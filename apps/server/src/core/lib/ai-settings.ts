import { inArray } from 'drizzle-orm'
import { appSettings } from '~/db/schema.js'
import { usePostgres } from '~/core/plugins/postgres.js'

/**
 * AI 配置层（数据库动态配置 + 环境变量兜底）
 *
 * 设计要点：
 * - AI 服务商配置（BASE_URL / API_KEY / 模型名）从 app_settings 表读取，
 *   管理员可在 /admin 页面运行时修改，无需重启服务
 * - 读取优先级：app_settings 有值（非空）> process.env 兜底 > 内置默认值
 * - 页面把某字段提交为空串 = 清除 DB 覆盖，回退到环境变量
 * - DB 访问用 usePostgres() 全局单例（而非 getDb()）：本模块同时被
 *   HTTP 请求上下文与 BullMQ worker（非请求上下文）调用，
 *   getDb() 依赖 hono context-storage 仅在请求作用域可用，worker 里会抛错
 * - 不做内存缓存：单行索引查询开销极小，避免多副本/失效通知的复杂度；
 *   保存配置后配合 ai.ts 的 resetAiInstances() 即时生效
 */

/** app_settings 表中 AI 配置的键名（与 .env 变量名保持一致，便于理解与排查） */
export const AI_SETTING_KEYS = {
  /** chat 服务商地址（OpenAI 兼容） */
  BASE_URL: 'AI_BASE_URL',
  /** chat 服务商 API Key */
  API_KEY: 'AI_API_KEY',
  /** 对话模型名 */
  CHAT_MODEL: 'AI_CHAT_MODEL',
  /** embedding 服务商地址（可选，缺省回退 BASE_URL） */
  EMBEDDING_BASE_URL: 'AI_EMBEDDING_BASE_URL',
  /** embedding API Key（可选，缺省回退 API_KEY） */
  EMBEDDING_API_KEY: 'AI_EMBEDDING_API_KEY',
  /** embedding 模型名 */
  EMBEDDING_MODEL: 'AI_EMBEDDING_MODEL',
  /** 期望 embedding 维度（必须与 rag_chunks.embedding 列一致） */
  EMBEDDING_DIM: 'AI_EMBEDDING_DIM',
  // ============ RAG 精排（GLM rerank，独立 HTTP 端点，非 OpenAI 协议） ============
  /** rerank 服务地址（可选，缺省回退主配置 BASE_URL；智谱填 https://open.bigmodel.cn/api/paas/v4） */
  RERANK_BASE_URL: 'AI_RERANK_BASE_URL',
  /** rerank API Key（可选，缺省回退主配置 API_KEY） */
  RERANK_API_KEY: 'AI_RERANK_API_KEY',
  /** rerank 模型名（空 = 关闭精排，走向量序；智谱固定 rerank） */
  RERANK_MODEL: 'AI_RERANK_MODEL',
  // ============ RAG 流程参数（检索管线运行时可调项） ============
  /** 意图识别开关（关闭后不分流，有 history 时退化为纯问题改写） */
  RAG_INTENT_ENABLED: 'RAG_INTENT_ENABLED',
  /** 查询扩展开关（关闭后问答与搜索均单路召回） */
  RAG_QUERY_EXPANSION_ENABLED: 'RAG_QUERY_EXPANSION_ENABLED',
  /** 召回候选数：粗筛进入精排的条数 */
  RAG_RECALL_SIZE: 'RAG_RECALL_SIZE',
  /** 相似度阈值：向量分低于该值判不相关（bge-m3 cosine 量纲） */
  RAG_MIN_SCORE: 'RAG_MIN_SCORE',
  /** 精排保留数：送入 Prompt 的资料条数 */
  RAG_FINAL_TOP_K: 'RAG_FINAL_TOP_K',
} as const

/** 全部 AI 配置键列表（一次性查询用） */
const ALL_AI_KEYS = Object.values(AI_SETTING_KEYS)

/**
 * 保存补丁字段名 → app_settings 键名映射
 * 补丁字段为 camelCase（与请求 Schema / AiSettings 一致），存储键为大写蛇形（与 .env 一致）
 */
