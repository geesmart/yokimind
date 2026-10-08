/**
 * 知识库发布模块接口（owner 语义："发布成站点"）
 *
 * 对接后端 `/api/v1/publish/*`（publish.controller.ts）：
 * - GET /publish/wiki/:wikiId/settings   读取发布设置（登录 + 归属校验）
 * - PUT /publish/wiki/:wikiId/settings   保存发布设置（web 编辑器登录态；
 *                                        pages 预览面板走预览令牌，见 apps/pages 同名模块）
 * - POST /publish/wiki/:wikiId/token     签发预览访问令牌（仅 owner，1 小时有效）
 *
 * 与 share 模块的职责边界（share/publish 语义拆分）：
 * - share = 分享给别人看/编辑（访问控制：shareStatus/password，wiki_shares 表）
 * - publish = 发布成站点（站点形态 publishType：help 帮助中心 / blog 博客 + 站点外观，wiki_publish 表）
 *
 * "发布"动作 = share.shareStatus public（share 模块）+ publishType 配置（本模块），
 * web 侧发布入口（layout-main.vue 发布卡片）会先后调用两个模块的接口
 *
 * 数据存储说明：后端除 publishType 外的外观字段存 wiki_publish.settings（jsonb），
 * 接口层摊平为扁平字段（与存储解耦）；新增设置项后端只改 zod + 读写代码，接口形状按需扩展
 *
 * 响应已被 request.ts 的 alova 实例统一解包：
 * - 成功直接返回后端 `data` 字段
 * - 业务失败抛 `ApiError`（含 code/httpStatus）
 */
import { alova } from '../request'
import { API_PATHS } from '../constants'

// ==================== 类型定义 ====================

/** 公开站点形态：help - 帮助中心（/w/:wikiId，默认）；blog - 博客（/b/:wikiId 卡片列表） */
export type PublishType = 'help' | 'blog'

/** 页头导航按钮（公开站页头右侧 pill 跳转按钮） */
export interface PublishNavButton {
  /** 按钮文案（1-50 字） */
  title: string
  /** 跳转链接：http(s):// 外链（新标签打开）或 / 开头站内路径（1-500 字） */
  href: string
}

/**
 * 发布设置（owner 侧读取 / 保存返回）
 * 后端无配置行时按默认值兜底：publishType 'help' + 外观全 null + aiEnabled true
 */
export interface WikiPublishSettings {
  /** 公开站点形态：help - 帮助中心（默认）/ blog - 博客 */
  publishType: PublishType
  /** 发布开关（wiki_publish.enabled）：true = 已发布 / false = 未发布或已下架（发布状态唯一数据源） */
  enabled: boolean
  /** 站点标题（null = 未自定义，公开站回退 wiki.name） */
  siteTitle: string | null
  /** Logo 图片 URL（null = 未自定义，公开站回退默认品牌图） */
  siteLogo: string | null
  /** 主题色 hex（null = 未自定义，公开站回退默认主题色；第一版暂无设置入口，透传保留） */
  siteColor: string | null
  /** AI 助手开关（false = 公开站隐藏 AI 浮窗 + 访客问答接口拒绝） */
  aiEnabled: boolean
  /** 页头导航按钮数组（null = 未配置；[] = 已清空，均不渲染） */
  navButtons: PublishNavButton[] | null
  /** 配置最后更新时间（ISO 字符串；从未配置过时为 null） */
  updatedAt: string | null
}

/**
 * 保存发布设置入参（部分更新语义，与后端 UpdatePublishSettingsSchema 对齐）：
 * - 传 string/boolean/数组 = 设置新值
 * - 传 null = 清除自定义回退默认（文本类空串在后端同样归一为 null）
 * - 不传（undefined）= 保持原值不变
 */
export interface UpsertPublishSettingsParams {
  /** 公开站点形态；不传 = 保持不变 */
  publishType?: PublishType
  /** 站点标题：string = 设置 / null = 清除回退 wiki.name / 不传 = 保持不变 */
  siteTitle?: string | null
  /** Logo 图片 URL：string = 设置 / null = 清除回退默认 / 不传 = 保持不变 */
  siteLogo?: string | null
  /** 主题色 hex：string = 设置 / null = 清除回退默认 / 不传 = 保持不变 */
  siteColor?: string | null
  /** AI 助手开关 */
  aiEnabled?: boolean
  /** 页头导航按钮：数组 = 覆盖 / null 或 [] = 清空 / 不传 = 保持不变 */
  navButtons?: PublishNavButton[] | null
}

/** 预览令牌（POST /publish/wiki/:wikiId/token 返回） */
export interface WikiPublishPreviewToken {
  /** 预览令牌（HMAC 签名，1 小时有效；scope = preview:{wikiId}，与访客分享令牌隔离） */
  token: string
  /** 令牌过期时间戳（毫秒） */
  expiresAt: number
}

// ==================== owner 端接口（需登录） ====================

/**
 * 读取发布设置（发布卡片 / 未来设置弹窗回填用）
 * 从未配置过发布时返回默认值（help + 全 null + aiEnabled true），无需前端判空
 * cacheFor: null 禁用 alova GET 默认的 5 分钟内存缓存：保存后必须拿到最新值
 */
