import { documents, wikiNodes } from '~/db/schema.js'
import { and, eq, isNull, or, ilike, sql } from 'drizzle-orm'
import { getDb } from '~/core/helper/db.helper.js'
import { getWikiById } from './wiki.service.js'

/**
 * 知识库文档正文关键词搜索服务
 *
 * 供搜索弹窗「内容命中」使用（标题命中由前端本地过滤文档树实现，不走本服务）：
 * - 先用 SQL ILIKE 粗筛候选文档（plain_text 命中 OR content JSON 文本命中）；
 * - 再对候选文档的 Tiptap JSON 做结构化定位：遍历顶层块 + heading 栈维护标题路径
 *   （遍历策略与 rag.service 的 chunkDocument 保持一致），找出关键词出现在哪个标题下，
 *   供前端跳转到文档内对应标题锚点（URL ?h=<标题文本>）。
 *
 * 注：刻意不走 /rag/search（向量检索强依赖 embedding 配置，dev 环境未配 key 时不可用），
 * 关键词检索语义也更符合「搜正文」预期。
 */

// ============ 类型 ============

/** 单条正文命中：所在标题路径 + 最深标题 + 命中片段 */
export interface ContentHit {
  /** 命中内容所在的标题路径（不含文档标题，如 ['部署指南', '连接池配置']） */
  headingPath: string[]
  /** 命中所在的最深标题文本（前端跳转锚点用；正文无标题结构时为空串） */
  heading: string
  /** 命中片段（关键词前后各约 40 字符窗口，含省略号） */
  snippet: string
}

/** 正文搜索单文档结果：节点信息 + 命中列表 */
export interface WikiContentSearchItem {
  /** 节点 ID（wiki_nodes.id，前端跳转 /wiki/{wikiId}/{nodeId} 用） */
  nodeId: string
  /** 节点 emoji 图标（可空） */
  icon: string | null
  /** 文档标题 */
  title: string
  /** 该文档的正文命中列表 */
  hits: ContentHit[]
}

// ============ 常量 ============

/** SQL 粗筛候选文档上限（防止候选过多时逐篇 JSON 遍历拖慢接口） */
const CANDIDATE_LIMIT = 30

/** 单文档返回命中条数上限（一篇文档命中多处时只取前 5 处） */
const MAX_HITS_PER_DOC = 5

/** 返回文档数上限（弹窗展示空间有限，默认 20 篇） */
const DEFAULT_RESULT_LIMIT = 20

/** snippet 关键词前后上下文字符数 */
const SNIPPET_CONTEXT = 40

// ============ 工具函数 ============

/**
 * 转义 ILIKE 模式串中的通配符（% _ \），防止用户输入干扰匹配
 * @param keyword 用户输入关键词
 * @returns 转义后的字面量（调用方再自行包裹 %...%）
 */
export function escapeLikePattern(keyword: string): string {
  return keyword.replace(/[\\%_]/g, (ch) => `\\${ch}`)
}

/**
 * 从 Tiptap JSON 节点递归提取纯文本
 * 与 rag.service 的 extractText 行为保持一致（块级节点子文本用换行连接、行内直接拼接），
 * 此处独立实现避免跨模块耦合（wiki 模块不 import rag 模块内部函数）
 * @param node Tiptap JSON 节点（块/行内/文本节点）
 * @returns 提取的文本
 */
function blockText(node: unknown): string {
  if (!node || typeof node !== 'object') return ''
  const n = node as { type?: string; text?: string; content?: unknown[] }
  // 文本节点：直接返回文本内容
  if (n.type === 'text') return n.text ?? ''
  // 硬换行：转为换行符
  if (n.type === 'hardBreak') return '\n'
  // 图片等叶子节点：无文本贡献
  const kids = Array.isArray(n.content) ? n.content.map(blockText).filter(Boolean) : []
  if (kids.length === 0) return ''
  // 块级节点用换行连接子文本，行内节点直接拼接
  const BLOCK_TYPES = new Set([
    'paragraph', 'heading', 'blockquote', 'codeBlock', 'bulletList', 'orderedList',
    'listItem', 'table', 'tableRow', 'tableCell', 'tableHeader', 'horizontalRule',
  ])
  return kids.join(BLOCK_TYPES.has(n.type ?? '') ? '\n' : '')
}

/**
 * 生成命中片段：关键词前后各 SNIPPET_CONTEXT 字符窗口，边界加省略号
 * 大小写不敏感（中英文混合输入时按小写匹配定位）
 * @param text 命中文本（标题或正文块文本）
 * @param keyword 搜索关键词
 * @returns 单行压缩后的片段（含省略号）
 */
function buildSnippet(text: string, keyword: string): string {
  // 单行压缩：正文中可能有换行/连续空白，展示前压成单行
  const flat = text.replace(/\s+/g, ' ').trim()
  const lowerFlat = flat.toLowerCase()
  const idx = lowerFlat.indexOf(keyword.toLowerCase())
  // 理论上调用前已确认包含，兜底返回开头片段
  if (idx < 0) return flat.slice(0, SNIPPET_CONTEXT * 2)
  const start = Math.max(0, idx - SNIPPET_CONTEXT)
  const end = Math.min(flat.length, idx + keyword.length + SNIPPET_CONTEXT)
  const body = flat.slice(start, end)
  const prefix = start > 0 ? '…' : ''
  const suffix = end < flat.length ? '…' : ''
  return `${prefix}${body}${suffix}`
}

// ============ 正文命中定位 ============

