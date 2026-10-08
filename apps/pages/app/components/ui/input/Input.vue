<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'

/**
 * 输入框组件（自 web 端移植）
 * 与 web 版差异：用 computed 双向绑定替代 @vueuse/core 的 useVModel，
 * 避免为单个组件引入额外依赖（pages 应用保持精简依赖）。
 */
const props = defineProps<{
  /** 非受控模式的默认值 */
  defaultValue?: string | number
  /** 受控值（v-model） */
  modelValue?: string | number
  /** 自定义 class */
  class?: HTMLAttributes['class']
}>()

const emits = defineEmits<{
  (e: 'update:modelValue', payload: string | number): void
}>()

// 双向绑定：优先受控 modelValue，未传时回退 defaultValue
const modelValue = computed({
  get: () => props.modelValue ?? props.defaultValue ?? '',
  set: (v) => emits('update:modelValue', v),
})
</script>

<template>
  <input
    v-model="modelValue"
    data-slot="input"
    :class="cn(
      'dark:bg-input/30 border-input focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:aria-invalid:border-destructive/50 disabled:bg-input/50 dark:disabled:bg-input/80 h-8 rounded-lg border bg-transparent px-2.5 py-1 text-base transition-colors file:h-6 file:text-sm file:font-medium focus-visible:ring-3 aria-invalid:ring-3 md:text-sm w-full min-w-0 outline-none file:inline-flex file:border-0 file:bg-transparent file:text-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
      props.class,
    )"
  >
</template>
