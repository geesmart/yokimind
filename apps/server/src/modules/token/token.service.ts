import { createHash, randomBytes } from 'node:crypto'
import { and, eq, isNull } from 'drizzle-orm'
import { accessTokens, type AccessToken } from '~/db/schema.js'
import { getDb } from '~/core/helper/db.helper.js'
import { BizException } from '~/core/lib/biz.exception.js'
import { ErrorCode } from '~/config/error-code.js'
import type { CreateToken } from './token.schema.js'

/** 令牌明文前缀：智能体接入令牌统一以 yki_ 开头，与登录 token 天然区分 */
const TOKEN_PREFIX = 'yki_'
/** lastUsedAt 写库节流间隔：距上次 >60s 才落库，避免高频请求写放大 */
const LAST_USED_THROTTLE_MS = 60_000

/** sha256 哈希令牌明文（库中只存哈希，不存明文） */
function hashToken(plain: string): string {
  return createHash('sha256').update(plain).digest('hex')
}

/** 生成明文令牌：yki_<48hex>（24 字节 = 192 bit 熵） */
function generatePlainToken(): string {
  return TOKEN_PREFIX + randomBytes(24).toString('hex')
}

/** 令牌列表项（脱敏视图，不含哈希） */
export interface TokenView {
  id: string
  name: string
  tokenPrefix: string
  createdAt: Date
  lastUsedAt: Date | null
  expiresAt: Date | null
  revokedAt: Date | null
}

function toView(row: AccessToken): TokenView {
  return {
    id: row.id,
    name: row.name,
    tokenPrefix: row.tokenPrefix,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
  }
}

/**
 * 创建个人访问令牌
 * @returns { token, view } token 为明文（yki_<48hex>），仅在创建响应中出现一次
 */
export async function createToken(userId: string, data: CreateToken) {
  const db = getDb()
  const plain = generatePlainToken()
  const [row] = await db
    .insert(accessTokens)
    .values({
      userId,
      name: data.name,
      tokenPrefix: plain.slice(0, 12),
      tokenHash: hashToken(plain),
      expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
    })
    .returning()
  return { token: plain, view: toView(row) }
}

/** 列出当前用户的全部令牌（脱敏，不含哈希） */
export async function listTokens(userId: string): Promise<TokenView[]> {
  const db = getDb()
  const rows = await db
    .select()
    .from(accessTokens)
    .where(eq(accessTokens.userId, userId))
  return rows
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map(toView)
}

/** 吊销令牌（按 userId + tokenId 过滤，防越权吊销他人令牌；幂等：重复吊销不报错） */
export async function revokeToken(userId: string, tokenId: string) {
  const db = getDb()
  const [row] = await db
    .update(accessTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(accessTokens.id, tokenId), eq(accessTokens.userId, userId), isNull(accessTokens.revokedAt)))
    .returning()
  if (!row) {
    throw new BizException(ErrorCode.PAT_INVALID)
  }
  return toView(row)
}

/**
 * 校验个人访问令牌并返回所属用户 ID
 * 校验链：前缀格式 → sha256 查表（唯一索引）→ 吊销 → 过期
 * 成功后节流更新 lastUsedAt（fire-and-forget，不阻塞请求、失败仅 warn）
 */
export async function verifyPat(plain: string): Promise<string> {
  if (!plain.startsWith(TOKEN_PREFIX)) {
    throw new BizException(ErrorCode.PAT_INVALID)
  }
  const db = getDb()
  const [row] = await db
    .select()
    .from(accessTokens)
    .where(eq(accessTokens.tokenHash, hashToken(plain)))
  if (!row) {
    throw new BizException(ErrorCode.PAT_INVALID)
  }
  if (row.revokedAt) {
    throw new BizException(ErrorCode.PAT_REVOKED)
  }
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
    throw new BizException(ErrorCode.PAT_EXPIRED)
  }
  // 节流更新最近使用时间；脱离 await 避免 IO 拖慢请求
  const now = new Date()
  if (!row.lastUsedAt || now.getTime() - row.lastUsedAt.getTime() > LAST_USED_THROTTLE_MS) {
    void db
      .update(accessTokens)
      .set({ lastUsedAt: now })
      .where(eq(accessTokens.id, row.id))
      .catch(() => {})
  }
  return row.userId
}
