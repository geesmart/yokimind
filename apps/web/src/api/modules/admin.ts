/**
 * 管理后台模块接口
 *
 * 对接后端 `/api/v1/admin/*` 接口（admin.controller.ts），均需登录 + 管理员权限：
 * - getAiSettings     查看 AI 配置   POST /admin/settings      apiKey 脱敏回显
 * - saveAiSettings    保存 AI 配置   POST /admin/settings/save 新配置即时生效
 * - testAiConnection  AI 连接测试    POST /admin/test-ai       失败以 ok:false 返回
 *
 * 响应已被 request.ts 的 alova 实例统一解包：
 * - 成功直接返回后端 `data` 字段
 * - 业务失败抛 `ApiError`（含 code/httpStatus，如 90001 无管理员权限）
 */
import { alova } from '../request'
import { API_PATHS } from '../constants'

// ==================== 类型定义 ====================

/**
 * AI 配置视图（后端 admin.service.getSettingsView 返回）
 * 所有密钥一律脱敏：只回掩码（如 sk-***abcd），不回传明文
 */
export interface AiSettingsView {
  /** chat 服务商地址（生效值；null = 未配置） */
  baseUrl: string | null
  /** chat API Key 掩码（如 sk-***abcd）；未配置为 null */
  apiKeyMask: string | null
  /** chat API Key 是否已配置 */
  hasApiKey: boolean
  /** 对话模型名（生效值，含默认值兜底） */
  chatModel: string
  /** embedding 服务商地址（未单独配置时为 null = 回退 chat 服务商） */
  embeddingBaseUrl: string | null
  /** embedding API Key 掩码（回退主配置时为 null） */
  embeddingApiKeyMask: string | null
  /** embedding API Key 是否已配置（含回退主配置的场景） */
  hasEmbeddingApiKey: boolean
  /** embedding 模型名（生效值） */
  embeddingModel: string
  /** 期望 embedding 维度（须与数据库 rag_chunks.embedding 列一致） */
  embeddingDim: number
  /** embedding 是否回退 chat 主配置（未单独配置 URL/key） */
  embeddingFallback: boolean
  /** chat 服务是否已配置就绪 */
  chatReady: boolean
  /** embedding 服务是否就绪（含回退场景） */
  embeddingReady: boolean
  // ============ RAG 精排（GLM rerank） ============
  /** rerank 服务商地址（未单独配置时为 null = 回退 chat 服务商） */
  rerankBaseUrl: string | null
  /** rerank API Key 掩码（回退主配置时为 null） */
  rerankApiKeyMask: string | null
  /** rerank API Key 是否已配置（含回退主配置的场景） */
  hasRerankApiKey: boolean
  /** rerank 模型名（null = 未配置即关闭精排） */
  rerankModel: string | null
  /** rerank 是否回退 chat 主配置（未单独配置 URL/key） */
  rerankFallback: boolean
  /** rerank 精排是否就绪（模型已配置且 URL/Key 就绪，含回退场景） */
  rerankReady: boolean
  // ============ RAG 流程参数（生效值） ============
  /** 意图识别开关 */
  ragIntentEnabled: boolean
  /** 查询扩展开关 */
  ragQueryExpansionEnabled: boolean
  /** 召回候选数 */
  ragRecallSize: number
  /** 相似度阈值 */
  ragMinScore: number
  /** 精排保留数 */
  ragFinalTopK: number
}

/**
 * 保存 AI 配置入参（字段全部可选）
 * - undefined = 不修改该字段（密钥留空不传即「保留现值」）
 * - 字符串字段空字符串 = 清除该字段的数据库覆盖（回退 .env 环境变量）
 * - 布尔/数字字段（RAG 参数）传空串 = 清除覆盖回退内置默认
 */
