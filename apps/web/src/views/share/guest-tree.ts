/**
 * 访客文档树纯函数工具（迁移自原 share-guest.vue）
 *
 * 职责：访客分享数据（listShareNodes 扁平节点）到嵌套树的全部纯函数变换，
 * 供 wiki/index.vue（数据加载）与 layout-left（guest 模式侧栏树渲染）共用。
 * 与 owner 侧 wiki-doc store 的树构建逻辑同构（O(n) 两遍法：先建 Map 再按 parentId 挂载）。
 */
import type { ShareNodeItem } from '@/api/modules/share'

/**
 * 访客树节点（嵌套结构，替代原 share-tree.vue 导出的 ShareTreeItem）
 */
export interface GuestTreeItem {
  /** 节点 ID（wikiNodes.id，对应路由 docId） */
  id: string
  /** 节点标题 */
  title: string
  /** 节点图标（emoji，可空） */
  icon: string | null
  /** 关联文档 ID（documents.id）；无关联文档的节点为 undefined（异常数据保护） */
  documentId?: string
  /** 子节点 */
  children: GuestTreeItem[]
}

/**
 * a-tree 数据节点结构（与 owner layout-left 本地定义一致）
 */
export interface GuestTreeDataNode {
  /** 节点唯一 key（节点 ID） */
  key: string
  /** 节点标题 */
  title: string
  /** 是否叶子节点（无子节点） */
  isLeaf: boolean
  /** 子节点 */
  children?: GuestTreeDataNode[]
}

/**
 * 将扁平节点数组构建为嵌套树（O(n) 两遍法，与 owner 侧 wiki-doc store 的 buildTree 同构）
 * @param flat 后端返回的扁平节点数组
 */
export function buildGuestTree(flat: ShareNodeItem[]): GuestTreeItem[] {
  const map = new Map<string, GuestTreeItem>()
  const roots: GuestTreeItem[] = []

  // 第一遍：转为树节点并入 Map
  for (const node of flat) {
    map.set(node.id, {
      id: node.id,
      title: node.title,
      icon: node.icon,
      documentId: node.documentId ?? undefined,
      children: [],
    })
  }

  // 第二遍：按 parentId 挂载
  for (const node of flat) {
    const item = map.get(node.id)!
    if (node.parentId) {
      const parent = map.get(node.parentId)
      if (parent) {
        parent.children.push(item)
      } else {
        // 父节点缺失（异常数据），提升为根节点
        roots.push(item)
      }
    } else {
      roots.push(item)
    }
  }

  return roots
}

/**
 * 在树中递归查找节点
 */
export function findGuestNode(list: GuestTreeItem[], id: string): GuestTreeItem | null {
  for (const item of list) {
    if (item.id === id) return item
    const found = findGuestNode(item.children, id)
    if (found) return found
  }
  return null
}

/**
 * 在树中查找节点的祖先链（根 → 直接父节点 → 目标节点，含自身）
 * 供 LayoutMain 面包屑渲染父级路径；节点不存在时返回空数组
 */
export function findGuestNodePath(list: GuestTreeItem[], id: string): GuestTreeItem[] {
  for (const item of list) {
    if (item.id === id) return [item]
    const subPath = findGuestNodePath(item.children, id)
    if (subPath.length > 0) return [item, ...subPath]
  }
  return []
}

/**
 * 深度优先取第一个节点（文档树目录顺序的第一篇；统一节点模型下节点即文档）
 * 用于 URL 无 docId / 初始 docId 失效时自动选中第一篇
 */
export function firstGuestNode(list: GuestTreeItem[]): GuestTreeItem | null {
  for (const item of list) {
    if (item.children?.length) {
      const found = firstGuestNode(item.children)
      if (found) return found
    }
    return item
  }
  return null
}

/**
 * 递归过滤树节点：保留标题命中或子节点命中的节点（命中节点的祖先链自动保留）
 * @param list 当前层级的节点列表
 * @param kw 小写化的搜索关键字
 */
export function filterGuestTree(list: GuestTreeItem[], kw: string): GuestTreeItem[] {
  const result: GuestTreeItem[] = []
  for (const item of list) {
    const titleHit = item.title.toLowerCase().includes(kw)
    const children = filterGuestTree(item.children, kw)
    // 标题命中保留完整子树，子节点命中仅保留命中链
    if (titleHit || children.length > 0) {
      result.push(titleHit ? item : { ...item, children })
    }
  }
  return result
}

/**
 * 递归收集「目录节点」（有子节点的节点）ID
 * @param list 当前层级的节点列表
 * @param depth 当前层级深度（根为 0）
 * @param minDepth 最小收集深度（0=全部目录；1=排除一级目录，与 owner「全部折叠时一级保持展开」语义一致）
 * @param acc 收集结果数组
 */
export function collectGuestFolderIds(
  list: GuestTreeItem[],
  depth: number,
  minDepth: number,
  acc: string[]
) {
  for (const item of list) {
    if (item.children.length > 0) {
      if (depth >= minDepth) acc.push(item.id)
      collectGuestFolderIds(item.children, depth + 1, minDepth, acc)
    }
  }
}

/**
 * 将访客树节点转换为 a-tree 数据结构（同 owner layout-left 的 toTreeData）
 */
export function toGuestTreeData(node: GuestTreeItem): GuestTreeDataNode {
  return {
    key: node.id,
    title: node.title,
    isLeaf: node.children.length === 0,
    children: node.children.length > 0 ? node.children.map(toGuestTreeData) : undefined,
  }
}
