import { getContext } from 'hono/context-storage'

/**
 * 获取客户端 IP 地址
 * 优先从 x-forwarded-for 头获取，其次从 x-real-ip 头获取
 */
export function getClientIp(): string | null {
  const c = getContext()
  const forwardedFor = c.req.header('x-forwarded-for')
  if (forwardedFor) {
    return forwardedFor.split(',')[0].trim()
  }
  return c.req.header('x-real-ip') || null
}
