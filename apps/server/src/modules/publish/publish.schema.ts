import { z } from 'zod'

/**
 * 发布设置请求 Schema（owner 语义：配置站点形态与外观，写入 wiki_publish 表）
 *
 * 数据落库形态：除 publishType 外的全部字段存入 wiki_publish.settings（jsonb 自由配置集合），
 * 写入前经本 Schema 校验（zod 默认剥离未知键，杜绝脏数据），读取按字段兜底默认值。
 * 新增设置项只需在此扩展字段 + service 读写透传，**表结构零变更**。
 */

/**
 * 可空文本归一：trim 后空串转为 null（null = 清除自定义，回退默认值）
 * 用于站点标题 / Logo / 主题色 —— 前端输入框留空即表示"恢复默认"
 */
const nullableText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label}最长 ${max} 字`)
    .transform((v) => (v === '' ? null : v))

/**
 * 页头导航按钮 Schema：公开站 / 预览站页头右侧的可配置跳转按钮
 * - title: 按钮文案（1-50 字）
 * - href: 跳转链接（1-500 字），仅允许 http(s):// 外链或 / 开头的站内路径
 *   （拒绝 javascript: 等危险协议，防 XSS 注入）
 */
const navButtonItem = z.object({
  title: z.string().trim().min(1, '按钮标题不能为空').max(50, '按钮标题最长 50 字'),
  href: z
    .string()
    .trim()
    .min(1, '按钮链接不能为空')
    .max(500, '按钮链接最长 500 字')
    .regex(/^(https?:\/\/|\/)/, '链接需以 http(s):// 或 / 开头'),
})

/**
 * 更新发布设置请求 Schema（PUT /publish/wiki/:wikiId/settings）
 * 部分更新语义：undefined = 保持不变；null（或空串归一后）= 清除回退默认
 * - publishType: 站点形态 'help' 帮助中心（默认）/ 'blog' 博客
 * - siteTitle: 站点标题（≤100 字，空 = 回退 wiki.name）
 * - siteLogo: Logo 图片 URL（≤500 字，空 = 回退默认品牌图）
 * - siteColor: 主题色，预设色板 hex（#RRGGBB，空 = 回退默认主题色）
 * - aiEnabled: AI 助手开关（false = 公开站隐藏 AI 浮窗 + 接口层拒绝问答）
 * - navButtons: 页头导航按钮数组（≤5 个）；null / [] = 清空隐藏
 * - seoDescription: 站点 SEO 描述（≤200 字，公开站 SSR 输出 meta description；空 = 回退页面默认摘要）
 * - seoKeywords: SEO 关键词（≤200 字，逗号分隔自由文本，输出 meta keywords；空 = 不输出）
 */
export const UpdatePublishSettingsSchema = z.object({
  publishType: z.enum(['help', 'blog']).optional(),
  siteTitle: nullableText(100, '站点标题').optional(),
  siteLogo: nullableText(500, 'Logo 地址').optional(),
  siteColor: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, '主题色格式不正确（需 #RRGGBB）')
    .or(z.literal(''))
    .transform((v) => (v === '' ? null : v))
    .optional(),
  aiEnabled: z.boolean().optional(),
  navButtons: z.array(navButtonItem).max(5, '最多配置 5 个按钮').nullable().optional(),
  seoDescription: nullableText(200, '站点描述').optional(),
  seoKeywords: nullableText(200, 'SEO 关键词').optional(),
})

// ============ 类型导出 ============

export type UpdatePublishSettings = z.infer<typeof UpdatePublishSettingsSchema>

/**
 * wiki_publish.settings jsonb 的已知键形态（读取侧类型视图）
 * 历史行可能缺任意键（jsonb 自由集合），读取时按字段兜底默认值
 */
export interface PublishSettingsData {
  /** 站点标题（null/缺省 = 回退 wiki.name） */
  siteTitle?: string | null
  /** Logo 图片 URL（null/缺省 = 回退默认品牌图） */
  siteLogo?: string | null
  /** 主题色 hex（null/缺省 = 回退默认主题色） */
  siteColor?: string | null
  /** AI 助手开关（缺省 = true） */
  aiEnabled?: boolean
  /** 页头导航按钮（null/缺省 = 不渲染；[] 同样不渲染） */
  navButtons?: { title: string; href: string }[] | null
  /** 站点 SEO 描述（null/缺省 = 公开站回退页面默认摘要） */
  seoDescription?: string | null
  /** SEO 关键词（逗号分隔自由文本，null/缺省 = 不输出 meta keywords） */
  seoKeywords?: string | null
}
