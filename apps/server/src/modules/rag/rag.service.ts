import { count, desc, eq, inArray, max, sql, and } from 'drizzle-orm'
import { createHash } from 'node:crypto'
import { Document } from '@langchain/core/documents'
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'
import { AIMessage, BaseMessage, HumanMessage, SystemMessage } from '@langchain/core/messages'
import { StringOutputParser } from '@langchain/core/output_parsers'
import { z } from 'zod'
import { ragSync, wiki, wikiNodes, documents, wikiRag } from '~/db/schema.js'
import { usePostgres } from '~/core/plugins/postgres.js'
import { BizException } from '~/core/lib/biz.exception.js'
import { ErrorCode } from '~/config/error-code.js'
import { embedTexts, createChatModel, chatInvoke, rerankTexts, isEmbeddingReady, embedQuery } from '~/core/lib/ai.js'
import { getAiSettings } from '~/core/lib/ai-settings.js'
import { usePino } from '~/core/plugins/pino.js'
import { addIndexJob, addIndexJobs } from './rag.queue.js'
import { deleteChunks, addChunks, searchChunks } from './rag.store.js'

const logger = usePino()

// ============ 配置常量 ============

/** 切片目标字符数（中文按字符计） */
const CHUNK_SIZE = Number(process.env.RAG_CHUNK_SIZE || 600)
/** 相邻切片重叠字符数 */
const CHUNK_OVERLAP = Number(process.env.RAG_CHUNK_OVERLAP || 80)
/** 切分算法版本：参与内容指纹（算法 / 上下文增强策略变更时递增，旧指纹自动失效触发全量重建） */
const CHUNKER_VERSION = '2'
/** 默认检索返回条数（/rag/search 未传 topK 时的兜底） */
const DEFAULT_TOP_K = Number(process.env.RAG_TOP_K || 6)

// ============ 切片器 ============

/** Tiptap JSON 中的块级节点类型（递归提取文本时，子节点之间用换行拼接） */
const BLOCK_TYPES = new Set([
  'doc', 'paragraph', 'heading', 'bulletList', 'orderedList', 'listItem',
  'blockquote', 'codeBlock', 'table', 'tableRow', 'tableCell', 'tableHeader',
  'horizontalRule',
])

/** 切片产出结构 */
export interface DocChunk {
  /** 标题路径（"文档标题 > 一级标题 > 二级标题"） */
  headingPath: string
  /** 切片文本 */
  content: string
  /** 字符数 */
  charCount: number
}

/**
 * 从 Tiptap JSON 节点递归提取纯文本
 * - text 节点直接取 text
 * - 块级节点的子结果用换行拼接（保留段落结构，利于 embedding 语义完整）
 * - 行内节点的子结果直接拼接
 * @param node Tiptap JSON 节点
 * @returns 提取的文本
 */
export function extractText(node: unknown): string {
  if (!node || typeof node !== 'object') return ''
  const n = node as { type?: string; text?: string; content?: unknown[] }
  // 文本节点：直接返回文本内容
  if (n.type === 'text') return n.text ?? ''
  // 硬换行：转为换行符
  if (n.type === 'hardBreak') return '\n'
  // 图片等叶子节点：无文本贡献
  const kids = Array.isArray(n.content)
    ? n.content.map(extractText).filter(Boolean)
    : []
  if (kids.length === 0) return ''
  // 块级节点用换行连接子文本，行内节点直接拼接
  return kids.join(BLOCK_TYPES.has(n.type ?? '') ? '\n' : '')
}

/**
 * 兜底切分器（LangChain RecursiveCharacterTextSplitter）
 * 按分隔符（双换行 → 单换行 → 空格 → 硬切）递归寻找语义边界，
 * 相邻段重叠 CHUNK_OVERLAP 字符，避免句子在边界被硬切后语义丢失；
 * 中文文本无空格时自动退化为单字符硬切，行为与原裸滑窗等价
 */
const fallbackSplitter = new RecursiveCharacterTextSplitter({
  chunkSize: CHUNK_SIZE,
  chunkOverlap: CHUNK_OVERLAP,
})

/**
 * 超长文本切分（LangChain 版兜底）
 * @param text 待切文本（已 trim）
 * @param headingPath 该文本所属的标题路径
 * @param chunks 输出数组（原地追加）
 */
async function slidingWindow(text: string, headingPath: string, chunks: DocChunk[]): Promise<void> {
  // splitText 按输入顺序返回切片
  const segments = await fallbackSplitter.splitText(text)
  for (const seg of segments) {
    if (seg.trim()) {
      chunks.push({ headingPath, content: seg, charCount: seg.length })
    }
  }
}

/**
 * 文档切片器
 *
 * 策略（结构优先 + 滑窗兜底）：
 * 1. content 为 Tiptap JSON 时，遍历顶层块：
 *    - 遇到 heading 先落盘上一段缓冲（章节边界天然是语义边界），
 *      再把 headingPath 更新为「文档标题 > ... > 当前标题」
 *    - 文本块累积到 CHUNK_SIZE 字符即落盘；落盘时超长内容滑窗二次切分
 * 2. content 缺失/无文本时，退化为对 plainText 整体滑窗切分
 * 3. 两者皆无文本时返回空数组（该文档不产出切片，标题不单独索引）
 *
 * @param content Tiptap JSON（documents.content）
 * @param plainText 纯文本（documents.plainText）
 * @param title 文档标题（wiki_nodes.title，作为 headingPath 根）
 */
export async function chunkDocument(content: unknown, plainText: string | null | undefined, title: string): Promise<DocChunk[]> {
  const chunks: DocChunk[] = []
  // headingPath 根为文档标题
  const rootTitle = title || '未命名文档'
  // 多级标题栈：维护 heading 层级祖链（h3 下内容保留 h2/h1 祖先，P1 核心修复）
  let headingStack: { level: number; text: string }[] = []
  let buffer = ''

  /** 由「文档标题 + 标题栈」拼出当前 headingPath（如 "部署指南 > 数据库准备 > 连接池配置"） */
  const currentHeadingPath = () =>
    [rootTitle, ...headingStack.map((h) => h.text)].filter(Boolean).join(' > ')

  /** 落盘当前缓冲：trim 后按需切分 */
  const flush = async () => {
    const text = buffer.trim()
    buffer = ''
    if (!text) return
    // 落盘时取「此刻」的标题路径（heading 落盘发生在更新栈之前，内容落盘在更新栈之后）
    const headingPath = currentHeadingPath()
    // 略超目标长度（≤1.3 倍）时整段落盘，避免产生重叠碎片切片
    if (text.length <= CHUNK_SIZE * 1.3) {
      chunks.push({ headingPath, content: text, charCount: text.length })
      return
    }
    await slidingWindow(text, headingPath, chunks)
  }

  // 1. 结构化切片：Tiptap JSON 顶层块遍历
  const doc = content as { type?: string; content?: unknown[] } | null
  const blocks = doc?.type === 'doc' && Array.isArray(doc.content) ? doc.content : null

  if (blocks && blocks.length > 0) {
    for (const block of blocks) {
      const b = block as { type?: string; attrs?: { level?: number } }
      // 标题块：章节边界，先落盘上一段缓冲，再更新标题栈
      if (b?.type === 'heading') {
        await flush()
        const headingText = extractText(block).trim()
        if (headingText) {
          // level 取 heading attrs.level（1-6），缺省按 1 处理
          const level = Math.min(Math.max(b.attrs?.level ?? 1, 1), 6)
          // 弹出栈内所有层级 >= 当前标题的项（同级或更深层章节已结束），再压入当前标题
          while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= level) {
            headingStack.pop()
          }
          headingStack.push({ level, text: headingText })
        }
        continue
      }
      const text = extractText(block).trim()
      if (!text) continue
      buffer += (buffer ? '\n' : '') + text
      if (buffer.length >= CHUNK_SIZE) await flush()
    }
    await flush()
  } else if (plainText && plainText.trim()) {
    // 2. 兜底切片：无结构化内容时对 plainText 整体切分
    const text = plainText.trim()
    if (text.length <= CHUNK_SIZE * 1.3) {
      chunks.push({ headingPath: currentHeadingPath(), content: text, charCount: text.length })
    } else {
      await slidingWindow(text, currentHeadingPath(), chunks)
    }
  }

  return chunks
}

// ============ 任务队列（rag_sync 状态记录 + BullMQ 入队） ============

/**
 * 文档内容指纹：切分版本号 + 内容 JSON + 纯文本拼接后取 sha256 前 16 位
 * worker 处理时与上次索引的指纹比对，一致则跳过重复切片/向量化；
 * CHUNKER_VERSION 参与指纹：切分算法/上下文增强升级后旧指纹自动失效，触发全量重建（P7）
 */
