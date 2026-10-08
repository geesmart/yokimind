/**
 * 脑图核心逻辑（组合式函数）
 *
 * - 数据模型：树结构 MindNode，内存态（刷新重置为示例数据）
 * - 布局算法：自实现递归水平树布局（根在左、向右展开，XMind 逻辑图方向）
 * - 结构操作：增删改、折叠/展开，全部操作后全量重建 VueFlow 节点/边
 */
import { nextTick, ref, shallowRef } from 'vue'
import type { Edge, Node } from '@vue-flow/core'
import { useVueFlow } from '@vue-flow/core'

/** 脑图树节点 */
export interface MindNode {
  id: string
  label: string
  /** 是否折叠子树 */
  collapsed?: boolean
  /** 是否处于文案编辑态（由 addChild 触发，输入框提交后清除） */
  editing?: boolean
  /** 节点宽度（px，左右拖拽手柄调整；未设置时按文字自适应） */
  width?: number
  children: MindNode[]
}

/** 层级间距（px）：父节点右缘到子节点左缘的水平距离 */
const X_GAP = 300
/** 同级间距（px）：相邻叶子节点垂直空隙 */
const Y_GAP = 28

/**
 * 一级分支专属配色（XMind 风格：每条主分支一种颜色，子级沿用父分支颜色）
 * 顺序：紫 / 蓝 / 绿 / 橙 / 红 / 粉
 */
const BRANCH_PALETTE = ['#7c3aed', '#2563eb', '#10b981', '#f59e0b', '#ef4444', '#ec4899']

/** 按层级估算节点高度（与 mind-node.vue 的实际样式近似即可，用于垂直排布） */
function heightOf(level: number): number {
  if (level === 0) return 68 // 根节点：大号胶囊
  if (level === 1) return 40 // 一级分支：纯文字
  return 30 // 更深层节点：小号文字
}

/**
 * 估算节点宽度（px）：布局需要用"父节点右缘"定位子节点
 * - 用户拖拽设置过 width 则用实际值
 * - 否则按层级字号估算（CJK 字符约等于 1 个字号宽度）+ 内边距
 */
function estimateWidth(node: MindNode, level: number): number {
  if (node.width) return node.width
  const charW = level === 0 ? 24 : level === 1 ? 18 : 14
  const pad = level === 0 ? 72 : 16
  return Math.max(node.label.length * charW + pad, 60)
}

/** 自增序号 + 随机串，保证演示页内 id 唯一（无需 ULID，纯前端内存数据） */
let idSeed = 0
function genId(): string {
  idSeed += 1
  return `mind-${idSeed}-${Math.random().toString(36).slice(2, 8)}`
}

/** 深拷贝树（结构操作前克隆，保持数据不可变语义） */
function cloneTree(root: MindNode): MindNode {
  return structuredClone(root)
}

/** 深度优先查找节点 */
function findNode(root: MindNode, id: string): MindNode | undefined {
  if (root.id === id) return root
  for (const child of root.children) {
    const hit = findNode(child, id)
    if (hit) return hit
  }
  return undefined
}

/** 查找节点的父节点（根节点返回 undefined） */
function findParent(root: MindNode, id: string): MindNode | undefined {
  for (const child of root.children) {
    if (child.id === id) return root
    const hit = findParent(child, id)
    if (hit) return hit
  }
  return undefined
}

/** 统计子树后代总数（折叠徽标 +N 用） */
function countDescendants(node: MindNode): number {
  return node.children.reduce((sum, c) => sum + 1 + countDescendants(c), 0)
}

/** 删除树中指定节点（连同其子树），返回是否删除成功 */
function removeFromTree(root: MindNode, id: string): boolean {
  const idx = root.children.findIndex((c) => c.id === id)
  if (idx >= 0) {
    root.children.splice(idx, 1)
    return true
  }
  return root.children.some((c) => removeFromTree(c, id))
}

/** 递归折叠所有节点的子树 */
function setCollapsedDeep(node: MindNode, collapsed: boolean): void {
  node.collapsed = collapsed
  node.children.forEach((c) => setCollapsedDeep(c, collapsed))
}

/** 示例数据：对齐 XMind 截图（中心主题 + 多条分支主题，其一带子主题） */
function createDemoTree(): MindNode {
  return {
    id: genId(),
    label: '中心主题',
    children: [
      {
        id: genId(),
        label: '分支主题',
        children: [{ id: genId(), label: '子主题', children: [] }],
      },
      { id: genId(), label: '分支主题', children: [] },
      { id: genId(), label: '分支主题', children: [] },
      { id: genId(), label: '分支主题', children: [] },
      { id: genId(), label: '分支主题', children: [] },
      { id: genId(), label: '分支主题', children: [] },
    ],
  }
}

