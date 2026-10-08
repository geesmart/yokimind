/**
 * API 共享类型定义
 * 仅保留被多个模块共享的值类型，请求层相关类型已由 alova 托管
 */

/** Token 信息 */
export interface TokenInfo {
  /** 访问令牌 */
  accessToken: string
  /** 刷新令牌（可选） */
  refreshToken?: string
  /** 过期时间（Unix 时间戳，秒） */
  expiresAt?: number
}

/** 用户信息 */
export interface UserInfo {
  /** 用户 ID（ULID 字符串） */
  id: string
  /** 昵称 */
  nickname: string
  /** 邮箱 */
  email: string
  /** 头像 */
  avatar?: string | null
  /** 是否管理员（admins 白名单表命中）：用户菜单据此显示「AI 大模型管理」入口 */
  isAdmin?: boolean
}

/** 分页参数 */
export interface PaginationParams {
  /** 页码（从 1 开始） */
  page: number
  /** 每页数量 */
  pageSize: number
}

/** 分页响应 */
export interface PaginatedResponse<T> {
  /** 数据列表 */
  list: T[]
  /** 总数 */
  total: number
  /** 当前页 */
  page: number
  /** 每页数量 */
  pageSize: number
  /** 总页数 */
  totalPages: number
}
