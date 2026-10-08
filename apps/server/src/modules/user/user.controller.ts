import { Hono } from 'hono'
import { vJson } from '~/core/helper/zod.helper.js'
import {
  RegisterUserSchema,
  LoginUserSchema,
  UpdateProfileSchema,
  ChangePasswordSchema,
} from './user.schema.js'
import {
  registerUser,
  loginUser,
  getUserById,
  clearUserDeviceTokens,
  updateProfile,
  changePassword,
} from './user.service.js'
import { authMiddleware, getCurrentUserId } from '~/core/middleware/auth.middleware.js'
import { isAdminUser } from '~/modules/admin/admin.service.js'

/**
 * 用户控制器
 * 提供用户注册、登录、退出登录、获取信息、更新资料、修改密码等接口
 * 使用 NanoID Token 认证
 */
const userController = new Hono()
  // 用户注册
  .post('/register', vJson(RegisterUserSchema), async (c) => {
    const data = c.req.valid('json')
    const result = await registerUser(data)
    return c.success(result)
  })
  // 用户登录
  .post('/login', vJson(LoginUserSchema), async (c) => {
    const data = c.req.valid('json')
    const result = await loginUser(data)
    const userInfo = {
      id: result.id,
      nickname: result.nickname,
      email: result.email,
      avatar: result.avatar,
    }
    return c.success({
      user: userInfo,
      token: result.token,
    })
  })
  // 退出登录
  .post('/logout', authMiddleware, async (c) => {
    const userId = getCurrentUserId(c)
    if (userId) {
      // 清除该用户的所有设备 token
      await clearUserDeviceTokens(userId)
    }
    return c.success({ message: '退出登录成功' })
  })
  // 获取当前用户信息（需要登录）
  .get('/profile', authMiddleware, async (c) => {
    const userId = c.get('userId')!
    const user = await getUserById(userId)
    // 附带管理员标识（admins 白名单表）：前端顶栏据此显示「系统管理」入口
    const isAdmin = await isAdminUser(userId)
    return c.success({ ...user, isAdmin })
  })
  // 更新当前用户资料（需要登录）：昵称与头像
  .post('/profile', authMiddleware, vJson(UpdateProfileSchema), async (c) => {
    const userId = getCurrentUserId(c)!
    const data = c.req.valid('json')
    const result = await updateProfile(userId, data)
    return c.success(result)
  })
  // 修改密码（需要登录）：校验当前密码后设置新密码，并强制下线
  .post('/password', authMiddleware, vJson(ChangePasswordSchema), async (c) => {
    const userId = getCurrentUserId(c)!
    const data = c.req.valid('json')
    const result = await changePassword(userId, data)
    return c.success(result)
  })

export default userController
