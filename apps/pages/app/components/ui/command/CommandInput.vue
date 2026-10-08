<script setup lang="ts">
import type { ListboxFilterProps } from 'reka-ui'

import type { HTMLAttributes } from 'vue'
import { SearchIcon } from '@lucide/vue'
import { reactiveOmit } from '@vueuse/core'
import { ListboxFilter, useForwardProps } from 'reka-ui'
import { cn } from '@/lib/utils'
import { useCommand } from '.'

// 基于 web 侧 CommandInput.vue 改写：pages 无 ui/input-group 组件，
// 改用普通 div 布局（relative + 左侧 SearchIcon + ListboxFilter），视觉对齐页头搜索输入框
defineOptions({
  inheritAttrs: false,
})

const props = defineProps<ListboxFilterProps & {
  class?: HTMLAttributes['class']
}>()

const delegatedProps = reactiveOmit(props, 'class')

const forwardedProps = useForwardProps(delegatedProps)

const { filterState } = useCommand()
</script>

<template>
  <div
    data-slot="command-input-wrapper"
    class="p-1 pb-0"
  >
    <div class="bg-input/30 border-input/30 flex h-10 items-center gap-2 rounded-lg border px-3">
      <SearchIcon class="size-4 shrink-0 opacity-50" />
      <ListboxFilter
        v-bind="{ ...forwardedProps, ...$attrs }"
        v-model="filterState.search"
        data-slot="command-input"
        auto-focus
        :class="cn('h-full w-full bg-transparent text-sm outline-hidden placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50', props.class)"
      />
    </div>
  </div>
</template>
