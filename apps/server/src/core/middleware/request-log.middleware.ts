import { createMiddleware } from 'hono/factory'
import { usePino } from '~/core/plugins/pino.js'
import config from '~/config/adapter.js'

/** 需要脱敏的敏感字段名（不区分大小写） */
const SENSITIVE_KEYS = ['password', 'token', 'apikey', 'secret', 'authorization', 'cookie', 'api_key']

/**
 * 递归脱敏请求/响应体中的敏感字段
 * @param obj 原始对象
 * @returns 脱敏后的对象
 */
function sanitizeBody(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj
  if (typeof obj !== 'object') return obj
  if (Array.isArray(obj)) return obj.map(sanitizeBody)

  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase()
    if (SENSITIVE_KEYS.some((sk) => lowerKey.includes(sk))) {
      // 字符串只保留前3位，其余类型标记为 [REDACTED]
      result[key] =
        typeof value === 'string' && value.length > 3
          ? value.slice(0, 3) + '***'
          : '[REDACTED]'
    } else if (typeof value === 'object' && value !== null) {
      result[key] = sanitizeBody(value)
    } else {
      result[key] = value
    }
  }
  return result
}

/**
 * 安全读取响应体
 * 仅对 JSON 响应尝试读取，且限制最大长度防止日志过大
 * @param res Hono Response
 * @returns 解析后的响应体或 undefined
 */
async function readResponseBody(res: Response): Promise<unknown> {
  const contentType = res.headers.get('content-type') || ''
  if (!contentType.includes('application/json')) {
    return undefined
  }

  try {
    const cloned = res.clone()
    const text = await cloned.text()
    // 限制响应体大小，超过 10KB 只记录摘要
    const MAX_SIZE = 10 * 1024
    if (text.length > MAX_SIZE) {
      return { _truncated: true, preview: text.slice(0, MAX_SIZE) + '...' }
    }
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/**
 * HTTP 请求日志中间件
 * 替换 hono/logger，使用 Pino 记录结构化请求日志
 * 同时创建 child logger 绑定到上下文，后续业务日志自动携带 requestId 和 userId
 */
export const requestLogMiddleware = createMiddleware(async (c, next) => {
  const start = Date.now()
  const requestId = c.get('requestId')

  // 创建携带 requestId 的 child logger
  const childLogger = usePino().child({ requestId })
  c.set('log', childLogger)

  // 读取请求体（Hono 内部有缓存，不会影响后续中间件读取）
  let requestBody: unknown
  try {
    const contentType = c.req.header('content-type') || ''
    if (contentType.includes('application/json')) {
      requestBody = await c.req.json()
    } else if (
      contentType.includes('application/x-www-form-urlencoded') ||
      contentType.includes('multipart/form-data')
    ) {
      requestBody = await c.req.parseBody()
    }
  } catch {
    // 读取失败时忽略，避免影响主流程
    requestBody = undefined
  }

  // 对请求体脱敏
  if (requestBody !== undefined) {
    requestBody = sanitizeBody(requestBody)
  }

  await next()

  // 读取响应体
  const responseBody = await readResponseBody(c.res)

  // 请求结束后记录结构化日志
  const duration = Date.now() - start
  const userId = c.get('userId')

  // 收集请求头（只收集配置中指定的 header）
  const allowedHeaders = config.pino.headers
  const headers: Record<string, string> = {}
  for (const headerName of allowedHeaders) {
    const value = c.req.header(headerName)
    if (value) {
      headers[headerName] = value
    }
  }

  childLogger.info(
    {
      method: c.req.method,
      path: c.req.path,
      query: c.req.query(),
      headers,
      requestBody,
      status: c.res.status,
      responseBody,
      duration,
      userId: userId ?? null,
    },
    'request completed'
  )
})
