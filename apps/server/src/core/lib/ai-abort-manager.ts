/**
 * AI 请求 AbortController 管理器
 * 用于管理活跃的 AI 流式请求，支持按 requestId 暂停/取消
 * （移植自 reddit-helper 的 ai.abort-manager.ts）
 *
 * 用法约定：
 * - 发起流式 AI 请求前，用业务侧生成的 requestId 调 createAbortController 注册，
 *   并把返回的 signal 透传给 model.stream(messages, { signal })
 * - 前端点「停止生成」时调 abortRequest(requestId)，正在进行的流会被中止
 * - 流结束后（无论成功/失败/中止）必须调 cleanupRequest 清理，防止 Map 泄漏
 */

import { usePino } from '~/core/plugins/pino.js'

/** 单个活跃 AI 请求的注册信息 */
interface ActiveRequest {
  /** 中止控制器（signal 传给模型调用） */
  controller: AbortController
  /** 请求开始时间（便于排查长时间挂起的请求） */
  startTime: number
  /** 请求唯一标识 */
  requestId: string
}

/** 活跃请求注册表（key = requestId） */
const activeRequests = new Map<string, ActiveRequest>()

/**
 * 创建新的 AbortController 并注册
 * 若已存在相同 requestId（如前端重发请求），先中止旧的再注册新的
 *
 * @param requestId 请求唯一标识
 * @returns 新创建的 AbortController 实例
 */
export function createAbortController(requestId: string): AbortController {
  const reqLogger = usePino().child({ requestId })

  // 相同 requestId 重复注册时，先中止旧请求，保证同一 id 只有一个活跃流
  const existing = activeRequests.get(requestId)
  if (existing) {
    existing.controller.abort()
    activeRequests.delete(requestId)
    reqLogger.info('abort manager: aborted old request')
  }

  const controller = new AbortController()
  activeRequests.set(requestId, {
    controller,
    startTime: Date.now(),
    requestId,
  })
  reqLogger.info({ activeCount: activeRequests.size }, 'abort manager: request registered')
  return controller
}

/**
 * 获取已存在的 AbortController
 *
 * @param requestId 请求唯一标识
 * @returns AbortController 实例或 undefined（不存在/已清理）
 */
export function getAbortController(requestId: string): AbortController | undefined {
  return activeRequests.get(requestId)?.controller
}

/**
 * 中止指定请求（典型场景：前端「停止生成」按钮）
 *
 * @param requestId 请求唯一标识
 * @returns 是否成功中止（false = 不存在或已中止）
 */
export function abortRequest(requestId: string): boolean {
  const reqLogger = usePino().child({ requestId })
  const request = activeRequests.get(requestId)

  if (request && !request.controller.signal.aborted) {
    request.controller.abort()
    activeRequests.delete(requestId)
    reqLogger.info({ activeCount: activeRequests.size }, 'abort manager: request aborted')
    return true
  }

  reqLogger.warn(
    { activeCount: activeRequests.size },
    'abort manager: request not found or already aborted'
  )
  return false
}

/**
 * 清理已完成的请求注册（流结束后必须调用，防止 Map 无限增长）
 *
 * @param requestId 请求唯一标识
 */
export function cleanupRequest(requestId: string): void {
  activeRequests.delete(requestId)
  const reqLogger = usePino().child({ requestId })
  reqLogger.info({ activeCount: activeRequests.size }, 'abort manager: request cleaned up')
}

/**
 * 获取当前活跃请求数量（监控/调试用）
 */
export function getActiveRequestCount(): number {
  return activeRequests.size
}

/**
 * 获取所有活跃请求 ID（排查挂起请求时用）
 */
export function getActiveRequestIds(): string[] {
  return Array.from(activeRequests.keys())
}
