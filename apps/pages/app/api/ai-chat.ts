/**
 * 访客 AI 问答接口（分享公开页右下角 AI 浮窗专用，无需登录）
 *
 * 对接后端 `/api/v1/share/wiki/:wikiId/ai-chat`（share.controller.ts，SSE 流式）：
 * - 权限：shareAuthMiddleware 实时复核分享可见性（公开库免令牌；密码库需 X-Share-Token，
 *   pages 站本期无密码流程，密码库页面本身展示锁定卡，浮窗提问会被后端拒绝并提示）
 * - SSE 事件流：stage（阶段进度）→ delta（回答增量）→ sources（引用来源）→ done（正常结束）；
 *   流内异常走 error 事件；AI 未配置仍在流前返回 JSON 错误码（80001）
 *
 * 实现说明（对齐 apps/web/src/api/modules/rag.ts 的 streamRagChat）：
 * - POST + SSE 无法用 EventSource，用原生 fetch + ReadableStream 逐块解析
 * - 业务异常（分享不存在 / 需要密码 / 限流 / AI 未配置等）在流开始前抛出：
 *   响应为 JSON（HTTP 200 + { status: 错误码, info }）而非 SSE，解析后抛 ApiError
 * - 仅浏览器端使用（浮窗交互触发），不做 SSR 取数
 */
import { API_PREFIX, API_PATHS } from './constants'
import { ApiError } from './request'

// ==================== 类型定义（与后端 rag.service.ts 导出类型对齐） ====================

/** 问答阶段（与后端 rag.service.ts 的 ChatStage 对齐；随 stage 事件逐个推送） */
export type ChatStage = 'thinking' | 'searching' | 'reranking' | 'generating'

/** 阶段进度文案（气泡内展示；无 stage 值时回落到 thinking 兼容旧后端） */
export const CHAT_STAGE_LABELS: Record<ChatStage, string> = {
  thinking: '思考中…',
  searching: '检索知识库…',
  reranking: '重排上下文…',
  generating: '生成回答…',
}

/** AI 问答引用来源（回答结束后随 sources 事件推送） */
export interface RagChatSource {
  /** 切片 ID */
  chunkId: string
  /** 文档 ID */
  documentId: string
  /** 节点 ID（可能为 null） */
  nodeId: string | null
  /** 文档标题 */
  title: string | null
  /** 标题路径（"文档标题 > 一级标题"） */
  headingPath: string | null
  /** 相似度得分（越大越相似） */
  score: number
  /** 前端跳转链接 /w/{wikiId}/{nodeId}（nodeId 缺失时为 null） */
  url: string | null
}

/** AI 问答 SSE 事件回调集合 */
export interface AiChatHandlers {
  /** 问答阶段推进（thinking → searching → reranking → generating，每个阶段回调一次） */
  onStage?: (stage: ChatStage) => void
  /** 收到回答增量文本（多次回调，顺序拼接即为完整回答） */
  onDelta: (text: string) => void
  /** 回答结束：推送引用来源列表 */
  onSources?: (sources: RagChatSource[]) => void
  /** 流内异常（AI 上游失败等，error 事件） */
  onError?: (message: string) => void
  /** 正常结束（done 事件） */
  onDone?: () => void
}

/**
 * 解析一行 SSE 文本到事件缓冲（内部辅助）
 * SSE 事件格式：`event: <name>\n data: <payload>\n\n`，空行表示事件结束
 */
function feedSseLine(line: string, state: { event: string; data: string }): { event: string; data: string } | null {
  // 空行：一个事件结束，返回缓冲的完整事件
  if (line === '' || line === '\r') {
    if (!state.data) return null
    const evt = { event: state.event || 'message', data: state.data }
    state.event = ''
    state.data = ''
    return evt
  }
  if (line.startsWith('event:')) {
    state.event = line.slice(6).trim()
  } else if (line.startsWith('data:')) {
    // 多行 data 以换行拼接（本项目 payload 均为单行 JSON）
    state.data += (state.data ? '\n' : '') + line.slice(5).trim()
  }
  return null
}

/** AI 问答对话历史条目（多轮追问上下文，前端内存维护，服务端不落库） */
export interface RagHistoryItem {
  /** 该轮用户提问 */
  question: string
  /** 该轮 AI 回答 */
  answer: string
}

/**
 * 访客 AI 问答（RAG）：基于该知识库公开内容流式生成回答
 * POST /share/wiki/:wikiId/ai-chat（无需登录，SSE 流式）
 *
 * @param wikiId 知识库 ID（路由 /w/:wikiId、/b/:wikiId 的 wikiId 段，已小写规范化）
 * @param question 用户问题
 * @param handlers SSE 事件回调
 * @param signal 可选中断信号（AbortController.signal，用于"停止生成"）
 * @param history 可选对话历史（最多 10 条，时间正序；用于问题改写与多轮上下文）
 */
export async function streamShareAiChat(
  wikiId: string,
  question: string,
  handlers: AiChatHandlers,
  signal?: AbortSignal,
  history?: RagHistoryItem[],
): Promise<void> {
  // 不走 $fetch（拿不到流式回调），原生 fetch 直连同源 /api/v1（开发由 devProxy 转发）
  const resp = await fetch(`${API_PREFIX}${API_PATHS.SHARE.AI_CHAT}/${wikiId}/ai-chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, history }),
    signal,
  })

  // 非流式响应：业务异常以 JSON 返回（HTTP 200 + { status: 错误码, info }），
  // 与 request.ts 解包逻辑对齐，抛 ApiError 由调用方捕获
  const contentType = resp.headers.get('content-type') || ''
  if (!contentType.includes('text/event-stream')) {
    const result = await resp.json().catch(() => ({}))
    if (result.status !== 1) {
      throw new ApiError(result.info || '请求失败', result.status, resp.status, result)
    }
    return
  }

  // 逐行解析 SSE 事件流
  const reader = resp.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const state = { event: '', data: '' }

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
      // 按事件类型分发（payload 均为 JSON）
      if (evt.event === 'stage') {
        handlers.onStage?.(JSON.parse(evt.data).stage)
      } else if (evt.event === 'delta') {
        handlers.onDelta(JSON.parse(evt.data).text)
      } else if (evt.event === 'sources') {
        handlers.onSources?.(JSON.parse(evt.data))
      } else if (evt.event === 'error') {
        handlers.onError?.(JSON.parse(evt.data).message)
      } else if (evt.event === 'done') {
        handlers.onDone?.()
      }
    }
  }
}