/**
 * 在单篇文档中定位关键词命中（标题路径 + 片段）
 *
 * 遍历策略与 rag.service 的 chunkDocument 一致：
 * - heading 块（type='heading'，attrs.level 1-6）维护标题栈（弹出所有 >= 当前层级的项后压栈）；
 * - 普通文本块命中 → 记录当前标题栈路径 + 片段；
 * - 标题文本自身命中 → 同样记录（路径含该标题自身），前端跳转到该标题；
 * - content 缺失/无结构化块时退化为 plainText 整体命中（无标题定位，heading 为空串）。
 *
 * @param content Tiptap JSON（documents.content）
 * @param plainText 纯文本（documents.plainText，结构化内容缺失时的兜底）
 * @param keyword 搜索关键词
 * @returns 命中列表（单文档最多 MAX_HITS_PER_DOC 条）
 */
export function locateKeywordHits(content: unknown, plainText: string | null | undefined, keyword: string): ContentHit[] {
  const hits: ContentHit[] = []

  const doc = content as { type?: string; content?: unknown[] } | null
  const blocks = doc?.type === 'doc' && Array.isArray(doc.content) ? doc.content : null

  // 1. 结构化遍历：Tiptap JSON 顶层块
  if (blocks && blocks.length > 0) {
    // 多级标题栈：维护 heading 层级祖链（与 chunkDocument 的 headingStack 同构）
    const headingStack: { level: number; text: string }[] = []
    const lowerKeyword = keyword.toLowerCase()

    for (const block of blocks) {
      const b = block as { type?: string; attrs?: { level?: number } }

      // 标题块：先更新标题栈，标题文本自身命中也记一条（跳转到该标题）
      if (b?.type === 'heading') {
        const headingFullText = blockText(block).trim()
        if (!headingFullText) continue
        // level 取 heading attrs.level（1-6），缺省按 1 处理
        const level = Math.min(Math.max(b.attrs?.level ?? 1, 1), 6)
        // 弹出栈内所有层级 >= 当前标题的项（同级或更深层章节已结束），再压入当前标题
        while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= level) {
          headingStack.pop()
        }
        headingStack.push({ level, text: headingFullText })

        // 标题文本自身命中：snippet 直接用标题文本
        if (headingFullText.toLowerCase().includes(lowerKeyword) && hits.length < MAX_HITS_PER_DOC) {
          hits.push({
            headingPath: headingStack.map((h) => h.text),
            heading: headingFullText,
            snippet: buildSnippet(headingFullText, keyword),
          })
        }
        continue
      }

      // 普通文本块：命中记录当前标题路径（栈快照）
      if (hits.length >= MAX_HITS_PER_DOC) continue
      const text = blockText(block).trim()
      if (!text || !text.toLowerCase().includes(lowerKeyword)) continue
      hits.push({
        headingPath: headingStack.map((h) => h.text),
        heading: headingStack.length > 0 ? headingStack[headingStack.length - 1].text : '',
        snippet: buildSnippet(text, keyword),
      })
    }
    return hits
  }

  // 2. 兜底：无结构化内容时用 plainText 整体命中（无法定位标题，heading 为空串）
  const text = plainText?.trim()
  if (text && text.toLowerCase().includes(keyword.toLowerCase())) {
    hits.push({ headingPath: [], heading: '', snippet: buildSnippet(text, keyword) })
  }
  return hits
}

// ============ 对外入口 ============

/**
 * 知识库文档正文关键词搜索
 * 知识库归属校验 → SQL ILIKE 粗筛候选 → 逐篇 Tiptap JSON 定位命中标题 → 组装结果
 *
 * @param wikiId 知识库 ID
 * @param userId 当前登录用户 ID（非 owner 抛 WIKI_NOT_FOUND）
 * @param q 搜索关键词（调用方已 trim 非空）
 * @param limit 返回文档数上限（默认 20）
 * @returns 命中文档列表（仅含有可定位命中的文档；无命中返回空数组，不抛业务异常）
 */
export async function searchWikiContent(wikiId: string, userId: string, q: string, limit: number = DEFAULT_RESULT_LIMIT): Promise<WikiContentSearchItem[]> {
  const db = getDb()

  // 知识库归属校验（非 owner 抛 WIKI_NOT_FOUND，与其他 wiki 接口行为一致）
  await getWikiById(wikiId, userId)

  const pattern = `%${escapeLikePattern(q)}%`

  // 粗筛候选：plain_text 命中 OR content JSON 序列化文本命中（后者兜底 plain_text 缺失的存量文档）
  // join wiki_nodes 取标题/图标；排除回收站文档（is_deleted = true）
  const candidates = await db
    .select({
      nodeId: wikiNodes.id,
      icon: wikiNodes.icon,
      title: wikiNodes.title,
      content: documents.content,
      plainText: documents.plainText,
    })
    .from(documents)
    .innerJoin(wikiNodes, eq(wikiNodes.id, documents.nodeId))
    .where(
      and(
        eq(documents.wikiId, wikiId),
        eq(wikiNodes.isDeleted, false),
        or(
          ilike(documents.plainText, pattern),
          sql`${documents.content}::text ilike ${pattern}`,
        ),
      ),
    )
    .limit(CANDIDATE_LIMIT)

  // 逐篇定位命中（纯内存 JSON 遍历，候选数有限，无性能顾虑）；无可定位命中的文档剔除
  const results: WikiContentSearchItem[] = []
  for (const doc of candidates) {
    const hits = locateKeywordHits(doc.content, doc.plainText, q)
    if (hits.length === 0) continue
    results.push({ nodeId: doc.nodeId, icon: doc.icon, title: doc.title, hits })
    if (results.length >= limit) break
  }

  return results
}
