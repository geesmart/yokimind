import { createMiddleware } from 'hono/factory'
import { BizException } from '~/core/lib/biz.exception.js'
import { ErrorCode } from '~/config/error-code.js'
import { authMiddleware } from '~/core/middleware/auth.middleware.js'
import { verifyShareToken } from '~/modules/share/share.util.js'

/**
 * 发布设置保存双鉴权中间件（挂载在 PUT /publish/wiki/:wikiId/settings 上）
 *
 * 该接口有两个合法调用方，鉴权方式不同：
 * 1. pages 预览面板（外观设置）：与 web 编辑器不同源无登录态，携带预览令牌
 *    （X-Preview-Token 头 / ?t= query，scope = preview:{wikiId}，owner 专属签发）
 * 2. web 编辑器分享弹窗（publishType 形态切换）：Bearer 登录态，归属校验由
 *    controller 内 getWikiById 完成
 *
 * 判定规则：请求携带预览令牌 → 校验令牌（无效拒绝，不回退登录态——防止过期令牌
 * 静默降级为匿名请求）；未携带 → 走标准登录鉴权（未登录抛 UNAUTHORIZED）
 */
export const publishSettingsAuth = createMiddleware(async (c, next) => {
  const wikiId = c.req.param('wikiId') || ''

  // 头优先（pages 面板后续 API 请求），query 兜底（URL 首次进入）
  const previewToken = c.req.header('X-Preview-Token') || c.req.query('t') || ''

  if (previewToken) {
    // 预览令牌路径：校验过期 / 篡改 / 跨库（scope 不匹配）统一拒绝
    const valid = await verifyShareToken(previewToken, `preview:${wikiId}`)
    if (!valid) {
      throw new BizException(ErrorCode.PREVIEW_TOKEN_INVALID)
    }
    await next()
    return
  }

  // 登录态路径：标准 Bearer 认证（用户身份校验 + userId 注入上下文）
  await authMiddleware(c, next)
})
