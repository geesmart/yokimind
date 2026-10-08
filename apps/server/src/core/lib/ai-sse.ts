/**
 * 通用 AI SSE 流式响应封装（LangChain 流 → Hono streamSSE 桥接）
 * （移植自 reddit-helper ai.service.ts 的 streamAIResponse，按 yokimind 需求调整）
 *
 * SSE 事件协议：
 * - event: thinking  模型思考过程（reasoning 模型的 reasoning_content / thinking 字段）
 * - event: message   正式回答的增量文本
 * - event: done      正常结束（data: {"done":true}）
 * - event: aborted   请求被中止（data: {"aborted":true}）
 * - event: error     流处理异常（data: 错误消息）
 *
 * 使用注意（结合项目经验）：
 * - 模型实例创建、权限校验、检索等可能抛 BizException 的逻辑必须在调用
 *   streamChatSSE 之前完成——流一旦开始无法再改 HTTP 状态码，只能靠 error 事件传错
 * - 本函数内部会创建 ChatOpenAI 实例（未配置 AI 时抛 RAG_NOT_CONFIGURED，
 *   发生在流开始前，可正常走全局错误响应）
 */

import type { Context } from 'hono'
import { streamSSE } from 'hono/streaming'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import { createChatModel, toLangChainMessages } from '~/core/lib/ai.js'
import { createAbortController, cleanupRequest } from '~/core/lib/ai-abort-manager.js'
import { usePino } from '~/core/plugins/pino.js'

/** streamChatSSE 的选项 */
export interface StreamChatSSEOptions {
  /** OpenAI 格式消息列表（system / user / assistant） */
  messages: ChatCompletionMessageParam[]
  /** 请求 ID：传入后注册 AbortController，支持 abortRequest(requestId) 中止生成 */
  requestId?: string
  /** 模型名覆盖（默认取 AI_CHAT_MODEL） */
  model?: string
  /** 日志前缀（区分不同业务场景的流式日志） */
  logPrefix: string
  /** 流正常结束后回调完整回答文本（供调用方落库/统计；中止与异常时不回调） */
  onDone?: (full: string) => void | Promise<void>
}

/**
 * 从 LangChain chunk 中提取思考过程文本
 * 不同聚合服务商把 reasoning 放在不同位置，这里覆盖生产验证过的三种字段位置
 */
function extractThinking(chunk: {
  additional_kwargs?: Record<string, unknown>
  response_metadata?: Record<string, unknown>
}): string {
  return (
    (chunk.additional_kwargs?.reasoning_content as string) ||
    (chunk.additional_kwargs?.thinking as string) ||
    (chunk.response_metadata?.reasoning_content as string) ||
    ''
  )
}

/**
 * 通用 AI SSE 流式响应处理函数
 * 创建模型与消息转换发生在流开始之前（配置错误可直接返回业务错误码），
 * 流内的异常只能通过 error 事件传给前端
 *
 * @param c Hono 上下文
 * @param options 流式选项，见 StreamChatSSEOptions
 * @returns SSE 流式响应
 */
export async function streamChatSSE(c: Context, options: StreamChatSSEOptions): Promise<Response> {
  const { messages, requestId, model, logPrefix, onDone } = options
  const logger = usePino()

  // —— 流开始前的准备：任何抛错都发生在 HTTP 状态码可控阶段 ——
  const chatModel = await createChatModel({ model })
  const lcMessages = toLangChainMessages(messages)

  // 有 requestId 则注册 AbortController，signal 透传给模型调用
  let signal: AbortSignal | undefined
  if (requestId) {
    signal = createAbortController(requestId).signal
    logger.debug(`[${logPrefix}] 已注册 AbortController: ${requestId}`)
  }

  return streamSSE(c, async (stream) => {
    const startTime = Date.now()
    logger.debug(`[${logPrefix}] streamSSE 开始执行`)

    let chunkCount = 0
    let totalChars = 0
    let thinkingChars = 0
    let isInThinkingPhase = false
    let isAborted = false
    let full = ''

    try {
      // 调用级传入 signal，流式获取 LangChain chunk
      const chunks = await chatModel.stream(lcMessages, { signal })

      for await (const chunk of chunks) {
        // 每轮检查中止信号，及时跳出循环
        if (signal?.aborted) {
          logger.debug(`[${logPrefix}] 请求被中止: ${requestId}`)
          isAborted = true
          break
        }

        chunkCount++

        // 先处理 thinking 内容（reasoning 模型先吐思考过程再吐正文）
        const thinking = extractThinking(chunk)
        if (thinking) {
          if (!isInThinkingPhase) {
            isInThinkingPhase = true
            logger.debug(`[${logPrefix}] 进入 thinking 阶段`)
          }
          thinkingChars += thinking.length
          await stream.writeSSE({ data: thinking, event: 'thinking' })
        }

        // 再处理正式回答内容
        const content = (chunk.content as string) || ''
        if (content) {
          if (isInThinkingPhase) {
            isInThinkingPhase = false
            logger.debug(`[${logPrefix}] thinking 阶段结束，共 ${thinkingChars} 字符`)
          }
          full += content
          totalChars += content.length
          await stream.writeSSE({ data: content, event: 'message' })
        }
      }

      // 结束信号：中止与正常完成区分开，前端据此展示不同状态
      if (isAborted) {
        await stream.writeSSE({ data: JSON.stringify({ aborted: true }), event: 'aborted' })
        logger.debug(`[${logPrefix}] 发送中止事件`)
      } else {
        await stream.writeSSE({ data: JSON.stringify({ done: true }), event: 'done' })
        // 仅正常完成时回调完整文本（落库/统计由调用方决定）
        await onDone?.(full)
      }

      logger.debug(
        `[${logPrefix}] SSE 流读取完成，共 ${chunkCount} 个 chunk，${totalChars} 字符，耗时 ${Date.now() - startTime}ms`
      )
    } catch (error) {
      // AbortError 是正常中止，其余才是真正的流处理错误
      if (error instanceof Error && error.name === 'AbortError') {
        logger.debug(`[${logPrefix}] 流被正常中止`)
        await stream.writeSSE({ data: JSON.stringify({ aborted: true }), event: 'aborted' })
      } else {
        logger.error({ err: error }, `[${logPrefix}] 流处理错误`)
        await stream.writeSSE({ data: (error as Error).message, event: 'error' })
      }
    } finally {
      // 无论成功/失败/中止都要清理注册，防止 Map 泄漏
      if (requestId) {
        cleanupRequest(requestId)
        logger.debug(`[${logPrefix}] 已清理 AbortController: ${requestId}`)
      }
    }
  })
}
