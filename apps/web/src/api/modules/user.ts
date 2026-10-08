/**
 * 用户模块接口
 *
 * 对接后端 `/api/v1/user/*` 接口（user.controller.ts）：
 * - register  注册        POST /user/register  无需鉴权
 * - login     登录        POST /user/login     无需鉴权
 * - logout    退出登录    POST /user/logout    需鉴权
 * - getProfile    获取资料 GET  /user/profile  需鉴权
 * - updateProfile 更新资料 POST /user/profile  需鉴权
 * - changePassword 修改密码 POST /user/password 需鉴权
 *
 * 使用方式：
 * - 组件内推荐用 `useRequest(login(params))` 获得 loading/data/error
 * - 非组件场景（如 store action）用 `await login(params).send()`
 *
 * 响应已被 request.ts 的 alova 实例统一解包：
 * - 成功直接返回后端 `data` 字段
 * - 业务失败抛 `ApiError`（含 code/httpStatus）
 */
import { alova } from '../request'
import { API_PATHS } from '../constants'
import type { UserInfo } from '../types'

// ==================== 类型定义 ====================

/**
 * 注册入参
 * 与后端 RegisterUserSchema 对齐，不再传 confirmPassword
 */
export interface RegisterParams {
  /** 昵称：2-50 字符 */
  nickname: string
  /** 邮箱：标准邮箱格式 */
  email: string
  /** 密码：8-20 字符 */
  password: string
}

/**
 * 注册出参
 * 后端返回新用户信息与初始 token，可直接保存登录态
 */
export interface RegisterResult {
  /** 用户 ID（ULID 字符串） */
  id: string
  nickname: string
  email: string
  /** 头像 URL，可能为 null */
  avatar?: string | null
  /** 登录令牌 */
  token: string
}

/**
 * 登录入参
 * Web 端无需传 deviceId；插件端可传以绑定设备
 */
export interface LoginParams {
  email: string
  password: string
  /** 设备 ID（可选）：插件场景使用，Web 端不传 */
  deviceId?: string
}

/**
 * 登录出参
 * 与后端 loginUser 返回结构一致：user 信息 + token
 */
export interface LoginResult {
  /** 用户基本信息 */
  user: UserInfo
  /** 登录令牌 */
  token: string
}

/**
 * 更新资料入参
 * 字段均可选，仅更新传入字段（后端按字段更新）
 */
export interface UpdateProfileParams {
  /** 昵称：2-50 字符 */
  nickname?: string
  /** 头像 URL；传空串可清空头像 */
  avatar?: string
}

/**
 * 修改密码入参
 * 后端会校验当前密码，并要求新密码与原密码不同
 */
export interface ChangePasswordParams {
  /** 当前密码 */
  currentPassword: string
  /** 新密码：8-20 字符 */
  newPassword: string
}

/**
 * 用户完整信息
 * GET /user/profile 返回，比共享 UserInfo 多审计字段
 */
export interface UserProfile extends UserInfo {
  /** 用户状态：active / disabled */
  status?: string
  /** 是否管理员（admins 白名单表命中）：顶栏据此显示「AI 大模型管理」入口 */
  isAdmin?: boolean
  /** 最后登录时间（ISO 字符串） */
  lastLoginAt?: string | null
  /** 创建时间（ISO 字符串） */
  createdAt?: string
  /** 更新时间（ISO 字符串） */
  updatedAt?: string
}

// ==================== 接口函数 ====================

/**
 * 用户注册
 * POST /user/register（无需鉴权）
 *
 * @param params 注册参数（昵称、邮箱、密码）
 * @returns alova Method，send 后得到用户信息与 token
 */
export function register(params: RegisterParams) {
  return alova.Post<RegisterResult>(API_PATHS.USER.REGISTER, params, {
    // 注册接口无需 Token
    meta: { auth: false },
  })
}

/**
 * 用户登录
 * POST /user/login（无需鉴权）
 *
 * @param params 登录参数（邮箱、密码，可选 deviceId）
 * @returns alova Method，send 后得到 { user, token }
 */
export function login(params: LoginParams) {
  return alova.Post<LoginResult>(API_PATHS.USER.LOGIN, params, {
    // 登录接口无需 Token
    meta: { auth: false },
  })
}

/**
 * 退出登录
 * POST /user/logout（需鉴权）
 *
 * 调用成功后，后端会清除该用户的所有设备 token；
 * 前端应同步调用 clearAuth() 清理本地认证信息。
 * @returns alova Method，send 后得到 { message }
 */
export function logout() {
  return alova.Post<{ message: string }>(API_PATHS.USER.LOGOUT)
}

/**
 * 获取当前用户信息
 * GET /user/profile（需鉴权）
 *
 * @returns alova Method，send 后得到用户完整信息（含审计字段）
 */
export function getProfile() {
  // cacheFor: null 禁用 alova GET 内存缓存（默认约 5 分钟）：
  // profile 含 isAdmin 管理员标记，缓存会导致 set-admin 后顶栏入口不出现，必须实时
  return alova.Get<UserProfile>(API_PATHS.USER.PROFILE, { cacheFor: null })
}

/**
 * 更新当前用户资料
 * POST /user/profile（需鉴权）
 *
 * 仅更新传入字段：nickname / avatar。
 * avatar 传空串可清空头像。
 *
 * @param params 待更新字段
 * @returns alova Method，send 后得到更新后的用户信息
 */
export function updateProfile(params: UpdateProfileParams) {
  return alova.Post<UserProfile>(API_PATHS.USER.PROFILE, params)
}

/**
 * 修改密码
 * POST /user/password（需鉴权）
 *
 * 后端流程：校验当前密码 → 校验新旧不同 → 写入新密码哈希 → 删除所有 token 强制重新登录。
 * 成功后前端必须调用 clearAuth() 清理本地认证信息，并跳转登录页。
 *
 * 业务错误码：
 * - 20004 INVALID_OLD_PASSWORD 当前密码错误
 * - 20005 SAME_PASSWORD 新密码与原密码相同
 *
 * @param params 当前密码 + 新密码
 * @returns alova Method，send 后得到 { success: true }
 */
export function changePassword(params: ChangePasswordParams) {
  return alova.Post<{ success: true }>(API_PATHS.USER.PASSWORD, params)
}
