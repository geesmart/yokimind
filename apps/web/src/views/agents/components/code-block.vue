<template>
  <!--
    轻量代码块组件（接入指引片段展示）
    - 等宽深色底 + 横向滚动 + 右上角复制按钮（悬停浮现）
    - 复制动作组件内完成（剪贴板 + toast），父级无需传 handler
  -->
  <div class="group relative overflow-hidden rounded-lg bg-zinc-950">
    <button
      class="absolute end-2 top-2 z-10 flex cursor-pointer items-center gap-1 rounded-md bg-zinc-800 px-2 py-1 text-[11px] text-zinc-300 transition-colors hover:bg-zinc-700 hover:text-white"
      aria-label="复制"
      @click="copy"
    >
      <Check v-if="copied" class="size-3 text-green-500" />
      <Copy v-else class="size-3" />
      {{ copied ? '已复制' : '复制' }}
    </button>
    <pre class="overflow-x-auto px-4 py-3 font-mono text-xs leading-relaxed text-zinc-100"><code>{{ code }}</code></pre>
  </div>
</template>

<script lang="ts" setup>
import { ref } from 'vue'
import { toast } from 'vue-sonner'
import { Check, Copy } from '@lucide/vue'

/**
 * Props
 * - code：代码文本（必传）
 */
const props = defineProps<{
  code: string
}>()

/** 复制成功反馈（按钮态短暂切换） */
const copied = ref(false)

/** 复制代码文本到剪贴板 */
async function copy() {
  try {
    await navigator.clipboard.writeText(props.code)
    copied.value = true
    setTimeout(() => (copied.value = false), 2000)
  } catch {
    toast.error('复制失败，请手动选择复制')
  }
}
</script>
