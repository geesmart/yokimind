import { z } from 'zod'

/**
 * RAG 语义搜索请求 Schema
 * - wikiId: 目标知识库 ID（检索边界，不跨库召回）
 * - query: 查询文本（自然语言）
 * - topK: 返回条数（可选，默认取 RAG_TOP_K 环境变量，范围 1-20）
 */
export const RagSearchSchema = z.object({
  // 知识库 ID：ULID（小写）
  wikiId: z.string().min(1, 'wikiId 不能为空').max(26),
  // 查询文本：去空格后 1-2000 字符
  query: z.string().trim().min(1, '查询内容不能为空').max(2000),
  // 返回条数：可选，1-20
  topK: z.number().int().min(1).max(20).optional(),
})

/**
 * 对话历史条目 Schema（多轮追问的上下文来源）
 * - question: 该轮用户提问（1-2000 字符，与问题主字段同限）
 * - answer: 该轮 AI 回答（1-8000 字符，回答通常长于提问故放宽）
 */
export const RagHistoryItemSchema = z.object({
  // 历史用户提问：去空格后 1-2000 字符
  question: z.string().trim().min(1, '历史提问不能为空').max(2000),
  // 历史 AI 回答：去空格后 1-8000 字符
  answer: z.string().trim().min(1, '历史回答不能为空').max(8000),
})

/**
 * RAG AI 问答请求 Schema
 * - wikiId: 目标知识库 ID（问答仅基于该库内容）
 * - question: 用户问题
 * - history: 可选对话历史（最多 10 条，时间正序；用于问题改写与多轮上下文）
 */
export const RagChatSchema = z.object({
  // 知识库 ID
  wikiId: z.string().min(1, 'wikiId 不能为空').max(26),
  // 用户问题：去空格后 1-2000 字符
  question: z.string().trim().min(1, '问题不能为空').max(2000),
  // 对话历史：可选，最多 10 条（超出按时间正序由调用方/前端裁剪）
  history: z.array(RagHistoryItemSchema).max(10, '对话历史最多 10 条').optional(),
})

/**
 * RAG 状态查询 / 重建索引请求 Schema
 * 两个接口都以知识库为粒度
 */
export const RagWikiSchema = z.object({
  // 知识库 ID
  wikiId: z.string().min(1, 'wikiId 不能为空').max(26),
})

/**
 * 单文档索引状态查询请求 Schema
 * - documentId: 文档 ID（documents.id，与 rag_sync.documentId 一致）
 */
export const RagDocumentStatusSchema = z.object({
  // 文档 ID
  documentId: z.string().min(1, 'documentId 不能为空').max(26),
})

/**
 * 批量索引状态查询请求 Schema（Dashboard 知识库列表一次性拉取多库四态圆点数据）
 * - wikiIds: 知识库 ID 列表（1-100 个，上限防止超大 payload；重复 ID 由服务端去重）
 */
export const RagStatusBatchSchema = z.object({
  // 知识库 ID 列表：1-100 个，每项为 ULID 格式非空字符串
  wikiIds: z
    .array(z.string().min(1, 'wikiId 不能为空').max(26))
    .min(1, 'wikiIds 不能为空')
    .max(100, '单次最多查询 100 个知识库'),
})

/** 语义搜索请求参数类型 */
export type RagSearch = z.infer<typeof RagSearchSchema>
/** AI 问答请求参数类型 */
export type RagChat = z.infer<typeof RagChatSchema>
/** 对话历史条目类型 */
export type RagHistoryItem = z.infer<typeof RagHistoryItemSchema>
/** 状态/重建请求参数类型 */
export type RagWiki = z.infer<typeof RagWikiSchema>
/** 单文档状态查询请求参数类型 */
export type RagDocumentStatusQuery = z.infer<typeof RagDocumentStatusSchema>
/** 批量状态查询请求参数类型 */
export type RagStatusBatch = z.infer<typeof RagStatusBatchSchema>
