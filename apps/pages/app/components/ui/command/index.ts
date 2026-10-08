import type { Ref } from 'vue'
import { createContext } from 'reka-ui'

// 与 apps/web/src/components/ui/command/index.ts 保持同构（pages 独立副本，双份维护）
// 仅保留搜索弹窗用到的子集：Input/List/Group/Item/Empty + 过滤上下文

export { default as CommandEmpty } from './CommandEmpty.vue'
export { default as CommandGroup } from './CommandGroup.vue'
export { default as CommandInput } from './CommandInput.vue'
export { default as CommandItem } from './CommandItem.vue'
export { default as CommandList } from './CommandList.vue'

/**
 * Command 过滤上下文（自提供模式：弹窗组件直接 provideCommandContext，
 * 不经过 Command.vue 根组件——与 web 编辑器 searchbox 同款用法）
 * - allItems：全部已注册 CommandItem 的文本（id → textContent）
 * - allGroups：分组下挂的 item 集合（groupId → itemIds）
 * - filterState.search：当前搜索词；filtered：过滤后的可见集合与命中计数
 */
export const [useCommand, provideCommandContext] = createContext<{
  allItems: Ref<Map<string, string>>
  allGroups: Ref<Map<string, Set<string>>>
  filterState: {
    search: string
    filtered: { count: number, items: Map<string, number>, groups: Set<string> }
  }
}>('Command')

export const [useCommandGroup, provideCommandGroupContext] = createContext<{
  id?: string
}>('CommandGroup')
