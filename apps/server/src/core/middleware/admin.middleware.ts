import { createMiddleware } from 'hono/factory'
import { BizException } from '~/core/lib/biz.exception.js'
import { ErrorCode } from '~/config/error-code.js'

/**
 * 管理员守卫中间件
 * 必须挂在 authMiddleware 之后（依赖上下文中的 userId）
 *
 * ⚠️ V1 策略（2026-09）：第一个版本不做角色区分，**所有登录用户都是管理员**，
 * 因此只校验登录态，直接放行；admins 白名单表与 scripts/set-admin.ts 脚本保留不动。
 * 后续恢复角色体系时，还原为查询 admins 表、未命中抛 ADMIN_FORBIDDEN 的实现：
 *
 *   const db = usePostgres()
 *   const rows = await db.select({ id: admins.id }).from(admins)
 *     .where(eq(admins.userId, userId)).limit(1)
 *   if (rows.length === 0) throw new BizException(ErrorCode.ADMIN_FORBIDDEN)
 */
export const adminGuard = createMiddleware(async (c, next) => {
  const userId = c.get('userId') as string | undefined

  if (!userId) {
    // 正常情况下 authMiddleware 已保证 userId 存在，这里兜底防御
    throw new BizException(ErrorCode.UNAUTHORIZED, '请先登录')
  }

  // V1：登录即管理员，跳过 admins 白名单校验
  await next()
})
