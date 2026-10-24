/**
 * 智能体接入模块接口
 *
 * 对接后端 `/api/v1/token/*` 接口（token.controller.ts），均需登录态：
 * - listPat    令牌列表    POST /token/list   脱敏视图（不含哈希与明文）
 * - createPat  创建令牌    POST /token/create 明文仅在本次响应中出现一次
 * - revokePat  吊销令牌    POST /token/revoke 幂等不可逆
 *
 * 令牌（PAT，yki_ 前缀）供外部 AI 客户端以 Bearer 方式消费
 * MCP（/api/v1/mcp）/ Skills（/api/v1/skills）/ Agent API（/api/v1/agent）三协议。
 *
 * 响应已被 request.ts 的 alova 实例统一解包：
 * - 成功直接返回后端 `data` 字段
 * - 业务失败抛 `ApiError`（含 code，如 21001 令牌无效）
 */
import { alova } from '../request'
import { API_PATHS } from '../constants'

// ==================== 类型定义 ====================

/**
 * 令牌视图（后端 token.service.TokenView，Date 经 JSON 序列化为 ISO 字符串）
 * 明文永不回传：列表 / 吊销响应均只有前缀（如 yki_abcd1234ef56）
 */
export interface PatView {
  /** 令牌 ID（吊销入参） */
  id: string
  /** 令牌名称（创建时备注的用途） */
  name: string
  /** 明文前缀 12 字符（yki_<8hex>），用于列表辨识 */
  tokenPrefix: string
  /** 创建时间（ISO 字符串） */
  createdAt: string
  /** 最近使用时间；从未使用为 null */
  lastUsedAt: string | null
  /** 过期时间；null = 永不过期 */
  expiresAt: string | null
  /** 吊销时间；null = 未吊销 */
  revokedAt: string | null
}

/** 创建令牌结果：token 为明文（yki_<48hex>），仅本次响应出现一次，关闭弹窗后无法再获取 */
export interface CreatePatResult {
  /** 明文令牌（务必立即保存） */
  token: string
  /** 脱敏视图（写回列表） */
  view: PatView
}

/** 令牌状态（前端根据 revokedAt / expiresAt 推导展示） */
export type PatStatus = 'active' | 'revoked' | 'expired'

// ==================== 接口函数 ====================

/**
 * 令牌列表（脱敏，按创建时间倒序）
 * POST /token/list（需登录）
 *
 * @returns alova Method，send 后得到令牌视图数组
 */
export function listPat() {
  return alova.Post<PatView[]>(API_PATHS.TOKEN.LIST)
}

/**
 * 创建令牌
 * POST /token/create（需登录）
 *
 * @param name 令牌名称（必填，1-50 字符，备注用途）
 * @param expiresAt 过期时间（ISO 8601 含时区偏移）；不传 = 永不过期
 * @returns alova Method，send 后得到 { token 明文, view 脱敏视图 }
 */
export function createPat(name: string, expiresAt?: string) {
  return alova.Post<CreatePatResult>(API_PATHS.TOKEN.CREATE, {
    name,
    ...(expiresAt ? { expiresAt } : {}),
  })
}

/**
 * 吊销令牌（幂等：重复吊销报 21001，不可逆）
 * POST /token/revoke（需登录，仅能吊销自己的令牌）
 *
 * @param tokenId 令牌 ID
 * @returns alova Method，send 后得到吊销后的脱敏视图（revokedAt 已填充）
 */
export function revokePat(tokenId: string) {
  return alova.Post<PatView>(API_PATHS.TOKEN.REVOKE, { tokenId })
}
