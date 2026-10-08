/**
 * 知识库文档树共享状态（全局状态）
 *
 * 各知识库页面（公开站落地页 /w/:wikiId、文档页 /w/:wikiId/:docId）取数后把
 * 访客文档树（扁平节点数组，后端已剔除隐藏节点）写入，布局层（layouts/default.vue）
 * 的搜索弹窗（components/searchbox）消费：标题命中 = 本地过滤这份数据。
 *
 * 与 useSiteSettings 相同的写入/清场约定：
 * - 页面在数据就绪后写入（watchEffect 跟随 useAsyncData 结果）；
 * - 客户端 onUnmounted 清空为 []，避免离开知识库上下文后残留串页
 *   （Vue 更换路由组件时旧组件先 unmount 再挂载新组件，不会误清新页写入的数据）。
 */
import type { ShareNodeItem } from '~/api/types'

/**
 * 当前知识库访客文档树（useState：SSR payload 序列化 + 客户端跨组件共享）
 * 空数组 = 当前不在知识库上下文 / 数据未加载 / 密码锁定态（无树可搜）
 */
export function useWikiNodes() {
  return useState<ShareNodeItem[]>('help-wiki-nodes', () => [])
}