const FIELD_TO_KEY: Record<string, string> = {
  baseUrl: AI_SETTING_KEYS.BASE_URL,
  apiKey: AI_SETTING_KEYS.API_KEY,
  chatModel: AI_SETTING_KEYS.CHAT_MODEL,
  embeddingBaseUrl: AI_SETTING_KEYS.EMBEDDING_BASE_URL,
  embeddingApiKey: AI_SETTING_KEYS.EMBEDDING_API_KEY,
  embeddingModel: AI_SETTING_KEYS.EMBEDDING_MODEL,
  embeddingDim: AI_SETTING_KEYS.EMBEDDING_DIM,
  rerankBaseUrl: AI_SETTING_KEYS.RERANK_BASE_URL,
  rerankApiKey: AI_SETTING_KEYS.RERANK_API_KEY,
  rerankModel: AI_SETTING_KEYS.RERANK_MODEL,
  ragIntentEnabled: AI_SETTING_KEYS.RAG_INTENT_ENABLED,
  ragQueryExpansionEnabled: AI_SETTING_KEYS.RAG_QUERY_EXPANSION_ENABLED,
  ragRecallSize: AI_SETTING_KEYS.RAG_RECALL_SIZE,
  ragMinScore: AI_SETTING_KEYS.RAG_MIN_SCORE,
  ragFinalTopK: AI_SETTING_KEYS.RAG_FINAL_TOP_K,
}

/**
 * AI 生效配置（已按「DB > env > 默认值」解析完成）
 */
export interface AiSettings {
  /** chat 服务商地址（OpenAI 兼容 baseURL） */
  baseUrl: string | null
  /** chat API Key */
  apiKey: string | null
  /** 对话模型名 */
  chatModel: string
  /** embedding 服务商地址（null = 回退 baseUrl） */
  embeddingBaseUrl: string | null
  /** embedding API Key（null = 回退 apiKey） */
  embeddingApiKey: string | null
  /** embedding 模型名 */
  embeddingModel: string
  /** 期望 embedding 维度 */
  embeddingDim: number
  /** rerank 服务商地址（null = 回退 baseUrl；独立配置可单独换服务商） */
  rerankBaseUrl: string | null
  /** rerank API Key（null = 回退 apiKey） */
  rerankApiKey: string | null
  /** rerank 模型名（null = 关闭精排，走向量序） */
  rerankModel: string | null
  /** 意图识别开关（true = 闲聊分流开启） */
  ragIntentEnabled: boolean
  /** 查询扩展开关（true = 多路召回开启） */
  ragQueryExpansionEnabled: boolean
  /** 召回候选数（粗筛进入精排的条数） */
  ragRecallSize: number
  /** 相似度阈值（向量分低于该值判不相关） */
  ragMinScore: number
  /** 精排保留数（送入 Prompt 的资料条数） */
  ragFinalTopK: number
}

/**
 * 保存 AI 配置的补丁（仅包含要写入的键）
 * - 字段为 undefined = 不修改该键
 * - 字段为空串 = 清除 DB 覆盖（删除该行，回退 env）；仅对字符串字段有意义
 * - 字段为非空值 = 写入/更新覆盖值（布尔/数字统一转为字符串存储）
 */
export type AiSettingsPatch = Partial<Record<keyof typeof AI_SETTING_KEYS, string>> & {
  // 布尔/数字字段允许原始类型传入（保存时统一字符串化），与 admin schema 字段对齐
  ragIntentEnabled?: boolean
  ragQueryExpansionEnabled?: boolean
  ragRecallSize?: number
  ragMinScore?: number
  ragFinalTopK?: number
}

/**
 * 读取 AI 生效配置
 * 一次查询取 app_settings 全部 AI_* 键，逐项按「DB > env > 默认值」解析
 */
