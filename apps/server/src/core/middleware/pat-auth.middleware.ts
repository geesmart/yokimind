import type { Context } from 'hono'
import { createMiddleware } from 'hono/factory'
import { BizException } from '~/core/lib/biz.exception.js'
import { ErrorCode } from '~/config/error-code.js'
import { verifyPat } from '~/modules/token/token.service.js'

/**
 * 从请求头提取 Bearer 令牌；缺失或格式错误返回 null
 */
function extractBearer(c: Context): string | null {
  const authHeader = c.req.header('Authorization')
  if (!authHeader) return null
  const [scheme, token] = authHeader.split(' ')
  if (scheme !== 'Bearer' || !token) return null
  return token
}

/**
 * 非中间件版 PAT 校验（供 MCP controller 内联使用）
 * MCP 端点是 JSON-RPC 协议，认证失败不能抛给全局 onError（会被包成 {status, info} 破坏协议），
 * 而是由调用方 catch BizException 后自行构造 HTTP 401 + JSON-RPC error 响应
 * @returns PAT 所属用户 ID
 * @throws BizException(PAT_INVALID / PAT_REVOKED / PAT_EXPIRED)
 */
export async function requirePat(c: Context): Promise<string> {
  const token = extractBearer(c)
  if (!token) {
    throw new BizException(ErrorCode.PAT_INVALID)
  }
  return verifyPat(token)
}

/**
 * PAT 认证中间件（Agent API / Skills 端点使用）
 * 仅接受个人访问令牌（yki_ 前缀），不接受登录 token——两套体系天然隔离，
 * 登录 token 走这里会被判 PAT_INVALID（21001）而非 UNAUTHORIZED
 * 成功后 c.set('userId', ...)，与 authMiddleware 注入的上下文键一致
 */
export const patAuthMiddleware = createMiddleware(async (c, next) => {
  const userId = await requirePat(c)
  c.set('userId', userId)
  await next()
})
