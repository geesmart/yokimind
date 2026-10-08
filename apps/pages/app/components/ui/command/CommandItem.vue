<script setup lang="ts">
import type { ListboxItemEmits, ListboxItemProps } from 'reka-ui'

import type { HTMLAttributes } from 'vue'
import { CheckIcon } from '@lucide/vue'
import { reactiveOmit, useCurrentElement } from '@vueuse/core'
import { ListboxItem, useForwardPropsEmits, useId } from 'reka-ui'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { cn } from '@/lib/utils'
import { useCommand, useCommandGroup } from '.'

// 与 web 侧 CommandItem.vue 同构副本（含「未注册项首渲」修复：filtered.items 里查不到时
// 先渲染一轮把文本注册进 allItems，否则新挂载的 item 永远进不了过滤集合）
const props = defineProps<ListboxItemProps & { class?: HTMLAttributes['class'] }>()
const emits = defineEmits<ListboxItemEmits>()

const delegatedProps = reactiveOmit(props, 'class')

const forwarded = useForwardPropsEmits(delegatedProps, emits)

const id = useId()
const { filterState, allItems, allGroups } = useCommand()
const groupContext = useCommandGroup()

const isRender = computed(() => {
  if (!filterState.search) {
    return true
  }
  else {
    const filteredCurrentItem = filterState.filtered.items.get(id)
    // undefined 说明还没进 allItems 映射：先渲染一轮完成注册
    if (filteredCurrentItem === undefined) {
      return true
    }

    // 已注册则按过滤得分决定可见性
    return filteredCurrentItem > 0
  }
})

const itemRef = ref()
const currentElement = useCurrentElement(itemRef)
onMounted(() => {
  if (!(currentElement.value instanceof HTMLElement))
    return

  // textValue 用于过滤（DOM 文本优先，兜底 value prop）
  allItems.value.set(id, currentElement.value.textContent ?? (props.value?.toString() ?? ''))

  const groupId = groupContext?.id
  if (groupId) {
    if (!allGroups.value.has(groupId)) {
      allGroups.value.set(groupId, new Set([id]))
    }
    else {
      allGroups.value.get(groupId)?.add(id)
    }
  }
})
onUnmounted(() => {
  allItems.value.delete(id)
})
</script>

<template>
  <ListboxItem
    v-if="isRender"
    v-bind="forwarded"
    :id="id"
    ref="itemRef"
    data-slot="command-item"
    :class="cn('data-highlighted:bg-muted data-highlighted:text-foreground data-highlighted:*:[svg]:text-foreground relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none in-data-[slot=dialog-content]:rounded-lg! [&_svg:not([class*=size-])]:size-4 group/command-item data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0', props.class)"
    @select="() => {
      filterState.search = ''
    }"
  >
    <slot />
    <CheckIcon class="ml-auto opacity-0 group-has-data-[slot=command-shortcut]/command-item:hidden group-data-[checked=true]/command-item:opacity-100" />
  </ListboxItem>
</template>
