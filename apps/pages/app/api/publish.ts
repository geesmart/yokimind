/**
 * 发布模块接口（owner 语义："发布成站点"，预览站专用）
 *
 * 对接后端 `/api/v1/publish/*`（publish.controller.ts）：
 * - 预览聚合：GET /publish/wiki/:wikiId/preview（?docId= 可选）
 * - 预览正文：GET /publish/wiki/:wikiId/preview/document/:documentId
 * - 发布设置保存：PUT /publish/wiki/:wikiId/settings（站点标题 / Logo / AI 开关 / 导航按钮等）
 * - 预览图片上传：POST /publish/wiki/:wikiId/upload（Logo 等）
 *
 * 鉴权：预览站与 web 编辑器不同源无法共享登录态，所有请求经
 * X-Preview-Token 头携带短时效预览令牌（只能由 owner 在 web 端签发，1 小时有效）
 *
 * 与 share 模块的职责边界（share/publish 语义拆分）：
 * - share = 分享给别人看（访客公开接口，见 ./share.ts）
 * - publish = 发布成站点 + owner 专属预览（本模块，wiki_publish 表）
 *
 * 重要约定：
 * - api 客户端由调用方在 setup 上下文中创建后显式传入（见 request.ts 的 useApiClient），
 *   不要在 useAsyncData 的异步回调内部再调用 useApiClient —— 统一沿用
 *   「setup 里创建好、显式传入」的使用约定（保持调用链可追溯）。
 */
import type { ApiClient, ApiResponse } from './request'
import type {
  PreviewAggregate,
  PreviewUploadResult,
  PublishedContentSearchItem,
  PublishSettingsResult,
  PublishSiteResult,
  ShareDocument,
  UpdatePublishSettingsParams,
} from './types'
import { API_PATHS } from './constants'
import { unwrap } from './request'

/**
 * 构建预览令牌请求头（本模块全部接口共用）
 * @param token web 编辑器签发的预览令牌（URL ?t= / sessionStorage 取得）
 */
function previewHeaders(token: string): Record<string, string> {
  return { 'X-Preview-Token': token }
}

/**
 * 预览聚合接口：站点配置 + 完整文档树 + 可选首屏正文
 * 未发布的库同样返回完整数据（预览不复核 shareStatus）
 * 令牌无效 / 过期 / 跨库 → 后端抛 70010（调用方渲染"无访问权限"卡片）
 * @param api 请求客户端（setup 上下文创建）
 * @param wikiId 知识库 ID
 * @param token 预览令牌
 * @param docId 可选文档 ID（documents.id 或 wikiNodes.id 均可），带值时附带首屏正文
 */
export async function fetchPreviewAggregate(
  api: ApiClient,
  wikiId: string,
  token: string,
  docId?: string
): Promise<PreviewAggregate> {
  const query = docId ? `?docId=${encodeURIComponent(docId)}` : ''
  const raw = await api<ApiResponse<PreviewAggregate>>(
    `${API_PATHS.PUBLISH.PREVIEW}/${wikiId}/preview${query}`,
    { headers: previewHeaders(token) }
  )
  return unwrap<PreviewAggregate>(raw)
}

/**
 * 预览文档正文（预览模式内切换文档时取，结构与访客文档一致）
 * @param api 请求客户端（setup 上下文创建）
 * @param wikiId 知识库 ID
 * @param token 预览令牌
 * @param documentId 文档 ID（documents.id 或 wikiNodes.id 均可）
 */
export async function fetchPreviewDocument(
  api: ApiClient,
  wikiId: string,
  token: string,
  documentId: string
): Promise<ShareDocument> {
  const raw = await api<ApiResponse<ShareDocument>>(
    `${API_PATHS.PUBLISH.PREVIEW}/${wikiId}/preview/document/${documentId}`,
    { headers: previewHeaders(token) }
  )
  return unwrap<ShareDocument>(raw)
}

/**
 * 保存发布设置（站点形态 / 站点标题 / Logo / 主题色 / AI 助手开关 / 导航按钮）
 * 保存后对已发布的公开站即时生效（访客接口实时读库）
 * @param api 请求客户端（setup 上下文创建）
 * @param wikiId 知识库 ID
 * @param token 预览令牌
 * @param data 发布设置（undefined = 保持不变，null/空串 = 清除回退默认）
 */
export async function putPublishSettings(
  api: ApiClient,
  wikiId: string,
  token: string,
  data: UpdatePublishSettingsParams
): Promise<PublishSettingsResult> {
  const raw = await api<ApiResponse<PublishSettingsResult>>(
    `${API_PATHS.PUBLISH.SETTINGS}/${wikiId}/settings`,
    { method: 'PUT', body: data, headers: previewHeaders(token) }
  )
  return unwrap<PublishSettingsResult>(raw)
}

