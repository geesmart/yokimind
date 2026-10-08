<template>
  <!--
    NotionLikeEditor：兼容旧接口的编辑器组件。
    内部直接复用新的 NotionEditor（src/components/notion-editor/index.vue），
    保持 canUndo / canRedo / undo / redo 的 expose 接口，
    使 wiki 页面（views/wiki/layout-main.vue）正常工作。
  -->
  <NotionEditor ref="notionEditorRef" v-model:editable="editable" class="h-full" />
</template>

<script lang="ts" setup>
import { ref, computed, type ComputedRef } from 'vue'
import NotionEditor from '@/components/notion-editor/index.vue'

const notionEditorRef = ref<InstanceType<typeof NotionEditor> | null>(null)
const editable = ref(true)

/**
 * 撤销/重做状态与方法，供 wiki 页面通过 ref 调用
 */
const canUndo: ComputedRef<boolean> = computed(() => notionEditorRef.value?.canUndo ?? false)
const canRedo: ComputedRef<boolean> = computed(() => notionEditorRef.value?.canRedo ?? false)

function undo() {
  notionEditorRef.value?.undo?.()
}

function redo() {
  notionEditorRef.value?.redo?.()
}

defineExpose({
  canUndo,
  canRedo,
  undo,
  redo,
})
</script>
