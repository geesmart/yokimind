<template>
  <!--
    脑图演示页（无需登录，纯前端内存数据）
    结构：全屏 VueFlow 画布 + 左上角标题/提示浮层 + 右上角工具条
    交互：Tab 添加子节点 / Enter 添加兄弟节点 / Delete 删除 / 双击编辑 / 按钮折叠展开
  -->
  <div class="relative h-screen w-screen overflow-hidden bg-background">
    <VueFlow
      :nodes="nodes"
      :edges="edges"
      :nodes-draggable="false"
      :nodes-connectable="false"
      :delete-key-code="null"
      fit-view-on-init
      :min-zoom="0.2"
      :max-zoom="2"
      class="h-full w-full"
      @node-click="onNodeClick"
      @pane-click="onPaneClick"
      @node-double-click="onNodeDoubleClick"
    >
      <!-- 注册自定义节点类型：type === 'mind' 的节点由此模板渲染 -->
      <template #node-mind="nodeProps">
        <MindNode
          :id="nodeProps.id"
          :data="nodeProps.data"
          :selected="nodeProps.selected"
          @commit="(label) => renameNode(nodeProps.id, label)"
          @cancel="cancelEdit(nodeProps.id)"
          @toggle="toggleCollapse(nodeProps.id)"
          @add="addChild(nodeProps.id)"
          @resize="(width) => resizeNode(nodeProps.id, width)"
        />
      </template>

      <!-- 点状网格背景 -->
      <Background :gap="20" pattern-color="var(--color-border, #d4d4d8)" />
      <!-- 小地图（右下角，可平移缩放） -->
      <MiniMap pannable zoomable />
    </VueFlow>

    <!-- 左上角：标题 + 操作提示 -->
    <div class="pointer-events-none absolute left-4 top-4 z-10 flex flex-col gap-1">
      <h1 class="text-sm font-semibold">脑图演示（VueFlow）</h1>
      <p class="text-xs text-muted-foreground">
        选中节点后：Tab 加子节点 · Enter 加兄弟节点 · Delete 删除 · 双击编辑文案
      </p>
    </div>

    <!-- 右上角：工具条 -->
    <div class="absolute right-4 top-4 z-10 flex items-center gap-2">
      <button
        class="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-3 py-1.5 text-xs shadow-sm transition-colors hover:bg-accent"
        @click="addChildOfSelected"
      >
        <Plus class="h-3.5 w-3.5" />
        子节点
      </button>
      <button
        class="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-3 py-1.5 text-xs shadow-sm transition-colors hover:bg-accent"
        @click="collapseAll"
      >
        <ChevronsDownUp class="h-3.5 w-3.5" />
        全部折叠
      </button>
      <button
        class="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-3 py-1.5 text-xs shadow-sm transition-colors hover:bg-accent"
        @click="expandAll"
      >
        <ChevronsUpDown class="h-3.5 w-3.5" />
        全部展开
      </button>
      <button
        class="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-3 py-1.5 text-xs shadow-sm transition-colors hover:bg-accent"
        @click="resetDemo"
      >
        <RotateCcw class="h-3.5 w-3.5" />
        重置示例
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import { VueFlow, useVueFlow } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { MiniMap } from '@vue-flow/minimap'
import type { NodeMouseEvent } from '@vue-flow/core'
import { ChevronsDownUp, ChevronsUpDown, Plus, RotateCcw } from '@lucide/vue'
import MindNode from './mind-node.vue'
import { useMindmap } from './use-mindmap'

// 引入 VueFlow 基础样式与默认主题
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'

// 脑图结构操作与键盘交互逻辑
const {
  selectedId,
  init,
  addChild,
  toggleCollapse,
  collapseAll,
  expandAll,
  renameNode,
  cancelEdit,
  startEdit,
  resizeNode,
  resetDemo,
  handleKeydown,
} = useMindmap()

// VueFlow 实例（用于读取模板绑定的响应式节点/边数据）
const { nodes, edges } = useVueFlow()

/** 点击节点：同步选中态到组合式函数（键盘操作的目标） */
function onNodeClick({ node }: NodeMouseEvent) {
  selectedId.value = node.id
}

/** 点击画布空白处：清除选中态 */
function onPaneClick() {
  selectedId.value = null
}

/** 双击节点：进入文案编辑态 */
function onNodeDoubleClick({ node }: NodeMouseEvent) {
  selectedId.value = node.id
  startEdit(node.id)
}

/** 工具条"子节点"按钮：为选中节点添加子节点（未选中时不操作，提示用键盘或先点选节点） */
function addChildOfSelected() {
  if (!selectedId.value) return
  addChild(selectedId.value)
}

/** window 级键盘监听：Tab/Enter/Delete 交给脑图逻辑，消费后阻止默认行为（如焦点跳转） */
function onKeydown(e: KeyboardEvent) {
  if (handleKeydown(e)) {
    e.preventDefault()
  }
}

onMounted(() => {
  init()
  window.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
})
</script>
