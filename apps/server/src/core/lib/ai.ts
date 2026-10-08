import { ChatOpenAI, OpenAIEmbeddings } from '@langchain/openai'
import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages'
import type { BaseLanguageModelInput } from '@langchain/core/language_models/base'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import { BizException } from '~/core/lib/biz.exception.js'
import { ErrorCode } from '~/config/error-code.js'
import { usePino } from '~/core/plugins/pino.js'
import { getAiSettings } from '~/core/lib/ai-settings.js'

/**
 * AI 基础能力封装（LangChain @langchain/openai，OpenAI 兼容协议）
 *
 * 设计要点（用法对齐 reddit-helper 的 LangChain 调用方式）：
 * - 走 OpenAI 兼容接口，通过 AI_BASE_URL 指向任意服务商
 *   （SiliconFlow / DeepSeek / 通义 / 智谱 / 本地 Ollama 兼容层等）
 * - 配置来源：管理后台 app_settings 表（DB > .env 兜底），见 core/lib/ai-settings.ts，
 *   管理员在 /admin 页面保存配置后调用 resetAiInstances() 即时生效，无需重启
 * - 惰性初始化：仅在首次实际调用时创建模型实例，未配置时接口层返回 RAG_NOT_CONFIGURED
 * - embedTexts 分批调用（batchSize 32），并对返回维度做校验，防止换模型后返回维度与
 *   AI_EMBEDDING_DIM 配置不符、导致写入 Qdrant 命名向量时错位
 * - embedQuery 单条向量化（检索查询用），与 embedTexts 共享同一 embeddings 实例
 * - chatStream 提供流式对话回调，供 RAG 问答接口以 SSE 透传给前端
 * - chatInvoke 提供非流式对话（model.invoke 用法），供后续 AI 功能直接使用
 * - AbortSignal 属于单次请求，统一走调用级选项 model.stream(messages, { signal })，
 *   不放进被缓存复用的模型实例；中止管理见 core/lib/ai-abort-manager.ts
 */

const logger = usePino()

/** chat 模型实例缓存（key = baseURL|model，同一配置复用实例） */
const chatModelCache = new Map<string, ChatOpenAI>()
/** embedding 模型实例单例（baseURL 可能与 chat 不同，单独缓存） */
let embeddingModel: OpenAIEmbeddings | null = null

/**
 * 清空模型实例缓存
 * 管理员保存新 AI 配置后调用：chat 缓存与 embedding 单例全部重建，新配置即时生效
 */
export function resetAiInstances(): void {
  chatModelCache.clear()
  embeddingModel = null
}

/**
 * 判断 AI 服务是否已配置
 * worker 启动与 controller 层用它做前置检查，未配置时优雅降级而非抛错崩溃
 * 配置来源为管理后台/环境变量（见 ai-settings.ts），因此为异步读取
 */
export async function isAiConfigured(): Promise<boolean> {
  const settings = await getAiSettings()
  return Boolean(settings.baseUrl && settings.apiKey)
}

/**
 * 判断 embedding 服务是否就绪
 * - 单独配置了 AI_EMBEDDING_BASE_URL / AI_EMBEDDING_API_KEY 时，两者必须同时提供
 *   （只配 URL 不配 key 会拿着错误的 key 去打必败请求，视为未就绪）
 * - 未单独配置时回退主配置（同一家服务商同时提供 embedding 的场景）
 *
 * embedding 未就绪时：索引任务保留 pending（不打必败请求），search/chat 拒绝服务；
 * key 配好后 worker 自动恢复消费 pending 任务，无需人工干预
 */
export async function isEmbeddingReady(): Promise<boolean> {
  const settings = await getAiSettings()
  if (settings.embeddingBaseUrl || settings.embeddingApiKey) {
    return Boolean(settings.embeddingBaseUrl && settings.embeddingApiKey)
  }
  return Boolean(settings.baseUrl && settings.apiKey)
}

/**
 * 创建/获取 ChatOpenAI 模型实例（惰性初始化 + 按配置缓存）
 * 未配置时抛 RAG_NOT_CONFIGURED，统一由全局错误处理返回
 *
 * @param options.model 可选的模型名覆盖（默认取配置的 chat 模型）
 */
