import { z } from 'zod'

/**
 * 用户注册请求 Schema
 * 与前端 RegisterParams 对齐：邮箱 + 密码 + 昵称
 * 密码策略统一为 8-20 位（与前端 register.vue 校验保持一致）
 */
export const RegisterUserSchema = z.object({
  // 昵称：2-50 字符
  nickname: z
    .string()
    .min(2, '昵称长度需为 2-50 位')
    .max(50, '昵称长度需为 2-50 位'),
  // 邮箱：标准邮箱格式
  email: z.string().email('请输入正确的邮箱地址'),
  // 密码：8-20 位
  password: z
    .string()
    .min(8, '密码长度需为 8-20 位')
    .max(20, '密码长度需为 8-20 位'),
})

/**
 * 用户登录请求 Schema
 * Web 端可不传 deviceId；插件端会传，已有逻辑兼容
 */
export const LoginUserSchema = z.object({
  email: z.string().email('请输入正确的邮箱地址'),
  password: z.string().min(1, '密码不能为空'),
  // 设备 ID（可选）：插件场景使用
  deviceId: z.string().optional(),
})

/**
 * 更新用户资料请求 Schema
 * 昵称与头像均为可选，仅更新传入字段
 */
export const UpdateProfileSchema = z.object({
  // 昵称（可选）：2-50 字符
  nickname: z
    .string()
    .min(2, '昵称长度需为 2-50 位')
    .max(50, '昵称长度需为 2-50 位')
    .optional(),
  // 头像 URL（可选）：相对路径（/media/{bucket}/{key}，媒体 URL 统一形态）或完整 http(s) 地址
  avatar: z
    .union([z.string().regex(/^\/media\//, '头像地址需为 /media/ 相对路径'), z.string().url('头像地址格式不正确')])
    .optional()
    .or(z.literal('')),
})

/**
 * 修改密码请求 Schema
 * 需要验证当前密码后才能设置新密码
 */
export const ChangePasswordSchema = z.object({
  // 当前密码：不能为空
  currentPassword: z.string().min(1, '当前密码不能为空'),
  // 新密码：8-20 位
  newPassword: z
    .string()
    .min(8, '密码长度需为 8-20 位')
    .max(20, '密码长度需为 8-20 位'),
})

// ============ 类型导出 ============

export type RegisterUser = z.infer<typeof RegisterUserSchema>
export type LoginUser = z.infer<typeof LoginUserSchema>
export type UpdateProfile = z.infer<typeof UpdateProfileSchema>
export type ChangePassword = z.infer<typeof ChangePasswordSchema>
