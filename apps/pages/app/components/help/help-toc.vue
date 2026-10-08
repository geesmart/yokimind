<script setup lang="ts">
/**
 * 帮助中心右栏「本页目录」
 *
 * - 数据：extractToc 从正文 contentHtml 提取的 h2/h3 列表（SSR 同源注入锚点 id）；
 * - scroll-spy：IntersectionObserver 监听标题进入「当前阅读带」→ 高亮对应目录项
 *   （仅客户端，onMounted 注册；SSR 无 IntersectionObserver）；
 * - 点击目录项：平滑滚动到对应标题（标题有 scroll-margin-top 留出 sticky 页头空间）。
 */
import type { TocItem } from '~/utils/help-toc'

const props = defineProps<{
  /** 目录条目（level 2 / 3） */
  items: TocItem[]
  /** 头部标题（可空）：博客文章页在目录顶部展示文章标题（参考稿样式），帮助中心不展示 */
  title?: string
}>()

/** 当前滚动位置对应的标题 id */
const activeId = ref('')

let observer: IntersectionObserver | null = null

/** 注册 scroll-spy：对每个标题元素建观察（重复调用前先清理旧观察） */
function observe() {
  observer?.disconnect()
  observer = null
  if (!props.items.length) return

  observer = new IntersectionObserver(
    (entries) => {
      // 标题进入阅读带（视口顶部 96px ~ 45% 高度之间）→ 记为当前章节
      for (const entry of entries) {
        if (entry.isIntersecting) {
          activeId.value = entry.target.id
        }
      }
    },
    // rootMargin 收缩视口：顶部跳过 sticky 页头区域，底部收缩到 55% 处
    { rootMargin: '-96px 0px -45% 0px', threshold: 0 }
  )

  for (const item of props.items) {
    const el = document.getElementById(item.id)
    if (el) observer.observe(el)
  }
}

// 挂载后注册（浏览器端），items 变化（如路由切换重新取数）时重建观察
onMounted(observe)
watch(
  () => props.items,
  () => nextTick(observe),
  { deep: false }
)
onBeforeUnmount(() => observer?.disconnect())

/** 点击目录项：平滑滚动到标题 */
function scrollTo(item: TocItem) {
  document.getElementById(item.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
</script>

<template>
  <!-- 左侧竖线贴 TOC 内容块高度（nav 自身高度），不延伸到整列 -->
  <nav v-if="items.length" aria-label="本页目录" class="border-l border-border/60 text-sm">
    <!-- 头部标题（博客文章页）：小号加粗，参考稿 TOC 顶部样式；标题不出现在目录列表里 -->
    <p v-if="title" class="px-4 pb-2 font-semibold text-foreground" :title="title">
      {{ title }}
    </p>
    <ul class="space-y-0.5">
      <li v-for="item in items" :key="item.id">
        <button
          type="button"
          class="block w-full cursor-pointer truncate py-1 pr-3 text-left transition-colors"
          :class="[
            item.level === 3 ? 'pl-8' : 'pl-4',
            activeId === item.id
              ? 'border-l-2 border-primary font-medium text-primary'
              : 'border-l-2 border-transparent text-muted-foreground hover:text-foreground',
          ]"
          :title="item.text"
          @click="scrollTo(item)"
        >
          {{ item.text }}
        </button>
      </li>
    </ul>
  </nav>
</template>