export function computeContentHash(content: unknown, plainText: string | null): string {
  const raw = `${CHUNKER_VERSION}|${JSON.stringify(content ?? null)}\n${plainText ?? ''}`
  return createHash('sha256').update(raw).digest('hex').slice(0, 16)
}

// ============ wiki 级聚合快照（wiki_rag 表维护） ============

/**
 * 重聚合指定知识库的 RAG 状态快照并写回 wiki_rag 表（upsert，每库一行）
 *
 * 一条 SQL 完成：count FILTER（done / pending+running / failed）+ sum(chunk_count) + max(last_synced_at)，
 * 替代 /rag/status 的实时 GROUP BY + Qdrant countChunksByWiki 双查询（chunkCount 用
 * rag_sync.chunk_count 冗余列求和，语义基本等价且无需跨存储）。
 *
 * 容错：聚合/写入失败仅 warn 不抛出 —— 快照写失败不阻断主流程，
 * /rag/status 读取侧有懒重建兜底（见 statusOf）。
 *
 * @param wikiId 知识库 ID
 */
async function refreshWikiRag(wikiId: string): Promise<void> {
  try {
    const db = usePostgres()
    // 一条 SQL 聚合该库全部文档的同步状态（口径与 statusOf 一致：pending = pending + running）
    const [agg] = await db
      .select({
        total: count(),
        done: sql<number>`count(*) filter (where ${ragSync.status} = 'done')`.mapWith(Number),
        pending: sql<number>`count(*) filter (where ${ragSync.status} in ('pending', 'running'))`.mapWith(Number),
        failed: sql<number>`count(*) filter (where ${ragSync.status} = 'failed')`.mapWith(Number),
        chunkCount: sql<number>`coalesce(sum(${ragSync.chunkCount}), 0)`.mapWith(Number),
        lastSyncedAt: max(ragSync.lastSyncedAt),
      })
      .from(ragSync)
      .where(eq(ragSync.wikiId, wikiId))

    // upsert 快照行（wiki_id 唯一索引冲突时更新计数列）
    await db
      .insert(wikiRag)
      .values({
        wikiId,
        total: agg?.total ?? 0,
        done: agg?.done ?? 0,
        pending: agg?.pending ?? 0,
        failed: agg?.failed ?? 0,
        chunkCount: agg?.chunkCount ?? 0,
        lastSyncedAt: agg?.lastSyncedAt ? new Date(agg.lastSyncedAt) : null,
      })
      .onConflictDoUpdate({
        target: wikiRag.wikiId,
        set: {
          total: agg?.total ?? 0,
          done: agg?.done ?? 0,
          pending: agg?.pending ?? 0,
          failed: agg?.failed ?? 0,
          chunkCount: agg?.chunkCount ?? 0,
          lastSyncedAt: agg?.lastSyncedAt ? new Date(agg.lastSyncedAt) : null,
          updatedAt: new Date(),
        },
      })
  } catch (err) {
    // 快照维护失败不影响主流程（索引任务本身照常），读取侧懒重建可自愈
    logger.warn({ err, wikiId }, 'refresh wiki_rag snapshot failed')
  }
}

/**
 * 文档保存后入队索引任务（wiki.service.saveDocument 挂钩调用）
 * 1. upsert rag_sync 为 pending（状态记录，供 /rag/status 统计）
 * 2. 向 BullMQ/Redis 队列投递任务（jobId = documentId，waiting/active 中自动去重）
 *
 * @param documentId 文档 ID
 * @param wikiId 所属知识库 ID
 */
export async function enqueueDocument(documentId: string, wikiId: string): Promise<void> {
  const db = usePostgres()
  await db
    .insert(ragSync)
    .values({ documentId, wikiId, status: 'pending' })
    .onConflictDoUpdate({
      target: ragSync.documentId,
      // 重新入队：重置状态与错误，清空尝试次数（允许重新处理）
      set: { status: 'pending', error: null, attempts: 0, updatedAt: new Date() },
    })
  // 快照刷新：pending 计数 +1，Dashboard 圆点立即转「索引中」（蓝）
  await refreshWikiRag(wikiId)
  await addIndexJob({ documentId, wikiId })
}

/**
 * 批量清理文档的索引数据（删除节点挂钩调用）
 * 同时删除 rag_sync 状态行与 Qdrant 切片数据
 * @param documentIds 待清理的文档 ID 列表
 */
export async function removeDocuments(documentIds: string[]): Promise<void> {
  if (documentIds.length === 0) return
  const db = usePostgres()
  // 删前收集涉及的库（文档可能来自多个库），删完后逐库刷新快照
  const affected = await db
    .selectDistinct({ wikiId: ragSync.wikiId })
    .from(ragSync)
    .where(inArray(ragSync.documentId, documentIds))
  await db.delete(ragSync).where(inArray(ragSync.documentId, documentIds))
  // 切片按 payload.documentId 过滤删除（Qdrant match any）
  await deleteChunks({ documentId: { in: documentIds } })
  // 快照刷新：被删文档的计数从快照中扣除（删除后 refresh 无 wiki_rag 行的库会懒创建）
  await Promise.all(affected.map((row) => refreshWikiRag(row.wikiId)))
}

/**
 * 清理整个知识库的索引数据（删除知识库挂钩调用）
 * @param wikiId 知识库 ID
 */
export async function removeWiki(wikiId: string): Promise<void> {
  const db = usePostgres()
  await db.delete(ragSync).where(eq(ragSync.wikiId, wikiId))
  // 库已删除，快照行一并清理（无孤儿行）
  await db.delete(wikiRag).where(eq(wikiRag.wikiId, wikiId))
  // 切片按 payload.wikiId 过滤删除
  await deleteChunks({ wikiId })
}

// ============ 单任务处理（切片 → 向量化 → 入库） ============

/**
 * 处理单个索引任务（BullMQ Worker 的消费入口）
 *
 * 流程：
 * 1. 读取 rag_sync 状态行（不存在说明文档已删除清理过，直接完成）
 * 2. 标记 running
 * 3. 读取文档（join wiki_nodes 取标题与节点 ID）
 * 4. 内容指纹与上次一致 → 直接置 done（跳过重复向量化，省 API 费用）
 * 5. 切片 → 批量向量化 → 事务内「删旧插新」重建该文档切片 → 置 done
 * 6. 任意失败 → attempts + 1 并记 error，随后向 BullMQ 抛出，
 *    由队列按 defaultJobOptions（3 次尝试 + 指数退避）自动重试
 *
 * 注：embedding 未就绪的降级检查在 worker 处理器中完成（moveToDelayed 延迟重试，不消耗 attempts）
 *
 * @param documentId 文档 ID（jobId，即 rag_sync.documentId）
 */
