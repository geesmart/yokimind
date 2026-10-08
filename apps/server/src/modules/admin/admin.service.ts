import { ChatOpenAI, OpenAIEmbeddings } from '@langchain/openai'
import { HumanMessage } from '@langchain/core/messages'
import { getAiSettings, saveAiSettings, type AiSettingsPatch } from '~/core/lib/ai-settings.js'
import { resetAiInstances } from '~/core/lib/ai.js'
import { resetRagVectorStore } from '~/modules/rag/rag.store.js'
import type { SaveAiSettings, TestAi } from './admin.schema.js'

/**
 * 管理后台服务层
 *
 * 职责：
 * - 管理员判定（V1：所有登录用户均为管理员，见 isAdminUser）
 * - AI 配置的查看（脱敏）/ 保存（保存后重置模型实例使新配置即时生效）
 * - AI 连接测试（chat / embedding 各自独立测试，失败以 ok:false 返回而非抛错）
 */

/**
 * 判断用户是否为管理员
 *
 * ⚠️ V1 策略（2026-09）：第一个版本不做角色区分，**所有登录用户都是管理员**，恒返回 true。
 * admins 白名单表与 scripts/set-admin.ts 保留不动；恢复角色体系时还原为：
 *
 *   const db = usePostgres()
 *   const rows = await db.select({ id: admins.id }).from(admins)
 *     .where(eq(admins.userId, userId)).limit(1)
 *   return rows.length > 0
 *
 * @param _userId 用户 ID（users.id）；V1 不参与判定，保留入参以兼容调用方
 */
export async function isAdminUser(_userId: string): Promise<boolean> {
  return true
}

/** API Key 脱敏：保留前 3 后 4 位，中间以 *** 代替；过短则完全遮蔽 */
function maskKey(key: string): string {
  if (key.length <= 8) return '***'
  return `${key.slice(0, 3)}***${key.slice(-4)}`
}

/**
 * AI 配置视图（管理页面回显用）
 * - apiKey / embeddingApiKey 一律脱敏为掩码，不回传明文
 * - 附带就绪状态与回退标注，便于前端展示配置健康度
 */