export async function createChatModel(options?: { model?: string }): Promise<ChatOpenAI> {
  const settings = await getAiSettings()
  if (!(settings.baseUrl && settings.apiKey)) {
    throw new BizException(ErrorCode.RAG_NOT_CONFIGURED)
  }
  const model = options?.model ?? settings.chatModel

  // 同一 baseURL + model 复用实例，避免重复构造；signal 等请求级参数不放进实例
  const cacheKey = `${settings.baseUrl}|${model}`
  const cached = chatModelCache.get(cacheKey)
  if (cached) return cached

  const instance = new ChatOpenAI({
    // 流式模式：model.stream 走 SSE 逐 chunk 返回
    streaming: true,
    model,
    apiKey: settings.apiKey,
    // 暂时默认关闭思考模式（modelKwargs 里的键值会原样合并进请求体）：
    // 智谱 GLM-4.5+/4.6 等推理模型默认开启思考，先吐 <think> 推理再给正文，
    // 会导致 SSE 流里出现大段推理噪声、问答首字延迟也显著变高。
    // 智谱协议：thinking: { type: 'disabled' }（'enabled' 才开启）；
    // 不支持该参数的服务商一般会忽略此字段，不影响正常对话
    // modelKwargs: {
    //   thinking: { type: 'disabled' },
    // },
    configuration: {
      baseURL: settings.baseUrl,
      // AI 服务偶尔慢，给足超时避免长文本生成被中途掐断
      timeout: 60_000,
      maxRetries: 2,
    },
  })
  chatModelCache.set(cacheKey, instance)
  return instance
}

/**
 * 获取/创建 OpenAIEmbeddings 模型实例（惰性初始化 + 单例）
 * embedding 独立配置优先，未设置时回退主配置（与 chat 不同服务商场景常见）
 * 导出供向量存储层与检索管线复用同一 embeddings 实例
 */
export async function getEmbeddingsInstance(): Promise<OpenAIEmbeddings> {
  if (embeddingModel) return embeddingModel
  const settings = await getAiSettings()
  // 就绪判断与 isEmbeddingReady 一致：单独配置时 URL/key 必须成对，否则回退主配置
  const hasStandalone = Boolean(settings.embeddingBaseUrl && settings.embeddingApiKey)
  const hasFallback = Boolean(settings.baseUrl && settings.apiKey)
  if (!hasStandalone && !hasFallback) {
    // 与未配置主配置同码：对调用方而言都是「embedding 服务不可用」
    throw new BizException(ErrorCode.RAG_NOT_CONFIGURED)
  }

  embeddingModel = new OpenAIEmbeddings({
    model: settings.embeddingModel,
    apiKey: settings.embeddingApiKey || settings.apiKey,
    // 每批 32 条，避免单次请求 token 超限（与改造前分批行为一致）
    batchSize: 32,
    // LangChain 默认 stripNewLines=true 会把换行替换成空格，这里关闭以保持原文送入
    stripNewLines: false,
    // 显式向服务商请求期望维度（随请求体传 dimensions 字段），与
    // AI_EMBEDDING_DIM / Qdrant 命名向量维度保持一致（命名向量按此维度选择，见 rag.store.ts）
    // 实测（2026-09-10）：智谱 embedding-3 默认即返回 2048 维，且请求带 dimensions 时
    // 按传入值返回；配置了 AI_EMBEDDING_DIM 就透传，保证与命名向量强一致
    dimensions: settings.embeddingDim,
    // 显式指定 float 编码（关键修复，勿删）：
    // openai SDK v7 在调用方未指定 encoding_format 时默认请求 base64，并把响应
    // 「无条件按 base64 解码」（openai lib/embeddings.js）；智谱忽略 base64 要求、
    // 原样返回 float 数组，2048 个数值被当作 2048 字节按 float32 解析 → 512 维（2048/4）。
    // 显式传 'float' 后 SDK 原样返回响应、跳过 base64 解码（lib/embeddings.js L28-30），
    // 任何"默认请求也默认响应 base64"的服务商都兼容此写法
    encodingFormat: 'float',
    configuration: {
      baseURL: settings.embeddingBaseUrl || settings.baseUrl,
      timeout: 60_000,
      maxRetries: 2,
    },
  })
  return embeddingModel
}

/**
 * 将 OpenAI 消息的 content 归一化为纯文本
 * OpenAI 类型里 content 可能是 string / 内容分块数组 / null，LangChain 消息
 * 构造器不接受后两种形态；本项目只用纯文本，数组形态兜底拼接 text 部分
 */
function toText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === 'string' ? part : ((part as { text?: string }).text ?? '')))
      .join('')
  }
  return ''
}

/**
 * 将 OpenAI 格式消息转换为 LangChain 消息列表
 * chatStream / chatInvoke / ai-sse 均复用此转换
 *
 * @param messages OpenAI 格式消息列表（system / user / assistant）
 */
