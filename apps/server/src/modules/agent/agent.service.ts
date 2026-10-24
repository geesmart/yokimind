import { eq } from 'drizzle-orm'
import type { JSONContent } from '@tiptap/core'
import { documents, wikiNodes } from '~/db/schema.js'
import { getDb } from '~/core/helper/db.helper.js'
import { BizException } from '~/core/lib/biz.exception.js'
import { ErrorCode } from '~/config/error-code.js'
import {
  listWikisByUserId,
  getWikiById,
  listWikiNodes,
  getDocumentById,
  createWikiNode,
  saveDocument,
} from '~/modules/wiki/wiki.service.js'
import { searchWikiContent } from '~/modules/wiki/wiki-search.service.js'
import { searchWiki } from '~/modules/rag/rag.service.js'
import { markdownToDocument, tiptapJsonToMarkdown } from '~/modules/wiki/document-markdown.renderer.js'
import type { AgentSearch, AgentDocumentGet, AgentDocumentCreate, AgentDocumentUpdate } from './agent.schema.js'

/**
 * 智能体接入层服务（Agent HTTP API / MCP 工具 / Skills 三协议共用的底座）
 * 全部复用 wiki / rag 既有 service：归属校验、软删除过滤、乐观锁口径、
 * RAG 同步入队、异步 HTML 渲染在底层一致生效，不在此层重复实现
 */

// ============ 读：知识库与文档树 ============

/** 列出本人全部知识库（软删除过滤由底层保证） */
export async function listWikis(userId: string) {
  return listWikisByUserId(userId)
}

/** 文档树节点（组树后的结构，供 CLI tree / MCP wiki_tree / SKILL.md 大纲共用） */
export interface AgentTreeNode {
  id: string
  title: string
  icon: string | null
  parentId: string | null
  sortOrder: number
  documentId: string
  docFormat: string
  children: AgentTreeNode[]
}

/** 组树：扁平节点 → 父子结构（sortOrder 升序由底层查询保证） */
function buildTree(flat: Awaited<ReturnType<typeof listWikiNodes>>): AgentTreeNode[] {
  const map = new Map<string, AgentTreeNode>()
  for (const node of flat) {
    map.set(node.id, {
      id: node.id,
      title: node.title,
      icon: node.icon,
      parentId: node.parentId,
      sortOrder: node.sortOrder,
      documentId: node.documentId,
      docFormat: node.docFormat ?? 'md',
      children: [],
    })
  }
  const roots: AgentTreeNode[] = []
  for (const node of map.values()) {
    const parent = node.parentId ? map.get(node.parentId) : undefined
    if (parent) {
      parent.children.push(node)
    } else {
      roots.push(node)
    }
  }
  return roots
}

/** 获取知识库文档树（越权/不存在抛 WIKI_NOT_FOUND） */
export async function getTree(wikiId: string, userId: string) {
  await getWikiById(wikiId, userId)
  const flat = await listWikiNodes(wikiId, userId)
  return { wikiId, nodes: buildTree(flat) }
}

// ============ 读：检索 ============

/** 统一搜索结果项（keyword 与 semantic 两种模式的扁平化视图） */
export interface AgentSearchItem {
  nodeId: string | null
  documentId: string | null
  title: string | null
  /** 关键词命中摘要（keyword 模式） */
  snippet?: unknown
  /** 切片内容（semantic 模式） */
  content?: string
  /** 相似度得分（semantic 模式，1 - cosine 距离） */
  score?: number
}

/** 跨库关键词搜索：不传 wikiId 时遍历本人全部知识库 */
async function searchAllWikis(q: string, limit: number, userId: string): Promise<AgentSearchItem[]> {
  const wikis = await listWikisByUserId(userId)
  const items: AgentSearchItem[] = []
  for (const wiki of wikis) {
    if (items.length >= limit) break
    // 每库取「剩余配额」条，聚合后整体截断
    const hits = await searchWikiContent(wiki.id, userId, q, limit - items.length)
    for (const hit of hits) {
      items.push({ nodeId: hit.nodeId, documentId: null, title: hit.title, snippet: hit.hits })
    }
  }
  return items.slice(0, limit)
}

/** semantic 结果 → 统一视图 */
async function semanticSearch(wikiId: string, q: string, limit: number, userId: string) {
  const results = await searchWiki(wikiId, q, limit, userId)
  return results.map((r) => ({
    nodeId: r.nodeId,
    documentId: r.documentId,
    title: r.title,
    content: r.content,
    score: r.score,
  }))
}

/**
 * 智能体检索
 * - keyword：SQL ILIKE + 正文命中定位（无外部依赖）
 * - semantic：RAG 语义检索（需配置 embedding，未配置抛 RAG_NOT_CONFIGURED）
 * - auto（默认）：先语义，未配置时自动降级关键词；响应带 usedMode 告知调用方实际模式
 * 注：不传 wikiId 时只能走关键词（逐库语义检索是 N 次 LLM 调用，开销不可控）
 */
