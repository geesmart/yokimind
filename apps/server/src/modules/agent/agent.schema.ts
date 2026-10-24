import { z } from 'zod'

/** 搜索模式：keyword 关键词 / semantic 语义（需 embedding）/ auto 自动（语义失败降级关键词） */
export const AgentSearchMode = z.enum(['keyword', 'semantic', 'auto'])
export type AgentSearchMode = z.infer<typeof AgentSearchMode>

/** 列出我的知识库 */
export const AgentWikisListSchema = z.object({}).strict()
export type AgentWikisList = z.infer<typeof AgentWikisListSchema>

/** 知识库文档树 */
export const AgentWikiTreeSchema = z
  .object({
    wikiId: z.string().min(1, 'wikiId 不能为空').max(26, 'wikiId 格式无效'),
  })
  .strict()
export type AgentWikiTree = z.infer<typeof AgentWikiTreeSchema>

/** 知识库检索（不传 wikiId 时在本人全部知识库内搜索；semantic 模式必须指定 wikiId） */
export const AgentSearchSchema = z
  .object({
    wikiId: z.string().max(26, 'wikiId 格式无效').optional(),
    q: z.string().min(1, '搜索词不能为空').max(200, '搜索词过长'),
    mode: AgentSearchMode.default('auto'),
    /** 返回条数上限（1-50，默认 10） */
    limit: z.number().int().min(1).max(50).default(10),
  })
  .strict()
export type AgentSearch = z.infer<typeof AgentSearchSchema>

/** 读取文档：nodeId 与 documentId 二选一 */
export const AgentDocumentGetSchema = z
  .object({
    wikiId: z.string().max(26).optional(),
    nodeId: z.string().max(26).optional(),
    documentId: z.string().max(26).optional(),
  })
  .strict()
  .refine((v) => Boolean(v.nodeId || v.documentId), { message: 'nodeId 与 documentId 至少提供一个' })
export type AgentDocumentGet = z.infer<typeof AgentDocumentGetSchema>

/** 创建文档：markdown 正文（可含 H1，会自动提取为标题） */
export const AgentDocumentCreateSchema = z
  .object({
    wikiId: z.string().min(1, 'wikiId 不能为空').max(26, 'wikiId 格式无效'),
    title: z.string().max(100, '文档标题最长 100 位').optional(),
    parentId: z.string().max(26).optional(),
    markdown: z.string().min(1, 'markdown 不能为空').max(500_000, 'markdown 内容过长'),
  })
  .strict()
export type AgentDocumentCreate = z.infer<typeof AgentDocumentCreateSchema>

/** 更新文档：nodeId 与 documentId 二选一；title 可选（同步改节点标题） */
export const AgentDocumentUpdateSchema = z
  .object({
    nodeId: z.string().max(26).optional(),
    documentId: z.string().max(26).optional(),
    title: z.string().max(100, '文档标题最长 100 位').optional(),
    markdown: z.string().min(1, 'markdown 不能为空').max(500_000, 'markdown 内容过长'),
  })
  .strict()
  .refine((v) => Boolean(v.nodeId || v.documentId), { message: 'nodeId 与 documentId 至少提供一个' })
export type AgentDocumentUpdate = z.infer<typeof AgentDocumentUpdateSchema>