export function toLangChainMessages(
  messages: ChatCompletionMessageParam[]
): BaseLanguageModelInput {
  const lcMessages = messages.map((msg) => {
    switch (msg.role) {
      case 'system':
        return new SystemMessage(toText(msg.content))
      case 'assistant':
        return new AIMessage(toText(msg.content))
      default:
        // user 与未识别 role 统一按人类消息处理，保证不丢请求内容
        return new HumanMessage(toText(msg.content))
    }
  })
  return lcMessages
}

/**
 * 批量文本向量化
 * - embedDocuments 内部按 batchSize（32）分批请求且结果保序
 * - 校验返回维度：与服务商返回维度不符时抛 RAG_EMBEDDING_DIM_MISMATCH
 *
 * @param texts 文本列表（顺序与返回向量一一对应）
 * @returns 与输入等长、等序的向量列表
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return []
  const settings = await getAiSettings()
  const model = settings.embeddingModel
  const expectedDim = settings.embeddingDim

  let vectors: number[][]
  try {
    // 结果保序：embedDocuments 按输入顺序返回对应向量
    vectors = await (await getEmbeddingsInstance()).embedDocuments(texts)
  } catch (err) {
    logger.error({ err, model, count: texts.length }, 'embedding request failed')
    throw new BizException(ErrorCode.RAG_EMBEDDING_FAILED)
  }

  // 逐条校验维度，防止换模型后与 AI_EMBEDDING_DIM 不符、写入 Qdrant 命名向量时错位
  for (const vector of vectors) {
    if (vector.length !== expectedDim) {
      logger.error(
        { expect: expectedDim, actual: vector.length, model },
        'embedding dimension mismatch'
      )
      throw new BizException(ErrorCode.RAG_EMBEDDING_DIM_MISMATCH)
    }
  }
  return vectors
}

/**
 * 单条文本向量化（检索查询专用）
 * 与 embedTexts 共享同一 embeddings 实例；不做维度校验（查询向量与索引向量必须同模型，
 * 模型切换场景由 rag_sync 全量重索引保证两端一致，见 reindexWiki）
 *
 * 异常不在此包装：调用方（retrieveChunks）统一把查询向量化 / 向量检索错误
 * 包成 RAG_EMBEDDING_FAILED，避免双重包装丢失原始错误信息
 *
 * @param text 查询文本
 * @returns 查询向量
 */
export async function embedQuery(text: string): Promise<number[]> {
  return (await getEmbeddingsInstance()).embedQuery(text)
}

/**
 * 流式对话：逐 token 回调透传，完整文本由调用方按需累积
 *
 * @param messages OpenAI 格式消息列表（system + user）
 * @param onDelta 每收到一段增量文本时的回调（SSE 场景直接透传给前端）
 * @param options.signal 可选的中止信号（传入后可随时取消生成）
 * @returns 完整的回答文本
 */
export async function chatStream(
  messages: ChatCompletionMessageParam[],
  onDelta: (delta: string) => void | Promise<void>,
  options?: { signal?: AbortSignal }
): Promise<string> {
  const chatModel = await createChatModel()
  try {
    // 调用级传入 signal：中止后流立即结束
    const stream = await chatModel.stream(toLangChainMessages(messages), {
      signal: options?.signal,
    })
    let full = ''
    for await (const chunk of stream) {
      const delta = (chunk.content as string) || ''
      if (delta) {
        full += delta
        await onDelta(delta)
      }
      // 每轮检查中止信号，及时停止累积与回调
      if (options?.signal?.aborted) break
    }
    return full
  } catch (err) {
    // 主动中止不算失败，直接结束
    if (options?.signal?.aborted) return ''
    logger.error({ err, model: (await getAiSettings()).chatModel }, 'chat stream failed')
    throw new BizException(ErrorCode.RAG_CHAT_FAILED)
  }
}

/**
 * 非流式对话：一次性返回完整回答（model.invoke 用法）
 * 供后续 AI 功能（总结、改写等）直接使用
 *
 * @param messages OpenAI 格式消息列表
 * @param options.model 可选的模型名覆盖（默认取 AI_CHAT_MODEL）
 * @param options.signal 可选的中止信号
 * @returns 完整回答文本（已 trim）
 */
export async function chatInvoke(
  messages: ChatCompletionMessageParam[],
  options?: { model?: string; signal?: AbortSignal }
): Promise<string> {
  const chatModel = await createChatModel({ model: options?.model })
  try {
    const response = await chatModel.invoke(toLangChainMessages(messages), {
      signal: options?.signal,
    })
    return ((response.content as string) || '').trim()
  } catch (err) {
    // 主动中止不算失败
    if (options?.signal?.aborted) return ''
    logger.error(
      { err, model: options?.model ?? (await getAiSettings()).chatModel },
      'chat invoke failed'
    )
    throw new BizException(ErrorCode.AI_SERVICE_ERROR)
  }
}