export async function search(
  params: AgentSearch,
  userId: string,
): Promise<{ usedMode: 'keyword' | 'semantic'; items: AgentSearchItem[] }> {
  const { wikiId, q, mode, limit } = params

  if (mode === 'semantic' && !wikiId) {
    throw new BizException(ErrorCode.INVALID_REQUEST, 'semantic 模式必须指定 wikiId')
  }

  // auto：先尝试语义（仅单库），未配置 embedding 降级关键词
  if (mode === 'auto' && wikiId) {
    try {
      return { usedMode: 'semantic', items: await semanticSearch(wikiId, q, limit, userId) }
    } catch (error) {
      // 仅「未配置语义检索」降级，其余异常（网络/配置错误）原样上抛
      if (!(error instanceof BizException) || error.code !== ErrorCode.RAG_NOT_CONFIGURED.code) {
        throw error
      }
    }
  }

  // keyword（含 auto 降级、auto 多库、显式 keyword）
  const items = wikiId
    ? (await searchWikiContent(wikiId, userId, q, limit)).map((h) => ({
        nodeId: h.nodeId,
        documentId: null,
        title: h.title,
        snippet: h.hits,
      }))
    : await searchAllWikis(q, limit, userId)
  return { usedMode: 'keyword', items }
}

// ============ 读：文档内容 ============

/** 文档读取结果（markdown 为主格式，plainText 供摘要类消费） */
export interface AgentDocumentView {
  documentId: string
  nodeId: string
  wikiId: string
  title: string | null
  markdown: string
  plainText: string | null
  wordCount: number
  updatedAt: string
}

/** 按 nodeId 反查 documents 行（不存在抛 WIKI_NOT_FOUND，不泄露存在性） */
async function findDocumentByNodeId(nodeId: string): Promise<string> {
  const db = getDb()
  const [found] = await db.select({ id: documents.id }).from(documents).where(eq(documents.nodeId, nodeId)).limit(1)
  if (!found) {
    throw new BizException(ErrorCode.WIKI_NOT_FOUND)
  }
  return found.id
}

/** 取节点标题（文档读取的 title 来源：documents 行不含标题，标题在 wiki_nodes 上） */
async function getNodeTitle(nodeId: string): Promise<string | null> {
  const db = getDb()
  const [node] = await db.select({ title: wikiNodes.title }).from(wikiNodes).where(eq(wikiNodes.id, nodeId)).limit(1)
  return node?.title ?? null
}

/**
 * 读取文档（markdown + plainText 双格式）
 * @throws WIKI_NOT_FOUND（不存在/越权）
 */
export async function getDocument(params: AgentDocumentGet, userId: string): Promise<AgentDocumentView> {
  const documentId = params.documentId ?? (await findDocumentByNodeId(params.nodeId!))
  const doc = await getDocumentById(documentId, userId)
  if (params.wikiId && doc.wikiId !== params.wikiId) {
    // 参数间互相矛盾按「不存在」处理，不泄露存在性
    throw new BizException(ErrorCode.WIKI_NOT_FOUND)
  }
  const content = doc.content as JSONContent
  return {
    documentId: doc.id,
    nodeId: doc.nodeId,
    wikiId: doc.wikiId,
    title: await getNodeTitle(doc.nodeId),
    markdown: content ? tiptapJsonToMarkdown(content) : '',
    plainText: doc.plainText,
    wordCount: doc.wordCount ?? 0,
    updatedAt: doc.updatedAt.toISOString(),
  }
}

// ============ 写：创建 / 更新 ============

/**
 * 创建文档：markdown 服务端转 Tiptap JSON 后走 createWikiNode + saveDocument
 * 标题优先级：显式 title > markdown 首个 H1 > 「无标题文档」
 * RAG 同步 / HTML 渲染由 saveDocument 底层钩子自动处理
 */
export async function createDocument(params: AgentDocumentCreate, userId: string) {
  const parsed = markdownToDocument(params.markdown)
  const node = await createWikiNode(params.wikiId, userId, {
    title: params.title ?? parsed.title,
    parentId: params.parentId,
  })
  await saveDocument(node.documentId, userId, {
    content: parsed.content,
    updatedAt: new Date().toISOString(),
    wordCount: parsed.wordCount,
  })
  return {
    wikiId: params.wikiId,
    nodeId: node.id,
    documentId: node.documentId,
    title: node.title,
    wordCount: parsed.wordCount,
  }
}

/**
 * 更新文档：后写覆盖语义（并发编辑以最后一次写入为准，与编辑器自动保存行为一致）
 * title 可选：同时更新节点标题（空串按「无标题文档」处理，与 createWikiNode 口径一致）
 */
export async function updateDocument(params: AgentDocumentUpdate, userId: string) {
  const documentId = params.documentId ?? (await findDocumentByNodeId(params.nodeId!))
  // 先读取现有文档：a) 归属校验 b) 拿 nodeId 供标题更新
  const existing = await getDocumentById(documentId, userId)
  const parsed = markdownToDocument(params.markdown)

  if (params.title !== undefined) {
    const db = getDb()
    await db
      .update(wikiNodes)
      .set({ title: params.title.trim() || '无标题文档' })
      .where(eq(wikiNodes.id, existing.nodeId))
  }

  await saveDocument(documentId, userId, {
    content: parsed.content,
    updatedAt: new Date().toISOString(),
    wordCount: parsed.wordCount,
  })
  return {
    documentId,
    nodeId: existing.nodeId,
    wikiId: existing.wikiId,
    title: params.title?.trim() || (await getNodeTitle(existing.nodeId)),
    wordCount: parsed.wordCount,
    residueCount: parsed.residueCount,
  }
}
