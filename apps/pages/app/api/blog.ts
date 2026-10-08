/**
 * 博客模块接口（访客端，无需登录）
 *
 * 对接后端 `/api/v1/share/wiki/:wikiId/blog`（share.controller.ts）：
 * - 博客文章列表：GET /share/wiki/:wikiId/blog
 *   仅公开库可访问；密码库需携带 X-Share-Token（本期不支持密码库，needsPassword 时
 *   页面在 meta 阶段已拦截渲染密码卡，不会走到本接口）
 *
 * 重要约定（与 share.ts 一致）：
 * - api 客户端由调用方在 setup 上下文中创建后显式传入，
 *   不能在 useAsyncData 的异步回调内部再调用 useApiClient
 * - 列表排序由后端保证（文档树先序，sortOrder 升序），前端不再排序
 */
import type { ApiClient, ApiResponse } from './request'
import type { BlogPost } from './types'
import { API_PATHS } from './constants'
import { unwrap } from './request'

/**
 * 获取博客文章列表
 * @param api 请求客户端（setup 上下文创建）
 * @param wikiId 知识库 ID
 * @returns 博客文章列表项数组（文档树先序排序；非公开库抛 ApiError 70001）
 */
export async function fetchBlogPosts(api: ApiClient, wikiId: string): Promise<BlogPost[]> {
  const raw = await api<ApiResponse<BlogPost[]>>(`${API_PATHS.SHARE.BLOG}/${wikiId}/blog`)
  return unwrap<BlogPost[]>(raw)
}
