<script setup lang="ts">
import type { ScrollAreaScrollbarProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { ScrollAreaScrollbar, ScrollAreaThumb } from 'reka-ui'
import { cn } from '@/lib/utils'

const props = withDefaults(defineProps<ScrollAreaScrollbarProps & { class?: HTMLAttributes['class'] }>(), {
  orientation: 'vertical',
})

// 剔除 class 后的其余 props（用 computed 替代 @vueuse/core 的 reactiveOmit）
const delegatedProps = computed(() => {
  const { class: _omit, ...rest } = props
  return rest
})
</script>

<template>
  <ScrollAreaScrollbar
    data-slot="scroll-area-scrollbar"
    :data-orientation="orientation"
    v-bind="delegatedProps"
    :class="cn('data-horizontal:h-2.5 data-horizontal:flex-col data-horizontal:border-t data-horizontal:border-t-transparent data-vertical:h-full data-vertical:w-2.5 data-vertical:border-l data-vertical:border-l-transparent flex touch-none p-px transition-colors select-none', props.class)"
  >
    <ScrollAreaThumb
      data-slot="scroll-area-thumb"
      class="rounded-full relative flex-1 bg-border"
    />
  </ScrollAreaScrollbar>
</template>
