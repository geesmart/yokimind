import { createMiddleware } from 'hono/factory'
import { BizException } from '~/core/lib/biz.exception.js'
import { ErrorCode } from '~/config/error-code.js'
import { getWikiLevelShare, getNodeLevelShare, resolveDocumentScope } from './share.service.js'
import { verifyShareToken } from './share.util.js'

/**
 * 分享访问校验中间件（两步判定，挂载在 /nodes、/document/:documentId 内容接口上）
 *
 * 每次请求都实时复核权限行（不缓存判定结果）：owner 撤销分享 / 修改可见性后，
 * 已签发的访客令牌也会在下一次请求被拒 —— "撤销即时失效"由这里保证，而非依赖令牌过期；
 * 改密码的即时失效则由令牌的密码绑定签名保证（verifyShareToken 传入实时权限行的当前密码，
 * 旧令牌签名与新密码不匹配 → SHARE_TOKEN_INVALID，访客需重新输密码）
 *
 * 判定流程：
 * 1. 读 wikiId → 查库级行（node_id = ''），不存在 → SHARE_NOT_FOUND（分享未开启或已撤销）
 * 2. 判定所需 scope 与密码（有效可见性 = 库可见性 ⊕ 页面覆盖）：
 *    - 库级 'private'（私密库单页公开）：
 *      - /document/:documentId：先 resolveDocumentScope 解析 nodeId（同时防跨库越权），
 *        页级行必须为 'public'，页密码存在则要求 X-Share-Token 校验 scope = `${wikiId}:${nodeId}`
 *      - /nodes：私密库没有整树浏览概念 → 直接 SHARE_NOT_FOUND
 *    - 库级 'public'（公开库）：
 *      - /document/:documentId：需确认该文档页级行不是 'private'（隐藏页 → SHARE_NOT_FOUND）；
 *        库密码存在则要求 token 校验 scope = `${wikiId}`
 *      - /nodes：树内容接口本身只服务公开库（service 侧还会剔除隐藏节点）；
 *        库密码存在则要求 token 校验 scope = `${wikiId}`
 * 3. 无密码 → 直接放行；token 缺失 → SHARE_PASSWORD_REQUIRED（前端据此弹密码卡片）；
 *    无效/过期/scope 不匹配 → SHARE_TOKEN_INVALID（前端据此要求重新输密码）
 * 4. 校验通过后把解析出的上下文（shareNodeId / shareScope）放入 c.set 供 handler 复用
 */
export const shareAuthMiddleware = createMiddleware(async (c, next) => {
  // 路由参数 wikiId 由挂载路径保证存在
  const wikiId = c.req.param('wikiId') || ''
  // /document/:documentId 路由上有 documentId；/nodes 路由上为 undefined —— 以此区分两类内容接口
  const documentId = c.req.param('documentId')

  // ---- 第一步：库级行必须存在 ----
  const wikiShare = await getWikiLevelShare(wikiId)
  if (!wikiShare) {
    throw new BizException(ErrorCode.SHARE_NOT_FOUND)
  }

  // 本次请求所需的访问密码（null = 无密码免令牌）与期望的令牌 scope
  let requiredPassword: string | null = null
  let expectedScope: string

  if (wikiShare.shareStatus === 'private') {
    // ---- 私密库：仅"单页公开"的页面可访问 ----
    if (!documentId) {
      // /nodes 整树接口：私密库没有整树浏览入口
      throw new BizException(ErrorCode.SHARE_NOT_FOUND)
    }

    // 解析文档作用域（id + wikiId 联合过滤，防跨库越权；不属于该库 → SHARE_NOT_FOUND）
    const doc = await resolveDocumentScope(wikiId, documentId)
    const nodeShare = await getNodeLevelShare(wikiId, doc.nodeId)

    // 页级行必须存在且为 'public'（'inherit'/无覆盖行 = 默认私密）
    if (!nodeShare || nodeShare.shareStatus !== 'public') {
      throw new BizException(ErrorCode.SHARE_NOT_FOUND)
    }

    requiredPassword = nodeShare.password
    expectedScope = `${wikiId}:${doc.nodeId}`
    // 上下文供 handler 复用（可选优化：避免 handler 重复解析）
    c.set('shareNodeId', doc.nodeId)
  } else {
    // ---- 公开库：整库可访问（页级 'private' 的页面除外）----
    if (documentId) {
      // /document/:documentId：页级 'private' = 该页面被 owner 从分享中隐藏
      const doc = await resolveDocumentScope(wikiId, documentId)
      const nodeShare = await getNodeLevelShare(wikiId, doc.nodeId)
      if (nodeShare?.shareStatus === 'private') {
        throw new BizException(ErrorCode.SHARE_NOT_FOUND)
      }
      c.set('shareNodeId', doc.nodeId)
    }

    // 公开库上下文：密码取库密码，scope 为整库（页级密码不生效）
    requiredPassword = wikiShare.password
    expectedScope = wikiId
  }

  // ---- 第二步：密码 / 令牌校验 ----
  // 无密码分享：免令牌直接放行
  if (!requiredPassword) {
    await next()
    return
  }

  // 有密码：要求 X-Share-Token 携带与本次访问上下文同 scope 的有效令牌
  const token = c.req.header('X-Share-Token')
  if (!token) {
    throw new BizException(ErrorCode.SHARE_PASSWORD_REQUIRED)
  }

  // scope 不匹配（整库令牌访问单页 / 跨库 / 跨页）或密码已变更（旧令牌按签发时密码签名，
  // 与实时权限行里的当前密码比对不上）都会在这里失败
  const valid = await verifyShareToken(token, expectedScope, requiredPassword)
  if (!valid) {
    throw new BizException(ErrorCode.SHARE_TOKEN_INVALID)
  }

  // 校验通过：记录已验证的 scope 供 handler 复用
  c.set('shareScope', expectedScope)

  await next()
})

/**
 * 预览访问校验中间件（owner 专属预览模式，挂载在 /preview 三个接口上）
 *
 * 与 shareAuthMiddleware 的关键差异：**不做 shareStatus 复核、不要求密码** ——
 * 预览的核心价值是「发布前检查」，未发布的库也必须能完整渲染。
 * 访问权限完全由短时效预览令牌保证：令牌只能由 owner 通过
 * POST /wiki/:id/preview-token（authMiddleware + 归属校验）签发，
 * scope = `preview:${wikiId}`，1 小时过期，无法跨库使用
 *
 * 令牌来源：优先读 X-Preview-Token 请求头（pages 站从 sessionStorage 取），
 * 回退 ?t= query（首次从 URL 进入时）；两者都缺 / 校验失败 → PREVIEW_TOKEN_INVALID
 */
export const previewAuthMiddleware = createMiddleware(async (c, next) => {
  // 路由参数 wikiId 由挂载路径保证存在
  const wikiId = c.req.param('wikiId') || ''

  // 头优先（后续 API 请求），query 兜底（URL 首次进入）
  const token = c.req.header('X-Preview-Token') || c.req.query('t') || ''
  if (!token) {
    throw new BizException(ErrorCode.PREVIEW_TOKEN_INVALID)
  }

  // 校验令牌：过期 / 篡改 / 跨库（scope 不匹配）统一拒绝，不泄露具体失败原因
  const valid = await verifyShareToken(token, `preview:${wikiId}`)
  if (!valid) {
    throw new BizException(ErrorCode.PREVIEW_TOKEN_INVALID)
  }

  await next()
})
