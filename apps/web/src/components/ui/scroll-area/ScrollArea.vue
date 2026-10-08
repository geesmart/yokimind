<script setup lang="ts">
import type { ScrollAreaRootProps } from 'reka-ui'

import type { HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { ScrollAreaCorner, ScrollAreaRoot, ScrollAreaViewport } from 'reka-ui'
import { cn } from '@/lib/utils'
import ScrollBar from './ScrollBar.vue'

/**
 * ScrollArea 根组件（shadcn-vue / reka-ui）
 * - 自定义滚动条替代浏览器原生滚动条（细圆条、随 hover 显色）
 * - 高度受约束的容器（如弹窗内滚动区、侧栏）中使用；
 *   根元素默认 relative overflow-hidden，viewport 撑满 size-full
 * - orientation 未传时 reka-ui 根节点自身默认 'vertical'，无需本地默认值
 */
const props = defineProps<ScrollAreaRootProps & { class?: HTMLAttributes['class'] }>()

/** 剥离 class 后透传其余 props（如 orientation、dir）给 reka-ui 根节点 */
const delegatedProps = reactiveOmit(props, 'class')
</script>

<template>
  <ScrollAreaRoot
    data-slot="scroll-area"
    v-bind="delegatedProps"
    :class="cn('relative overflow-hidden', props.class)"
  >
    <!-- 视口：实际滚动区域，占满根容器并继承圆角；聚焦时展示 ring 焦点环 -->
    <ScrollAreaViewport
      data-slot="scroll-area-viewport"
      class="focus-visible:ring-ring/50 size-full rounded-[inherit] transition-[color,box-shadow] outline-none focus-visible:ring-[3px] focus-visible:outline-1"
    >
      <slot />
    </ScrollAreaViewport>
    <!-- 默认渲染竖向滚动条；横向场景显式放 ScrollBar orientation="horizontal" -->
    <ScrollBar />
    <ScrollAreaCorner />
  </ScrollAreaRoot>
</template>