export interface SaveAiSettingsParams {
  /** chat 服务商地址（OpenAI 兼容 baseURL） */
  baseUrl?: string
  /** chat API Key：仅当用户输入了新值才传 */
  apiKey?: string
  /** 对话模型名 */
  chatModel?: string
  /** embedding 服务商地址（可选） */
  embeddingBaseUrl?: string
  /** embedding API Key（可选） */
  embeddingApiKey?: string
  /** embedding 模型名 */
  embeddingModel?: string
  // ============ RAG 精排（GLM rerank） ============
  /** rerank 服务商地址（可选，缺省回退 chat 服务商） */
  rerankBaseUrl?: string
  /** rerank API Key（可选，缺省回退 chat API Key） */
  rerankApiKey?: string
  /** rerank 模型名（空串 = 清除覆盖即关闭精排） */
  rerankModel?: string
  // ============ RAG 流程参数 ============
  /** 意图识别开关；空串 = 清除覆盖 */
  ragIntentEnabled?: boolean | ''
  /** 查询扩展开关；空串 = 清除覆盖 */
  ragQueryExpansionEnabled?: boolean | ''
  /** 召回候选数（1-100）；空串 = 清除覆盖 */
  ragRecallSize?: number | ''
  /** 相似度阈值（0-1）；空串 = 清除覆盖 */
  ragMinScore?: number | ''
  /** 精排保留数（1-20）；空串 = 清除覆盖 */
  ragFinalTopK?: number | ''
}

/** 连接测试目标：chat 对话 / embedding 向量化 / rerank 精排 */
export type AiTestTarget = 'chat' | 'embedding' | 'rerank'

/** 连接测试入参：targets 可选目标；overrides 为临时覆盖（测试未保存的表单值） */
export interface TestAiParams {
  /** 要测试的目标（后端默认两个都测） */
  targets?: AiTestTarget[]
  /** 临时覆盖配置（仅本次测试使用，不落库、不污染缓存） */
  overrides?: SaveAiSettingsParams
}

/** 单个测试目标的结果 */
export interface AiTestItemResult {
  /** 测试目标 */
  target: AiTestTarget
  /** 是否连通可用 */
  ok: boolean
  /** 请求耗时（毫秒）；未发起请求（未配置）时为 undefined */
  latencyMs?: number
  /** 实际使用的模型名 */
  model?: string
  /** embedding 实测维度（仅 embedding 目标返回） */
  dim?: number
  /** 失败原因（ok=false 时提供） */
  error?: string
}

// ==================== 接口函数 ====================

/**
 * 查看 AI 配置（脱敏）
 * POST /admin/settings（需管理员）
 *
 * @returns alova Method，send 后得到配置视图（掩码 + 就绪状态）
 */
export function getAiSettings() {
  return alova.Post<AiSettingsView>(API_PATHS.ADMIN.SETTINGS)
}

/**
 * 保存 AI 配置
 * POST /admin/settings/save（需管理员）
 *
 * 后端保存后会重置模型实例缓存，新配置对后续所有请求即时生效。
 * 建议用返回的最新视图刷新表单回显。
 *
 * @param params 配置补丁（undefined=不修改；空串=清除覆盖回退 env）
 * @returns alova Method，send 后得到保存后的最新配置视图
 */
export function saveAiSettings(params: SaveAiSettingsParams) {
  return alova.Post<AiSettingsView>(API_PATHS.ADMIN.SETTINGS_SAVE, params)
}

/**
 * AI 连接测试
 * POST /admin/test-ai（需管理员）
 *
 * 可用 overrides 测试「尚未保存」的表单值；任何失败都以 ok:false 正常返回，
 * 不会抛业务异常，前端按逐项结果展示成功/失败原因。
 *
 * @param params 测试目标与可选覆盖配置
 * @returns alova Method，send 后得到逐项测试结果数组
 */
export function testAiConnection(params: TestAiParams) {
  return alova.Post<AiTestItemResult[]>(API_PATHS.ADMIN.TEST_AI, params)
}