export function getPublishSettings(wikiId: string) {
  return alova.Get<WikiPublishSettings>(
    `${API_PATHS.PUBLISH.SETTINGS}/${wikiId}/settings`,
    { cacheFor: null }
  )
}

/**
 * 保存发布设置（部分更新：undefined = 保持不变，null = 清除回退默认）
 * 成功返回保存后的完整扁平设置（含 publishType 与全部外观字段）
 */
export function upsertPublishSettings(wikiId: string, data: UpsertPublishSettingsParams) {
  return alova.Put<WikiPublishSettings>(
    `${API_PATHS.PUBLISH.SETTINGS}/${wikiId}/settings`,
    data
  )
}

/**
 * 签发预览访问令牌（仅 owner，后端做归属校验）
 * 令牌经 URL ?t= 携带到 pages 站预览页（与 web 不同源无法共享登录态），
 * 非 owner / 未登录时抛 ApiError（code = WIKI_NOT_FOUND / UNAUTHORIZED）
 * cacheFor 无需关心：POST 请求无缓存
 */
export function getPublishPreviewToken(wikiId: string) {
  return alova.Post<WikiPublishPreviewToken>(`${API_PATHS.PUBLISH.TOKEN}/${wikiId}/token`)
}

/**
 * 发布站点返回（POST /publish/wiki/:wikiId/publish | /unpublish）
 */
export interface PublishToggleResult {
  /** 翻转后的库级分享状态：public = 已发布 / private = 已下架 */
  shareStatus: 'public' | 'private'
  /** 库级分享行更新时间（ISO 字符串，发布时间展示用） */
  updatedAt: string
}

/**
 * 发布站点（发布动作，pages 预览条「发布」/ 编辑器「发布成 Wiki」共用）
 * 后端一个事务内同步三处状态：库级 shareStatus → public、wiki_publish.enabled → true、
 * wikis.visibility → public（并清除库密码），保证 Dashboard 徽标与访客可达性一致
 */
export function publishWikiSite(wikiId: string) {
  return alova.Post<PublishToggleResult>(`${API_PATHS.PUBLISH.PUBLISH_TOGGLE}/${wikiId}/publish`)
}

/**
 * 取消发布/下架（发布动作，pages 预览条「已发布」/ 编辑器「下架」/ Dashboard 取消发布共用）
 * 后端一个事务内同步三处状态：库级 shareStatus → private、wiki_publish.enabled → false、
 * wikis.visibility → private；不动 publishType / 站点外观（重新发布形态不变）
 */
export function unpublishWikiSite(wikiId: string) {
  return alova.Post<PublishToggleResult>(`${API_PATHS.PUBLISH.PUBLISH_TOGGLE}/${wikiId}/unpublish`)
}

// ==================== pages 公开站链接构建 ====================

/**
 * 构建 pages 公开站的发布链接（owner 侧展示/预览共用，与访客打开的 URL 完全一致）
 *
 * - 发布语义即"公开站点"，对外链接用 pages 站（SSR + SEO 友好），不是 web 端 owner 浏览页
 * - 站点 origin 一律取 window.location.origin（同源派生）：统一入口模式（Caddy 按路径
 *   把 /w/*、/b/* 路由到 pages）与生产反向代理同构，发布链接与访客打开的地址天然一致；
 *   本地直连 web :6000 时由 vite dev 的 /w、/b、/_nuxt 代理转发到 pages
 *   （见 vite.config.ts server.proxy），同样同源可用
 *
 * @param wikiId 知识库 ID（全站统一小写）
 * @param publishType 公开站点形态：help → 帮助中心 /w/{wikiId}（默认）；blog → 博客 /b/{wikiId}
 */
export function buildWikiPagesLink(wikiId: string, publishType: PublishType = 'help'): string {
  const pagesOrigin = window.location.origin
  // help（帮助中心）与 blog（博客）两形态在 pages 站的路由前缀约定，与 apps/pages/app/pages 目录一一对应
  const prefix = publishType === 'blog' ? '/b' : '/w'
  return `${pagesOrigin}${prefix}/${wikiId}`
}

/**
 * 构建 pages 站的预览模式链接（owner 专属，整库预览入口）
 *
 * 预览路由 /w/{wikiId}/preview（docId 可选）与公开站 /w/{wikiId}/{docId} 并存，
 * 预览语义是整个知识库：不带 docId 打开，pages 站自动定位文档树第一个文档展示，
 * 站内切换文档在预览页组件内完成（不走公开站路由）。
 * 注意 preview 必须是独立路径段（不能放成 {docId}/preview）：Nuxt 同名
 * 「.vue 文件 + 目录」会形成嵌套路由，预览页会被当成公开站 [docId].vue 的子路由，
 * 而公开站页面没有 <NuxtPage /> 出口，最终只渲染公开站父组件并被其密码逻辑拦截。
 * 鉴权靠 URL 携带的短时效预览令牌（?t=，1 小时有效，只能由 owner 经
 * getPublishPreviewToken 签发）—— pages 站与 web 不同源无法共享登录态
 *
 * @param wikiId 知识库 ID
 * @param token getPublishPreviewToken 返回的预览令牌
 */
export function buildWikiPreviewLink(wikiId: string, token: string): string {
  const pagesOrigin = window.location.origin
  return `${pagesOrigin}/w/${wikiId}/preview?t=${encodeURIComponent(token)}`
}