/**
 * 脑图组合式函数
 * 内部持有树数据与 VueFlow 实例，暴露结构操作与键盘交互所需的判断方法
 */
export function useMindmap() {
  const { setNodes, setEdges, fitView } = useVueFlow()

  /** 树数据（shallowRef：结构操作整体替换引用，配合重建流程） */
  const tree = shallowRef<MindNode>(createDemoTree())
  /** 当前选中节点 id（画布点击/键盘操作目标） */
  const selectedId = ref<string | null>(null)

  /**
   * 由树数据重建 VueFlow 节点与边（全量替换）
   * 布局：一次递归自上而下分配垂直游标，父节点 y 取子节点 y 的中位数
   */
  function rebuildFlow() {
    const root = tree.value
    // VueFlow 的 Node 类型未声明 selected，但运行时支持该字段（随重建保留选中态）
    type FlowNode = Node & { selected?: boolean }
    const nodes: Node[] = []
    const edges: Edge[] = []
    let cursorY = 0

    /**
     * 递归布局并产出节点/边
     * @param node 当前树节点
     * @param level 层级（根为 0）
     * @param parentId 父节点 id（根为 null）
     * @param branchColor 所属主分支颜色（一级分支按序分配调色板，子级沿用父分支颜色）
     * @param parentX 父节点左缘 x（根为 0）
     * @param parentWidth 父节点宽度（用于子节点 x = 父右缘 + 间距）
     * @returns 该节点中心的 y 坐标
     */
    const walk = (
      node: MindNode,
      level: number,
      parentId: string | null,
      branchColor: string | null,
      parentX = 0,
      parentWidth = 0,
    ): number => {
      const h = heightOf(level)
      // 子节点 x 由父节点实际（或估算）宽度决定，父节点拖宽后子树整体右移
      const x = level === 0 ? 0 : parentX + parentWidth + X_GAP
      const w = estimateWidth(node, level)
      let centerY: number
      const hasVisibleChildren = !node.collapsed && node.children.length > 0
      if (!hasVisibleChildren) {
        // 叶子（或已折叠）：占用下一个垂直游标槽位
        centerY = cursorY + h / 2
        cursorY += h + Y_GAP
      } else {
        const childYs: number[] = []
        node.children.forEach((c, i) => {
          // 一级分支按序分配专属颜色，更深层级沿用父分支颜色
          const color = level === 0 ? BRANCH_PALETTE[i % BRANCH_PALETTE.length] : branchColor
          childYs.push(walk(c, level + 1, node.id, color, x, w))
        })
        // 父节点垂直居中于所有可见子节点之间
        centerY = (Math.min(...childYs) + Math.max(...childYs)) / 2
      }

      const flowNode: FlowNode = {
        id: node.id,
        type: 'mind',
        position: { x, y: centerY },
        // 选中态随重建保留（setNodes 全量替换会丢失运行时选中）
        selected: node.id === selectedId.value,
        data: {
          label: node.label,
          level,
          collapsed: !!node.collapsed,
          collapsedCount: node.collapsed ? countDescendants(node) : 0,
          editing: !!node.editing,
          isRoot: level === 0,
          hasChildren: node.children.length > 0,
          color: branchColor,
          width: node.width ?? null,
        },
      }
      nodes.push(flowNode)
      if (parentId && branchColor) {
        // 贝塞尔粗曲线（XMind 风格）：颜色随主分支，子级收细一档
        edges.push({
          id: `e-${parentId}-${node.id}`,
          source: parentId,
          target: node.id,
          type: 'default',
          pathOptions: { curvature: 0.4 },
          style: { strokeWidth: level === 1 ? 4 : 2.5, stroke: branchColor, fill: 'none' },
        })
      }
      return centerY
    }

    walk(root, 0, null, null)
    setNodes(nodes)
    setEdges(edges)
  }

  /** 重建并自适应视野（结构大幅变化时调用） */
  async function rebuildAndFit() {
    rebuildFlow()
    await nextTick()
    await fitView({ padding: 0.2, duration: 200 })
  }

  /** 在指定节点下添加子节点，并使其进入编辑态 */
  function addChild(parentId: string) {
    const next = cloneTree(tree.value)
    const parent = findNode(next, parentId)
    if (!parent) return
    // 父节点若处于折叠态，先展开再插入
    if (parent.collapsed) parent.collapsed = false
    parent.children.push({ id: genId(), label: '新节点', editing: true, children: [] })
    selectedId.value = parent.id
    tree.value = next
    rebuildFlow()
  }

  /** 在指定节点后方插入兄弟节点（根节点视为"添加子节点"） */
  function addSibling(nodeId: string) {
    const next = cloneTree(tree.value)
    if (nodeId === next.id) {
      // 根节点没有兄弟，退化为添加子节点
      next.children.push({ id: genId(), label: '新节点', editing: true, children: [] })
      tree.value = next
      rebuildFlow()
      return
    }
    const parent = findParent(next, nodeId)
    if (!parent) return
    const idx = parent.children.findIndex((c) => c.id === nodeId)
    parent.children.splice(idx + 1, 0, { id: genId(), label: '新节点', editing: true, children: [] })
    selectedId.value = nodeId
    tree.value = next
    rebuildFlow()
  }

  /** 删除指定节点及其整个子树（根节点不可删除） */
  function removeNode(nodeId: string) {
    if (nodeId === tree.value.id) return
    const next = cloneTree(tree.value)
    removeFromTree(next, nodeId)
    // 删除后选中其父节点（若父节点也在本次删除范围内则回落到根）
    selectedId.value = next.id
    tree.value = next
    rebuildFlow()
  }

  /** 折叠/展开指定节点的子树 */
  function toggleCollapse(nodeId: string) {
    const next = cloneTree(tree.value)
    const node = findNode(next, nodeId)
    if (!node) return
    node.collapsed = !node.collapsed
    tree.value = next
    rebuildFlow()
  }

  /** 折叠全部节点（仅保留根与其直接子节点可见） */
  function collapseAll() {
    const next = cloneTree(tree.value)
    next.children.forEach((c) => setCollapsedDeep(c, true))
    tree.value = next
    void rebuildAndFit()
  }

  /** 展开全部节点 */
  function expandAll() {
    const next = cloneTree(tree.value)
    setCollapsedDeep(next, false)
    tree.value = next
    void rebuildAndFit()
  }

  /** 提交节点文案（清除编辑态；空文案回退为"新节点"） */
  function renameNode(nodeId: string, label: string) {
    const next = cloneTree(tree.value)
    const node = findNode(next, nodeId)
    if (!node) return
    node.label = label.trim() || '新节点'
    node.editing = false
    tree.value = next
    rebuildFlow()
  }

  /** 取消编辑（丢弃未提交的新文案） */
  function cancelEdit(nodeId: string) {
    const next = cloneTree(tree.value)
    const node = findNode(next, nodeId)
    if (!node) return
    node.editing = false
    tree.value = next
    rebuildFlow()
  }

  /** 进入编辑态（双击节点触发） */
  function startEdit(nodeId: string) {
    const next = cloneTree(tree.value)
    const node = findNode(next, nodeId)
    if (!node) return
    node.editing = true
    tree.value = next
    rebuildFlow()
  }

  /** 拖拽左右手柄调整节点宽度（仅水平方向；结束后提交一次） */
  function resizeNode(nodeId: string, width: number) {
    const next = cloneTree(tree.value)
    const node = findNode(next, nodeId)
    if (!node) return
    // 最小宽度限制，避免拖成不可读的窄条
    node.width = Math.max(Math.round(width), 60)
    tree.value = next
    rebuildFlow()
  }

  /** 重置为示例数据 */
  function resetDemo() {
    selectedId.value = null
    tree.value = createDemoTree()
    void rebuildAndFit()
  }

  /**
   * 键盘交互入口（由页面在 window keydown 中调用）
   * 返回 true 表示事件已被脑图消费（页面据此 preventDefault）
   */
  function handleKeydown(e: KeyboardEvent): boolean {
    // 焦点在可编辑元素内时快捷键不生效，避免与文案编辑冲突；
    // 只读 input（未进入编辑态的脑图节点）不算编辑中，快捷键照常生效
    const active = document.activeElement
    const tag = active?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || (active as HTMLElement | null)?.isContentEditable) {
      const el = active as HTMLInputElement
      const readOnlyInput = tag === 'INPUT' && el.readOnly
      if (!readOnlyInput) return false
    }
    const id = selectedId.value
    switch (e.key) {
      case 'Tab':
        // Tab：为选中节点添加子节点
        if (!id) return false
        addChild(id)
        return true
      case 'Enter':
        // Enter：添加兄弟节点（根节点退化为添加子节点）
        if (!id) return false
        addSibling(id)
        return true
      case 'Delete':
      case 'Backspace':
        // Delete/Backspace：删除选中节点及子树（根节点不可删）
        if (!id || id === tree.value.id) return false
        removeNode(id)
        return true
      default:
        return false
    }
  }

  /** 首次构建画布数据并自适应视野（页面 onMounted 调用） */
  function init() {
    void rebuildAndFit()
  }

  return {
    selectedId,
    init,
    addChild,
    addSibling,
    removeNode,
    toggleCollapse,
    collapseAll,
    expandAll,
    renameNode,
    cancelEdit,
    startEdit,
    resizeNode,
    resetDemo,
    handleKeydown,
  }
}