export async function getAiSettings(): Promise<AiSettings> {
  // usePostgres() 为进程级单例：initPostgres 之后请求上下文与 worker 均可用
  const db = usePostgres()
  const rows = await db
    .select({ key: appSettings.key, value: appSettings.value })
    .from(appSettings)
    .where(inArray(appSettings.key, ALL_AI_KEYS))

  // DB 覆盖值映射（NULL 视为未覆盖）
  const overrides = new Map<string, string | null>()
  for (const row of rows) {
    overrides.set(row.key, row.value)
  }

  /** 解析单键：DB 有值 > env > undefined */
  const pick = (key: string): string | null =>
    overrides.get(key) ?? process.env[key] ?? null

  /** 解析布尔键：'true' 为开，其余（'false'/未配置时给默认）按传入默认值 */
  const pickBool = (key: string, defaultValue: boolean): boolean => {
    const raw = pick(key)
    if (raw === null) return defaultValue
    return raw === 'true'
  }

  /** 解析数字键：非法（NaN）时回退默认值，防御手误配置导致 NaN 污染管线 */
  const pickNumber = (key: string, defaultValue: number): number => {
    const raw = pick(key)
    if (raw === null || raw === '') return defaultValue
    const parsed = Number(raw)
    return Number.isFinite(parsed) ? parsed : defaultValue
  }

  return {
    baseUrl: pick(AI_SETTING_KEYS.BASE_URL),
    apiKey: pick(AI_SETTING_KEYS.API_KEY),
    // 模型名不设内置默认值：未配置返回空串（前端回显空输入框），
    // 避免「看似有配置」的假默认（如 gpt-4o-mini / BAAI/bge-m3）误导管理员；
    // 未配置模型名时调用由服务商报错，配置界面测试连接同样会失败并给出原因
    chatModel: pick(AI_SETTING_KEYS.CHAT_MODEL) ?? '',
    embeddingBaseUrl: pick(AI_SETTING_KEYS.EMBEDDING_BASE_URL),
    embeddingApiKey: pick(AI_SETTING_KEYS.EMBEDDING_API_KEY),
    embeddingModel: pick(AI_SETTING_KEYS.EMBEDDING_MODEL) ?? '',
    embeddingDim: pickNumber(AI_SETTING_KEYS.EMBEDDING_DIM, 1024),
    // rerank 独立配置：URL / Key 原样返回（null 时由调用方回退主配置），模型空 = 关闭精排
    rerankBaseUrl: pick(AI_SETTING_KEYS.RERANK_BASE_URL),
    rerankApiKey: pick(AI_SETTING_KEYS.RERANK_API_KEY),
    rerankModel: pick(AI_SETTING_KEYS.RERANK_MODEL) || null,
    ragIntentEnabled: pickBool(AI_SETTING_KEYS.RAG_INTENT_ENABLED, true),
    ragQueryExpansionEnabled: pickBool(AI_SETTING_KEYS.RAG_QUERY_EXPANSION_ENABLED, true),
    ragRecallSize: pickNumber(AI_SETTING_KEYS.RAG_RECALL_SIZE, 20),
    ragMinScore: pickNumber(AI_SETTING_KEYS.RAG_MIN_SCORE, 0.35),
    ragFinalTopK: pickNumber(AI_SETTING_KEYS.RAG_FINAL_TOP_K, 6),
  }
}

/**
 * 保存 AI 配置（upsert，仅写传入字段）
 * 配合 ai.ts 的 resetAiInstances() 使用：保存后模型实例缓存被清空，新配置立即生效
 *
 * @param patch 配置补丁；空串 = 清除该键的 DB 覆盖（回退 env）
 */
export async function saveAiSettings(patch: AiSettingsPatch): Promise<void> {
  const db = usePostgres()

  for (const [field, rawValue] of Object.entries(patch)) {
    // camelCase 字段名映射到存储键（如 baseUrl → AI_BASE_URL）；
    // 未知字段直接忽略（调用方经 zod 校验，这里双保险）
    const key = FIELD_TO_KEY[field]
    if (!key) continue

    // undefined = 不修改该键
    if (rawValue === undefined) continue

    // 布尔/数字字段（RAG 开关与参数）：统一字符串化后 upsert（app_settings.value 为 text 列）
    if (typeof rawValue === 'boolean' || typeof rawValue === 'number') {
      const value = String(rawValue)
      await db
        .insert(appSettings)
        .values({ key, value })
        .onConflictDoUpdate({
          target: appSettings.key,
          set: { value, updatedAt: new Date() },
        })
      continue
    }

    // 字符串字段：空串（含纯空白）= 清除覆盖：删除该行，读取时回退 env
    const value = rawValue.trim()
    if (value === '') {
      await db.delete(appSettings).where(inArray(appSettings.key, [key]))
      continue
    }

    // 非空值 = upsert 覆盖（冲突时更新 value 与 updatedAt）
    await db
      .insert(appSettings)
      .values({ key, value })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { value, updatedAt: new Date() },
      })
  }
}
