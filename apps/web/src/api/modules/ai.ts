/**
 * AI 写作模块接口
 *
 * 对接后端 `/api/v1/ai/*` 接口（ai.controller.ts）：
 * - getAiStatus    查询 AI 是否已配置 POST /ai/status 需鉴权（返回 { chatReady, embeddingReady }）
 * - streamAiWrite  AI 写作（改写/续写/生成等）  POST /ai/write   需鉴权（SSE 流式）
 * - abortAiWrite   中止指定 AI 请求（停止生成） POST /ai/abort   需鉴权
 *
 * SSE 事件协议（见后端 ai-sse.ts）：
 * - event: message  正式回答的增量文本（data 为原始文本，非 JSON）
 * - event: thinking 模型思考过程增量（reasoning 模型先吐 thinking 再吐 message）
 * - event: done     正常结束（data: {"done":true}）
 * - event: aborted  请求被中止（data: {"aborted":true}）
 * - event: error    流处理异常（data 为错误消息文本）
 */
import { alova } from '../request'
import { API_BASE_URL, API_PREFIX, API_PATHS } from '../constants'
import { getAccessToken } from '../../utils/token'

/** AI 配置状态查询返回体（项目统一 POST，接口无入参） */
export interface AiStatusView {
  /** chat 服务（baseUrl + apiKey）是否已配置就绪 */
  chatReady: boolean
  /** 向量服务（embedding）是否已配置就绪（含回退主配置场景）；false 时 RAG 不可用 */
  embeddingReady: boolean
}

/**
 * 查询 AI 写作服务是否已配置
 * POST /ai/status（需登录，普通用户即可调用；不暴露任何配置细节）
 *
 * AI 输入框回车提交前做前置检查：chatReady=false 时弹窗引导去 /admin 配置，
 * 避免直接发起 /ai/write 只拿到 80001 业务错误。
 *
 * @returns alova Method，send 后得到 { chatReady, embeddingReady }
 */
export function getAiStatus() {
  return alova.Post<AiStatusView>(API_PATHS.AI.STATUS)
}

/** AI 写作请求参数 */
export interface AiWriteParams {
  /** 写作动作（与后端 AI_WRITE_ACTIONS 枚举一致） */
  action:
    | 'improve'
    | 'fix'
    | 'extend'
    | 'reduce'
    | 'simplify'
    | 'emojify'
    | 'complete'
    | 'continue'
    | 'summarize'
    | 'translate'
    | 'tone'
    | 'ask'
    | 'custom'
  /** 待处理的原文（改写类动作必传） */
  text?: string
  /** 用户自定义指令（ask / custom 必传） */
  instruction?: string
  /** 文档标题（帮助 AI 理解文章主题） */
  title?: string
  /** 当前章节标题：光标上方最近的标题块（AI 聚焦当前章节主题的信号） */
  sectionTitle?: string
  /** 章节标题层级 1-6（与 sectionTitle 成对出现） */
  sectionLevel?: number
  /** 目标语气（action=tone 时使用，如 Formal / Casual） */
  tone?: string
  /** 目标语言（action=translate 时使用） */
  language?: string
  /** 光标/选区之前的文档上下文（帮助 AI 理解行文） */
  contextBefore?: string
  /** 光标/选区之后的文档上下文 */
  contextAfter?: string
  /** 请求唯一标识（前端生成，用于「停止生成」中止服务端流） */
  requestId?: string
}

/** AI 写作 SSE 事件回调集合 */
export interface AiWriteHandlers {
  /** 收到增量文本（多次回调，顺序拼接即为完整回答） */
  onDelta: (text: string) => void
  /** 收到思考过程增量（reasoning 模型先吐 thinking 再吐正文；非 reasoning 模型不回调） */
  onThinking?: (text: string) => void
  /** 正常结束（done 事件） */
  onDone?: () => void
  /** 请求被中止（aborted 事件，含前端主动停止） */
  onAborted?: () => void
  /** 流内异常（error 事件，AI 上游失败等） */
  onError?: (message: string) => void
}

/**
 * 解析一行 SSE 文本到事件缓冲（与 rag.ts 的 feedSseLine 同款实现）
 * SSE 事件格式：`event: <name>\n data: <payload>\n\n`，空行表示事件结束
 */
