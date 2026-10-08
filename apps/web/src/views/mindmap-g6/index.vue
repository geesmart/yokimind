<template>
  <!--
    脑图演示页（G6 版，无需登录，纯前端内存数据）
    结构：全屏 G6 画布 + 左上角标题/提示浮层 + 右上角缩放工具条 + 双击编辑浮层
    交互：拖拽平移 / 滚轮缩放 / 点击选中 / 双击编辑文案 / 按钮缩放与适应画布
  -->
  <div class="relative h-screen w-screen overflow-hidden bg-background">
    <!-- G6 画布挂载点（autoResize 跟随容器尺寸） -->
    <div ref="containerRef" class="h-full w-full" />

    <!-- 左上角：标题 + 操作提示 -->
    <div class="pointer-events-none absolute left-4 top-4 z-10 flex flex-col gap-1">
      <h1 class="text-sm font-semibold">脑图演示（AntV G6）</h1>
      <p class="text-xs text-muted-foreground">
        拖拽平移 · 滚轮缩放 · 点击选中 · 双击编辑 · 拖动节点到目标上改变层级 · 拖动根节点整体移动
      </p>
    </div>

    <!-- 右上角：缩放工具条 -->
    <div class="absolute right-4 top-4 z-10 flex items-center gap-2">
      <button
        class="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-3 py-1.5 text-xs shadow-sm transition-colors hover:bg-accent"
        title="放大"
        @click="zoomIn"
      >
        <ZoomIn class="h-3.5 w-3.5" />
      </button>
      <button
        class="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-3 py-1.5 text-xs shadow-sm transition-colors hover:bg-accent"
        title="缩小"
        @click="zoomOut"
      >
        <ZoomOut class="h-3.5 w-3.5" />
      </button>
      <button
        class="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-3 py-1.5 text-xs shadow-sm transition-colors hover:bg-accent"
        title="适应画布"
        @click="fitView"
      >
        <Maximize class="h-3.5 w-3.5" />
      </button>
    </div>

    <!-- 选中框：设计工具式蓝色选择框 + 左右两个宽度手柄（节点本身样式不变）
         跟随画布缩放/平移；编辑中/拖动中隐藏；拖动手柄可调整节点宽度 -->
    <div
      v-if="selectedId && !editing && !dragId"
      class="pointer-events-none fixed z-10 border-2 border-blue-500"
      :style="selectedFrameStyle"
    >
      <!-- 左右宽度手柄：白色小方块 + 蓝色描边，按住左右拖动调整节点宽度 -->
      <span
        class="pointer-events-auto absolute -left-1 top-1/2 -mt-1 h-2 w-2 cursor-ew-resize rounded-[2px] border border-blue-500 bg-card"
        @mousedown.stop.prevent="startResize($event, selectedId, 'left')"
      />
      <span
        class="pointer-events-auto absolute -right-1 top-1/2 -mt-1 h-2 w-2 cursor-ew-resize rounded-[2px] border border-blue-500 bg-card"
        @mousedown.stop.prevent="startResize($event, selectedId, 'right')"
      />
    </div>

    <!-- 拖拽落点提示框：拖动节点悬停在目标节点上时显示的橙色虚线框（XMind 式占位提示）
         松手后拖拽节点将变为该节点的子节点，并重跑布局对齐 -->
    <div
      v-if="dropTargetId"
      class="pointer-events-none fixed z-10 rounded-lg border-2 border-dashed border-amber-500"
      :style="dropFrameStyle"
    />

    <!-- 原位编辑浮层：双击后覆盖在节点正上方，外观即"节点变成输入框"（对齐 XMind 体验）
         Enter/失焦提交，Esc 取消；尺寸随文案自适应，画布缩放/平移时实时跟随节点 -->
    <input
      v-if="editing"
      ref="editInputRef"
      v-model="editing.label"
      class="fixed z-20 border-2 bg-card text-center shadow-lg outline-none"
      :style="editBoxStyle"
      @keydown.enter.prevent="commitEdit"
      @keydown.esc.prevent="cancelEdit"
      @blur="commitEdit"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { CompactBoxLayout, Graph } from '@antv/g6'
import type { EdgeData, GraphData, IElementEvent, NodeData } from '@antv/g6'
import { Maximize, ZoomIn, ZoomOut } from '@lucide/vue'

/**
 * G6 节点自定义数据字段（挂在 datum.data 上，供样式函数与布局访问器读取）
 * G6 的 data 类型是 Record<string, unknown>，读取时统一通过 asRaw 安全断言
 */
interface MindRaw {
  label: string
  /** 层级：根为 0 */
  level: number
  /** 所属主分支颜色（一级分支分配调色板，子级沿用父分支颜色） */
  color: string
  /** 自定义宽度（拖拽宽度手柄调整后持久化；缺省按文案估算） */
  w?: number
}

