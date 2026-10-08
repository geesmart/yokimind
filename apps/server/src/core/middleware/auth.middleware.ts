import { createMiddleware } from 'hono/factory'
import { verifyToken } from '~/core/utils/token.util.js'
import { BizException } from '~/core/lib/biz.exception.js'
import { ErrorCode } from '~/config/error-code.js'

/**
 * 认证中间件
 * 使用 NanoID Token 进行认证，查询数据库验证 token 有效性
 */
export const authMiddleware = createMiddleware(async (c, next) => {
  const authHeader = c.req.header('Authorization')

  if (!authHeader) {
    throw new BizException(ErrorCode.UNAUTHORIZED, '请先登录')
  }

  const [scheme, token] = authHeader.split(' ')

  if (scheme !== 'Bearer' || !token) {
    throw new BizException(ErrorCode.UNAUTHORIZED, '认证格式错误')
  }

  try {
    const payload = await verifyToken(token)

    // 将用户信息设置到上下文
    c.set('user', payload)
    c.set('userId', payload.userId)

    await next()
  } catch (error) {
    const logger = c.get('log')
    logger?.error({ err: error, token: authHeader?.slice(0, 20) }, 'auth failed')
    throw new BizException(ErrorCode.UNAUTHORIZED, '认证失败，请重新登录')
  }
})

/**
 * 可选认证中间件
 * 不强制要求登录，但会尝试获取用户信息
 */
export const optionalAuthMiddleware = createMiddleware(async (c, next) => {
  try {
    const authHeader = c.req.header('Authorization')

    if (authHeader) {
      const [scheme, token] = authHeader.split(' ')
      if (scheme === 'Bearer' && token) {
        const payload = await verifyToken(token)
        c.set('user', payload)
        c.set('userId', payload.userId)
      }
    }

    await next()
  } catch (error) {
    // 可选认证失败不阻断请求
    const logger = c.get('log')
    logger?.warn({ err: error }, 'optional auth failed')
    await next()
  }
})

/**
 * 获取当前用户信息
 */
export const getCurrentUser = (c: any) => {
  return c.get('user') || null
}

/**
 * 获取当前用户 ID
 * @returns ULID 字符串，未登录返回 null
 */
export const getCurrentUserId = (c: any): string | null => {
  return c.get('userId') || null
}

/**
 * 统一认证中间件（兼容旧代码）
 * @deprecated 请使用 authMiddleware
 */
export const unifiedAuthMiddleware = authMiddleware
