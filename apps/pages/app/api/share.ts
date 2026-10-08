/**
 * 分享模块接口（访客端，无需登录；share 语义："分享给别人看"）
 *
 * 对接后端 `/api/v1/share/*`（share.controller.ts）：
 * - 元信息探测：GET /share/wiki/:wikiId（?docId= 判定单页形态）
 * - 访客文档树：GET /share/wiki/:wikiId/nodes
 * - 访客文档正文：GET /share/wiki/:wikiId/document/:documentId（含预渲染 contentHtml）
 *
 * 与 publish 模块的职责边界（share/publish 语义拆分）：
 * - 本模块只管访客侧公开内容读取（shareStatus/password 访问控制）；
 *   owner 发布设置与预览模式（预览令牌鉴权）见 ./publish.ts（/publish/* 接口）
 *
 * 重要约定：
 * - api 客户端由调用方在 setup 上下文中创建后显式传入（见 request.ts 的 useApiClient），
 *   不要在 useAsyncData 的异步回调内部再调用 useApiClient —— 统一沿用
 *   「setup 里创建好、显式传入」的使用约定（保持调用链可追溯）。
 *
 * 与 web 端的差异：
 * - 帮助中心走 Nuxt SSR（useAsyncData + $fetch），无 alova 内存缓存问题
 * - 本期不支持密码库：不实现 verify/token；needsPassword=true 时页面渲染提示卡
 */
import type { ApiClient, ApiResponse } from './request'
import type { ShareDocument, ShareMeta, ShareNodeItem } from './types'
import { API_PATHS } from './constants'
import { unwrap } from './request'

/**
 * 获取分享元信息
 * @param api 请求客户端（setup 上下文创建）
 * @param wikiId 知识库 ID
 * @param docId 文档 ID（可选）：带值时后端据此判定单页分享的 accessType / needsPassword
 */
export async function fetchShareMeta(api: ApiClient, wikiId: string, docId?: string): Promise<ShareMeta> {
  const query = docId ? `?docId=${encodeURIComponent(docId)}` : ''
  const raw = await api<ApiResponse<ShareMeta>>(`${API_PATHS.SHARE.META}/${wikiId}${query}`)
  return unwrap<ShareMeta>(raw)
}

/**
 * 获取访客文档树（扁平节点数组，隐藏节点后端已剔除）
 * 无密码公开库可直接访问；密码库（本期不支持）由调用方在 meta 阶段拦截
 * @param api 请求客户端（setup 上下文创建）
 * @param wikiId 知识库 ID
 */
export async function fetchShareNodes(api: ApiClient, wikiId: string): Promise<ShareNodeItem[]> {
  const raw = await api<ApiResponse<ShareNodeItem[]>>(`${API_PATHS.SHARE.NODES}/${wikiId}/nodes`)
  return unwrap<ShareNodeItem[]>(raw)
}

/**
 * 获取访客文档正文（含预渲染 contentHtml）
 * @param api 请求客户端（setup 上下文创建）
 * @param wikiId 知识库 ID
 * @param documentId 文档 ID（documents.id，即路由 docId 段）
 * 后端校验 document.wikiId 与分享上下文一致，不一致抛 SHARE_NOT_FOUND
 */
export async function fetchShareDocument(
  api: ApiClient,
  wikiId: string,
  documentId: string,
): Promise<ShareDocument> {
  const raw = await api<ApiResponse<ShareDocument>>(`${API_PATHS.SHARE.DOCUMENT}/${wikiId}/document/${documentId}`)
  return unwrap<ShareDocument>(raw)
}
