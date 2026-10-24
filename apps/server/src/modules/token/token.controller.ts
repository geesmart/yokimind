import { Hono } from 'hono'
import { vJson } from '~/core/helper/zod.helper.js'
import { authMiddleware, getCurrentUserId } from '~/core/middleware/auth.middleware.js'
import { CreateTokenSchema, RevokeTokenSchema } from './token.schema.js'
import { createToken, listTokens, revokeToken } from './token.service.js'

/**
 * 个人访问令牌（PAT）控制器
 * 供 web 设置页管理智能体接入令牌；MCP / Skills / Agent API / CLI 以 Bearer 消费
 * 管理接口需要登录态（authMiddleware），PAT 本身不用于本控制器
 */
const tokenController = new Hono()
  /** 令牌列表（脱敏，不含哈希与明文） */
  .post('/list', authMiddleware, async (c) => {
    const userId = getCurrentUserId(c)!
    const tokens = await listTokens(userId)
    return c.success(tokens)
  })
  /** 创建令牌：明文仅在本次响应中出现一次 */
  .post('/create', vJson(CreateTokenSchema), authMiddleware, async (c) => {
    const data = c.req.valid('json')
    const userId = getCurrentUserId(c)!
    const result = await createToken(userId, data)
    return c.success(result)
  })
  /** 吊销令牌（幂等不可逆） */
  .post('/revoke', vJson(RevokeTokenSchema), authMiddleware, async (c) => {
    const { tokenId } = c.req.valid('json')
    const userId = getCurrentUserId(c)!
    const result = await revokeToken(userId, tokenId)
    return c.success(result)
  })

export default tokenController
