/**
 * 帮助中心文档树工具（apps/pages）
 *
 * 处理后端 /share/wiki/:wikiId/nodes 返回的扁平节点数组：
 * - buildTree:      扁平 → 树（保序 sortOrder）
 * - findNodePath:   在树中查找节点并返回「根 → 目标」祖先链（面包屑用）
 * - filterTree:     按关键词过滤树（保留匹配节点的祖先链，便于展示层级）
 * - collectDocs:    平铺某分组下所有后代文档节点（落地页分组卡用）
 */
import type { ShareNodeItem } from '~/api/types'

/**
 * 树形节点（在扁平节点基础上挂 children）
 */
export type HelpNode = ShareNodeItem & {
  /** 子节点（按 sortOrder 升序） */
  children: HelpNode[]
}

/**
 * 扁平节点数组 → 树（不修改入参）
 *
 * - children 按 sortOrder 升序排列，同级稳定排序；
 * - parentId 指向不存在节点的「孤儿节点」按根层级处理（防御后端数据异常）；
 * - 后端已剔除隐藏节点，这里不做 isVisible 过滤。
 * @param nodes 扁平节点数组（顺序无关）
 */
export function buildTree(nodes: ShareNodeItem[]): HelpNode[] {
  const byId = new Map<string, HelpNode>()
  for (const node of nodes) {
    byId.set(node.id, { ...node, children: [] })
  }

  const roots: HelpNode[] = []
  for (const node of byId.values()) {
    const parent = node.parentId ? byId.get(node.parentId) : undefined
    if (parent) {
      parent.children.push(node)
    } else {
      // parentId 为空或父节点不存在（孤儿节点）→ 根层级
      roots.push(node)
    }
  }

  // 同层按 sortOrder 升序
  const sortRec = (list: HelpNode[]) => {
    list.sort((a, b) => a.sortOrder - b.sortOrder)
    for (const node of list) sortRec(node.children)
  }
  sortRec(roots)

  return roots
}

/**
 * 深度优先查找节点，返回「根 → 目标」的祖先链（含目标自身）
 * @param tree 树根数组
 * @param match 节点匹配谓词（如按 documentId 或节点 id 匹配）
 * @returns 匹配节点的祖先链；未找到返回 null
 */
export function findNodePath(
  tree: HelpNode[],
  match: (node: HelpNode) => boolean,
): HelpNode[] | null {
  for (const node of tree) {
    if (match(node)) return [node]
    const sub = findNodePath(node.children, match)
    if (sub) return [node, ...sub]
  }
  return null
}

/**
 * 按关键词过滤树：标题命中的节点保留，且自动保留其祖先链
 * （祖先虽未命中，但为了展示层级/可展开到命中项而保留）
 * @param tree 树根数组
 * @param keyword 关键词（对 title 做不区分大小写的 includes 匹配；空串返回原树结构副本）
 */
export function filterTree(tree: HelpNode[], keyword: string): HelpNode[] {
  const kw = keyword.trim().toLowerCase()
  if (!kw) return tree

  const walk = (list: HelpNode[]): HelpNode[] => {
    const result: HelpNode[] = []
    for (const node of list) {
      const children = walk(node.children)
      const selfMatch = node.title.toLowerCase().includes(kw)
      // 自身命中 或 后代命中（children 非空）→ 保留
      if (selfMatch || children.length > 0) {
        result.push({ ...node, children })
      }
    }
    return result
  }
  return walk(tree)
}

/**
 * 平铺某节点下所有「文档」后代（documentId 非空的节点，含自身若为文档）
 * 落地页分组卡用：组标题下平铺该组全部可读文档链接
 * @param node 分组节点
 * @returns 文档节点数组（按树的先序遍历，保持 sortOrder 展示顺序）
 */
export function collectDocs(node: HelpNode): HelpNode[] {
  const docs: HelpNode[] = []
  const walk = (n: HelpNode) => {
    if (n.documentId) docs.push(n)
    for (const child of n.children) walk(child)
  }
  walk(node)
  return docs
}
