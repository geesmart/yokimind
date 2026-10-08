import { Hono } from 'hono'
import { vJson } from '~/core/helper/zod.helper.js'
import { UpdatePublishSettingsSchema } from './publish.schema.js'
import { getPublishSettings, updatePublishSettings, publishWiki, getPreviewData, getPreviewDocument, uploadPreviewImage, searchPublishedContent } from './publish.service.js'
import { signPreviewToken } from './publish.util.js'
import { publishSettingsAuth } from './publish.middleware.js'
import { previewAuthMiddleware } from '~/modules/share/share.middleware.js'
import { authMiddleware, getCurrentUserId } from '~/core/middleware/auth.middleware.js'
import { getWikiById } from '~/modules/wiki/wiki.service.js'
import { BizException } from '~/core/lib/biz.exception.js'
import { ErrorCode } from '~/config/error-code.js'

/**
 * 知识库发布控制器（owner 语义："发布成站点"——站点形态配置、外观设置、发布预览）
 *
 * 与 share 模块的职责边界（share/publish 语义拆分）：
 * - /share/*：分享给别人看（访客访问，访问控制由 wiki_shares 两级 shareStatus/password 决定）
 * - /publish/*：发布成站点（wiki 帮助中心 / blog 博客等形态 + 站点外观），数据存 wiki_publish 表
 *
 * 路由列表（均以 wikiId 寻址）：
 * - GET  /publish/wiki/:wikiId/settings                   读取发布设置（登录 + 归属校验）
 * - PUT  /publish/wiki/:wikiId/settings                   保存发布设置（双鉴权：预览令牌 or 登录）
 * - POST /publish/wiki/:wikiId/token                      签发预览访问令牌（登录 + 归属校验，1 小时有效）
 * - POST /publish/wiki/:wikiId/publish                    发布站点（双鉴权：预览令牌 or 登录；开发布开关 + enabled + 清密码）
 * - POST /publish/wiki/:wikiId/unpublish                  取消发布（双鉴权：预览令牌 or 登录；关发布开关 + enabled）
 * - GET  /publish/wiki/:wikiId/preview                    预览聚合：站点配置 + 完整文档树 + 可选首屏正文
 * - GET  /publish/wiki/:wikiId/preview/document/:docId    预览文档正文（预览模式内切换文档）
 * - GET  /publish/wiki/:wikiId/search?q=                  正文搜索（访客：需 public 无密码；可选预览令牌走 owner 预览路径）
 * - POST /publish/wiki/:wikiId/upload                     预览图片上传（Logo 等，multipart）
 *
 * 发布开关（wiki_publish.enabled）由本模块 publish/unpublish 接口承担——「发布」动作 =
 * shareStatus public（share 侧库级行）+ enabled true（本模块发布开关）+ 清密码，单事务内原子同步；
 * share 弹窗的「公开知识库」（upsertWikiShare）是分享动作，不翻转 enabled（分享 ≠ 发布）
 */
