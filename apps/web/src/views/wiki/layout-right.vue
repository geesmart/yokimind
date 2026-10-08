<template>
  <aside class="flex flex-col h-full w-full bg-background min-w-0">
    <!-- 大纲列表（已迁移到编辑器内部，此组件保留备用） -->
    <div class="px-3 py-4 text-xs text-muted-foreground/60">
      大纲已集成到编辑器右侧
    </div>
  </aside>
</template>

<script lang="ts" setup>
/**
 * 组件 Props
 */
const props = withDefaults(
  defineProps<{
    /** 当前文档 ID（documents.id），保留以备将来恢复标签功能 */
    docId?: string
  }>(),
  {
    docId: '',
  }
)
</script>