export async function processJob(documentId: string): Promise<void> {
  const db = usePostgres()

  // 1. 取任务状态行（BullMQ 以 documentId 为 jobId 派发）
  const [task] = await db.select().from(ragSync).where(eq(ragSync.documentId, documentId)).limit(1)
  if (!task) return

  // 2. 标记 running（/rag/status 展示「处理中」；进程崩溃遗留由 worker 启动恢复兜底）
  await db
    .update(ragSync)
    .set({ status: 'running', updatedAt: new Date() })
    .where(eq(ragSync.id, task.id))

  try {
    // 3. 读取文档内容（join 节点表取标题/节点 ID，节点可能已被删除）
    const [doc] = await db
      .select({
        id: documents.id,
        wikiId: documents.wikiId,
        nodeId: documents.nodeId,
        content: documents.content,
        plainText: documents.plainText,
        title: wikiNodes.title,
        isDeleted: wikiNodes.isDeleted,
      })
      .from(documents)
      .leftJoin(wikiNodes, eq(documents.nodeId, wikiNodes.id))
      .where(eq(documents.id, documentId))
      .limit(1)

    // 文档已被删除：连带清理任务行后返回
    if (!doc) {
      await db.delete(ragSync).where(eq(ragSync.id, task.id))
      return
    }

    // 节点已进入回收站（软删除）：任务直接置 done 跳过向量化，避免残留队列任务 /
    // 全量重建对回收站文档浪费 embedding 费用。切片保留不清理（恢复后索引仍在，零成本还原），
    // 检索侧 retrieveChunks 已实时过滤回收站内容，不影响问答 / 搜索正确性
    if (doc.isDeleted) {
      await db
        .update(ragSync)
        .set({ status: 'done', lastSyncedAt: new Date(), updatedAt: new Date() })
        .where(eq(ragSync.id, task.id))
      await refreshWikiRag(task.wikiId)
      return
    }

    // 4. 指纹比对：内容未变化且上次处理状态非 failed → 直接置 done，跳过重复向量化
    //    （failed 任务即使 hash 相同也强制重跑，给暂时性故障恢复的机会；reindex 会置空 hash 全量重建）
    const hash = computeContentHash(doc.content, doc.plainText)
    if (task.contentHash === hash && task.status !== 'failed') {
      await db
        .update(ragSync)
        .set({ status: 'done', lastSyncedAt: new Date(), updatedAt: new Date() })
        .where(eq(ragSync.id, task.id))
      // 快照刷新：pending-1 / done+1
      await refreshWikiRag(task.wikiId)
      return
    }

    // 5. 切片（结构化优先 + LangChain 兜底切分）
    const chunks = await chunkDocument(doc.content, doc.plainText, doc.title ?? '未命名文档')

    if (chunks.length === 0) {
      // 空文档：清空旧切片，任务完成
      await deleteChunks({ documentId: doc.id })
      await db
        .update(ragSync)
        .set({
          status: 'done',
          contentHash: hash,
          chunkCount: 0,
          error: null,
          lastSyncedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(ragSync.id, task.id))
      // 快照刷新：pending-1 / done+1（空文档无切片，chunkCount 不变）
      await refreshWikiRag(task.wikiId)
      return
    }

    // 6. 批量向量化（embedTexts 内部分批 + 维度校验，防止换模型后维度不符）
    const vectors = await embedTexts(chunks.map((ch) => ch.content))

    // 7. 向量存储「删旧插新」+ 更新任务状态
    // 说明：Qdrant 写入与 drizzle 事务无法原子化；
    // 一致性由「先删后插 + 失败落 rag_sync(failed) + BullMQ 重试幂等」保证
    // （重试时再次先删后插，不产生重复切片）
    await deleteChunks({ documentId: doc.id })
    // embeddingDim 决定写入哪个命名向量（预设 5 档 / 非预设动态补建，见 rag.store.ts）
    const settings = await getAiSettings()
    await addChunks(
      vectors,
      chunks.map((ch, i) => new Document({
        pageContent: ch.content,
        metadata: {
          wikiId: doc.wikiId,
          documentId: doc.id,
          nodeId: doc.nodeId,
          chunkIndex: i,
          headingPath: ch.headingPath,
          charCount: ch.charCount,
        },
      })),
      settings.embeddingDim,
    )
    await db
      .update(ragSync)
      .set({
        status: 'done',
        contentHash: hash,
        chunkCount: chunks.length,
        error: null,
        lastSyncedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(ragSync.id, task.id))
    // 快照刷新：pending-1 / done+1 / chunkCount 增量
    await refreshWikiRag(task.wikiId)

    logger.info({ documentId: doc.id, chunks: chunks.length }, 'rag index done')
  } catch (err) {
    // 失败：累计尝试次数并记录错误信息（供 /rag/status 与排查），再抛出交给 BullMQ 重试
    const message = err instanceof Error ? err.message : String(err)
    logger.warn({ err, documentId, attempts: task.attempts + 1 }, 'rag index failed')
    await db
      .update(ragSync)
      .set({
        status: 'failed',
        attempts: task.attempts + 1,
        error: message.slice(0, 500),
        updatedAt: new Date(),
      })
      .where(eq(ragSync.id, task.id))
    // 快照刷新：pending-1 / failed+1（BullMQ 重试再入队时 enqueueDocument 侧会再刷新）
    await refreshWikiRag(task.wikiId)
    throw err
  }
}

// ============ 权限校验 ============

/**
 * 校验当前用户对知识库的访问权限（RAG 模块独立实现，避免与 wiki.service 循环依赖）
 * 不存在或非 owner → RAG_WIKI_FORBIDDEN（不泄露存在性）
 * 注：当前 wiki_members 尚未启用协作，先校验 ownerId；后续接入协作时在此扩展成员校验
 * @param wikiId 知识库 ID
 * @param userId 当前登录用户 ID
 */
async function assertWikiAccess(wikiId: string, userId: string): Promise<void> {
  const db = usePostgres()
  const [row] = await db.select({ ownerId: wiki.ownerId }).from(wiki).where(eq(wiki.id, wikiId)).limit(1)
  if (!row || row.ownerId !== userId) {
    throw new BizException(ErrorCode.RAG_WIKI_FORBIDDEN)
  }
}

// ============ 语义检索 ============

/** 检索结果条目 */
export interface RagSearchResult {
  chunkId: string
  documentId: string
  nodeId: string | null
  /** 文档标题（wiki_nodes.title） */
  title: string | null
  /** 标题路径 */
  headingPath: string | null
  /** 切片内容 */
  content: string
  /** 相似度得分（1 - cosine 距离，越大越相似） */
  score: number
}

/**
 * 语义检索核心（不含权限校验）：
 * embedding 就绪检查 + 查询向量化 + Qdrant 命名向量召回 + 实时补标题
 *
 * 权限由调用方先行校验：
 * - searchWiki（owner 场景）：assertWikiAccess 校验归属
 * - buildChatContext（访客问答场景）：share 模块的 shareAuthMiddleware 实时复核分享可见性
 *
 * @param wikiId 知识库 ID（检索边界，走 payload.wikiId 过滤）
 * @param query 查询文本
 * @param limit 返回条数（调用方已完成钳制，1-20）
 */
async function retrieveChunks(wikiId: string, query: string, limit: number): Promise<RagSearchResult[]> {
  // embedding 服务未就绪时拒绝服务（key 配好后自动恢复）
  if (!(await isEmbeddingReady())) {
    throw new BizException(ErrorCode.RAG_NOT_CONFIGURED)
  }

  // 检索两步：查询向量化（embedQuery）→ Qdrant 命名向量召回
  // （旧 PGVectorStore 的 similaritySearchWithScore 内部自动 embed query；
  //   Qdrant 客户端不含 AI 能力，需显式两步，维度决定检索哪个命名向量）
  let hits
  try {
    const queryVector = await embedQuery(query)
    const { embeddingDim } = await getAiSettings()
    hits = await searchChunks(queryVector, embeddingDim, { wikiId }, limit)
  } catch (err) {
    // 检索期向量化 / Qdrant 查询等原始错误（openai APIError、连接失败等）包成业务异常：
    // 否则会冒泡到全局 errorHandler 变成 HTTP 500 { status: 0 }，前端无法识别错误码
    logger.warn({ err, wikiId }, 'vector search failed')
    throw new BizException(ErrorCode.RAG_EMBEDDING_FAILED)
  }

  // 实时补标题 + 回收站过滤：文档改名后 payload 不随动，按 nodeId 批量回查 wikiNodes 保证展示准确
  // 回收站（软删除）节点必须在此实时剔除 —— 软删除仅打 is_deleted 标记、切片保留以支持恢复，
  // 向量库中仍可被召回，与关键词搜索（wiki-search 的 isDeleted = false 口径）对齐，
  // 否则回收站文档内容会作为 AI 引用 / 搜索结果出现
  const nodeIds = [...new Set(hits.map((h) => h.payload.nodeId).filter((id): id is string => Boolean(id)))]
  const titleMap = new Map<string, string>()
  const trashedNodeIds = new Set<string>()
  if (nodeIds.length > 0) {
    const db = usePostgres()
    const rows = await db
      .select({ id: wikiNodes.id, title: wikiNodes.title, isDeleted: wikiNodes.isDeleted })
      .from(wikiNodes)
      .where(inArray(wikiNodes.id, nodeIds))
    for (const row of rows) {
      titleMap.set(row.id, row.title)
      if (row.isDeleted) trashedNodeIds.add(row.id)
    }
  }

  return hits
    .filter((h) => {
      // 回收站文档的切片不参与召回；nodeId 缺失的异常数据无法判定归属，保持原行为不剔除
      const nodeId = h.payload.nodeId as string | undefined
      return !nodeId || !trashedNodeIds.has(nodeId)
    })
    .map((h) => ({
    chunkId: h.id,
    documentId: (h.payload.documentId as string) ?? '',
    nodeId: (h.payload.nodeId as string) ?? null,
    title: h.payload.nodeId ? (titleMap.get(h.payload.nodeId as string) ?? null) : null,
    headingPath: (h.payload.headingPath as string) ?? null,
    content: (h.payload.content as string) ?? '',
    score: Number(h.score.toFixed(4)),
  }))
}

/**
 * 语义搜索：多路召回 + 阈值 + rerank 精排（与问答共用检索管线，检索质量一致）
 *
 * 与问答的差异（PRD 6.3.7）：
 * - 无意图分析：仅轻量 expandSearchQueries 扩展变体（失败/未配置单路）
 * - 阈值后为空返回 []（前端展示空态），而非兜底文案
 * - 返回条数为请求参数 topK（而非固定的 RAG_FINAL_TOP_K）
 *
 * @param wikiId 知识库 ID（检索边界，走 metadata.wikiId 过滤）
 * @param query 查询文本
 * @param topK 返回条数（默认 RAG_TOP_K）
 * @param userId 当前用户（权限校验）
 */
export async function searchWiki(wikiId: string, query: string, topK: number | undefined, userId: string): Promise<RagSearchResult[]> {
  // 权限校验（越权/不存在抛 RAG_WIKI_FORBIDDEN）
  await assertWikiAccess(wikiId, userId)

  const limit = Math.min(Math.max(topK ?? DEFAULT_TOP_K, 1), 20)
  // 轻量查询扩展（一次 LLM，5s 超时，失败单路）：返回 ≤2 个变体
  const variants = await expandSearchQueries(query)
  // 共用检索管线：多路并发召回 → 融合去重 → 阈值 → rerank 精排（按请求 topK 截断）
  return retrieveContext(wikiId, query, variants, limit)
}

// ============ AI 问答（RAG 编排） ============

/** 问答引用来源 */
export interface RagChatSource {
  chunkId: string
  documentId: string
  nodeId: string | null
  title: string | null
  headingPath: string | null
  score: number
  /** 前端跳转链接 /w/{wikiId}/{nodeId}（nodeId 缺失时为 null） */
  url: string | null
}

// ============ 多路召回 + 融合去重 + 阈值 + rerank 精排（问答 / 搜索共用检索管线） ============

/** 融合候选：单条检索结果 + 多路命中信息 */
interface FusedCandidate {
  /** 原始检索结果 */
  result: RagSearchResult
  /** 各路最高向量分（阈值过滤的作用对象，bge-m3 cosine 量纲） */
  bestScore: number
  /** 被几路命中（越多越可能是「翻译不变」的真正相关内容） */
  hitCount: number
  /** 排序分 = bestScore × (1 + 0.1 × (hitCount − 1))，加性加权（多路命中只加成、不翻倍碾压单路强相关） */
  combined: number
}

/**
 * 多路并发向量召回 + 融合去重 + 阈值过滤（P3 语义鸿沟 / P4 整体不相关）
 *
 * 流程（PRD 6.3.2/6.3.3/6.3.4）：
 * 1. routes = [改写问题, ...扩展变体] Promise.all 并发检索；
 *    单路（无变体）时该路召回量取 RAG_RECALL_SIZE，多路时每路取一半（融合后总量≈RECALL_SIZE）
 * 2. 融合去重：以 chunkId 为 key 合并，bestScore 取各路最高向量分，hitCount 累计命中路数；
 *    combined = bestScore × (1 + 0.1 × (hitCount − 1))，按 combined 降序截取 RAG_RECALL_SIZE 条
 * 3. 阈值过滤：bestScore < RAG_MIN_SCORE 的候选剔除；全部低于阈值返回空 → 上层走兜底/空态
 *    （阈值作用于向量分而非 rerank 分：与前端 score 语义跨端一致，rerank 分仅排序）
 *
 * @param wikiId 知识库 ID（检索边界）
 * @param routes 检索路由（≥1 条；通常为首条改写问题 + ≤2 个扩展变体）
 */
async function multiRouteRecall(wikiId: string, routes: string[]): Promise<FusedCandidate[]> {
  const settings = await getAiSettings()
  const recallSize = Math.min(Math.max(Math.round(settings.ragRecallSize), 1), 50)
  // 多路时每路召回量减半（两路各 10 条，融合去重后进入精排的池子仍是 recallSize 量级）
  const perRoute = routes.length > 1 ? Math.ceil(recallSize / 2) : recallSize

  // 并发检索：某一路失败不拖垮整体（部分失败降级为「仅剩的路」，warn 记录）
  const settled = await Promise.allSettled(routes.map((q) => retrieveChunks(wikiId, q, perRoute)))
  const routeResults = settled
    .filter((s): s is PromiseFulfilledResult<RagSearchResult[]> => s.status === 'fulfilled')
    .map((s) => s.value)

  // 全部失败：向上抛出首个错误（embedding 未就绪的 RAG_NOT_CONFIGURED 等业务异常需传给调用方）
  if (routeResults.length === 0) {
    const firstRejected = settled.find((s): s is PromiseRejectedResult => s.status === 'rejected')
    throw (firstRejected?.reason ?? new BizException(ErrorCode.RAG_NOT_CONFIGURED))
  }
  if (routeResults.length < routes.length) {
    logger.warn({ failed: routes.length - routeResults.length }, 'some recall routes failed, degrade to partial routes')
  }

  // 融合去重：同 chunk 取各路最高向量分为 bestScore，累计 hitCount
  const map = new Map<string, FusedCandidate>()
  for (const results of routeResults) {
    for (const r of results) {
      const existing = map.get(r.chunkId)
      if (!existing) {
        map.set(r.chunkId, { result: r, bestScore: r.score, hitCount: 1, combined: r.score })
      } else {
        existing.bestScore = Math.max(existing.bestScore, r.score)
        existing.hitCount += 1
      }
    }
  }

  // 加性加权排序分，按 combined 降序截取 recallSize 条进入精排
  const candidates = [...map.values()]
  for (const c of candidates) {
    c.combined = c.bestScore * (1 + 0.1 * (c.hitCount - 1))
  }
  candidates.sort((a, b) => b.combined - a.combined)
  const top = candidates.slice(0, recallSize)

  // 阈值过滤（P4）：全部候选低于阈值 → 返回空（宁可说不知道，不可编造）
  const filtered = top.filter((c) => c.bestScore >= settings.ragMinScore)
  if (top.length > 0 && filtered.length === 0) {
    logger.info({ minScore: settings.ragMinScore, candidates: top.length }, 'all recall candidates below min score')
  }
  return filtered
}

/**
 * 检索上下文（问答 / 搜索共用管线末段）：多路召回 → 阈值 → rerank 精排 → Top N
 *
 * @param wikiId 知识库 ID（检索边界）
 * @param rewritten 主查询（改写后的独立问题 / 搜索原文）
 * @param variants 查询扩展变体（≤2 个；扩展开关关闭时上层传入空数组 → 单路）
 * @param finalCount 精排保留条数（缺省取 RAG_FINAL_TOP_K；搜索场景传请求 topK）
 * @returns 阈值后为空返回 []（问答上层走兜底出口②，搜索上层返回空态）
 */
async function retrieveContext(
  wikiId: string,
  rewritten: string,
  variants: string[],
  finalCount?: number,
  onStage?: (stage: ChatStage) => Promise<void> | void,
): Promise<RagSearchResult[]> {
  const settings = await getAiSettings()
  const topN = Math.min(Math.max(Math.round(finalCount ?? settings.ragFinalTopK), 1), 20)

  // 多路并发召回 + 融合去重 + 阈值过滤
  const routes = [rewritten, ...variants].map((q) => q.trim()).filter(Boolean)
  if (routes.length === 0) return []
  const candidates = await multiRouteRecall(wikiId, routes)
  if (candidates.length === 0) return []

  // 阶段推送：召回完成、进入精排（SSE stage 事件，供前端显示阶段进度）
  await onStage?.('reranking')

  // GLM rerank 精排：rerank 文档文本带 headingPath 语境（与向量化输入同构：路径 + 正文）
  const docs = candidates.map((c) =>
    c.result.headingPath ? `${c.result.headingPath}\n${c.result.content}` : c.result.content,
  )
  const indices = await rerankTexts(rewritten, docs, topN)

  if (indices) {
    // 精排生效：按 rerank 分降序取 Top N；score 字段仍回填向量分（前端展示与阈值语义跨端一致）
    return indices
      .filter((i) => i >= 0 && i < candidates.length)
      .map((i) => candidates[i].result)
      .slice(0, topN)
  }
  // rerank 未配置 / 请求失败（fail-open）：向量序（combined 序）直接取 Top N
  return candidates.slice(0, topN).map((c) => c.result)
}

// ============ 意图识别 + 问题改写 + 查询扩展（三合一，一次 LLM 调用） ============

/** 对话历史条目（前端内存维护 max 10 轮，请求透传，服务端不落库） */
export interface ChatHistoryItem {
  question: string
  answer: string
}

/** 意图分析结果（可观测：intent 分布 / 规则命中率 / 扩展变体数 / 耗时） */
export interface IntentAnalysis {
  /** kb = 知识库查询（含基于历史的追问）；chitchat = 闲聊（短路不检索不生成） */
  intent: 'kb' | 'chitchat'
  /** 改写后的独立检索问题（指代消解 + 补全省略主语）；检索用 rewritten，展示仍用原始 question */
  rewritten: string
  /** 查询扩展变体（≤2 个，口语/正式不同措辞），用于多路召回 */
  variants: string[]
  /** 是否被「纯闲聊正则」直接命中（零 LLM 成本分流） */
  ruleHit: boolean
  /** 分析耗时（毫秒） */
  latencyMs: number
}

/**
 * 纯闲聊显式模式正则（规则前置，零成本拦截高频打招呼/在吗等）
 * 只拦「整条输入即闲聊」的显式模式，不命中不强行猜（避免误伤真实提问）
 */
const CHITCHAT_PATTERN =
  /^(你好|您好|哈喽|哈罗|嗨|hi|hello|hey|halo|在吗|在么|在不在|早上好|上午好|中午好|下午好|晚上好|晚安|你好呀|hi there)([!！。.?？~～\s]*)$/i

/** 意图/改写分析 LLM 的 JSON 输出结构（zod 校验，任何失败 fail-open） */
const AnalysisJsonSchema = z.object({
  // 意图缺失（纯 condense 场景不要求模型输出 intent）时默认 kb（宁可多一次检索，不可误伤真实提问）
  intent: z.enum(['kb', 'chitchat']).optional().default('kb'),
  rewritten: z.string().min(1).max(2000),
  variants: z.array(z.string().min(1).max(50)).max(2).optional().default([]),
})

/**
 * 从 LLM 响应中容错提取第一个 JSON 对象（正则取 {...} 块 → JSON.parse）
 * 提取或解析失败返回 null（调用方 fail-open）
 */
function extractJsonObject(text: string): unknown | null {
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) return null
  try {
    return JSON.parse(match[0])
  } catch {
    return null
  }
}

/**
 * 拼接对话历史块（分析 prompt 用）：最近 maxTurns 轮，答案截断 answerLimit 字
 * @param history 对话历史（前端透传）
 * @param maxTurns 取最近几轮
 * @param answerLimit 每条答案截断长度
 */
function buildHistoryBlock(history: ChatHistoryItem[], maxTurns: number, answerLimit: number): string {
  const recent = history.slice(-maxTurns)
  if (recent.length === 0) return ''
  const lines = recent.map((t) => `用户：${t.question}\n助手：${t.answer.slice(0, answerLimit) || '（无回答）'}`)
  return `【对话历史】\n${lines.join('\n')}\n`
}

/** 通用失败兜底结果：intent=kb、rewritten=原文、无变体（fail-open，仅由调用方记日志） */
function failOpenResult(question: string, start: number, ruleHit = false): IntentAnalysis {
  return { intent: 'kb', rewritten: question, variants: [], ruleHit, latencyMs: Date.now() - start }
}

/**
 * 意图识别 + 问题改写 + 查询扩展（三合一次 LLM 调用，PRD 6.2）
 *
 * 降级链（每级独立 fail-open，绝不阻断问答）：
 * - 意图开关关闭：有 history → 纯 condense 改写调用（prompt 去意图段，仍可产变体，受扩展开关独立控制）；
 *   无 history → 零 LLM 调用（rewritten=原文、variants=[]）
 * - 规则前置：纯闲聊正则命中 → intent=chitchat（零 LLM）
 * - LLM 调用失败/超时(8s) / JSON 提取失败 / zod 校验失败 → fail-open（intent=kb、rewritten=原文、variants=[]）
 *
 * 不变量：检索用改写后的 rewritten；prompt 与前端展示仍用原始 question
 *
 * @param question 用户最新输入（原始）
 * @param history 对话历史（前端透传，可空）
 */
export async function analyzeIntentAndRewrite(question: string, history: ChatHistoryItem[]): Promise<IntentAnalysis> {
  const start = Date.now()
  const settings = await getAiSettings()

  // 1. 意图开关关闭：不分流（恒 kb），有历史退纯改写
  if (!settings.ragIntentEnabled) {
    if (history.length === 0) {
      return failOpenResult(question, start)
    }
    const condensed = await condenseQuestion(question, history, settings.ragQueryExpansionEnabled)
    return {
      intent: 'kb',
      rewritten: condensed?.rewritten || question,
      variants: condensed?.variants ?? [],
      ruleHit: false,
      latencyMs: Date.now() - start,
    }
  }

  // 2. 规则前置：纯闲聊显式模式直接分流（零 LLM 成本）
  if (CHITCHAT_PATTERN.test(question.trim())) {
    return { intent: 'chitchat', rewritten: question, variants: [], ruleHit: true, latencyMs: Date.now() - start }
  }

  // 3. 三合一 LLM 调用：意图 + 改写 + 扩展（一次调用，吸收「独立意图识别多一秒延迟」的教训）
  const historyBlock = buildHistoryBlock(history, 3, 500)
  const expansionRules = settings.ragQueryExpansionEnabled
    ? `variants 规则：将 rewritten 用不同措辞改写成 2 个同义变体查询（覆盖口语/正式等不同表述，例如「数据库挂了怎么办」→「数据库无法连接如何处理」），每个 ≤ 50 字；其他意图输出空数组 []。`
    : `variants 规则：本次不需要查询扩展，恒输出空数组 []。`
  const prompt = [
    '你是知识库问答系统的意图分析器。分析用户最新输入，只输出一个 JSON 对象，不要输出任何其他内容：',
    '{"intent": "kb|chitchat", "rewritten": "...", "variants": ["...", "..."]}',
    '',
    '意图定义：',
    '- kb：答案可能在知识库文档中的问题（业务流程、操作步骤、规范、技术内容），包括需要结合上下文理解的追问',
    '- chitchat：打招呼、闲聊、与知识库文档无关的请求',
    '无法判断时 intent 取 kb。',
    '',
    'rewritten 规则：intent 为 kb 时，将最新输入结合对话历史改写为不依赖上下文、语义完整的独立检索问题（指代消解、补全省略主语）；其他意图填原文。',
    '',
    expansionRules,
    '',
    historyBlock ? `${historyBlock}\n` : '',
    `【最新输入】${question}`,
  ].join('\n')

  try {
    // 8s 超时：分析是检索前置步骤，超时即 fail-open（chatInvoke 中止后返回空串，走解析失败分支）
    const raw = await chatInvoke([{ role: 'user', content: prompt }], { signal: AbortSignal.timeout(8_000) })
    const parsed = AnalysisJsonSchema.safeParse(extractJsonObject(raw))
    if (!parsed.success) {
      logger.warn({ raw: raw.slice(0, 200) }, 'intent analysis json invalid, fail-open to kb')
      return failOpenResult(question, start)
    }
    // 扩展开关关闭时强制单路（双开关独立控制，互不耦合死锁）
    const variants = settings.ragQueryExpansionEnabled ? parsed.data.variants : []
    return { intent: parsed.data.intent, rewritten: parsed.data.rewritten, variants, ruleHit: false, latencyMs: Date.now() - start }
  } catch (err) {
    logger.warn({ err }, 'intent analysis llm call failed, fail-open to kb')
    return failOpenResult(question, start)
  }
}

/**
 * 纯问题改写（condense，意图开关关闭且有历史时的退化路径）
 * prompt 去意图段，仅产出 rewritten + variants（变体受扩展开关独立控制）
 *
 * @returns 改写结果；LLM 失败/解析失败返回 null（调用方回退原文）
 */
async function condenseQuestion(
  question: string,
  history: ChatHistoryItem[],
  withVariants: boolean,
): Promise<{ rewritten: string; variants: string[] } | null> {
  const historyBlock = buildHistoryBlock(history, 3, 500)
  const variantsRule = withVariants
    ? '并用不同措辞产出 2 个同义变体查询（每个 ≤ 50 字）'
    : '本次不需要查询扩展，variants 恒输出空数组 []'
  const prompt = [
    '你是知识库问答系统的检索改写器。结合对话历史，将最新输入改写为不依赖上下文、语义完整的独立检索问题（指代消解、补全省略主语），',
    `${variantsRule}。只输出一个 JSON 对象，不要输出任何其他内容：`,
    '{"rewritten": "...", "variants": ["...", "..."]}',
    '',
    historyBlock ? `${historyBlock}\n` : '',
    `【最新输入】${question}`,
  ].join('\n')

  try {
    const raw = await chatInvoke([{ role: 'user', content: prompt }], { signal: AbortSignal.timeout(8_000) })
    const parsed = AnalysisJsonSchema.safeParse(extractJsonObject(raw))
    if (!parsed.success) {
      logger.warn({ raw: raw.slice(0, 200) }, 'condense json invalid, fallback to original question')
      return null
    }
    return {
      rewritten: parsed.data.rewritten,
      variants: withVariants ? parsed.data.variants : [],
    }
  } catch (err) {
    logger.warn({ err }, 'condense llm call failed, fallback to original question')
    return null
  }
}

/**
 * 语义搜索查询扩展（轻量版，与问答的意图分析分离）
 * 一次 chatInvoke 产出 ≤2 个变体（JSON 数组、5s 超时）；失败 / chat 未配置 / 扩展开关关闭 → 返回 []（单路检索）
 */
export async function expandSearchQueries(query: string): Promise<string[]> {
  const settings = await getAiSettings()
  // 扩展开关关闭或 chat 服务未配置：单路（无感降级）
  if (!settings.ragQueryExpansionEnabled) return []
  if (!(settings.baseUrl && settings.apiKey)) return []

  const prompt = [
    '你是搜索引擎的查询扩展器。将用户查询用不同措辞改写成 2 个同义变体（覆盖口语/正式等不同表述），每个变体 ≤ 50 字。',
    '只输出一个 JSON 数组，不要输出任何其他内容，如 ["变体一","变体二"]。',
    '',
    `【查询】${query}`,
  ].join('\n')

  try {
    const raw = await chatInvoke([{ role: 'user', content: prompt }], { signal: AbortSignal.timeout(5_000) })
    // 容错提取：正则取响应中第一个 [...] 数组块
    const match = raw.match(/\[[\s\S]*\]/)
    if (!match) return []
    const parsed = z.array(z.string().min(1).max(50)).max(2).safeParse(JSON.parse(match[0]))
    return parsed.success ? parsed.data : []
  } catch (err) {
    logger.warn({ err }, 'expand search queries failed, degrade to single route')
    return []
  }
}

// ============ AI 问答编排（三出口：闲聊 / 兜底 / 正常生成） ============

/** 出口①闲聊固定引导文案（不检索不生成，秒回） */
const CHITCHAT_REPLY =
  '我是本知识库的 AI 助手，专注于回答库内文档相关问题。您可以试着问我文档中的业务流程、操作步骤等内容～'
/** 出口②兜底文案（后接可点击推荐文档 sources） */
const FALLBACK_REPLY = '知识库中暂无相关内容，您可以参考以下文档，或换个表述再试：'

/** 问答准备结果（三出口形态，权限/意图/检索/兜底判定全部在 SSE 流开始前完成——流一旦开始无法改状态码） */
export type PreparedChat =
  /** 出口①：闲聊短路（固定引导文案，sources 为空） */
  | { kind: 'chitchat'; replyText: string; sources: RagChatSource[] }
  /** 出口②：阈值后无相关内容（兜底文案 + 推荐文档，0 次生成调用） */
  | { kind: 'fallback'; replyText: string; sources: RagChatSource[] }
  /** 出口③：正常问答（LangChain 消息链流式生成 + 检索来源） */
  | { kind: 'kb'; messages: BaseMessage[]; sources: RagChatSource[] }

/**
 * 兜底推荐：该库最近更新的 4 篇文档（wikiNodes 按 updatedAt desc），以 sources 形态推送
 * （D7 决策：前端现有来源卡片零改动即可点击跳转；chunkId 用 recommended: 前缀合成唯一 key，
 *  避免前端 v-for :key 重复；score 0 仅为占位）
 */
async function recommendRecentNodes(wikiId: string, limit: number): Promise<RagChatSource[]> {
  const db = usePostgres()
  // 排除回收站节点（isDeleted = true）：兜底推荐不能把已删除文档推给用户
  const rows = await db
    .select({ id: wikiNodes.id, documentId: wikiNodes.documentId, title: wikiNodes.title })
    .from(wikiNodes)
    .where(and(eq(wikiNodes.wikiId, wikiId), eq(wikiNodes.isDeleted, false)))
    .orderBy(desc(wikiNodes.updatedAt))
    .limit(limit)
  return rows.map((n) => ({
    chunkId: `recommended:${n.id}`,
    documentId: n.documentId,
    nodeId: n.id,
    title: n.title,
    headingPath: n.title,
    score: 0,
    url: `/w/${wikiId}/${n.id}`,
  }))
}

/** 问答阶段（SSE stage 事件 payload，供前端显示「思考中/检索/重排/生成」进度） */
export type ChatStage = 'thinking' | 'searching' | 'reranking' | 'generating'

/**
 * RAG 问答编排（权限校验由调用方先行完成，业务异常直接抛——SSE 开始前）
 *
 * 流程（PRD 6.1）：
 * 1. 意图分析（规则前置 → 三合一 LLM）：闲聊 → 出口①（不检索不生成）
 * 2. 多路召回 + 阈值 + rerank 精排：无相关 → 出口②（兜底文案 + 推荐文档）
 * 3. 有相关 → 出口③：Prompt（资料[n] + 最近 5 轮历史 + 原始问题）→ LCEL 流式生成
 *
 * 成本：出口① 0 LLM + 0 检索；出口② 1 分析 + 检索；出口③ 1 分析 + 多路检索 + rerank + 1 生成
 *
 * @param wikiId 知识库 ID（检索边界）
 * @param question 用户原始问题（prompt 与展示均用原文，检索用改写后的 rewritten）
 * @param history 对话历史（前端内存维护，服务端不落库；prompt 内取最近 5 轮）
 * @param onStage 阶段回调（可选）：SSE 场景把 thinking/searching/reranking/generating
 *                逐阶段推给前端显示进度；不传时行为与旧版完全一致
 */
async function buildChatContext(
  wikiId: string,
  question: string,
  history: ChatHistoryItem[],
  onStage?: (stage: ChatStage) => Promise<void> | void,
): Promise<PreparedChat> {
  // 阶段推送：进入意图分析（含 LLM 调用，前端显示「思考中」）
  await onStage?.('thinking')

  // 1. 意图分析 + 问题改写 + 查询扩展（失败 fail-open，不阻断）
  const analysis = await analyzeIntentAndRewrite(question, history)
  // 可观测：统计意图分布 / 规则命中率 / 扩展变体数 / 分析耗时
  logger.info(
    {
      intent: analysis.intent,
      rewritten: analysis.rewritten,
      variantsCount: analysis.variants.length,
      ruleHit: analysis.ruleHit,
      latencyMs: analysis.latencyMs,
    },
    'rag intent analyzed',
  )

  // 2. 出口①：闲聊短路（不检索不生成）
  if (analysis.intent === 'chitchat') {
    return { kind: 'chitchat', replyText: CHITCHAT_REPLY, sources: [] }
  }

  // 阶段推送：意图明确，进入多路召回（前端显示「检索知识库」）
  await onStage?.('searching')

  // 3. 检索（多路召回 + 阈值 + rerank，检索用改写后问题；onStage 透传供 rerank 前推送）
  const results = await retrieveContext(wikiId, analysis.rewritten, analysis.variants, undefined, onStage)

  // 4. 出口②：阈值后无相关内容 → 兜底文案 + 最近更新 4 篇文档（可点击，0 次生成调用）
  if (results.length === 0) {
    return { kind: 'fallback', replyText: FALLBACK_REPLY, sources: await recommendRecentNodes(wikiId, 4) }
  }

  // 5. 出口③：组装 Prompt 与消息链
  const sources: RagChatSource[] = results.map((r) => ({
    chunkId: r.chunkId,
    documentId: r.documentId,
    nodeId: r.nodeId,
    title: r.title,
    headingPath: r.headingPath,
    score: r.score,
    url: r.nodeId ? `/w/${wikiId}/${r.nodeId}` : null,
  }))

  // 资料 blocks：[n]（来源：标题路径）\n 正文
  const contextBlocks = results
    .map((r, i) => `[${i + 1}]（来源：${r.headingPath || r.title || '未命名文档'}）\n${r.content}`)
    .join('\n\n')

  // systemPrompt（工作准则版，PRD 6.5）：仅依据资料回答 + [n] 来源标注 + 不编造 + 冲突说明 + 语言一致
  const systemPrompt = [
    '你是 YokiMind 知识库的 AI 助手，请仅依据下方提供的知识库资料回答用户问题。',
    '工作准则：',
    '1. 只根据提供的参考资料回答，不要使用你自己的知识；',
    '2. 引用资料时在对应句子末尾标注来源编号，如 [1]、[2]；',
    '3. 如果资料不足以回答问题，如实说明「知识库中暂无相关内容」，不要编造；',
    '4. 操作类问题按步骤清晰列出；概念类问题先给简明定义再展开；',
    '5. 不同资料信息冲突时，指出差异并说明各自适用场景；',
    '6. 使用与用户提问相同的语言回答，保持简洁准确。',
  ].join('\n')

  // 消息链：system 工作准则 → 最近 5 轮历史（human/ai 交替）→ human（资料 + 原始问题）
  // 注：直接构建 LangChain 消息对象而非 ChatPromptTemplate 模板 —— 资料/问题/历史含 { } 大括号
  // 会被模板解析器误当变量，消息对象绕过模板解析，语义等价且更稳
  const messages: BaseMessage[] = [new SystemMessage(systemPrompt)]
  for (const turn of history.slice(-5)) {
    messages.push(new HumanMessage(turn.question))
    messages.push(new AIMessage(turn.answer))
  }
  messages.push(new HumanMessage(`【知识库资料】\n${contextBlocks}\n\n【用户问题】\n${question}`))

  // 阶段推送：上下文就绪，进入 LLM 流式生成（前端显示「生成回答」）
  await onStage?.('generating')

  return { kind: 'kb', messages, sources }
}

/**
 * 组装 RAG 问答的三出口准备结果（流式开始前调用，失败可直接抛业务异常）
 *
 * @param wikiId 知识库 ID
 * @param question 用户问题
 * @param history 对话历史（可选，前端透传）
 * @param userId 当前用户（权限校验）
 */
export async function prepareChat(wikiId: string, question: string, history: ChatHistoryItem[], userId: string): Promise<PreparedChat> {
  // 权限校验（owner / 协作者，越权抛 RAG_WIKI_FORBIDDEN）
  await assertWikiAccess(wikiId, userId)
  return buildChatContext(wikiId, question, history)
}

/**
 * 访客问答准备（分享公开页 AI 浮窗专用）：检索 + 组装提示词，不做 owner 归属校验
 *
 * 与 prepareChat 的差异仅在权限模型：
 * - 调用入口是 share 模块的公开端点，可见性 / 密码 / 令牌由 shareAuthMiddleware
 *   在每次请求时实时复核（owner 撤销分享后问答即时失效）
 * - 检索边界同样锁定在该 wikiId，不会跨库召回
 *
 * @param wikiId 知识库 ID
 * @param question 用户问题
 * @param history 对话历史（可选，前端透传）
 * @param onStage 阶段回调（可选，SSE 场景推送 thinking/searching/reranking/generating）
 */
export async function prepareVisitorChat(
  wikiId: string,
  question: string,
  history: ChatHistoryItem[],
  onStage?: (stage: ChatStage) => Promise<void> | void,
): Promise<PreparedChat> {
  return buildChatContext(wikiId, question, history, onStage)
}

/**
 * 执行问答流式输出（三出口统一入口，SSE 事件序均为 delta → sources → done）
 *
 * - 出口①/②（闲聊/兜底）：固定文案一次性下发，不调用 LLM（秒回）
 * - 出口③（正常问答）：LCEL 链（模型 → 解析器）流式生成，逐增量回调透传
 *
 * @param prepared prepareChat / prepareVisitorChat 产物
 * @param onDelta 增量文本回调（SSE 透传）
 * @returns 完整回答文本
 */
export async function runChatStream(
  prepared: PreparedChat,
  onDelta: (delta: string) => void | Promise<void>,
): Promise<string> {
  // 出口①/②：固定文案一次回调（controller 作为单个 delta 事件下发后接 sources/done）
  if (prepared.kind !== 'kb') {
    await onDelta(prepared.replyText)
    return prepared.replyText
  }

  // 出口③：LCEL 组合（ChatOpenAI 流式 → 输出解析）；消息链在 prepare 阶段已构建完毕
  const chain = (await createChatModel()).pipe(new StringOutputParser())

  let full = ''
  const stream = await chain.stream(prepared.messages)
  for await (const delta of stream) {
    if (delta) {
      full += delta
      await onDelta(delta)
    }
  }
  return full
}

// ============ 回答后 sources 裁决（消除「说没有内容却列引用」的矛盾） ============

/**
 * 「模型自述无内容」特征正则
 *
 * system prompt 工作准则 3 约定模型资料不足时如实回复固定文案「知识库中暂无相关内容」，
 * 此正则以该短语为主、少量同义措辞容错（LLM 偶发改写）。
 * 注意与出口②兜底文案区分：出口②是「暂无相关内容，您可以参考以下文档」——
 * 其 sources 是刻意附带的推荐文档，文案与卡片自洽，不适用本规则。
 */
const MODEL_NO_CONTENT_PATTERN = /(暂无|没有|未找到|未收录)相关内容|知识库中(暂无|没有|找不到)/

/**
 * 回答生成完毕后裁决 sources（流结束后、下发 sources 事件前调用）
 *
 * 背景：出口③（正常问答）中，检索管线按相似度阈值召回的切片会同时作为
 * 模型资料与 sources 推送；但当模型判断资料不足以回答时（如问「yoki 是什么」
 * 召回的全是「语雀是什么」），会按工作准则回复「知识库中暂无相关内容」——
 * 此时回答与「引用来源」语义矛盾（引用意为「回答内容出自这些片段」，而回答恰恰说没有）。
 *
 * 规则：仅出口③且回答命中「无内容」措辞时置空 sources（前端 v-if 不渲染卡片）；
 * 出口①闲聊 sources 本就为空、出口②兜底保留推荐文档，均不受影响。
 *
 * @param prepared prepareChat / prepareVisitorChat 产物
 * @param fullText runChatStream 返回的完整回答文本
 * @returns 最终下发的 sources
 */
export function resolveChatSources(prepared: PreparedChat, fullText: string): RagChatSource[] {
  if (prepared.kind === 'kb' && MODEL_NO_CONTENT_PATTERN.test(fullText)) {
    return []
  }
  return prepared.sources
}

// ============ 状态统计与重建 ============

/** 索引状态统计 */
export interface RagStatus {
  /** 总文档数（有同步状态的） */
  total: number
  /** 已完成索引数 */
  done: number
  /** 待处理数 */
  pending: number
  /** 失败数（含重试中） */
  failed: number
  /** 已入库切片总数 */
  chunkCount: number
  /** 全库最新一次成功同步时间（ISO 字符串，从未成功过为 null） */
  lastSyncedAt: string | null
}

/**
 * 统计指定知识库的索引状态（读 wiki_rag 快照）
 *
 * 数据源：wiki_rag 表每库一行快照（由 refreshWikiRag 在状态变更点维护），
 * 不再实时 GROUP BY rag_sync + 调 Qdrant 计数，O(1) 单行读。
 * 兜底：快照行不存在（如迁移前建库、快照写入曾失败）时懒触发一次 refreshWikiRag 后重读，
 * 保证任何遗漏场景自愈。
 *
 * @param wikiId 知识库 ID
 * @param userId 当前用户（权限校验）
 */
export async function statusOf(wikiId: string, userId: string): Promise<RagStatus> {
  await assertWikiAccess(wikiId, userId)
  const db = usePostgres()

  // 读快照行（无行 → 懒重建后重读，兼容存量库与快照写失败场景）
  let [snap] = await db.select().from(wikiRag).where(eq(wikiRag.wikiId, wikiId)).limit(1)
  if (!snap) {
    await refreshWikiRag(wikiId)
    ;[snap] = await db.select().from(wikiRag).where(eq(wikiRag.wikiId, wikiId)).limit(1)
  }

  return {
    total: snap?.total ?? 0,
    done: snap?.done ?? 0,
    pending: snap?.pending ?? 0,
    failed: snap?.failed ?? 0,
    chunkCount: snap?.chunkCount ?? 0,
    lastSyncedAt: snap?.lastSyncedAt ? new Date(snap.lastSyncedAt).toISOString() : null,
  }
}

/** 批量状态查询返回条目（wikiId + 快照计数） */
export interface RagStatusBatchItem extends RagStatus {
  /** 知识库 ID */
  wikiId: string
}

/**
 * 批量统计多个知识库的索引状态（读 wiki_rag 快照，单条 inArray 查询）
 *
 * 供 Dashboard 知识库列表一次性拉取全部开启 RAG 库的四态圆点数据，
 * 替代逐库调 statusOf 的 N 次请求 + N 次聚合。
 *
 * 权限：一次 JOIN wiki 表校验归属，越权/不存在的 ID 静默过滤（不报错，不泄露存在性）。
 * 无快照行的库返回全 0 条目（前端灰点），不触发懒重建（批量场景不做写放大）。
 *
 * @param wikiIds 知识库 ID 列表（去重后查询）
 * @param userId 当前用户（归属校验）
 */
export async function statusBatchOf(wikiIds: string[], userId: string): Promise<RagStatusBatchItem[]> {
  // 入参去重（空列表直接返回，避免无谓查询）
  const ids = [...new Set(wikiIds)]
  if (ids.length === 0) return []
  const db = usePostgres()

  // 一次查询：JOIN wiki 校验归属（owner 不匹配的行直接不出现在结果里）
  const rows = await db
    .select({
      wikiId: wikiRag.wikiId,
      total: wikiRag.total,
      done: wikiRag.done,
      pending: wikiRag.pending,
      failed: wikiRag.failed,
      chunkCount: wikiRag.chunkCount,
      lastSyncedAt: wikiRag.lastSyncedAt,
    })
    .from(wikiRag)
    .innerJoin(wiki, eq(wiki.id, wikiRag.wikiId))
    .where(and(inArray(wikiRag.wikiId, ids), eq(wiki.ownerId, userId)))

  // 按入参顺序组装；无快照行的库补全 0 值条目（前端无需判空）
  const map = new Map(rows.map((r) => [r.wikiId, r]))
  return ids.map((wikiId) => {
    const r = map.get(wikiId)
    return {
      wikiId,
      total: r?.total ?? 0,
      done: r?.done ?? 0,
      pending: r?.pending ?? 0,
      failed: r?.failed ?? 0,
      chunkCount: r?.chunkCount ?? 0,
      lastSyncedAt: r?.lastSyncedAt ? new Date(r.lastSyncedAt).toISOString() : null,
    }
  })
}

/**
 * 单文档索引状态查询
 *
 * 供前端文档编辑页徽标展示：从 rag_sync 读取该文档的同步状态（none/pending/running/done/failed）。
 * 纯 DB 读，不调用 isEmbeddingReady —— embedding 未配置时也能查询状态。
 *
 * 权限：文档所属知识库必须归属当前用户（不存在/越权统一抛 RAG_WIKI_FORBIDDEN，不泄露存在性）
 *
 * @param documentId 文档 ID（documents.id）
 * @param userId 当前登录用户 ID
 */
export async function documentStatusOf(documentId: string, userId: string) {
  const db = usePostgres()

  // 1. 查文档所属知识库（文档不存在与越权同样处理，避免泄露存在性）
  const [doc] = await db
    .select({ wikiId: documents.wikiId })
    .from(documents)
    .where(eq(documents.id, documentId))
    .limit(1)
  if (!doc) {
    throw new BizException(ErrorCode.RAG_WIKI_FORBIDDEN)
  }

  // 2. 校验知识库归属（越权抛 RAG_WIKI_FORBIDDEN）
  await assertWikiAccess(doc.wikiId, userId)

  // 3. 读同步状态行（无行 = 从未入队索引）
  const [task] = await db
    .select({
      status: ragSync.status,
      chunkCount: ragSync.chunkCount,
      lastSyncedAt: ragSync.lastSyncedAt,
      error: ragSync.error,
    })
    .from(ragSync)
    .where(eq(ragSync.documentId, documentId))
    .limit(1)

  if (!task) {
    return { status: 'none' as const, chunkCount: 0, lastSyncedAt: null, error: null }
  }

  return {
    status: task.status as 'pending' | 'running' | 'done' | 'failed',
    chunkCount: task.chunkCount,
    lastSyncedAt: task.lastSyncedAt,
    error: task.error,
  }
}

/**
 * 全量重建指定知识库的索引
 * 将该库所有文档的任务重置为 pending（清空尝试次数与错误与指纹）并重新入队
 * 常用于：切换 embedding 模型、修复失败任务、首次为存量文档建索引
 *
 * @param wikiId 知识库 ID
 * @param userId 当前用户（权限校验）
 * @returns 重置的任务数
 */
export async function reindexWiki(wikiId: string, userId: string): Promise<{ marked: number }> {
  try {
    await assertWikiAccess(wikiId, userId)
    const db = usePostgres()

    // 该库全部文档（每个节点强制关联一个 documents 行，以节点为准收集）
    // 排除回收站节点：回收站文档不参与全量重建（切片保留 + 检索侧过滤已覆盖正确性）
    const nodeRows = await db
      .select({ documentId: wikiNodes.documentId })
      .from(wikiNodes)
      .where(and(eq(wikiNodes.wikiId, wikiId), eq(wikiNodes.isDeleted, false)))
    const documentIds = nodeRows.map((n) => n.documentId)

    if (documentIds.length === 0) return { marked: 0 }

    // 全部 upsert 为 pending（重置 attempts/error，保留 contentHash 由 worker 指纹比对决定是否跳过向量化）
    // 注：切换模型维度时需清空 contentHash 强制重建 —— reindex 直接置空 hash，确保切片全量重算
    await db
      .insert(ragSync)
      .values(documentIds.map((documentId) => ({ documentId, wikiId, status: 'pending' })))
      .onConflictDoUpdate({
        target: ragSync.documentId,
        set: { status: 'pending', error: null, attempts: 0, contentHash: null, updatedAt: new Date() },
      })

    // 重新入队（BullMQ）：completed 任务已被删除、同 jobId 可重新入队；
    // embedding 未就绪时任务会在队列中延迟等待，key 配好后自动消费
    await addIndexJobs(documentIds.map((documentId) => ({ documentId, wikiId })))
    // 快照刷新：全部任务转 pending，Dashboard 圆点转「索引中」（蓝）
    await refreshWikiRag(wikiId)
    return { marked: documentIds.length }
  } catch (err) {
    if (err instanceof BizException) throw err
    logger.error({ err, wikiId }, 'reindex wiki failed')
    throw new BizException(ErrorCode.RAG_REINDEX_FAILED)
  }
}

/**
 * 单文档立即索引（重索引）
 *
 * 供前端文档编辑页「RAG 标签弹层」的立即索引按钮调用：只重置并重跑当前文档的任务。
 * 与 reindexWiki 的差异：范围限定单文档，无需遍历全库节点。
 *
 * 权限：文档所属知识库必须归属当前用户（不存在/越权统一抛 RAG_WIKI_FORBIDDEN，不泄露存在性）
 *
 * @param documentId 文档 ID（documents.id）
 * @param userId 当前登录用户 ID
 * @returns { marked: 1 } 与 reindexWiki 返回结构对齐（恒为 1）
 */
export async function reindexDocument(documentId: string, userId: string): Promise<{ marked: number }> {
  try {
    const db = usePostgres()

    // 1. 查文档所属知识库（文档不存在与越权同样处理，避免泄露存在性）
    const [doc] = await db
      .select({ wikiId: documents.wikiId })
      .from(documents)
      .where(eq(documents.id, documentId))
      .limit(1)
    if (!doc) {
      throw new BizException(ErrorCode.RAG_WIKI_FORBIDDEN)
    }

    // 2. 校验知识库归属（越权抛 RAG_WIKI_FORBIDDEN）
    await assertWikiAccess(doc.wikiId, userId)

    // 3. upsert 为 pending：清空指纹/错误/尝试次数，强制 worker 全量重建切片（语义同 reindexWiki）
    await db
      .insert(ragSync)
      .values({ documentId, wikiId: doc.wikiId, status: 'pending' })
      .onConflictDoUpdate({
        target: ragSync.documentId,
        set: { status: 'pending', error: null, attempts: 0, contentHash: null, updatedAt: new Date() },
      })

    // 4. 重新入队（BullMQ）：embedding 未就绪时任务会在队列中延迟等待，key 配好后自动消费
    await addIndexJob({ documentId, wikiId: doc.wikiId })
    // 快照刷新：单文档转 pending，Dashboard 圆点转「索引中」（蓝）
    await refreshWikiRag(doc.wikiId)
    return { marked: 1 }
  } catch (err) {
    if (err instanceof BizException) throw err
    logger.error({ err, documentId }, 'reindex document failed')
    throw new BizException(ErrorCode.RAG_REINDEX_FAILED)
  }
}

/**
 * 为知识库存量文档补建缺失的索引任务（开启 ragEnabled 开关时自动触发）
 *
 * 背景：rag_sync 任务行只在「文档保存（且开关已开）/ 手动重建」两个时机产生，
 * 先建文档后开开关的存量库永远没有任务行 → wiki_rag 快照全 0 →
 * Dashboard 徽标显示不出进度、圆点绿色误导为「已正常索引」。
 *
 * 与 reindexWiki 的差异：reindex 是「全量重置」（清指纹强制重建全部切片），
 * 本函数是「查漏补缺」——只补建缺失的任务行：
 * - 已有 rag_sync 行的文档一律不动（done 不重跑、failed 保持原有重试节奏）
 * - 新补行 upsert 为 pending 并逐个投递 BullMQ（embedding 未就绪时任务延迟等待，key 配好自动恢复）
 *
 * @param wikiId 知识库 ID（调用方保证归属已校验，本函数不做权限检查）
 * @returns 实际新入队的文档数（0 = 无缺失，无需处理）
 */
export async function backfillWikiDocuments(wikiId: string): Promise<number> {
  const db = usePostgres()

  // 该库全部节点关联的文档（每个节点强制关联一个 documents 行，以节点为准收集，口径同 reindexWiki）
  // 排除回收站节点：查漏补缺不能把回收站文档补建进索引（检索侧虽会过滤，但白耗 embedding 费用）
  const nodeRows = await db
    .select({ documentId: wikiNodes.documentId })
    .from(wikiNodes)
    .where(and(eq(wikiNodes.wikiId, wikiId), eq(wikiNodes.isDeleted, false)))
  // 去重防御：正常建模下一文档对应一节点，去重避免异常数据导致重复插入冲突
  const documentIds = [...new Set(nodeRows.map((n) => n.documentId))]
  if (documentIds.length === 0) return 0

  // 仅插入缺失的任务行（onConflictDoNothing：已有行保持原状，不重置、不重复入队）
  const inserted = await db
    .insert(ragSync)
    .values(documentIds.map((documentId) => ({ documentId, wikiId, status: 'pending' })))
    .onConflictDoNothing({ target: ragSync.documentId })
    .returning({ documentId: ragSync.documentId })

  // 只为真实新入队的文档投递队列任务（0 条时跳过，避免无谓的队列与快照写）
  if (inserted.length > 0) {
    await addIndexJobs(inserted.map((r) => ({ documentId: r.documentId, wikiId })))
  }
  // 快照刷新：pending 计数立即可见（Dashboard 徽标转「RAG 0/N」进度态）
  await refreshWikiRag(wikiId)
  return inserted.length
}