function feedSseLine(
  line: string,
  state: { event: string; data: string; hasData: boolean }
): { event: string; data: string } | null {
  // 空行：一个事件结束，返回缓冲的完整事件。
  // 用 hasData 标记判断「是否收到过 data 行」而非 data 非空：data 可能为空串
  // （模型把 \n\n 作为独立增量吐出时，整个事件的 data 就是纯换行），不能据此丢弃
  if (line === '' || line === '\r') {
    if (!state.hasData) return null
    const evt = { event: state.event || 'message', data: state.data }
    state.event = ''
    state.data = ''
    state.hasData = false
    return evt
  }
  if (line.startsWith('event:')) {
    state.event = line.slice(6).trim()
  } else if (line.startsWith('data:')) {
    // 多行 data 以换行拼接（本项目 payload 均为单行）。
    // 注意：写作场景 payload 是原始文本增量，前导/尾随空格是有意义的内容
    // （如 token " line"），只能去掉 "data:" 后的这一个分隔空格，绝不能 trim
    let value = line.slice(5)
    if (value.startsWith(' ')) value = value.slice(1)
    // 拼接换行必须用 hasData 标记而非 data 非空判断：增量以换行开头时
    // （模型把 \n\n 作为独立 token 吐出）首个 data 行为空串，按 data 非空判断
    // 会漏掉它对应的换行，导致标题行与正文粘连、空行 delta 整体丢失
    if (state.hasData) state.data += '\n'
    state.hasData = true
    state.data += value
  }
  return null
}

/**
 * AI 写作（流式）：按动作生成/改写文本
 * POST /ai/write（需鉴权，SSE 流式）
 *
 * 实现说明：
 * - POST 无法用 EventSource，用原生 fetch + ReadableStream 逐块解析（与 streamRagChat 同款）
 * - 业务异常（未登录 / AI 未配置 80001 等）在流开始前抛出：响应为 JSON 而非 SSE，
 *   解析后抛 ApiError 由调用方捕获
 *
 * @param params 写作参数（动作 + 原文/指令等）
 * @param handlers SSE 事件回调
 * @param signal 可选中止信号（前端「停止生成」）
 */
export async function streamAiWrite(
  params: AiWriteParams,
  handlers: AiWriteHandlers,
  signal?: AbortSignal
): Promise<void> {
  // 不走 alova（不支持流式回调），原生 fetch 并手动注入 token
  const token = getAccessToken()
  const resp = await fetch(`${API_BASE_URL}${API_PREFIX}${API_PATHS.AI.WRITE}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(params),
    signal,
  })

  // 非流式响应：业务异常以 JSON 返回（HTTP 200 + { status: 错误码, info }），
  // 与 request.ts 解包逻辑对齐，抛 ApiError
  const contentType = resp.headers.get('content-type') || ''
  if (!contentType.includes('text/event-stream')) {
    const result = await resp.json().catch(() => ({}))
    if (result.status !== 1) {
      const { ApiError } = await import('../request')
      throw new ApiError(result.info || 'AI 写作请求失败', result.status, resp.status, result)
    }
    return
  }

  // 逐行解析 SSE 事件流
  const reader = resp.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const state = { event: '', data: '', hasData: false }

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    // 按换行拆分；最后一段可能不完整，留在 buffer 等下一块
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const evt = feedSseLine(line, state)
      if (!evt) continue
      // 按事件类型分发
      if (evt.event === 'message') {
        // message 的 data 为原始文本增量（非 JSON）
        handlers.onDelta(evt.data)
      } else if (evt.event === 'thinking') {
        // thinking 的 data 为思考过程文本增量（reasoning 模型）
        handlers.onThinking?.(evt.data)
      } else if (evt.event === 'done') {
        handlers.onDone?.()
      } else if (evt.event === 'aborted') {
        handlers.onAborted?.()
      } else if (evt.event === 'error') {
        // error 的 data 为错误消息文本
        handlers.onError?.(evt.data)
      }
    }
  }
}

/**
 * 中止指定 AI 写作请求（前端「停止生成」）
 * POST /ai/abort（需鉴权）
 *
 * 服务端流被中止后会推送 aborted 事件；若流已自然结束则 aborted=false，无副作用。
 *
 * @param requestId 需要中止的请求 ID
 */
export async function abortAiWrite(requestId: string): Promise<void> {
  const token = getAccessToken()
  try {
    await fetch(`${API_BASE_URL}${API_PREFIX}${API_PATHS.AI.ABORT}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ requestId }),
    })
  } catch {
    // 中止失败不阻断前端流程（本地 AbortSignal 已切断读取，服务端流会被自然丢弃）
  }
}
