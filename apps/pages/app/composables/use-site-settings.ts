/**
 * 站点外观设置（全局状态）
 *
 * owner 在预览面板配置的「站点标题 / Logo / 主题色 / AI 助手开关 / 导航按钮」，
 * 由各知识库页面（公开站落地页 / 文档页 / 预览页）取数后写入，
 * 布局层（layouts/default.vue）消费：
 * - siteLogo 有值 → 页头渲染自定义 Logo 图片（否则回退默认品牌图）
 * - siteColor 有值 → 根容器注入 --primary CSS 变量覆盖（Tailwind v4
 *   @theme inline 引用 var(--primary)，运行时覆盖即全站生效）
 * - aiEnabled === false → 不渲染 AiAssistant 浮窗
 * - navButtons 非空数组 → 页头右侧渲染跳转按钮（外链新标签、站内当前页）
 *
 * 页面内标题展示（面包屑 / 落地页 h1 / SEO）直接用各自 meta 数据
 * （siteTitle || wikiName）计算，不依赖本状态
 */
import type { ShareNavButton } from '~/api/types'

export interface SiteSettings {
  /** 站点标题（发布设置「站点标题」，null = 未自定义） */
  siteTitle: string | null
  /** 知识库名（站点标题未配置时的回退品牌名，如浏览器标签页后缀） */
  wikiName: string | null
  /** 站点 Logo 图片 URL（null = 未自定义） */
  siteLogo: string | null
  /** 站点主题色 hex（null = 未自定义） */
  siteColor: string | null
  /** AI 助手开关（false = 隐藏浮窗且后端拒绝问答） */
  aiEnabled: boolean
  /** 页头导航按钮数组（null = 未配置；空数组渲染等价 null，布局层不渲染） */
  navButtons: ShareNavButton[] | null
}

/**
 * 站点外观设置全局状态（useState：SSR payload 序列化 + 客户端跨组件共享）
 * null = 当前不在知识库上下文 / 数据未加载，布局层按默认外观渲染
 */
export function useSiteSettings() {
  return useState<SiteSettings | null>('site-settings', () => null)
}
