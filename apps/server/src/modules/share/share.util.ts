import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import config from '~/config/adapter.js'

/**
 * 访客访问令牌有效期（毫秒）：12 小时
 * 过期后访客需重新输入密码获取新令牌
 */
const SHARE_TOKEN_TTL = 12 * 60 * 60 * 1000

/**
 * 按作用域与有效期签发无状态 HMAC 令牌（signShareToken / publish 模块 signPreviewToken 共用底层实现）
 * 结构：`${expiresAt}.${hmacSha256(secret, scope + ':' + expiresAt)}`
 * @param scope 作用域字符串（参与签名，令牌不可跨 scope 使用）
 * @param ttl 有效期（毫秒）
 */
export function signToken(scope: string, ttl: number): { token: string; expiresAt: number } {
  const expiresAt = Date.now() + ttl
  // 载荷 = `${scope}:${expiresAt}`：scope 参与签名，令牌不可跨库 / 跨页 / 跨用途使用
  const token = `${expiresAt}.${hmac(`${scope}:${expiresAt}`)}`
  return { token, expiresAt }
}

/**
 * 计算载荷的 HMAC-SHA256 签名
 * 复用 config.jwt.secret 作为签名密钥（服务端环境变量，不对外暴露）
 * @param payload 待签名载荷（`${scope}:${expiresAt}`）
 */
function hmac(payload: string): string {
  return createHmac('sha256', config.jwt.secret).update(payload).digest('hex')
}

/**
 * 计算令牌签名载荷的主题串（scope ⊕ 密码绑定）
 *
 * 密码绑定的意义：把当前生效的密码（先 sha256 归一，避免明文直接进 HMAC 载荷）
 * 拼进签名载荷 —— owner 修改 / 清除密码后，旧令牌的签名不再与「新密码派生的期望签名」
 * 匹配，校验立即失败，访客必须重新输密码换取新令牌（改密码即时踢下线）。
 * 密码不存在（免密分享）时载荷退化为纯 scope，与历史行为一致。
 *
 * @param scope 作用域（库级 `wikiId` / 页级 `${wikiId}:${nodeId}` / 预览 `preview:${wikiId}`）
 * @param password 当前生效的访问密码（可空：免密分享 / 预览令牌等无密码场景传 null/undefined）
 */
function tokenPayload(scope: string, password?: string | null): string {
  return password ? `${scope}:${createHash('sha256').update(password).digest('hex')}` : scope
}

/**
 * 为分享访客签发无状态访问令牌
 *
 * scope（作用域）语义 —— 权限模型重构后的核心维度，令牌只对同一 scope 有效：
 * - 整库访问：scope = `${wikiId}`（公开库访客，凭库密码换得，可浏览整库与库内全部可见页面）
 * - 单页访问：scope = `${wikiId}:${nodeId}`（私密库中单页公开的页面，凭页密码换得，仅对该页面有效）
 *
 * 结构：`${expiresAt}.${hmacSha256(secret, 主题串 + ':' + expiresAt)}`
 * 主题串 = tokenPayload(scope, password)：scope 防跨库/跨页，密码绑定防「改密码后旧令牌仍有效」
 * 无 DB 写入：签名即凭证，校验时重算 HMAC 比对即可；
 * 撤销分享 / 切换可见性的"即时失效"由每次请求的实时权限复核保证（见 share.service / share.middleware），
 * 改密码的"即时失效"由密码绑定签名保证（本函数与 verifyShareToken 的 password 参数）
 *
 * @param scope 作用域字符串：库级传 `wikiId`，页级传 `${wikiId}:${nodeId}`（由调用方按上下文拼装）
 * @param password 签发时生效的访问密码（verifySharePassword 校验通过后的当前密码，可空）
 * @returns token 令牌字符串与过期时间戳（毫秒）
 */
export async function signShareToken(
  scope: string,
  password?: string | null
): Promise<{ token: string; expiresAt: number }> {
  return signToken(tokenPayload(scope, password), SHARE_TOKEN_TTL)
}

/**
 * 校验访客访问令牌
 * 1. 格式：`${expiresAt}.${signature}` 两段
 * 2. 未过期：expiresAt > 当前时间
 * 3. 签名一致：按调用方传入的 scope 与**当前密码**重算 HMAC + timingSafeEqual 恒时比较（防时序攻击）
 *    - scope 必须与签发时完全一致 —— 整库令牌拿到单页接口上、或跨库使用都会因 scope 不同而校验失败
 *    - password 必须与签发时的密码一致 —— owner 改密码后旧令牌在此处被拒（密码绑定签名），
 *      调用方必须传**实时权限行里的当前密码**，而非签发时刻的密码
 * @param token 访客令牌（请求头 X-Share-Token）
 * @param scope 期望的作用域：库级传 `wikiId`，页级传 `${wikiId}:${nodeId}`
 * @param password 当前期望的访问密码（来自实时权限行；免密分享 / 预览令牌传 null/undefined）
 * @returns true = 有效
 */
export async function verifyShareToken(
  token: string,
  scope: string,
  password?: string | null
): Promise<boolean> {
  const dotIndex = token.indexOf('.')
  if (dotIndex <= 0) return false

  const expiresAt = Number(token.slice(0, dotIndex))
  const signature = token.slice(dotIndex + 1)

  // 格式或数值非法
  if (!Number.isSafeInteger(expiresAt) || !signature) return false
  // 已过期
  if (expiresAt < Date.now()) return false

  // 按同一 scope + 当前密码重算签名比对：scope 不匹配（跨库/跨页）或密码已变更（旧令牌）均在此处被拒
  const expected = Buffer.from(hmac(`${tokenPayload(scope, password)}:${expiresAt}`), 'hex')
  const actual = Buffer.from(signature, 'hex')

  // 长度不一致直接失败（timingSafeEqual 要求等长）
  if (expected.length !== actual.length) return false

  return timingSafeEqual(expected, actual)
}