const publishController = new Hono()
  // 读取发布设置（web 编辑器分享弹窗回填表单用）
  // - 返回扁平结构：{ publishType, siteTitle, siteLogo, siteColor, aiEnabled, navButtons, updatedAt }
  // - 从未配置过发布时返回默认值（help + 全 null + aiEnabled true），前端直接回填
  .get('/wiki/:wikiId/settings', authMiddleware, async (c) => {
    const userId = getCurrentUserId(c)!
    const wikiId = c.req.param('wikiId')
    // 归属校验（越权抛 WIKI_NOT_FOUND）
    await getWikiById(wikiId, userId)
    const result = await getPublishSettings(wikiId)
    return c.success(result)
  })
  // 保存发布设置（部分更新语义：undefined = 保持不变，null = 清除回退默认）
  // 双鉴权（publishSettingsAuth）：pages 预览面板带预览令牌 / web 编辑器带登录态；
  // 登录态路径在 handler 内补归属校验（预览令牌路径 scope 已绑定 wikiId 无需重复校验）
  .put('/wiki/:wikiId/settings', publishSettingsAuth, vJson(UpdatePublishSettingsSchema), async (c) => {
    const wikiId = c.req.param('wikiId')
    const userId = getCurrentUserId(c)
    // 仅登录态路径需要归属校验（预览令牌路径 getCurrentUserId 为 null，scope 已保证库绑定）
    if (userId) {
      await getWikiById(wikiId, userId)
    }
    const data = c.req.valid('json')
    const result = await updatePublishSettings(wikiId, data)
    return c.success(result)
  })
  // 签发预览访问令牌（仅 owner，预览模式入口）
  // - 预览令牌供 web 编辑器跳转 pages 站 /w/{wikiId}/preview?t=... 使用：
  //   pages 站与 web 不同源无法共享登录态，改用 URL 携带短时效 HMAC 令牌（1 小时）
  // - 归属校验复用 getWikiById：非 owner → WIKI_NOT_FOUND（不泄露知识库存在性）
  // - 返回 { token, expiresAt }（毫秒时间戳）
  .post('/wiki/:wikiId/token', authMiddleware, async (c) => {
    const userId = getCurrentUserId(c)!
    const wikiId = c.req.param('wikiId')
    // 归属校验（越权抛 WIKI_NOT_FOUND）
    await getWikiById(wikiId, userId)
    // 签发预览令牌（scope = preview:{wikiId}，与访客分享令牌隔离）
    const result = await signPreviewToken(wikiId)
    return c.success(result)
  })
  // ============ 预览模式（owner 专属，previewAuthMiddleware 校验 X-Preview-Token / ?t=） ============
  // 访问权限完全由短时效预览令牌保证（只能由 owner 经 POST /publish/wiki/:wikiId/token 签发，
  // scope = preview:{wikiId}，1 小时过期）；**不复核 shareStatus** —— 未发布的库也能完整预览
  // 发布 / 取消发布（pages 预览条按钮 + web 编辑器发布卡片共用）：
  // 翻转发布开关（shareStatus → public | private + wiki_publish.enabled → true|false +
  // 清密码 + 同步 wikis.visibility），不动 publishType / 外观设置；
  // 双鉴权（publishSettingsAuth）：pages 预览条带预览令牌 / web 编辑器带登录态
  .post('/wiki/:wikiId/publish', publishSettingsAuth, async (c) => {
    const wikiId = c.req.param('wikiId')
    const result = await publishWiki(wikiId, 'public')
    return c.success(result)
  })
  .post('/wiki/:wikiId/unpublish', publishSettingsAuth, async (c) => {
    const wikiId = c.req.param('wikiId')
    const result = await publishWiki(wikiId, 'private')
    return c.success(result)
  })
  // 预览聚合接口：站点配置（含 publishType 与外观兜底）+ 完整文档树 + 可选首屏正文（?docId=）
  .get('/wiki/:wikiId/preview', previewAuthMiddleware, async (c) => {
    const wikiId = c.req.param('wikiId')
    // 空串归一为 undefined（不带首屏正文）
    const docId = c.req.query('docId') || undefined
    const result = await getPreviewData(wikiId, docId)
    return c.success(result)
  })
  // 预览文档正文：预览模式内切换文档时取（防跨库越权同访客接口，双 ID 兼容）
  .get('/wiki/:wikiId/preview/document/:documentId', previewAuthMiddleware, async (c) => {
    const wikiId = c.req.param('wikiId')
    const documentId = c.req.param('documentId')
    const result = await getPreviewDocument(wikiId, documentId)
    return c.success(result)
  })
  // 公开站正文搜索（pages 搜索弹窗「内容命中」数据源）：
  // 可见性由服务内复核 —— 访客路径要求库级 shareStatus public 且未设密码；
  // 可选预览令牌（X-Preview-Token 头 / ?t=）走 owner 预览路径：未发布/密码库也放行
  // （预览态语义同 previewAuthMiddleware，令牌无效与无权同码 SHARE_NOT_FOUND）；
  // q 空/全空白直接返回空数组（前端仅在有关键词时调用，此处兜底防御）
  .get('/wiki/:wikiId/search', async (c) => {
    const wikiId = c.req.param('wikiId')
    const q = (c.req.query('q') ?? '').trim().slice(0, 100)
    if (!q) return c.success([])
    // 预览令牌可选透传（公开态访客不带；预览态由 pages 弹窗从 sessionStorage 回填）
    const previewToken = c.req.header('X-Preview-Token') || c.req.query('t') || ''
    const result = await searchPublishedContent(wikiId, q, previewToken || undefined)
    return c.success(result)
  })
  // 预览图片上传（owner 预览面板 Logo 等，multipart/form-data 字段名 file）：
  // 预览站无登录态，鉴权同其他预览接口（预览令牌）；落盘复用 media.service
  // （MIME 白名单 jpeg/png/gif/webp、5MB 上限），媒体资产归属到 wiki.ownerId
  .post('/wiki/:wikiId/upload', previewAuthMiddleware, async (c) => {
    const wikiId = c.req.param('wikiId')
    const contentType = c.req.header('content-type') || ''

    // 校验 Content-Type 必须为 multipart/form-data（与 media.controller 同款守卫）
    if (!contentType.includes('multipart/form-data')) {
      throw new BizException(ErrorCode.INVALID_REQUEST, '请使用 multipart/form-data 提交')
    }

    // 解析 multipart body（all: false 只取同名字段第一个值）
    let body: Record<string, unknown>
    try {
      body = (await c.req.parseBody({ all: false })) as Record<string, unknown>
    } catch {
      throw new BizException(ErrorCode.MEDIA_FILE_REQUIRED)
    }

    // 校验 file 字段存在且为 File 类型
    const file = body['file']
    if (!file || typeof file === 'string' || !(file instanceof File)) {
      throw new BizException(ErrorCode.MEDIA_FILE_REQUIRED)
    }

    const result = await uploadPreviewImage(wikiId, file)
    return c.success(result)
  })

export default publishController
