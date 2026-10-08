import { Hono } from 'hono'
import { vJson } from '~/core/helper/zod.helper.js'
import { authMiddleware } from '~/core/middleware/auth.middleware.js'
import { usePino } from '~/core/plugins/pino.js'
import { abortRequest } from '~/core/lib/ai-abort-manager.js'
import { streamChatSSE } from '~/core/lib/ai-sse.js'
import { isAiConfigured, isEmbeddingReady } from '~/core/lib/ai.js'
import { AiWriteSchema, AiAbortSchema } from './ai.schema.js'
import { buildWriteMessages } from './ai.service.js'
// 动作展示名由技能注册表派生（ai.skills.ts 是提示词与元数据的唯一来源）
import { AI_ACTION_LABELS } from './ai.skills.js'

const logger = usePino()

/**
 * AI 写作控制器
 * 为 notion-editor 提供 AI 改写/续写/生成能力（均需登录）
 * - POST /ai/write   AI 写作：按 action 组装 prompt，SSE 流式输出（thinking/message/done/aborted/error）
 * - POST /ai/abort   中止指定请求：前端「停止生成」按钮调用
 * - POST /ai/status  查询 AI 服务配置状态（返回 chatReady / embeddingReady，不暴露任何配置细节）
 *
 * 实现说明：
 * - prompt 组装是纯同步逻辑，createChatModel 在 streamChatSSE 内部、流开始之前完成，
 *   AI 未配置时抛 RAG_NOT_CONFIGURED，此时 HTTP 状态码仍可控（走全局错误响应）
 * - SSE 事件协议与 ai-sse.ts 对齐：message 为原始文本增量；done/aborted 为 JSON；error 为错误文本
 */
const aiController = new Hono()
  // 查询 AI 服务配置状态（仅需登录，不暴露 baseUrl/apiKey 等任何配置细节）
  // - chatReady：前端在 AI 输入框回车提交前调用，false 时弹窗引导去 /admin 配置
  // - embeddingReady：向量服务是否就绪（知识库弹窗用，false 时提示「RAG 不可用」并禁用重建索引）
  .post('/status', authMiddleware, async (c) => {
    const chatReady = await isAiConfigured()
    const embeddingReady = await isEmbeddingReady()
    return c.success({ chatReady, embeddingReady })
  })
  // AI 写作（SSE 流式）
  .post('/write', authMiddleware, vJson(AiWriteSchema), async (c) => {
    const params = c.req.valid('json')

    logger.debug(
      { action: params.action, requestId: params.requestId, textLen: params.text?.length ?? 0 },
      `ai write: ${AI_ACTION_LABELS[params.action]}`
    )

    return streamChatSSE(c, {
      messages: buildWriteMessages(params),
      // requestId 由前端生成，传入后注册 AbortController 支持服务端中止
      requestId: params.requestId,
      logPrefix: 'ai-write',
    })
  })
  // 中止指定 AI 写作请求
  .post('/abort', authMiddleware, vJson(AiAbortSchema), async (c) => {
    const { requestId } = c.req.valid('json')
    const aborted = abortRequest(requestId)
    // 找不到请求也返回成功（流可能已自然结束，前端无需区分）
    return c.success({ ok: true, aborted })
  })

export default aiController
