<script setup lang="ts">
/**
 * 知识库图标统一渲染组件
 *
 * 兼容两代数据：legacy lucide key（icon-meta 组件渲染）与 Solar 图标 id
 * （懒加载 solar-library 后烘焙内联 SVG，见 wiki-icon-meta.ts）。
 * 只渲染图标 glyph 本体；底色由调用方包裹层按 resolveWikiIconColor().bg 决定。
 * Solar chunk（3.7M）仅在存在 Solar id 的 wiki 时才下载，全 legacy 数据零新增请求。
 */
import { computed, ref, watchEffect } from 'vue'
import { iconElementsToSvg } from '@/components/notion-editor/extensions/editor-icon.js'
import { loadSolarIcons } from '@/components/notion-editor/utils/solar-library.js'
import { getWikiLegacyIconComponent, isLegacyIconKey, resolveWikiIconColor } from './wiki-icon-meta'

const props = withDefaults(
  defineProps<{
    /** wiki.icon：Solar 图标 id 或 legacy lucide key */
    icon?: string | null
    /** wiki.color：统一色板 key 或 legacy 色 key */
    color?: string | null
    /** 渲染尺寸 px（正方形） */
    size?: number
  }>(),
  { icon: null, color: null, size: 16 }
)

const visual = computed(() => resolveWikiIconColor(props.color))

/** legacy / 兜底用的 lucide 组件：legacy 直接用命中组件，Solar 模式加载中/未命中回退 BookOpen */
const fallbackIcon = computed(() =>
  getWikiLegacyIconComponent(isLegacyIconKey(props.icon) ? props.icon : 'BookOpen')
)

/** Solar 图标烘焙结果（异步解析后填充；颜色变化时随 watchEffect 重烘焙） */
const solarSvg = ref<string | null>(null)

watchEffect(async (onCleanup) => {
  const id = props.icon
  const bakeKey = visual.value.rainbow ? 'rainbow' : visual.value.key
  solarSvg.value = null
  if (!id || isLegacyIconKey(id)) return

  let active = true
  onCleanup(() => {
    active = false
  })
  const items = await loadSolarIcons()
  if (!active) return
  const item = items.find((i) => i.id === id)
  if (item) solarSvg.value = iconElementsToSvg(item.elements, bakeKey)
  // 未命中（脏数据等）保持 BookOpen 兜底
})
</script>

<template>
  <!-- Solar 图标：烘焙好的内联 SVG（色值已进 SVG，无需 CSS 上色） -->
  <span
    v-if="solarSvg"
    class="inline-block shrink-0 [&_svg]:block [&_svg]:h-full [&_svg]:w-full"
    :style="{ width: `${size}px`, height: `${size}px` }"
    v-html="solarSvg"
  />
  <!-- legacy lucide 组件 / Solar 加载中与未命中的 BookOpen 兜底 -->
  <component :is="fallbackIcon" v-else-if="fallbackIcon" :size="size" :style="{ color: visual.fg }" class="shrink-0" />
</template>