export interface AiSettingsView {
  /** chat 服务商地址（生效值） */
  baseUrl: string | null
  /** chat API Key 掩码（如 sk-***abcd）；未配置为 null */
  apiKeyMask: string | null
  /** chat API Key 是否已配置 */
  hasApiKey: boolean
  /** 对话模型名（生效值） */
  chatModel: string
  /** embedding 服务商地址（生效值；null = 回退 chat 服务商） */
  embeddingBaseUrl: string | null
  /** embedding API Key 掩码（生效值脱敏；null = 回退 chat API Key） */
  embeddingApiKeyMask: string | null
  /** embedding API Key 是否已配置（含回退主配置的场景） */
  hasEmbeddingApiKey: boolean
  /** embedding 模型名（生效值） */
  embeddingModel: string
  /** 期望 embedding 维度（决定 Qdrant 写入/检索哪个命名向量，见 rag.store.ts） */
  embeddingDim: number
  /** embedding 是否回退 chat 主配置（未单独配置 URL/key） */
  embeddingFallback: boolean
  /** chat 服务是否已配置就绪 */
  chatReady: boolean
  /** embedding 服务是否就绪（含回退场景） */
  embeddingReady: boolean
  // ============ RAG 精排（GLM rerank） ============
  /** rerank 服务商地址（生效值；null = 回退 chat 服务商） */
  rerankBaseUrl: string | null
  /** rerank API Key 掩码（生效值脱敏；null = 回退 chat API Key） */
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
 * 查询 AI 配置视图（脱敏后供管理页面回显）
 */
export async function getSettingsView(): Promise<AiSettingsView> {
  const s = await getAiSettings()
  // 回退判定：未单独配置 embedding URL/key 时，展示层沿用主配置
  const embeddingFallback = !(s.embeddingBaseUrl || s.embeddingApiKey)
  const embeddingReady = embeddingFallback
    ? Boolean(s.baseUrl && s.apiKey)
    : Boolean(s.embeddingBaseUrl && s.embeddingApiKey)
  // rerank 同理：未单独配置 URL/key 时回退主配置（与 ai.ts rerankTexts 的回退逻辑对齐）
  const rerankFallback = !(s.rerankBaseUrl || s.rerankApiKey)
  // 精排就绪 = 模型已配置（开启精排的开关）且 URL/Key 就绪（含回退主配置的场景）
  const rerankReady = Boolean(s.rerankModel) && (rerankFallback
    ? Boolean(s.baseUrl && s.apiKey)
    : Boolean(s.rerankBaseUrl && s.rerankApiKey))

  return {
    baseUrl: s.baseUrl,
    apiKeyMask: s.apiKey ? maskKey(s.apiKey) : null,
    hasApiKey: Boolean(s.apiKey),
    chatModel: s.chatModel,
    embeddingBaseUrl: embeddingFallback ? null : s.embeddingBaseUrl,
    embeddingApiKeyMask: embeddingFallback
      ? null
      : (s.embeddingApiKey ? maskKey(s.embeddingApiKey) : null),
    hasEmbeddingApiKey: embeddingReady,
    embeddingModel: s.embeddingModel,
    embeddingDim: s.embeddingDim,
    embeddingFallback,
    chatReady: Boolean(s.baseUrl && s.apiKey),
    embeddingReady,
    // rerank：URL/Key 未单独配置时展示 null + fallback 标注（前端提示「沿用 chat 配置」）
    rerankBaseUrl: rerankFallback ? null : s.rerankBaseUrl,
    rerankApiKeyMask: rerankFallback
      ? null
      : (s.rerankApiKey ? maskKey(s.rerankApiKey) : null),
    hasRerankApiKey: rerankFallback ? Boolean(s.baseUrl && s.apiKey) : Boolean(s.rerankApiKey),
    rerankModel: s.rerankModel,
    rerankFallback,
    rerankReady,
    // RAG 流程参数：直接回显生效值（DB 覆盖 > env > 默认值），前端据此填充表单
    ragIntentEnabled: s.ragIntentEnabled,
    ragQueryExpansionEnabled: s.ragQueryExpansionEnabled,
    ragRecallSize: s.ragRecallSize,
    ragMinScore: s.ragMinScore,
    ragFinalTopK: s.ragFinalTopK,
  }
}

/**
 * 保存 AI 配置
 * 写库后重置 chat/embedding 模型实例缓存与向量存储单例，
 * 使新配置对后续所有请求（含 worker 任务）即时生效，无需重启
 *
 * @param patch 配置补丁（undefined = 不修改；空串 = 清除 DB 覆盖回退 env）
 * @returns 保存后的配置视图（前端用于刷新回显）
 */
export async function saveSettings(patch: SaveAiSettings): Promise<AiSettingsView> {
  // 字段名与 ai-settings 的 AI_SETTING_KEYS 一致，直接透传
  await saveAiSettings(patch as AiSettingsPatch)

  // 新配置即时生效：清空模型实例缓存 + 向量存储单例（下次使用时按新配置重建）
  resetAiInstances()
  resetRagVectorStore()

  return getSettingsView()
}

/** 单个测试目标的结果 */
export interface AiTestItemResult {
  /** 测试目标：chat 对话 / embedding 向量化 / rerank 精排 */
  target: 'chat' | 'embedding' | 'rerank'
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

/**
 * 将测试请求中的 overrides 合并到当前生效配置上，得到本次测试使用的临时配置
 * - undefined = 沿用生效值
 * - 空串 = 视为未设置（模拟「清除覆盖」后的测试效果）
 */
function mergeForTest(
  effective: Awaited<ReturnType<typeof getAiSettings>>,
  overrides?: SaveAiSettings,
): Awaited<ReturnType<typeof getAiSettings>> {
  if (!overrides) return effective
  /** 空串 → null（未设置），非空 → trim 后的值，undefined → 沿用 */
  const pick = (value: string | undefined, fallback: string | null): string | null => {
    if (value === undefined) return fallback
    const trimmed = value.trim()
    return trimmed === '' ? null : trimmed
  }
  /** 布尔/数字字段：空串 → null（视为清除，回退默认），undefined → 沿用，其余原样 */
  const pickScalar = <T extends boolean | number>(value: T | '' | undefined, fallback: T): T | null => {
    if (value === undefined) return fallback
    if (value === '') return null
    return value
  }
  return {
    baseUrl: pick(overrides.baseUrl, effective.baseUrl),
    apiKey: pick(overrides.apiKey, effective.apiKey),
    chatModel: pick(overrides.chatModel, effective.chatModel) || effective.chatModel,
    embeddingBaseUrl: pick(overrides.embeddingBaseUrl, effective.embeddingBaseUrl),
    embeddingApiKey: pick(overrides.embeddingApiKey, effective.embeddingApiKey),
    embeddingModel: pick(overrides.embeddingModel, effective.embeddingModel) || effective.embeddingModel,
    embeddingDim: effective.embeddingDim,
    // rerank：模型名 null = 本次测试视为关闭精排
    rerankBaseUrl: pick(overrides.rerankBaseUrl, effective.rerankBaseUrl),
    rerankApiKey: pick(overrides.rerankApiKey, effective.rerankApiKey),
    rerankModel: pick(overrides.rerankModel, effective.rerankModel),
    // RAG 流程参数不参与连通性测试，仅补全结构（空串 = 清除覆盖，回退内置默认）
    ragIntentEnabled: pickScalar(overrides.ragIntentEnabled, true) ?? true,
    ragQueryExpansionEnabled: pickScalar(overrides.ragQueryExpansionEnabled, true) ?? true,
    ragRecallSize: pickScalar(overrides.ragRecallSize, 20) ?? 20,
    ragMinScore: pickScalar(overrides.ragMinScore, 0.35) ?? 0.35,
    ragFinalTopK: pickScalar(overrides.ragFinalTopK, 6) ?? 6,
  }
}

/**
 * AI 连接测试
 * 用「传入 overrides ?? 当前生效配置」临时构造独立模型实例（不读不写实例缓存，
 * 不影响线上正在使用的实例），分别对 chat / embedding 发起最小请求验证连通性。
 * 任何失败都以 ok:false 正常返回（不抛 BizException），前端据此展示失败原因
 */
export async function testAi(params: TestAi): Promise<AiTestItemResult[]> {
  const effective = await getAiSettings()
  const merged = mergeForTest(effective, params.overrides)

  // —— chat 连通性：构造独立 ChatOpenAI，发送最小消息 ——
  const testChat = async (): Promise<AiTestItemResult | undefined> => {
    if (!params.targets.includes('chat')) return undefined
    if (!(merged.baseUrl && merged.apiKey)) {
      return { target: 'chat', ok: false, error: 'chat 服务未配置（缺少 baseUrl 或 apiKey）' }
    }
    const start = Date.now()
    try {
      const chatModel = new ChatOpenAI({
        streaming: false,
        model: merged.chatModel,
        apiKey: merged.apiKey,
        // LangChain AsyncCaller 顶层参数：0 = 连接失败立即返回（测试场景不重试）
        maxRetries: 0,
        configuration: {
          baseURL: merged.baseUrl,
          timeout: 30_000,
          maxRetries: 0, // openai SDK 客户端同样关闭重试
        },
        // 限制输出长度：连接测试只关心「能不能通」，不需要完整生成
        maxTokens: 8,
      })
      await chatModel.invoke([new HumanMessage('ping')])
      return { target: 'chat', ok: true, latencyMs: Date.now() - start, model: merged.chatModel }
    } catch (err) {
      return {
        target: 'chat',
        ok: false,
        latencyMs: Date.now() - start,
        model: merged.chatModel,
        error: err instanceof Error ? err.message : '连接失败',
      }
    }
  }

  // —— embedding 连通性：构造独立 OpenAIEmbeddings，向量化单条文本 ——
  const testEmbedding = async (): Promise<AiTestItemResult | undefined> => {
    if (!params.targets.includes('embedding')) return undefined
    const fallback = merged.baseUrl && merged.apiKey
    const hasStandalone = Boolean(merged.embeddingBaseUrl && merged.embeddingApiKey)
    if (!hasStandalone && !fallback) {
      return { target: 'embedding', ok: false, error: 'embedding 服务未配置（缺少 URL/key，且主配置未就绪）' }
    }
    const start = Date.now()
    try {
      const embeddings = new OpenAIEmbeddings({
        model: merged.embeddingModel,
        apiKey: merged.embeddingApiKey || merged.apiKey,
        batchSize: 1,
        stripNewLines: false,
        // 与 getEmbeddingsInstance 对齐：显式传期望维度，
        // 避免服务商默认维度与 AI_EMBEDDING_DIM 配置不符造成误报
        dimensions: merged.embeddingDim,
        // 显式 float 编码：openai SDK v7 默认 base64 且把响应无条件按 base64 解码，
        // 服务商（如智谱）忽略 base64 返回 float 数组时会被错解成 1/4 维度（详见 ai.ts）
        encodingFormat: 'float',
        // LangChain AsyncCaller 顶层参数：0 = 连接失败立即返回（测试场景不重试）
        maxRetries: 0,
        configuration: {
          baseURL: merged.embeddingBaseUrl || merged.baseUrl,
          timeout: 30_000,
          maxRetries: 0,
        },
      })
      const [vector] = await embeddings.embedDocuments(['ping'])
      const dim = vector?.length ?? 0
      if (dim !== merged.embeddingDim) {
        // 维度与期望不符：连接是通的，但与 AI_EMBEDDING_DIM 不符会导致向量写入/检索错位，视为不可用
        return {
          target: 'embedding',
          ok: false,
          latencyMs: Date.now() - start,
          model: merged.embeddingModel,
          dim,
          error: `向量维度 ${dim} 与期望 ${merged.embeddingDim} 不符，请检查模型或 AI_EMBEDDING_DIM 配置`,
        }
      }
      return {
        target: 'embedding',
        ok: true,
        latencyMs: Date.now() - start,
        model: merged.embeddingModel,
        dim,
      }
    } catch (err) {
      return {
        target: 'embedding',
        ok: false,
        latencyMs: Date.now() - start,
        model: merged.embeddingModel,
        error: err instanceof Error ? err.message : '连接失败',
      }
    }
  }

  // —— rerank 连通性：直连 POST {base}/rerank（非 OpenAI 协议，与 ai.ts rerankTexts 同款请求）——
  const testRerank = async (): Promise<AiTestItemResult | undefined> => {
    if (!params.targets.includes('rerank')) return undefined
    if (!merged.rerankModel) {
      // 模型名未配置 = 精排功能关闭（不算故障，但测试视角下提示未配置）
      return { target: 'rerank', ok: false, error: 'rerank 未配置（缺少模型名 AI_RERANK_MODEL，精排功能关闭）' }
    }
    const baseUrl = merged.rerankBaseUrl || merged.baseUrl
    const apiKey = merged.rerankApiKey || merged.apiKey
    if (!baseUrl || !apiKey) {
      return { target: 'rerank', ok: false, model: merged.rerankModel, error: 'rerank URL/Key 缺失，且主配置未就绪' }
    }
    const start = Date.now()
    try {
      // 最小请求：1 条文档 + top_n 1，只验证「能通、能解析」，不关心排序结果
      const resp = await fetch(`${baseUrl.replace(/\/+$/, '')}/rerank`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: merged.rerankModel,
          query: 'ping',
          documents: ['连接测试文档'],
          top_n: 1,
          return_documents: false,
        }),
        // 测试场景 30s 超时（对齐 chat/embedding；线上 rerankTexts 用 5s，此处放宽便于排查）
        signal: AbortSignal.timeout(30_000),
      })
      if (!resp.ok) {
        const body = await resp.text().catch(() => '')
        return {
          target: 'rerank',
          ok: false,
          latencyMs: Date.now() - start,
          model: merged.rerankModel,
          error: `HTTP ${resp.status}：${body.slice(0, 200) || '无响应体'}`,
        }
      }
      const data = (await resp.json()) as { results?: unknown }
      if (!Array.isArray(data.results)) {
        return { target: 'rerank', ok: false, latencyMs: Date.now() - start, model: merged.rerankModel, error: '响应缺少 results 数组，请确认服务为 rerank 协议' }
      }
      return { target: 'rerank', ok: true, latencyMs: Date.now() - start, model: merged.rerankModel }
    } catch (err) {
      return {
        target: 'rerank',
        ok: false,
        latencyMs: Date.now() - start,
        model: merged.rerankModel,
        error: err instanceof Error ? err.message : '连接失败',
      }
    }
  }

  // 三项目标相互独立，并发执行：单目标超时上限 30s，并发后接口总耗时 = 最慢一项目标
  // （顺序执行时上游挂起最长要等 90s，前端长时间无反馈会被误认为「没反应」）
  const settled = await Promise.all([testChat(), testEmbedding(), testRerank()])
  return settled.filter((r): r is AiTestItemResult => r !== undefined)
}