// ============ GLM Rerank 精排（独立 HTTP 端点，非 OpenAI 协议） ============

/** rerank 输入防御性上限：query 与每条 document 截断长度（智谱限制 4096 字） */
const RERANK_MAX_QUERY_CHARS = 4000
/** rerank documents 条数上限（智谱限制 128 条） */
const RERANK_MAX_DOCS = 128
/** rerank 请求超时（毫秒）：精排是同步阻塞检索管线的一环，超时后走 fail-open */
const RERANK_TIMEOUT_MS = 5_000

/** 智谱 rerank 响应中的单条结果（return_documents: false 时仅 index + 分数） */
interface RerankApiResult {
  index: number
  relevance_score: number
}

/**
 * GLM rerank 精排：用 rerank 模型对「query × 候选文档」重打相关性分，返回按分降序的原索引数组
 *
 * 服务端点：POST {rerankBaseUrl}/rerank（智谱：https://open.bigmodel.cn/api/paas/v4/rerank，
 * OpenAI 兼容体系之外的独立端点，因此不走 LangChain，直接 fetch）
 *
 * 降级策略（fail-open，绝不阻断问答/搜索）：
 * - 未配置 AI_RERANK_MODEL → 返回 null（功能关闭，调用方走向量序）
 * - URL/Key 缺省时回退主配置 baseUrl/apiKey；主配置也未就绪 → null
 * - 请求失败 / 超时（5s）/ 响应结构异常 → warn 日志 + null
 *
 * @param query 查询文本（截断至 4000 字）
 * @param documents 候选文档列表（每条截断至 4000 字，最多 128 条）
 * @param topN 返回条数（按 rerank 分降序取前 N 个原索引）
 * @returns 按相关性降序排列的「原索引数组」（如 [2, 0, 5]）；功能关闭或失败返回 null
 */
export async function rerankTexts(
  query: string,
  documents: string[],
  topN: number
): Promise<number[] | null> {
  const settings = await getAiSettings()
  // 模型未配置 = 精排功能关闭（非异常），调用方直接走向量序
  if (!settings.rerankModel) return null

  // URL / Key 缺省回退主配置（rerank 服务商与 chat 同家的场景免重复配置）
  const baseUrl = settings.rerankBaseUrl || settings.baseUrl
  const apiKey = settings.rerankApiKey || settings.apiKey
  if (!baseUrl || !apiKey) {
    logger.warn('rerank model configured but base url / api key missing, skip rerank')
    return null
  }

  // 防御性截断：query 4000 字、documents 128 条 × 每条 4000 字（对齐智谱输入限制）
  const trimmedQuery = query.slice(0, RERANK_MAX_QUERY_CHARS)
  const trimmedDocs = documents
    .slice(0, RERANK_MAX_DOCS)
    .map((d) => d.slice(0, RERANK_MAX_QUERY_CHARS))

  const start = Date.now()
  try {
    const resp = await fetch(`${baseUrl.replace(/\/+$/, '')}/rerank`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: settings.rerankModel,
        query: trimmedQuery,
        documents: trimmedDocs,
        top_n: topN,
        // 只回传 index + 分数，不回传文档原文（省流量，原索引由调用方持有）
        return_documents: false,
      }),
      // 5s 超时：精排阻塞检索管线，超时即降级走向量序
      signal: AbortSignal.timeout(RERANK_TIMEOUT_MS),
    })

    if (!resp.ok) {
      const body = await resp.text().catch(() => '')
      logger.warn({ status: resp.status, body: body.slice(0, 300) }, 'rerank request failed')
      return null
    }

    const data = (await resp.json()) as { results?: RerankApiResult[] }
    const results = data.results
    // 响应结构异常（缺 results / index 越界）按失败降级，不抛错
    if (!Array.isArray(results) || results.some((r) => !Number.isInteger(r?.index))) {
      logger.warn({ results }, 'rerank response malformed, skip rerank')
      return null
    }

    // 响应已按分降序（保险起见本地再排一次），映射为原索引数组
    const indices = [...results]
      .sort((a, b) => (b.relevance_score ?? 0) - (a.relevance_score ?? 0))
      .map((r) => r.index)
    logger.info(
      { latencyMs: Date.now() - start, model: settings.rerankModel, docs: trimmedDocs.length },
      'rerank done'
    )
    return indices
  } catch (err) {
    // 超时 / 网络失败：fail-open（warn 后走向量序），绝不阻断问答
    logger.warn(
      { err, latencyMs: Date.now() - start },
      'rerank request failed, fallback to vector order'
    )
    return null
  }
}