/** 边自定义数据字段（边样式函数据此着色） */
interface EdgeRaw {
  color: string
  /** 子节点层级（根到一级分支的连线更粗） */
  level: number
}

/** Record<string, unknown> → 业务字段的安全断言（数据由本页自行构造，结构可控） */
function asRaw<T extends object>(data: Record<string, unknown> | undefined): T {
  return (data ?? {}) as unknown as T
}

/** 自增序号 + 随机串，保证演示页内 id 唯一（无需 ULID，纯前端内存数据） */
let idSeed = 0
function genId(): string {
  idSeed += 1
  return `g6-${idSeed}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * 一级分支专属配色（XMind 风格：每条主分支一种颜色，子级沿用父分支颜色）
 * 顺序：紫 / 蓝 / 绿 / 橙 / 红 / 粉
 */
const BRANCH_PALETTE = ['#7c3aed', '#2563eb', '#10b981', '#f59e0b', '#ef4444', '#ec4899']

/** 按层级取节点高度（px）：与节点渲染样式保持一致，供布局计算 */
function nodeHeight(level: number): number {
  if (level === 0) return 56 // 根节点：大号胶囊
  if (level === 1) return 42 // 一级分支：中号胶囊
  return 32 // 更深层级：小号胶囊
}

/** 按层级取字号（px）：与节点渲染样式保持一致 */
function fontOf(level: number): number {
  if (level === 0) return 18
  if (level === 1) return 15
  return 13
}

/** 按层级取文字两侧内边距（px） */
function padOf(level: number): number {
  if (level === 0) return 56
  if (level === 1) return 32
  return 24
}

/** 估算文案宽度（px）：CJK 字符约等于 1 个字号宽度，其余按 0.6 倍估算 */
function textWidth(label: string, fontSize: number): number {
  let w = 0
  for (const ch of label) {
    w += /[\u2e80-\u9fff\uf900-\ufdff\uff00-\uffef]/.test(ch) ? fontSize : fontSize * 0.6
  }
  return w
}

/** 相邻层级水平间隙（px）：G6 布局配置与列对齐计算共用同一常量 */
const HGAP = 56

/** 节点总宽度 = 文案宽度 + 两侧内边距，最小 60px */
function nodeWidth(label: string, level: number): number {
  return Math.max(Math.round(textWidth(label, fontOf(level))) + padOf(level), 60)
}

/** 节点实际宽度：自定义 w 优先（拖拽宽度手柄调整过），否则按文案估算 */
function widthOf(raw: MindRaw): number {
  return raw.w ?? nodeWidth(raw.label, raw.level)
}

/** 示例数据的源树片段：label + 子节点（children 缺省表示叶子） */
interface DemoSeed {
  label: string
  children?: DemoSeed[]
}

/** 示例数据：中心主题 + 多条分支主题，其一含两层子主题 */
const DEMO_SEED: DemoSeed = {
  label: '中心主题',
  children: [
    {
      label: '分支主题',
      children: [
        { label: '子主题', children: [{ label: '孙主题' }] },
        { label: '子主题' },
      ],
    },
    { label: '分支主题', children: [{ label: '子主题' }] },
    { label: '分支主题' },
    { label: '分支主题' },
    { label: '分支主题' },
    { label: '分支主题' },
  ],
}

/** 带稳定 id 的脑图树节点（拖拽改层级时直接修改这棵树，再重建图数据） */
interface MindTreeNode {
  id: string
  label: string
  /** 自定义宽度（宽度手柄调整后回写，重建图数据时保留） */
  w?: number
  children?: MindTreeNode[]
}

/** 给示例树深拷贝并分配稳定 id（id 只在树里改层级时复用，重建图数据不再重新生成） */
function toTree(seed: DemoSeed): MindTreeNode {
  return {
    id: genId(),
    label: seed.label,
    children: seed.children?.map((c) => toTree(c)),
  }
}

/** 在树中按 id 查找节点（返回节点本身） */
function findNode(root: MindTreeNode, id: string): MindTreeNode | null {
  if (root.id === id) return root
  for (const child of root.children ?? []) {
    const hit = findNode(child, id)
    if (hit) return hit
  }
  return null
}

/** 在树中按 id 查找节点的父节点（根节点返回 null） */
function findParent(root: MindTreeNode, id: string): MindTreeNode | null {
  for (const child of root.children ?? []) {
    if (child.id === id) return root
    const hit = findParent(child, id)
    if (hit) return hit
  }
  return null
}

/** 判断 id 是否位于 node 的子树内（含自身，用于禁止把节点拖进自己的子树） */
function containsNode(node: MindTreeNode, id: string): boolean {
  if (node.id === id) return true
  return (node.children ?? []).some((c) => containsNode(c, id))
}

/**
 * 由脑图树构造 G6 图数据
 * G6 v5 的 data 为扁平结构：nodes 数组 + edges 数组（树布局会根据 edges 建立层级关系）
 * 递归分配层级 / 分支颜色：一级分支按序取调色板，子级沿用父分支颜色；id 沿用树节点的稳定 id
 */
function buildGraphData(root: MindTreeNode): GraphData {
  const nodes: NodeData[] = []
  const edges: EdgeData[] = []
  /** 一级分支序号（用于轮转调色板，跨分支递增） */
  let branchIndex = 0

  /** 递归构造：level 为层级，color 为分支色，parentId 为父节点 id（根为空） */
  const walk = (s: MindTreeNode, level: number, color: string, parentId?: string): string => {
    nodes.push({ id: s.id, data: { label: s.label, level, color, w: s.w } as unknown as Record<string, unknown> })
    if (parentId) {
      // 父子边自带分支色与层级，供边样式函数读取
      // 显式 id（source->target）：换层级时用增量 API 删旧边/加新边需要按 id 定位
      edges.push({
        id: `${parentId}->${s.id}`,
        source: parentId,
        target: s.id,
        data: { color, level } as unknown as Record<string, unknown>,
      })
    }
    s.children?.forEach((child) => {
      // 一级分支按序分配专属颜色，更深层级沿用父分支颜色
      const childColor = level === 0 ? BRANCH_PALETTE[branchIndex++ % BRANCH_PALETTE.length] : color
      walk(child, level + 1, childColor, s.id)
    })
    return s.id
  }

  walk(root, 0, '#6d28d9')
  return { nodes, edges }
}

/** 独立布局结果节点（@antv/hierarchy compactBox 的返回结构子集） */
interface LayoutResultNode {
  id: string
  x: number
  y: number
  children?: LayoutResultNode[]
}

/**
 * 独立跑一遍紧凑盒布局（参数与 Graph 配置的 layout 完全一致），返回 id → 坐标映射
 * rootAnchor：用根节点的真实画布位置做锚点平移 —— G6 内部跑布局时会按视野做整体居中偏移，
 * 把独立布局结果平移到根节点实际所在处，坐标系即与画布一致
 * 用途：换层级时自行计算新布局位置，只平移位置真正变化的节点，避免整图 render 刷新
 */
function computeLayoutPositions(t: MindTreeNode, rootAnchor: [number, number]): Map<string, [number, number]> {
  // 转成 @antv/hierarchy 需要的嵌套结构：数据挂在 data 字段上（与 G6 传给布局访问器的节点结构一致）
  const toDatum = (node: MindTreeNode, level: number): { id: string; data: Record<string, unknown>; children?: unknown[] } => ({
    id: node.id,
    data: { label: node.label, level, w: node.w },
    children: node.children?.map((c) => toDatum(c, level + 1)),
  })
  const result = CompactBoxLayout(toDatum(t, 0) as never, {
    direction: 'LR',
    getWidth: (d: { data: unknown }) => widthOf(asRaw<MindRaw>(d.data as Record<string, unknown>)),
    getHeight: (d: { data: unknown }) => nodeHeight(asRaw<MindRaw>(d.data as Record<string, unknown>).level),
    getVGap: () => 18,
    getHGap: () => HGAP,
  }) as unknown as LayoutResultNode

  const dx = rootAnchor[0] - result.x
  const dy = rootAnchor[1] - result.y
  // 节点层级/宽度直接从树收集（布局结果节点的 .data 是整个输入 datum，
  // 业务字段在 .data.data 里，直接读容易踩坑，这里绕开它）
  const infoById = new Map<string, { level: number; w: number }>()
  const collectInfo = (node: MindTreeNode, level: number) => {
    infoById.set(node.id, { level, w: node.w ?? nodeWidth(node.label, level) })
    node.children?.forEach((c) => collectInfo(c, level + 1))
  }
  collectInfo(t, 0)

  // 第一遍：收集 compact-box 的原始位置（y 保留布局结果，x 待列对齐覆盖）
  const placed = new Map<string, { x: number; y: number; level: number; w: number }>()
  const walk = (n: LayoutResultNode) => {
    const info = infoById.get(n.id)
    if (info) placed.set(n.id, { x: n.x + dx, y: n.y + dy, level: info.level, w: info.w })
    n.children?.forEach(walk)
  }
  walk(result)

  // 第二遍：列对齐（XMind 式）——compact-box 里子节点 x 依赖父节点宽度，同层左缘会参差不齐；
  // 这里按「每层取该层最大节点宽，逐层向右推导列左缘」重算 x，让同层所有节点左缘落在同一垂直线上
  const maxWByLevel = new Map<number, number>()
  for (const p of placed.values()) {
    maxWByLevel.set(p.level, Math.max(maxWByLevel.get(p.level) ?? 0, p.w))
  }
  const leftByLevel = new Map<number, number>()
  const rootP = placed.get(t.id)!
  leftByLevel.set(0, rootP.x - rootP.w / 2) // 根列左缘由根节点实际位置推出（根节点不动）
  for (let lv = 1; maxWByLevel.has(lv); lv++) {
    leftByLevel.set(lv, (leftByLevel.get(lv - 1) ?? 0) + (maxWByLevel.get(lv - 1) ?? 0) + HGAP)
  }

  const positions = new Map<string, [number, number]>()
  for (const [id, p] of placed) {
    const left = leftByLevel.get(p.level) ?? p.x - p.w / 2
    positions.set(id, [left + p.w / 2, p.y])
  }
  return positions
}

/** 页面组件状态 */
const containerRef = ref<HTMLDivElement | null>(null)
const editInputRef = ref<HTMLInputElement | null>(null)
/** 脑图树数据（响应式持有）：拖拽改层级时修改这棵树，再重建图数据 + 重跑布局 */
const tree = ref<MindTreeNode>(toTree(DEMO_SEED))
/** 当前编辑中的节点（null = 未在编辑；label 为输入框实时内容；baseW 为进入编辑时的节点宽度） */
const editing = ref<{ id: string; label: string; level: number; color: string; baseW: number } | null>(null)
/** 视口变化计数器：编辑期间缩放/平移画布时强制重算编辑框位置 */
const viewportTick = ref(0)
/** 当前选中（单击）的节点 id（null = 未选中），选中框覆盖层据此渲染 */
const selectedId = ref<string | null>(null)
/** 正在被拖拽的节点 id（null = 未在拖拽；根节点不允许拖拽） */
const dragId = ref<string | null>(null)
/** 拖拽悬停的落点目标节点 id（null = 无目标）：拖拽节点变为该节点的子节点 */
const dropTargetId = ref<string | null>(null)
/** 正在用宽度手柄调整宽度的节点（记录节点 id 与被拖动的边），null = 未在调整 */
const resizing = ref<{ id: string; edge: 'left' | 'right' } | null>(null)

/** 按层级取节点圆角半径（px）：与节点渲染样式保持一致 */
function radiusOf(level: number): number {
  if (level === 0) return 28
  if (level === 1) return 12
  return 8
}

/**
 * 编辑框样式：左缘锚定在节点原左缘，宽度随输入文案向右扩展（XMind 的编辑体验）
 * 高度/圆角/字号随画布缩放比例缩放，画布缩放/平移时实时跟随节点
 */
const editBoxStyle = computed(() => {
  void viewportTick.value // 依赖视口变化计数：缩放/平移时重新计算位置
  if (!editing.value || !graph) return {}
  const { id, label, level, color, baseW } = editing.value
  const zoom = graph.getZoom()
  // 宽度取 max(节点当前宽度, 文案估算宽度)：不小于节点原宽，文案变长时向右扩展
  const w = Math.max(baseW * zoom, nodeWidth(label, level) * zoom, 60 * zoom)
  const h = nodeHeight(level) * zoom
  // 节点中心（画布坐标）→ 客户端坐标（换算含缩放与平移）
  const [cx, cy] = graph.getElementPosition(id)
  const [px, py] = graph.getClientByCanvas([cx, cy])
  return {
    // 左缘固定：节点中心 - 进入编辑时的节点宽度一半，宽度增长全部向右扩展
    left: `${px - (baseW * zoom) / 2}px`,
    top: `${py - h / 2}px`,
    width: `${w}px`,
    height: `${h}px`,
    fontSize: `${fontOf(level) * zoom}px`,
    fontWeight: level <= 1 ? 600 : 400,
    borderRadius: `${radiusOf(level) * zoom}px`,
    // 边框用分支色，视觉上延续节点的配色身份
    borderColor: color,
  }
})

/**
 * 通用：以节点为中心的外扩框样式（客户端坐标，随画布缩放/平移/节点拖动实时跟随）
 * 选中框与拖拽落点虚线框共用此定位逻辑，只是外观（实线/虚线、是否带手柄）不同
 */
function frameStyleOf(id: string): Record<string, string> {
  if (!graph) return {}
  const raw = asRaw<MindRaw>(graph.getNodeData(id).data)
  const zoom = graph.getZoom()
  const w = widthOf(raw) * zoom
  const h = nodeHeight(raw.level) * zoom
  const pad = 4 * zoom // 框与节点之间的间距
  // 节点中心（画布坐标）→ 客户端坐标（换算含缩放与平移）
  const [cx, cy] = graph.getElementPosition(id)
  const [px, py] = graph.getClientByCanvas([cx, cy])
  return {
    left: `${px - w / 2 - pad}px`,
    top: `${py - h / 2 - pad}px`,
    width: `${w + pad * 2}px`,
    height: `${h + pad * 2}px`,
    borderRadius: `${(radiusOf(raw.level) + 4) * zoom}px`,
  }
}

/**
 * 选中框样式：设计工具式蓝色实线框
 * 位置随画布缩放/平移实时跟随节点（依赖 viewportTick 重算）
 */
const selectedFrameStyle = computed(() => {
  void viewportTick.value // 依赖视口变化计数：缩放/平移时重新计算位置
  if (!selectedId.value) return {}
  return frameStyleOf(selectedId.value)
})

/**
 * 拖拽落点虚线框样式：橙色虚线框套在悬停目标节点上
 * 拖动过程中 node:drag 持续 bump viewportTick，保证实时跟随
 */
const dropFrameStyle = computed(() => {
  void viewportTick.value // 依赖视口变化计数：拖动时重新计算位置
  if (!dropTargetId.value) return {}
  return frameStyleOf(dropTargetId.value)
})

/** G6 实例（非响应式，生命周期内持有，卸载时 destroy） */
let graph: Graph | null = null

/** 画布初始化：构建 G6 Graph 并首次渲染 */
function initGraph() {
  if (!containerRef.value) return

  graph = new Graph({
    container: containerRef.value,
    // 不配置 autoFit：它会在每次 render() 后重复生效（拖拽结束重跑布局时视野会被强制重置）
    // 首次渲染后手动 fitView 一次即可，见 initGraph 末尾
    padding: 60,
    // 启用动画：布局、缩放、状态切换有过渡效果
    animation: true,
    data: buildGraphData(tree.value),
    // 树形布局：compact-box 紧凑盒布局，根在左、向右展开（经典 XMind 逻辑图方向）
    // getWidth/getHeight 与节点渲染尺寸一致，避免节点重叠
    layout: {
      type: 'compact-box',
      direction: 'LR',
        getWidth: (d: NodeData) => widthOf(asRaw<MindRaw>(d.data)),
      getHeight: (d: NodeData) => nodeHeight(asRaw<MindRaw>(d.data).level),
      // 同级垂直间隙 / 相邻层级水平间隙
      getVGap: () => 18,
      getHGap: () => HGAP,
    },
    node: {
      type: 'rect',
      // 样式按节点数据动态计算：层级决定尺寸/字号，分支色决定配色
      style: (d: NodeData) => {
        const raw = asRaw<MindRaw>(d.data)
        const w = widthOf(raw)
        const h = nodeHeight(raw.level)
        return {
          size: [w, h],
          // 连接桩：不设 r 即为"点型连接桩"，不在画布上显示但可连接
          // right = 右侧中点（出边起点），left = 左侧中点（入边终点）
          ports: [
            { key: 'right', placement: [1, 0.5] },
            { key: 'left', placement: [0, 0.5] },
          ],
          // 根节点大圆角胶囊，一级分支中圆角，更深层级小圆角
          radius: radiusOf(raw.level),
          // 根节点深色实底；一级分支用分支色实底；更深层级淡色底 + 分支色描边
          fill: raw.level === 0 ? '#312e81' : raw.level === 1 ? raw.color : `${raw.color}1f`,
          stroke: raw.level >= 2 ? raw.color : 'transparent',
          lineWidth: 1,
          labelText: editing.value?.id === d.id ? '' : raw.label,
          labelPlacement: 'center',
          labelFontSize: fontOf(raw.level),
          labelFontWeight: raw.level <= 1 ? 600 : 400,
          // 根节点与一级分支用白色文字，更深层级用深灰文字
          labelFill: raw.level <= 1 ? '#ffffff' : '#334155',
          cursor: 'pointer',
        }
      },
    },
    edge: {
      // 水平三次贝塞尔曲线：从父节点右侧平滑过渡到子节点左侧
      type: 'cubic-horizontal',
      style: (d: EdgeData) => {
        const raw = asRaw<EdgeRaw>(d.data)
        return {
          // 统一从父节点右侧中点出发、到达子节点左侧中点
          // （XMind 风格：同一节点的所有分支线从同一个点发散，而不是散落在节点边缘）
          sourcePort: 'right',
          targetPort: 'left',
          stroke: raw.color ?? '#94a3b8',
          // 根到一级分支的连线更粗，突出主干
          lineWidth: (raw.level ?? 2) <= 1 ? 4 : 2.5,
          endArrow: false,
        }
      },
    },
    // 内置交互：拖拽平移画布 / 滚轮缩放 / 拖动节点（根节点除外：拖根节点 = 平移整个画布内容）
    behaviors: [
      'drag-canvas',
      'zoom-canvas',
      {
        type: 'drag-element',
        enable: (event: IElementEvent) => String(event.target?.id ?? '') !== tree.value.id,
      },
    ],
  })

  // 单击节点：显示选中框；单击画布空白处：取消选中
  graph.on('node:click', (e: IElementEvent) => {
    const id = e.target?.id
    if (id) selectedId.value = id
  })
  graph.on('canvas:click', () => {
    selectedId.value = null
  })

  // 根节点拖拽标记：拖根节点 = 平移整个画布内容（所有节点一起移动）
  let rootDragging = false
  /** 被拖节点在拖拽开始时的画布位置：未改层级时用它把节点平移回原位（避免整体刷新画布） */
  let dragStartPos: [number, number] = [0, 0]

  // 拖动中：根节点 → 平移整个画布；非根节点 → bump 计数器让选中框/编辑框跟随节点
  graph.on('node:drag', (e: IElementEvent) => {
    if (rootDragging && graph) {
      // 位移取 pointer movement（与 drag-canvas 一致，客户端像素，无需除以缩放）
      const m = (e as unknown as { movement?: { x?: number; y?: number } }).movement
      const dx = m?.x ?? (e as unknown as { dx?: number }).dx ?? 0
      const dy = m?.y ?? (e as unknown as { dy?: number }).dy ?? 0
      void graph.translateBy([dx, dy], false)
    }
    viewportTick.value += 1
  })

  // 拖拽开始：根节点标记整体平移（drag-element 已通过 enable 排除根节点）；其余记录被拖节点
  graph.on('node:dragstart', (e: IElementEvent) => {
    const id = e.target?.id
    if (!id || !graph) return
    if (id === tree.value.id) {
      rootDragging = true
      return
    }
    dragId.value = id
    dropTargetId.value = null
    // 记录拖拽开始时的画布位置（即布局位置），未改层级时据此把节点平移回原位
    const [cx, cy] = graph.getElementPosition(id)
    dragStartPos = [cx, cy]
  })

  // 拖拽中：指针悬停在哪个节点上，就把哪个节点标记为落点目标（显示橙色虚线框）
  graph.on('node:drag', (e: IElementEvent) => {
    if (!graph || !dragId.value) return
    // 指针位置（客户端坐标）逐节点做矩形命中测试
    const cx = e.client.x
    const cy = e.client.y
    const zoom = graph.getZoom()
    const draggedNode = findNode(tree.value, dragId.value)
    let target: string | null = null
    for (const d of graph.getNodeData()) {
      const nid = String(d.id)
      // 跳过自己与自己的子孙（不能拖进自己的子树）
      if (nid === dragId.value) continue
      if (draggedNode && containsNode(draggedNode, nid)) continue
      const raw = asRaw<MindRaw>(d.data)
      const [ecx, ecy] = graph.getElementPosition(nid)
      const [px, py] = graph.getClientByCanvas([ecx, ecy])
      if (
        Math.abs(cx - px) <= (nodeWidth(raw.label, raw.level) * zoom) / 2 &&
        Math.abs(cy - py) <= (nodeHeight(raw.level) * zoom) / 2
      ) {
        target = nid
        break
      }
    }
    dropTargetId.value = target
  })

  // 拖拽结束：真正换了父级 → 外科手术式更新（不整图刷新）；未换层级 → 只把被拖节点移回原位
  graph.on('node:dragend', () => {
    const dragged = dragId.value
    const target = dropTargetId.value
    const wasRootDrag = rootDragging
    dragId.value = null
    dropTargetId.value = null
    rootDragging = false
    if (!graph) return

    if (dragged && target) {
      const draggedNode = findNode(tree.value, dragged)
      const oldParent = findParent(tree.value, dragged)
      const targetNode = findNode(tree.value, target)
      // 只有目标 != 当前父节点才算真换层级（拖回自己父节点上 = 无变化，走下面的回位逻辑）
      if (draggedNode && targetNode && oldParent?.children && targetNode !== oldParent) {
        // 1) 变更前快照：各节点当前画布位置 + 规范布局位置（根节点锚定，坐标系与画布一致）
        const liveBefore = new Map<string, [number, number]>()
        for (const d of graph.getNodeData()) {
          const [cx, cy] = graph.getElementPosition(String(d.id))
          liveBefore.set(String(d.id), [cx, cy])
        }
        const rootPos = liveBefore.get(tree.value.id) ?? [0, 0]
        const canonicalBefore = computeLayoutPositions(tree.value, rootPos as [number, number])

        // 2) 改树：从原父节点移除，挂到目标节点的子节点末尾（挂在根节点下 = 变成一级分支）
        oldParent.children = oldParent.children.filter((c) => c.id !== dragged)
        targetNode.children = [...(targetNode.children ?? []), draggedNode]

        // 3) 变更后规范布局位置（根节点不动，锚点沿用）
        const canonicalAfter = computeLayoutPositions(tree.value, rootPos as [number, number])

        // 4) 目标位置 = 新规范位置 + 旧偏差（保留宽度手柄等造成的自定义偏移）
        //    未受影响的分支规范位置不变 → 目标 = 当前位置 → 完全不动
        //    被拖节点除外：它在拖拽中已被 drag-element 移走，直接回新规范位，不保留拖拽偏移
        const movedPositions: Record<string, [number, number]> = {}
        for (const [id, after] of canonicalAfter) {
          const live = liveBefore.get(id)
          if (!live) continue
          const before = canonicalBefore.get(id) ?? after
          const ox = id === dragged ? 0 : live[0] - before[0]
          const oy = id === dragged ? 0 : live[1] - before[1]
          const tx = after[0] + ox
          const ty = after[1] + oy
          if (Math.abs(tx - live[0]) > 0.5 || Math.abs(ty - live[1]) > 0.5) {
            movedPositions[id] = [tx, ty]
          }
        }

        // 5) 用重建的图数据推导被拖子树的新 level/分支色，只增量更新这批节点数据
        //    （层级变了 → 尺寸/字号/配色随样式函数变化；不 setData 整体重建）
        const fresh = buildGraphData(tree.value)
        const dataById = new Map((fresh.nodes ?? []).map((n) => [String(n.id), asRaw<MindRaw>(n.data)]))
        const subtreeData: { id: string; data: Record<string, unknown> }[] = []
        const collect = (node: MindTreeNode) => {
          const raw = dataById.get(node.id)
          if (raw) subtreeData.push({ id: node.id, data: { ...raw } as unknown as Record<string, unknown> })
          node.children?.forEach(collect)
        }
        collect(draggedNode)
        graph.updateNodeData(subtreeData)

        // 6) 边增量更新：删旧父子边，加新父子边（新边的 color/level 取自重建数据）
        graph.removeEdgeData([`${oldParent.id}->${dragged}`])
        const newEdge = (fresh.edges ?? []).find((e) => String(e.target) === dragged)
        if (newEdge) {
          graph.addEdgeData([
            { id: String(newEdge.id), source: newEdge.source, target: newEdge.target, data: newEdge.data },
          ])
        }

        // 7) draw 应用样式变化，再批量平移动画到位；动画结束后刷新覆盖层位置
        graph.draw()
        if (Object.keys(movedPositions).length > 0) {
          void graph.translateElementTo(movedPositions, true).then(() => {
            viewportTick.value += 1
          })
        }
        viewportTick.value += 1
        return
      }
    }

    // 未改层级（拖到空白处 / 拖回原地 / 拖到自己父节点上 / 根节点视口平移）：
    // 不做整体 render，只把被拖节点平移回拖拽开始时的布局原位，其余节点与边完全不动
    if (dragged && !wasRootDrag) {
      void graph.translateElementTo(dragged, dragStartPos, true)
    }
  })

  // 双击节点：进入原位编辑（节点文字隐藏，输入框覆盖在节点正上方）
  graph.on('node:dblclick', (e: IElementEvent) => {
    const id = e.target?.id
    if (!id || !graph) return
    const raw = asRaw<MindRaw>(graph.getNodeData(id).data)
    // baseW：进入编辑时的节点宽度（画布坐标单位），编辑框左缘据此锚定、向右扩展
    editing.value = {
      id,
      label: raw.label,
      level: raw.level,
      color: raw.color,
      baseW: widthOf(raw),
    }
  })

  // 编辑期间画布缩放/平移时，编辑框跟随节点位置（触发 editBoxStyle 重算）
  graph.on('viewportchange', () => {
    viewportTick.value += 1
  })

  void graph
    .render()
    .then(() => {
      if (!graph) return
      // 首次渲染后按「层级列对齐」规则覆盖布局位置：G6 内置 compact-box 的子节点 x
      // 依赖父节点宽度，同层左缘参差不齐；统一改用 computeLayoutPositions 的对齐结果
      // （根节点锚定不动，y 沿用内置布局，仅重排 x），随后再做一次 fitView
      const [cx, cy] = graph.getElementPosition(tree.value.id)
      const aligned: Record<string, [number, number]> = {}
      for (const [id, p] of computeLayoutPositions(tree.value, [cx, cy])) aligned[id] = p
      return graph.translateElementTo(aligned, false)
    })
    .then(() => {
      // 适应画布：整图居中显示（不配 autoFit，只在这里手动 fit 一次）
      void graph?.fitView()
    })

  // 暴露实例到 window：便于控制台调试与自动化验证（演示页纯前端数据，无安全风险）
  ;(window as unknown as Record<string, unknown>).__mindGraph = graph
}

/** 提交编辑：回写 G6 节点数据并重绘；节点变宽时整体向右扩展（左缘与编辑时保持一致不动） */
function commitEdit() {
  if (!editing.value || !graph) return
  const { id, label, baseW } = editing.value
  const level = editing.value.level
  const finalLabel = label.trim() || '新节点'
  // 提交后的宽度：不小于节点原宽（保留手柄调整结果），文案变长则向右增长
  const finalW = Math.max(baseW, nodeWidth(finalLabel, level))
  editing.value = null

  const raw = asRaw<MindRaw>(graph.getNodeData(id).data)
  graph.updateNodeData([
    { id, data: { ...raw, label: finalLabel, w: finalW } as unknown as Record<string, unknown> },
  ])
  graph.draw()

  // 节点是按中心点变宽的：把宽度增量的一半平移到右侧，左缘保持原位（与编辑框的扩展方向一致）
  const dx = (finalW - baseW) / 2
  if (dx !== 0) {
    void graph.translateElementBy(id, [dx, 0], false)
  }
  // 宽度回写到树：后续拖拽改层级重建图数据时保留
  const treeNode = findNode(tree.value, id)
  if (treeNode) treeNode.w = finalW
}

/** 取消编辑：丢弃未提交的文案（watch 中统一 draw 恢复节点文字显示） */
function cancelEdit() {
  editing.value = null
}

/**
 * 按下宽度手柄开始调整节点宽度（window 级 mousemove/mouseup 接力）
 * - 右手柄：右缘跟随光标，宽度向右延伸（左缘固定）
 * - 左手柄：左缘跟随光标，宽度向左延伸（右缘固定）
 * 节点是按中心变宽的：每帧用 translateElementBy 平移补偿，保持对侧缘不动
 */
function startResize(e: MouseEvent, id: string, edge: 'left' | 'right') {
  if (!graph) return
  e.preventDefault()
  resizing.value = { id, edge }

  const zoom = graph.getZoom()
  const startW = widthOf(asRaw<MindRaw>(graph.getNodeData(id).data)) // 起始宽度（画布坐标单位）
  const startX = e.clientX // 起始光标位置（客户端坐标）

  /** 拖动中：按光标位移计算新宽度，更新节点数据并平移补偿 */
  const onMove = (ev: MouseEvent) => {
    if (!graph || !resizing.value) return
    // 新宽度（画布坐标单位）：右手柄加位移、左手柄减位移，最小 60
    const deltaW = (ev.clientX - startX) / zoom
    const newW = Math.max(edge === 'right' ? startW + deltaW : startW - deltaW, 60)
    const oldW = widthOf(asRaw<MindRaw>(graph.getNodeData(id).data))
    if (newW === oldW) return

    const raw = asRaw<MindRaw>(graph.getNodeData(id).data)
    graph.updateNodeData([
      { id, data: { ...raw, w: newW } as unknown as Record<string, unknown> },
    ])
    graph.draw()

    // 平移补偿：右手柄固定左缘（中心右移增量一半），左手柄固定右缘（中心左移减量一半）
    const dx = edge === 'right' ? (newW - oldW) / 2 : (oldW - newW) / 2
    if (dx !== 0) void graph.translateElementBy(id, [dx, 0], false)

    viewportTick.value += 1 // 让选中框/编辑框跟随新宽度
  }

  /** 松手：宽度回写到树（重建图数据/重跑布局时保留），解绑监听 */
  const onUp = () => {
    if (graph) {
      const finalW = widthOf(asRaw<MindRaw>(graph.getNodeData(id).data))
      const treeNode = findNode(tree.value, id)
      if (treeNode) treeNode.w = finalW
    }
    resizing.value = null
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
  }

  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}

/** 放大一档（相对缩放 1.2 倍） */
function zoomIn() {
  void graph?.zoomBy(1.2)
}

/** 缩小一档（相对缩放 1/1.2 倍） */
function zoomOut() {
  void graph?.zoomBy(1 / 1.2)
}

/** 适应画布：整图居中显示 */
function fitView() {
  void graph?.fitView()
}

// 编辑浮层出现/消失时：出现则自动聚焦输入框，并重绘以切换节点文字的隐藏/恢复
watch(editing, (val) => {
  if (val) {
    void nextTick(() => editInputRef.value?.focus())
  }
  graph?.draw()
})

onMounted(() => {
  initGraph()
})

onBeforeUnmount(() => {
  // 编辑浮层若打开，先清掉（避免卸载后残留）
  editing.value = null
  graph?.destroy()
  graph = null
})
</script>
