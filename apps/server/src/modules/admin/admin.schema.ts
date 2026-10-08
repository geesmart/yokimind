import { z } from 'zod'

/**
 * AI 配置保存请求 Schema
 *
 * 字段全部可选（undefined = 不修改该字段）：
 * - 字符串字段：非空字符串 = 写入/更新 app_settings 的 DB 覆盖值；空字符串 = 清除覆盖（回退 .env）
 * - apiKey / embeddingApiKey / rerankApiKey 传空串时语义为「清除覆盖」，若想保留现值应不传该字段
 * - 布尔/数字字段（RAG 参数）：传值 = 写入覆盖；空串 = 清除覆盖回退默认值
 */
export const SaveAiSettingsSchema = z.object({
  // chat 服务商地址（OpenAI 兼容 baseURL），如 https://api.siliconflow.cn/v1
  baseUrl: z.string().trim().max(500).optional(),
  // chat API Key（明文传输依赖 HTTPS；后端只存不回传）
  apiKey: z.string().max(300).optional(),
  // 对话模型名，如 gpt-4o-mini / z-ai/glm-5.3-flash
  chatModel: z.string().trim().max(200).optional(),
  // embedding 服务商地址（可选，缺省回退 chat 服务商）
  embeddingBaseUrl: z.string().trim().max(500).optional(),
  // embedding API Key（可选，缺省回退 chat API Key）
  embeddingApiKey: z.string().max(300).optional(),
  // embedding 模型名，如 BAAI/bge-m3
  embeddingModel: z.string().trim().max(200).optional(),
  // ============ RAG 精排（GLM rerank） ============
  // rerank 服务商地址（可选，缺省回退 chat 服务商；智谱填 https://open.bigmodel.cn/api/paas/v4）
  rerankBaseUrl: z.string().trim().max(500).optional(),
  // rerank API Key（可选，缺省回退 chat API Key）
  rerankApiKey: z.string().max(300).optional(),
  // rerank 模型名（空串 = 清除覆盖即关闭精排，走向量序）
  rerankModel: z.string().trim().max(200).optional(),
  // ============ RAG 流程参数 ============
  // 意图识别开关（关闭后不分流，有 history 时退化为纯问题改写）；空串 = 清除覆盖
  ragIntentEnabled: z.union([z.boolean(), z.literal('')]).optional(),
  // 查询扩展开关（关闭后问答与搜索均单路召回）；空串 = 清除覆盖
  ragQueryExpansionEnabled: z.union([z.boolean(), z.literal('')]).optional(),
  // 召回候选数（粗筛进入精排的条数，1-100）；空串 = 清除覆盖回退默认
  ragRecallSize: z.union([z.number().int().min(1).max(100), z.literal('')]).optional(),
  // 相似度阈值（0-1，bge-m3 cosine 量纲，低于判不相关）；空串 = 清除覆盖回退默认
  ragMinScore: z.union([z.number().min(0).max(1), z.literal('')]).optional(),
  // 精排保留数（送入 Prompt 的资料条数，1-20）；空串 = 清除覆盖回退默认
  ragFinalTopK: z.union([z.number().int().min(1).max(20), z.literal('')]).optional(),
})

/**
 * AI 连接测试请求 Schema
 *
 * - targets: 要测试的目标，chat / embedding / rerank 可多选
 * - overrides: 可选的临时配置覆盖（测试「未保存」的表单值时使用）；
 *   未提供时用当前生效配置（DB > env）测试。覆盖值仅本次测试使用，不会落库、不污染缓存
 */
export const TestAiSchema = z.object({
  // 测试目标（默认测 chat + embedding；rerank 按需勾选）
  targets: z.array(z.enum(['chat', 'embedding', 'rerank'])).min(1).max(3).default(['chat', 'embedding']),
  // 临时覆盖配置（结构同保存 Schema，仅作用于本次测试）
  overrides: SaveAiSettingsSchema.optional(),
})

/** AI 配置保存请求参数类型 */
export type SaveAiSettings = z.infer<typeof SaveAiSettingsSchema>
/** AI 连接测试请求参数类型 */
export type TestAi = z.infer<typeof TestAiSchema>