/**
 * 发布站点（预览条「发布」按钮）
 * 开发布开关：shareStatus → public + 清除密码（pages 公开站暂不支持输密码）+
 * 同步 wikis.visibility；站点形态与外观设置保持原值。
 * 成功后公开链接即刻可访问，预览条据此摘除「尚未发布」徽标与发布按钮
 * @param api 请求客户端（setup 上下文创建）
 * @param wikiId 知识库 ID
 * @param token 预览令牌
 */
export async function publishWikiSite(
  api: ApiClient,
  wikiId: string,
  token: string
): Promise<PublishSiteResult> {
  const raw = await api<ApiResponse<PublishSiteResult>>(
    `${API_PATHS.PUBLISH.PREVIEW}/${wikiId}/publish`,
    { method: 'POST', headers: previewHeaders(token) }
  )
  return unwrap<PublishSiteResult>(raw)
}

/**
 * 取消发布（预览条「已发布」按钮，点击下架）
 * 关发布开关：shareStatus → private（密码保持清除、外观与形态不变，重新发布即可恢复公开），
 * 访客即刻不可访问（公开接口每次请求实时复核 shareStatus）
 * @param api 请求客户端（setup 上下文创建）
 * @param wikiId 知识库 ID
 * @param token 预览令牌
 */
export async function unpublishWikiSite(
  api: ApiClient,
  wikiId: string,
  token: string
): Promise<PublishSiteResult> {
  const raw = await api<ApiResponse<PublishSiteResult>>(
    `${API_PATHS.PUBLISH.PREVIEW}/${wikiId}/unpublish`,
    { method: 'POST', headers: previewHeaders(token) }
  )
  return unwrap<PublishSiteResult>(raw)
}

/**
 * 上传发布外观图片（Logo 等，multipart/form-data 字段名 file）
 * 预览站无登录态，鉴权同其他预览接口（X-Preview-Token 头）
 * 服务端校验 MIME 白名单（jpeg/png/gif/webp）与 5MB 上限，成功返回 /uploads/... URL
 * （pages 站 /uploads 经 devProxy / 生产反代同源转发到后端静态服务，可直接作 <img src>）
 * @param api 请求客户端（setup 上下文创建）
 * @param wikiId 知识库 ID
 * @param token 预览令牌
 * @param file 用户选择的图片文件
 */
export async function uploadPublishImage(
  api: ApiClient,
  wikiId: string,
  token: string,
  file: File
): Promise<PreviewUploadResult> {
  const body = new FormData()
  body.append('file', file)
  // body 为 FormData 时 $fetch 自动按 multipart 边界设置 Content-Type，勿手工覆盖
  const raw = await api<ApiResponse<PreviewUploadResult>>(
    `${API_PATHS.PUBLISH.PREVIEW}/${wikiId}/upload`,
    { method: 'POST', body, headers: previewHeaders(token) }
  )
  return unwrap<PreviewUploadResult>(raw)
}

/**
 * 正文搜索（搜索弹窗「内容命中」数据源）
 *
 * 放行条件二选一（服务内复核）：
 * - 访客路径（不传 token）：库级 shareStatus public 且未设密码；
 * - 预览路径（传 token）：有效预览令牌 = owner 预览态，未发布/密码库也放行
 *   （pages 预览页从 sessionStorage 回填令牌，见 components/searchbox）。
 *
 * @param api 请求客户端（setup 上下文创建）
 * @param wikiId 知识库 ID
 * @param q 搜索关键词（调用方已 trim 非空；后端截断 100 字符）
 * @param token 可选预览令牌（预览态搜索携带；公开态访客不传走访客路径）
 * @returns 命中文档列表（documentId 对齐 /w/:wikiId/:docId 路由；无命中返回空数组）
 * 失败（未发布 / 密码库 / 令牌无效 / 网络异常）抛 ApiError，由调用方静默降级为空结果
 */
export async function searchPublishedContent(
  api: ApiClient,
  wikiId: string,
  q: string,
  token?: string
): Promise<PublishedContentSearchItem[]> {
  const raw = await api<ApiResponse<PublishedContentSearchItem[]>>(
    `${API_PATHS.PUBLISH.PREVIEW}/${wikiId}/search?q=${encodeURIComponent(q)}`,
    { headers: token ? previewHeaders(token) : undefined }
  )
  return unwrap<PublishedContentSearchItem[]>(raw)
}
