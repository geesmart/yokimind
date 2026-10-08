<script setup lang="ts">
import type { ScrollAreaScrollbarProps } from 'reka-ui'

import type { HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { ScrollAreaScrollbar, ScrollAreaThumb } from 'reka-ui'
import { cn } from '@/lib/utils'

/**
 * ScrollArea 滚动条（shadcn-vue / reka-ui）
 * - 默认竖向；ScrollArea 根组件内已默认渲染，横向场景需显式传入 orientation
 * - p-px + 透明 border 留出内边距，thumb 为 bg-border 圆角细条
 */
const props = withDefaults(
  defineProps<ScrollAreaScrollbarProps & { class?: HTMLAttributes['class'] }>(),
  { orientation: 'vertical' },
)

/** 剥离 class 后透传其余 props 给 reka-ui 滚动条节点 */
const delegatedProps = reactiveOmit(props, 'class')
</script>

<template>
  <ScrollAreaScrollbar
    data-slot="scroll-area-scrollbar"
    v-bind="delegatedProps"
    :class="cn(
      'flex touch-none p-px transition-colors select-none',
      orientation === 'vertical'
        && 'h-full w-2.5 border-l border-l-transparent',
      orientation === 'horizontal'
        && 'h-2.5 flex-col border-t border-t-transparent',
      props.class,
    )"
  >
    <!-- 滑块：可拖拽部分，占满轨道并呈圆角胶囊状 -->
    <ScrollAreaThumb
      data-slot="scroll-area-thumb"
      class="bg-border relative flex-1 rounded-full"
    />
  </ScrollAreaScrollbar>
</template>
