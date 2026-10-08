import { ulid } from 'ulid'
import { getDb } from '~/core/helper/db.helper.js'
import { userToken, users } from '~/db/schema.js'
import { eq } from 'drizzle-orm'
import { BizException } from '~/core/lib/biz.exception.js'
import { ErrorCode } from '~/config/error-code.js'

export interface TokenPayload {
  /** 用户 ID（ULID 字符串） */
  userId: string
  email: string
}

/**
 * 生成随机 token
 * 使用 ULID 生成 26 位单调递增的随机字符串
 * 相比 nanoid，ULID 自带时序信息，便于排序与索引
 * 统一转小写：网站全站 ID 均使用小写
 * @returns 小写 ULID token 字符串
 */
export const generateToken = async (): Promise<string> => {
  return ulid().toLowerCase()
}

/**
 * 验证 token 有效性
 * 查询数据库验证 token 是否存在且未过期
 * @param token token 字符串
 * @returns 验证成功返回用户信息，失败抛出错误
 */
export const verifyToken = async (token: string): Promise<TokenPayload> => {
  const db = getDb()

  // 查询 user_token 表中是否有该 token
  const tokenRecord = await db
    .select()
    .from(userToken)
    .where(eq(userToken.token, token))
    .limit(1)

  if (!tokenRecord[0]) {
    throw new Error('Token not found')
  }

  // 检查 token 是否过期
  if (tokenRecord[0].tokenExpiresAt && new Date(tokenRecord[0].tokenExpiresAt) < new Date()) {
    throw new Error('Token expired')
  }

  // 获取用户信息
  const userRecord = await db
    .select({
      id: users.id,
      email: users.email,
    })
    .from(users)
    .where(eq(users.id, tokenRecord[0].userId))
    .limit(1)

  if (!userRecord[0]) {
    throw new Error('User not found')
  }

  return {
    userId: userRecord[0].id,
    email: userRecord[0].email,
  }
}
