import { randomUUID } from 'node:crypto'
import { QdrantClient } from '@qdrant/js-client-rest'
import type { Schemas } from '@qdrant/js-client-rest'
import type { Document } from '@langchain/core/documents'
import { usePino } from '~/core/plugins/pino.js'

const logger = usePino()

/**
 * RAG 向量存储层（Qdrant 官方客户端 @qdrant/js-client-rest）
 *
 * 为什么不用 @langchain/qdrant：LangChain 的 VectorStore 设计是「单 embedding 单向量」，
 * 不支持查询时动态指定命名向量；本项目需要单 collection 内按当前 embedding 模型维度
 * 自动选择命名向量，故直接使用 Qdrant 官方 REST 客户端（纯 JS，无原生模块）。
 *
 * 多命名向量设计（核心）：
 * - 单 collection（QDRANT_COLLECTION，默认 yokimind_rag）预设 5 档命名向量：
 *   vec_768 / vec_1024 / vec_1536 / vec_2048 / vec_3072（Cosine，on_disk 落盘），
 *   覆盖轻量开源模型 / BGE 中文主流 / OpenAI 经典 / 智谱高精度 / OpenAI Large。
 * - 写入与查询均按「当前 embedding 模型实际维度」选择同名命名向量（dimToVectorName），
 *   同名向量间检索互不干扰 —— 切换 embedding 模型（维度变化）无需重建 collection。
 * - 维度不在预设档时（如 512 / 256），ensureNamedVector 在写入/查询前用
 *   createVectorName 动态补建同名向量（Qdrant 1.10+ 支持），任何模型开箱即用。
 *
 * 语义对齐旧 PGVectorStore：
 * - score 即 Qdrant Cosine 相似度（越大越相似），对齐旧 scoreNormalization: 'similarity'
 * - payload = { content, ...metadata }：切片正文与业务元数据同存 payload
 *   （对齐旧 content 列 + metadata jsonb 列的语义）
 * - point id 用 randomUUID()（Qdrant 原生支持 UUID 字符串主键），项目 DB 主键仍为 ULID
 *
 * 就绪检查：本层不做 isEmbeddingReady 检查（构造不打 AI 请求），
 * 调用方（searchWiki / processJob）保留现有就绪检查与降级逻辑
 */

/** Qdrant collection 名（QDRANT_COLLECTION 可覆盖） */
const COLLECTION = process.env.QDRANT_COLLECTION || 'yokimind_rag'

/** 预设命名向量（创建 collection 时一次建齐；on_disk: 向量落盘不占内存，数据量大时内存友好） */
const PRESET_VECTORS: Record<string, Schemas['VectorParams']> = {
  vec_768: { size: 768, distance: 'Cosine', on_disk: true }, // 轻量开源模型
  vec_1024: { size: 1024, distance: 'Cosine', on_disk: true }, // 🏆 中文主流（BGE 等）
  vec_1536: { size: 1536, distance: 'Cosine', on_disk: true }, // OpenAI 经典
  vec_2048: { size: 2048, distance: 'Cosine', on_disk: true }, // 智谱等高精度
  vec_3072: { size: 3072, distance: 'Cosine', on_disk: true }, // OpenAI 最新 Large
}

/**
 * 维度 → 命名向量名映射
 * 预设档直接命中（vec_1024 等）；非预设档返回动态名（如 vec_512），
 * 由 ensureNamedVector 在写入/查询前动态补建
 */
function dimToVectorName(dim: number): string {
  const preset = Object.entries(PRESET_VECTORS).find(([, v]) => v.size === dim)
  if (preset) return preset[0]
  return `vec_${dim}`
}

/**
 * 检索/删除的 payload 过滤条件
 * 形态对齐旧 PGVectorStore 的 LangChain filter 写法（外部调用点零语义变化）：
 * - { wikiId } 按知识库过滤
 * - { documentId } 按单文档过滤
 * - { documentId: { in: [...] } } 按文档列表过滤（in 操作符）
 */
export interface RagVectorFilter {
  wikiId?: string
  documentId?: string | { in: string[] }
}

