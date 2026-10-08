<template>
  <!--
    脑图自定义节点（VueFlow node type: 'mind'，XMind 风格）
    - 节点本身就是一个 input 框：平时只读（readonly，外观与普通文字一致），
      双击后同一个 input 变为可编辑（无元素切换、尺寸不跳变）
    - 左右各一个隐形 Handle，供父子连线（target 左 / source 右）
    - 选中态：蓝色选框包裹 + 左右拖拽手柄（仅水平拖动改宽度）
    - 悬停/选中时右侧显示圆形"+"按钮（添加子节点）；有子节点的节点右缘显示折叠按钮
  -->
  <div class="group relative flex items-center gap-1">
    <!-- 左侧目标连接点（隐形，仅用于连线锚定） -->
    <Handle type="target" :position="Position.Left" class="opacity-0!" />

    <!-- 选框容器：选中且未编辑时显示蓝色选框，左右手柄挂在其上 -->
    <div class="relative" :class="selected && !data.editing ? selectionBoxClass : ''">
      <!-- 节点 input：只读态 = 节点外观；编辑态 = 蓝框可输入 -->
      <input
        ref="inputRef"
        v-model="draft"
        class="outline-none"
        :class="inputClass"
        :style="inputStyle"
        :readonly="!data.editing"
        @click.stop
        @keydown.enter="onEnterKey"
        @keydown.tab.stop.prevent="onTabKey"
        @keydown.esc="onEscKey"
        @blur="onBlur"
      />

      <!-- 选中态左右拖拽手柄：只能水平拖动，改变节点宽度 -->
      <template v-if="selected">
        <span
          class="absolute -left-1.5 top-1/2 z-10 h-3 w-2.5 -translate-y-1/2 cursor-ew-resize rounded-[2px] border border-[#2563eb] bg-white"
          title="左右拖拽调整宽度"
          @pointerdown.stop.prevent="startResize($event, 'left')"
          @pointermove="onResizeMove"
          @pointerup="endResize"
          @pointercancel="endResize"
        />
        <span
          class="absolute -right-1.5 top-1/2 z-10 h-3 w-2.5 -translate-y-1/2 cursor-ew-resize rounded-[2px] border border-[#2563eb] bg-white"
          title="左右拖拽调整宽度"
          @pointerdown.stop.prevent="startResize($event, 'right')"
          @pointermove="onResizeMove"
          @pointerup="endResize"
          @pointercancel="endResize"
        />
      </template>
    </div>

    <!-- 折叠徽标：显示被折叠的后代数量（颜色随所属分支） -->
    <span
      v-if="data.collapsed && data.collapsedCount > 0"
      class="inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-semibold text-white"
      :style="{ backgroundColor: data.color ?? '#7c3aed' }"
    >
      +{{ data.collapsedCount }}
    </span>

    <!-- 折叠/展开切换按钮：蓝色圆形，叠放在节点右缘连线出发点上（XMind 样式）
         仅在有子节点时渲染；展开时显示白色"−"，折叠时显示白色"+"；悬停显示，折叠后常显 -->
    <button
      v-if="data.hasChildren"
      class="absolute -right-3.5 top-1/2 z-10 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full bg-[#2563eb] text-white shadow-md ring-2 ring-white transition-opacity hover:bg-[#1d4ed8]"
      :class="data.collapsed ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'"
      :title="data.collapsed ? '展开子节点' : '折叠子节点'"
      @click.stop="emit('toggle')"
    >
      <Minus v-if="!data.collapsed" class="h-3.5 w-3.5" />
      <Plus v-else class="h-3.5 w-3.5" />
    </button>

    <!-- 悬停/选中显示的圆形"+"按钮：添加子节点（位于折叠按钮右侧，不占布局） -->
    <button
      class="absolute -right-13 top-1/2 z-10 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-white text-[#2563eb] shadow-md ring-1 ring-[#2563eb]/20 transition-opacity hover:shadow-lg"
      :class="selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'"
      title="添加子节点"
      @click.stop="emit('add')"
    >
      <Plus class="h-4 w-4" />
    </button>

    <!-- 右侧来源连接点（隐形，仅用于连线锚定） -->
    <Handle type="source" :position="Position.Right" class="opacity-0!" />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { Minus, Plus } from '@lucide/vue'

/** 节点数据（由 use-mindmap.ts 的 rebuildFlow 写入） */
interface MindNodeData {
  label: string
  /** 层级：根为 0，用于区分样式 */
  level: number
  collapsed: boolean
  /** 折叠时被隐藏的后代数量（徽标 +N） */
  collapsedCount: number
  /** 是否处于编辑态（readonly ↔ 可编辑切换） */
  editing: boolean
  isRoot: boolean
  /** 是否有子节点（决定折叠按钮是否渲染） */
  hasChildren: boolean
  /** 所属主分支颜色（根节点为 null） */
  color: string | null
  /** 拖拽设置的固定宽度（px，null = 按文字自适应） */
  width: number | null
}

const props = defineProps<{
  id: string
  data: MindNodeData
  selected?: boolean
}>()

