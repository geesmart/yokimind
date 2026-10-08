import { createMiddleware } from 'hono/factory'
import { ulid } from 'ulid'

/**
 * Request ID 中间件
 * 为每个 HTTP 请求生成或透传唯一 Request ID，便于全链路日志追踪
 * 使用 ULID（26 位单调递增），便于按时间排序与索引
 */
export const requestIdMiddleware = createMiddleware(async (c, next) => {
  // 优先从请求头透传，方便前后端联调
  let requestId = c.req.header('x-request-id')

  if (!requestId) {
    // 统一转小写：网站全站 ID 均使用小写
    requestId = ulid().toLowerCase()
  }

  c.set('requestId', requestId)
  c.header('x-request-id', requestId)

  await next()
})