/** 向量检索命中条目（payload 即切片正文 + 业务元数据） */
export interface RagSearchHit {
  /** point id（UUID 字符串，作为 chunkId 透出） */
  id: string
  /** payload（content / wikiId / documentId / nodeId / headingPath / chunkIndex / charCount） */
  payload: Record<string, unknown>
  /** 相似度得分（Qdrant Cosine，越大越相似） */
  score: number
}

/** 将业务过滤条件转换为 Qdrant Filter（must 条件列表，逐字段精确匹配） */
function toQdrantFilter(filter: RagVectorFilter): Schemas['Filter'] {
  const must: Schemas['Condition'][] = []
  if (filter.wikiId !== undefined) {
    must.push({ key: 'wikiId', match: { value: filter.wikiId } })
  }
  if (filter.documentId !== undefined) {
    // 字符串 = 精确匹配；{ in: [...] } = match any（值集合内任一命中）
    if (typeof filter.documentId === 'string') {
      must.push({ key: 'documentId', match: { value: filter.documentId } })
    } else {
      must.push({ key: 'documentId', match: { any: filter.documentId.in } })
    }
  }
  return { must }
}

/** QdrantClient 单例（惰性初始化，避免每次请求重复 ensure collection 的连接开销） */
let client: QdrantClient | null = null

/** 已确认可用的命名向量维度缓存（进程内；resetRagVectorStore 时一并清空） */
const ensuredDims = new Set<number>()

/**
 * 确保 collection 内存在目标维度的命名向量，返回向量名
 * - 预设 5 档：collection 创建时已建齐，直接命中（打一次缓存标记）
 * - 非预设档：读 collection 配置检查，缺失则 createVectorName 动态补建（幂等）
 * - ensuredDims 进程内缓存：同维度重复写入/查询不再打 getCollection 请求
 *
 * @param dim 当前 embedding 模型的向量维度（AI_EMBEDDING_DIM）
 * @returns 命名向量名（vec_<dim>）
 */
async function ensureNamedVector(c: QdrantClient, dim: number): Promise<string> {
  const name = dimToVectorName(dim)
  // 预设档 + 已确认过的维度：直接返回（零网络请求）
  if (ensuredDims.has(dim) || dim in PRESET_VECTORS) {
    ensuredDims.add(dim)
    return name
  }

  // 非预设档：读 collection 配置确认该命名向量是否存在
  // vectors 配置形态有两种（公开 API / update_collection 写法），统一按普通对象窄化处理
  const info = await c.getCollection(COLLECTION)
  const vectors: unknown = info.config?.params?.vectors
  let namedVectors: Record<string, unknown> | null = null
  if (vectors && typeof vectors === 'object' && !Array.isArray(vectors)) {
    const v = vectors as Record<string, unknown>
    // { named: { vec_512: {...} } } 形态（update_collection 产物）优先取内层
    if ('named' in v && v.named && typeof v.named === 'object') {
      namedVectors = v.named as Record<string, unknown>
    } else {
      namedVectors = v
    }
  }

  if (!namedVectors || !(name in namedVectors)) {
    // 动态补建命名向量（Qdrant 1.10+）：只有 size/distance 是不可变属性，可后续补建
    await c.createVectorName(COLLECTION, name, { dense: { size: dim, distance: 'Cosine' } })
    logger.info({ collection: COLLECTION, vectorName: name, dimensions: dim }, 'dynamic named vector created')
  }
  ensuredDims.add(dim)
  return name
}

/**
 * 获取 RAG 向量存储客户端（惰性单例）
 * 首次调用幂等执行：
 * 1. collection 不存在则创建（带 5 档预设命名向量）
 * 2. wikiId / documentId payload 索引（删除与检索过滤的高频字段，缺索引时过滤退化为全量扫描）
 */
export async function getRagVectorStore(): Promise<QdrantClient> {
  if (client) return client

  // QDRANT_URL：dev 由 .env 提供（http://localhost:6333），生产由 compose 注入 http://qdrant:6333
  client = new QdrantClient({ url: process.env.QDRANT_URL || 'http://localhost:6333' })

  // 1. 幂等 ensure collection（存在则跳过）
  if (!(await client.collectionExists(COLLECTION)).exists) {
    await client.createCollection(COLLECTION, { vectors: PRESET_VECTORS })
    logger.info({ collection: COLLECTION, presets: Object.keys(PRESET_VECTORS) }, 'qdrant collection created with preset named vectors')
  }

  // 2. payload 字段索引（幂等）：重复 create 同 schema 是无害的覆盖操作
  await client.createPayloadIndex(COLLECTION, { field_name: 'wikiId', field_schema: 'keyword' })
  await client.createPayloadIndex(COLLECTION, { field_name: 'documentId', field_schema: 'keyword' })

  logger.info({ collection: COLLECTION, url: process.env.QDRANT_URL || 'http://localhost:6333' }, 'rag vector store (qdrant) initialized')
  return client
}