const emit = defineEmits<{
  /** 提交文案（Enter/失焦） */
  commit: [label: string]
  /** 取消编辑（Esc） */
  cancel: []
  /** 切换折叠/展开 */
  toggle: []
  /** 添加子节点（圆形"+"按钮 / 编辑态 Tab） */
  add: []
  /** 拖拽左右手柄结束，提交新宽度 */
  resize: [width: number]
}>()

const inputRef = ref<HTMLInputElement | null>(null)
/** input 绑定值：未编辑时与 label 保持同步 */
const draft = ref(props.data.label)

// 未编辑时跟随外部 label 变化（重命名/重置示例等）
watch(
  () => props.data.label,
  (label) => {
    if (!props.data.editing) draft.value = label
  },
)

// 编辑态切换时同步草稿：进入编辑取当前文案，取消编辑回退为 label（丢弃未提交输入）
watch(
  () => props.data.editing,
  (editing) => {
    if (editing) {
      void nextTick(() => {
        inputRef.value?.focus()
        inputRef.value?.select()
      })
    } else {
      draft.value = props.data.label
    }
  },
)

/** 提交草稿（清空首尾空白，空文案回退"新节点"由 renameNode 兜底） */
function commitDraft() {
  emit('commit', draft.value)
}

/** Enter：编辑态提交并退出编辑；只读态不拦截（冒泡给全局快捷键 = 添加兄弟节点） */
function onEnterKey(e: KeyboardEvent) {
  if (props.data.editing) {
    e.preventDefault()
    commitDraft()
  }
}

/** Tab：编辑态先提交再添加子节点；只读态同样直接添加子节点（对齐 XMind） */
function onTabKey() {
  if (props.data.editing) commitDraft()
  emit('add')
}

/** Esc：仅编辑态取消（只读态冒泡给全局，无对应快捷键） */
function onEscKey(e: KeyboardEvent) {
  if (props.data.editing) {
    e.preventDefault()
    e.stopPropagation()
    emit('cancel')
  }
}

/** 失焦：编辑态提交（只读态草稿与 label 一致，提交无副作用） */
function onBlur() {
  if (props.data.editing) commitDraft()
}

/** 拖拽中的临时状态：起始指针 x、起始宽度、拖拽方向 */
let resizeState: { startX: number; startWidth: number; side: 'left' | 'right' } | null = null
/** 拖拽预览宽度（本地即时生效，pointerup 时才提交，避免重建打断拖拽） */
const dragWidth = ref<number | null>(null)

/** 开始拖拽：记录起点并捕获指针（后续 move/up 即使移出元素也能收到） */
function startResize(e: PointerEvent, side: 'left' | 'right') {
  // 起始宽度优先取已设置的固定宽度，否则以选框容器当前渲染宽度为起点
  const startWidth = props.data.width ?? (e.currentTarget as HTMLElement).parentElement!.getBoundingClientRect().width
  resizeState = { startX: e.clientX, startWidth, side }
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
}

/** 拖拽中：只做水平方向位移换算宽度（左柄向左拖=变宽，右柄向右拖=变宽） */
function onResizeMove(e: PointerEvent) {
  if (!resizeState) return
  const dx = e.clientX - resizeState.startX
  const raw = resizeState.side === 'right' ? resizeState.startWidth + dx : resizeState.startWidth - dx
  dragWidth.value = Math.max(Math.round(raw), 60)
}

/** 结束拖拽：提交最终宽度，清除预览状态 */
function endResize() {
  if (!resizeState) return
  resizeState = null
  if (dragWidth.value != null) {
    emit('resize', dragWidth.value)
    dragWidth.value = null
  }
}

/** 选中态选框：包住 input 的蓝色边框容器 */
const selectionBoxClass = 'border-2 border-[#2563eb] rounded-[4px] px-1.5 py-0.5 -mx-2 -my-1'

/**
 * input 外观：与各层级文字样式保持一致
 * - 只读态：根 = 紫描边胶囊；分支/子级 = 无边框透明背景（看起来就是纯文字）
 * - 编辑态：描边变蓝（根保持胶囊），文字节点补边框并用负边距抵消占位变化
 */
const inputClass = computed(() => {
  if (props.data.isRoot) {
    const pill = 'rounded-full border-[3px] bg-white px-8 py-3 text-2xl font-bold text-foreground shadow-sm'
    return `${pill} ${props.data.editing ? 'border-[#2563eb]' : 'border-[#7c3aed]'}`
  }
  const font = props.data.level === 1 ? 'text-lg font-medium text-foreground/85' : 'text-sm text-foreground/75'
  if (props.data.editing) {
    return `rounded-[4px] border-2 border-[#2563eb] bg-white px-1.5 py-0.5 -mx-2 -my-1 ${font}`
  }
  return `border-0 bg-transparent px-0 py-0 ${font}`
})

/** input 宽度：固定宽度（拖拽设置/拖拽预览）优先，否则随文字长度自适应（em 随字号缩放） */
const inputStyle = computed(() => {
  if (props.data.width || dragWidth.value) {
    return { width: `${dragWidth.value ?? props.data.width}px` }
  }
  const text = props.data.editing ? draft.value : props.data.label
  return { width: `${Math.max(text.length, 4) + 0.5}em` }
})
</script>
