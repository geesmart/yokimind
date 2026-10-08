import { users, userToken } from '~/db/schema.js'
import { eq } from 'drizzle-orm'
import { hashPassword, comparePassword } from '~/core/utils/password.util.js'
import { generateToken } from '~/core/utils/token.util.js'
import { BizException } from '~/core/lib/biz.exception.js'
import { ErrorCode } from '~/config/error-code.js'
import { getDb } from '~/core/helper/db.helper.js'
import type { RegisterUser, LoginUser, UpdateProfile, ChangePassword } from './user.schema.js'

/**
 * 用户注册
 * @param data 注册信息（昵称、邮箱、密码）
 * @returns 用户信息及 token
 */
export async function registerUser(data: RegisterUser) {
  const db = getDb()

  // 检查邮箱是否已存在
  const existing = await db.select().from(users).where(eq(users.email, data.email))
  if (existing.length > 0) {
    throw new BizException(ErrorCode.USER_ALREADY_EXISTS)
  }

  // 创建用户
  const passwordHash = await hashPassword(data.password)
  const [user] = await db
    .insert(users)
    .values({
      nickname: data.nickname,
      email: data.email,
      passwordHash,
    })
    .returning({
      id: users.id,
      nickname: users.nickname,
      email: users.email,
      avatar: users.avatar,
    })

  // 生成 token（使用 NanoID）
  const token = await generateToken()

  // token 有效期 30 天
  const tokenExpiresAt = new Date()
  tokenExpiresAt.setDate(tokenExpiresAt.getDate() + 30)

  // 在 user_token 表创建记录，deviceId 为空（表示 Web 端注册）
  await db.insert(userToken).values({
    userId: user.id,
    deviceId: '',
    token,
    tokenExpiresAt,
    createdAt: new Date(),
    updatedAt: new Date(),
  })

  return { ...user, token }
}

/**
 * 用户登录
 * @param data 登录信息（邮箱、密码、deviceId）
 * @returns 用户信息及 token
 */
export async function loginUser(data: LoginUser) {
  const db = getDb()

  // 查找用户
  const [user] = await db.select().from(users).where(eq(users.email, data.email))
  if (!user) {
    throw new BizException(ErrorCode.USER_NOT_FOUND)
  }

  // 检查用户状态
  if (user.status === 'disabled') {
    throw new BizException(ErrorCode.UNAUTHORIZED)
  }

  // 验证密码
  const isValid = await comparePassword(data.password, user.passwordHash)
  if (!isValid) {
    throw new BizException(ErrorCode.INVALID_PASSWORD)
  }

  // 更新最后登录时间
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id))

  // 每次登录都生成新的 token
  const token = await generateToken()

  // 创建或更新 user_token 记录
  await bindDeviceToken(data.deviceId || '', token, user.id)

  return {
    id: user.id,
    nickname: user.nickname,
    email: user.email,
    avatar: user.avatar,
    token,
  }
}

/**
 * 绑定设备 token（私有函数，供 loginUser 使用）
 * 以 userId 为唯一键，一个用户只有一条 token 记录
 * @param deviceId 设备 ID
 * @param token 用户 token
 * @param userId 用户 ID
 */
async function bindDeviceToken(deviceId: string, token: string, userId: string) {
  const db = getDb()

  // token 有效期 30 天
  const tokenExpiresAt = new Date()
  tokenExpiresAt.setDate(tokenExpiresAt.getDate() + 30)

  // 查询该用户的 user_token 记录是否存在
  const existingToken = await db
    .select()
    .from(userToken)
    .where(eq(userToken.userId, userId))
    .limit(1)

  if (existingToken.length > 0) {
    // 已存在，更新 deviceId、token 和过期时间
    await db
      .update(userToken)
      .set({
        deviceId,
        token,
        tokenExpiresAt,
        updatedAt: new Date(),
      })
      .where(eq(userToken.userId, userId))
  } else {
    // 不存在，创建新记录
    await db.insert(userToken).values({
      userId,
      deviceId,
      token,
      tokenExpiresAt,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
  }
}

/**
 * 根据用户 ID 获取用户信息
 * @param userId 用户 ID
 * @returns 用户信息（不包含密码）
 */
export async function getUserById(userId: string) {
  const db = getDb()

  const [user] = await db
    .select({
      id: users.id,
      nickname: users.nickname,
      email: users.email,
      avatar: users.avatar,
      status: users.status,
      lastLoginAt: users.lastLoginAt,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.id, userId))

  if (!user) {
    throw new BizException(ErrorCode.USER_NOT_FOUND)
  }

  return user
}

/**
 * 清除用户的所有设备 Token
 * 用户退出登录时调用
 * @param userId 用户 ID
 */
export async function clearUserDeviceTokens(userId: string) {
  const db = getDb()

  // 删除该用户的所有设备 token 记录
  await db.delete(userToken).where(eq(userToken.userId, userId))

  return { success: true }
}

/**
 * 更新用户资料
 * 仅更新传入字段（nickname / avatar），不传的字段保持不变
 * @param userId 用户 ID
 * @param data 待更新字段
 * @returns 更新后的用户信息（不含密码）
 */
export async function updateProfile(userId: string, data: UpdateProfile) {
  const db = getDb()

  // 校验用户是否存在
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1)
  if (!existing) {
    throw new BizException(ErrorCode.USER_NOT_FOUND)
  }

  // 仅组装传入字段的更新对象
  const updateData: Partial<{ nickname: string; avatar: string | null; updatedAt: Date }> = {
    updatedAt: new Date(),
  }
  if (data.nickname !== undefined) {
    updateData.nickname = data.nickname
  }
  // avatar 允许传空串清空头像
  if (data.avatar !== undefined) {
    updateData.avatar = data.avatar === '' ? null : data.avatar
  }

  // 执行更新并返回新用户信息
  const [updated] = await db
    .update(users)
    .set(updateData)
    .where(eq(users.id, userId))
    .returning({
      id: users.id,
      nickname: users.nickname,
      email: users.email,
      avatar: users.avatar,
      status: users.status,
      lastLoginAt: users.lastLoginAt,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
    })

  return updated
}

/**
 * 修改密码
 * 校验当前密码 → 校验新旧不同 → 写入新密码哈希 → 删除所有 token 强制重新登录
 * @param userId 用户 ID
 * @param data 当前密码 + 新密码
 * @returns 操作结果
 */
export async function changePassword(userId: string, data: ChangePassword) {
  const db = getDb()

  // 取出用户当前的 passwordHash
  const [user] = await db
    .select({ id: users.id, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  if (!user) {
    throw new BizException(ErrorCode.USER_NOT_FOUND)
  }

  // 校验当前密码
  const isValid = await comparePassword(data.currentPassword, user.passwordHash)
  if (!isValid) {
    throw new BizException(ErrorCode.INVALID_OLD_PASSWORD)
  }

  // 校验新密码不能与原密码相同
  if (data.currentPassword === data.newPassword) {
    throw new BizException(ErrorCode.SAME_PASSWORD)
  }

  // 写入新密码哈希
  const newPasswordHash = await hashPassword(data.newPassword)
  await db
    .update(users)
    .set({ passwordHash: newPasswordHash, updatedAt: new Date() })
    .where(eq(users.id, userId))

  // 修改密码后删除该用户所有 token，强制重新登录
  await db.delete(userToken).where(eq(userToken.userId, userId))

  return { success: true }
}