/**
 * 重置向量存储单例
 * 管理员保存新 embedding 配置后调用：置空后下次使用时按新配置重建客户端
 * （Qdrant 多命名向量设计下换模型通常无需任何迁移，此处仅对齐旧缓存重置语义）
 */
export function resetRagVectorStore(): void {
  client = null
  ensuredDims.clear()
}

/**
 * 批量写入切片向量（替代旧 store.addVectors）
 * - point id 由内部 randomUUID() 生成，调用方无需手工提供
 * - payload = { content: 切片正文, ...业务元数据 }（检索结果从 payload 取回）
 * - 写入前 ensureNamedVector：非预设维度动态补建，保证 upsert 不因向量缺失失败
 * - wait: true 等待写入落定（重试幂等：processJob 重跑时先删后插，不产生重复切片）
 *
 * @param vectors 向量列表（与 documents 一一对应，维度必须一致）
 * @param documents LangChain Document 列表（pageContent + metadata）
 * @param dim 当前 embedding 维度（决定写入哪个命名向量）
 */
export async function addChunks(vectors: number[][], documents: Document[], dim: number): Promise<void> {
  const c = await getRagVectorStore()
  const vectorName = await ensureNamedVector(c, dim)
  await c.upsert(COLLECTION, {
    wait: true,
    points: vectors.map((vector, i) => ({
      id: randomUUID(),
      // 命名向量格式：{ vec_1024: number[] }，写入该维度对应的向量空间
      vector: { [vectorName]: vector },
      payload: { content: documents[i].pageContent, ...documents[i].metadata },
    })),
  })
}

/**
 * 按 payload 过滤批量删除切片（替代旧 store.delete({ filter })）
 * @param filter { wikiId } / { documentId } / { documentId: { in: [...] } }
 */
export async function deleteChunks(filter: RagVectorFilter): Promise<void> {
  const c = await getRagVectorStore()
  await c.delete(COLLECTION, { wait: true, filter: toQdrantFilter(filter) })
}

/**
 * 向量相似度检索（替代旧 store.similaritySearchWithScore）
 * 用 client.query（v1.19 通用查询端点）+ using 指定命名向量：
 * - query 传查询向量（调用方已 embedQuery），在同名向量空间内做 Cosine 相似度检索
 * - score 即 Qdrant Cosine 相似度（越大越相似），语义与旧版一致
 *
 * @param queryVector 查询向量（embedQuery 产物）
 * @param dim 当前 embedding 维度（决定检索哪个命名向量）
 * @param filter 检索边界（通常 { wikiId }）
 * @param limit 返回条数
 */
export async function searchChunks(
  queryVector: number[],
  dim: number,
  filter: RagVectorFilter,
  limit: number,
): Promise<RagSearchHit[]> {
  const c = await getRagVectorStore()
  const vectorName = await ensureNamedVector(c, dim)
  const resp = await c.query(COLLECTION, {
    // 直接传向量 = nearest 向量检索（无需 prefetch，等价旧 search API）
    query: queryVector,
    using: vectorName,
    filter: toQdrantFilter(filter),
    limit,
    // payload 即切片正文 + 元数据，检索结果直接取回
    with_payload: true,
  })
  return resp.points.map((p) => ({
    id: String(p.id),
    payload: (p.payload ?? {}) as Record<string, unknown>,
    score: p.score,
  }))
}

/**
 * 统计指定知识库已入库切片数（payload wikiId 过滤精确计数）
 * @param wikiId 知识库 ID
 */
export async function countChunksByWiki(wikiId: string): Promise<number> {
  const c = await getRagVectorStore()
  const { count } = await c.count(COLLECTION, { filter: toQdrantFilter({ wikiId }), exact: true })
  return count
}
