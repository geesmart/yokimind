<template>
  <div class="min-h-screen bg-gray-50 px-8 py-6">
    <div class="mx-auto max-w-4xl">
      <div
        class="mb-4 flex items-center justify-between rounded-xl bg-white px-4 py-3 shadow-sm ring-1 ring-gray-100"
      >
        <div>
          <h1 class="text-sm font-semibold">编辑器测试页（无需登录）</h1>
          <p class="mt-0.5 text-xs text-muted-foreground">
            悬停块左侧手柄，验证 H1-H6 标题居中 / 其他块顶部对齐。可编辑、自动保存已关闭。
          </p>
        </div>
        <div class="flex items-center gap-2 text-xs">
          <span
            class="inline-flex items-center gap-1 rounded-full px-2 py-0.5"
            :class="editable ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'"
          >
            {{ editable ? '可编辑' : '已禁用' }}
          </span>
          <button
            class="rounded-lg border border-gray-200 px-3 py-1.5 hover:bg-gray-50"
            @click="editable = !editable"
          >
            切换编辑态
          </button>
        </div>
      </div>

      <div
        class="overflow-y-auto max-h-[80vh] rounded-xl bg-white px-8 py-6 shadow-sm ring-1 ring-gray-100"
      >
        <NotionEditor
          ref="editorRef"
          :editable="editable"
          :auto-save="false"
          :content="testContent"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watchEffect } from 'vue'
import NotionEditor from '@/components/notion-editor/index.vue'

const editable = ref(true)
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- 测试页专用，松散类型
const editorRef = ref<any>(null)

// dev 环境把编辑器实例挂到 window，便于控制台直接调试命令/选区（测试页专用）
if (import.meta.env.DEV) {
  watchEffect(() => {
    ;(window as unknown as { __editor?: unknown }).__editor = editorRef.value?.editor
  })
}

/**
 * 测试用编辑器内容：包含 H1-H6、段落、列表、引用，便于验证手柄在各类块上的对齐效果。
 */
const testContent = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: '一级标题 H1' }] },
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '二级标题 H2' }] },
    { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: '三级标题 H3' }] },
    { type: 'heading', attrs: { level: 4 }, content: [{ type: 'text', text: '四级标题 H4' }] },
    { type: 'heading', attrs: { level: 5 }, content: [{ type: 'text', text: '五级标题 H5' }] },
    { type: 'heading', attrs: { level: 6 }, content: [{ type: 'text', text: '六级标题 H6' }] },
    {
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: '这是一个普通段落，手柄应对齐顶部。这是一段较长的文本，用于测试段落的对齐效果。',
        },
      ],
    },
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: '无序列表项一' }] }],
        },
        {
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: '无序列表项二' }] }],
        },
      ],
    },
    {
      type: 'blockquote',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: '这是引用块，手柄应对齐顶部。' }] },
      ],
    },
  ],
}
</script>