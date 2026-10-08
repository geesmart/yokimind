import { signToken } from '~/modules/share/share.util.js'
import type { PublishSettingsData } from './publish.schema.js'

/**
 * 预览令牌有效期（毫秒）：1 小时
 * owner 专属预览模式：web 编辑器签发 → 经 URL ?t= 携带到 pages 站；
 * 短时效 + scope 绑定 wikiId，链接被分享出去也很快失效
 */
const PREVIEW_TOKEN_TTL = 60 * 60 * 1000

/**
 * 为 wiki owner 签发预览访问令牌（owner 专属预览模式，publish 模块职责）
 *
 * scope = `preview:${wikiId}`，与访客分享令牌（scope = wikiId 或 `${wikiId}:${nodeId}`）
 * 完全隔离：预览令牌拿到访客接口上会因 scope 不匹配被拒，反之亦然。
 * 预览能力的关键差异：预览接口不做 shareStatus 复核（未发布的库也能预览），
 * 因此预览令牌必须只能由 owner 签发（publish.controller 的 authMiddleware + 归属校验保证）
 *
 * @param wikiId 知识库 ID
 * @returns token 令牌字符串与过期时间戳（毫秒），1 小时有效期
 */
export async function signPreviewToken(wikiId: string): Promise<{ token: string; expiresAt: number }> {
  return signToken(`preview:${wikiId}`, PREVIEW_TOKEN_TTL)
}

/**
 * 将 wiki_publish.settings（jsonb 自由集合）摊平为已知键的扁平返回结构（含默认值兜底）
 *
 * jsonb 历史行可能缺任意键（新增设置项不需要迁移），读取侧统一在此兜底：
 * - 文本类（siteTitle/siteLogo/siteColor）：缺省 → null（前端回退 wiki 默认值）
 * - aiEnabled：缺省 → true（默认开放 AI 助手）
 * - navButtons：缺省 → null（页头不渲染按钮）
 * - SEO 设置（seoDescription/seoKeywords）：缺省 → null（公开站回退页面默认摘要 / 不输出 keywords）
 *
 * 供 publish.service（预览聚合 / 设置读写）与 share.service（访客 meta 外观字段）共用 ——
 * 放在本工具文件避免 service 间循环依赖
 *
 * @param settings wiki_publish.settings jsonb 值（可能为 null / 缺键的历史行）
 */
export function flattenPublishSettings(settings: unknown) {
  const s = (settings ?? {}) as PublishSettingsData
  return {
    siteTitle: s.siteTitle ?? null,
    siteLogo: s.siteLogo ?? null,
    siteColor: s.siteColor ?? null,
    aiEnabled: s.aiEnabled ?? true,
    navButtons: s.navButtons ?? null,
    seoDescription: s.seoDescription ?? null,
    seoKeywords: s.seoKeywords ?? null,
  }
}
