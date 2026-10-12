import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { listWikiNodes, createWikiNode, saveNodeTitle, saveNodeIcon, deleteWikiNode, moveWikiNode, listTrash, restoreTrashNode, purgeTrashNode, purgeAllTrash } from '@/api/modules/wiki'
import type { WikiNodeItem, TrashItem } from '@/api/modules/wiki'
import { ApiError } from '@/api/request'
import type { WikiDocItem } from '@/types/wiki-doc'

/**
 * 在树中查找指定 ID 的节点
 * @param tree 文档树
 * @param id 目标节点 ID
 * @returns 找到的节点、父节点数组以及节点在父节点中的索引
 */
function findNodeInTree(
  tree: WikiDocItem[],
  id: string,
  parent: WikiDocItem[] | null = null
): { node: WikiDocItem; parent: WikiDocItem[] | null; index: number } | null {
  for (let i = 0; i < tree.length; i++) {
    const item = tree[i]
    if (item.id === id) {
      return { node: item, parent, index: i }
    }
    if (item.children && item.children.length > 0) {
      const found = findNodeInTree(item.children, id, item.children)
      if (found) return found
    }
  }
  return null
}

/**
 * 在树中按关联文档 ID（documents.id）递归查找节点
 * @param tree 文档树（子层级）
 * @param documentId 目标文档 ID（documents.id）
 * @returns 找到的节点，未找到返回 null
 */
function findNodeByDocumentIdInTree(tree: WikiDocItem[], documentId: string): WikiDocItem | null {
  for (const item of tree) {
    if (item.documentId === documentId) return item
    if (item.children && item.children.length > 0) {
      const found = findNodeByDocumentIdInTree(item.children, documentId)
      if (found) return found
    }
  }
  return null
}

/**
 * 递归查找节点的完整父级路径（从根到直接父节点）
 * 用于渲染面包屑导航，返回不含目标节点自身的所有祖先节点
 * @param tree 文档树
 * @param id 目标节点 ID
 * @param path 当前累积的路径（递归内部使用）
 * @returns 从根到父节点的路径数组，每项为 { id, title, icon }；未找到返回空数组
 */
function getNodePathInTree(
  tree: WikiDocItem[],
  id: string,
  path: { id: string; title: string; icon?: string | null }[] = []
): { id: string; title: string; icon?: string | null }[] | null {
  for (const item of tree) {
    // 找到目标节点，返回当前累积的路径（不含自身）
    if (item.id === id) {
      return path
    }
    // 有子节点时继续递归，将当前节点加入路径
    if (item.children && item.children.length > 0) {
      const found = getNodePathInTree(item.children, id, [
        ...path,
        { id: item.id, title: item.title, icon: item.icon },
      ])
      if (found) return found
    }
  }
  return null
}

/**
 * 将扁平节点数组构建为嵌套文档树（Notion 风格统一节点模型）
 * O(n) 复杂度：先用 Map 索引节点，再按 parentId 挂载子节点
 * 每个节点都初始化 children: []，便于后续动态挂载子节点
 * @param flat 后端返回的扁平节点数组
 * @returns 嵌套文档树根层级数组
 */
function buildTree(flat: WikiNodeItem[]): WikiDocItem[] {
  // 节点 Map：id → WikiDocItem（含 children 占位）
  const map = new Map<string, WikiDocItem>()
  const roots: WikiDocItem[] = []

  // 第一遍：转换为 WikiDocItem 并入 Map（每个节点都初始化 children: []）
  for (const node of flat) {
    map.set(node.id, {
      id: node.id,
      title: node.title,
      icon: node.icon ?? undefined,
      visible: node.isVisible !== false,
      parentId: node.parentId ?? undefined,
      index: node.sortOrder,
      documentId: node.documentId ?? undefined,
      updatedAt: node.updatedAt,
      children: [],
    })
  }

  // 第二遍：按 parentId 挂载，根层级进 roots
  for (const node of flat) {
    const item = map.get(node.id)!
    if (node.parentId) {
      const parent = map.get(node.parentId)
      if (parent && parent.children) {
        parent.children.push(item)
      } else {
        // 父节点缺失（异常数据），提升为根节点
        roots.push(item)
      }
    } else {
      roots.push(item)
    }
  }

  // 按 index（sortOrder）排序
  const sortRecursive = (list: WikiDocItem[]) => {
    list.sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    for (const item of list) {
      if (item.children) sortRecursive(item.children)
    }
  }
  sortRecursive(roots)

  return roots
}

/**
 * 递归更新所有子节点的 parentId
 * @param list 节点列表
 * @param parentId 父节点 ID
 */
function updateParentIds(list: WikiDocItem[], parentId?: string) {
  list.forEach((item, index) => {
    item.parentId = parentId
    item.index = index
    if (item.children && item.children.length > 0) {
      updateParentIds(item.children, item.id)
    }
  })
}

/**
 * 递归收集所有"有子节点的节点" ID（替代原 getAllFolderIds）
 * Notion 风格模型下，"是否为父级"由 children 长度判断，而非 isFolder 字段
 * @param list 文档树节点列表
 * @returns 所有有子节点的节点 ID 数组
 */
function getAllParentIds(list: WikiDocItem[]): string[] {
  const result: string[] = []
  for (const item of list) {
    if (item.children && item.children.length > 0) {
      result.push(item.id)
      result.push(...getAllParentIds(item.children))
    }
  }
  return result
}

/**
 * 收集二级及以下嵌套"有子节点的节点" ID（排除根层级父级节点）
 * 根层级（一级）父级节点始终展开，不受全量展开/收缩控制影响
 * @param rootList 文档树根层级节点列表
 * @returns 二级及以下父级节点 ID 数组
 */
function getNestedParentIds(rootList: WikiDocItem[]): string[] {
  const result: string[] = []
  for (const rootItem of rootList) {
    if (rootItem.children && rootItem.children.length > 0) {
      // 进入子树收集所有父级节点（即二级及以下）
      result.push(...getAllParentIds(rootItem.children))
    }
  }
  return result
}

/**
 * Wiki 文档目录 Store（Notion 风格统一节点模型）
 * 管理当前知识库的文档树（从后端动态拉取）、展开状态、本地拖拽重排
 *
 * 注意：拖拽 moveDoc 为本地内存重排，不持久化到后端（符合「仅读取」范围）
 */
export const useWikiDocStore = defineStore('wiki-doc', () => {
  /**
   * 文档树数据
   */
  const docTree = ref<WikiDocItem[]>([])

  /**
   * 当前已加载的知识库 ID（避免重复拉取）
   */
  const currentWikiId = ref<string | null>(null)

  /**
   * 当前展开的父级节点 ID 列表
   */
  const openKeys = ref<string[]>([])

  /**
   * 加载状态
   */
  const loading = ref(false)

  /**
   * 展示用的文档树，过滤掉不可见节点
   */
  const sortedDisplayDocs = computed<WikiDocItem[]>(() => {
    return docTree.value.filter((item) => item.visible !== false)
  })

  /**
   * 加载指定知识库的文档树
   * @param wikiId 知识库 ID
   * @param force 是否强制刷新（忽略缓存）
   */
  async function loadDocs(wikiId: string, force = false) {
    // 同一知识库且非强制刷新时跳过（成功加载过才跳过，失败允许重试）
    if (!force && currentWikiId.value === wikiId) return

    loading.value = true
    try {
      const list = await listWikiNodes(wikiId).send()
      docTree.value = buildTree(list ?? [])
      // 仅成功时记录 currentWikiId，失败时不记录以便重试
      currentWikiId.value = wikiId
      // 默认展开根层级所有"有子节点"的节点（贴近原"展开根文件夹"体验）
      openKeys.value = docTree.value
        .filter((item) => item.children && item.children.length > 0)
        .map((item) => item.id)
    } catch (error) {
      if (error instanceof ApiError) {
        console.warn('[WikiDocStore] loadDocs failed:', error.message)
      } else {
        console.error('[WikiDocStore] loadDocs error:', error)
      }
      docTree.value = []
    } finally {
      loading.value = false
    }
  }

  /**
   * 创建一篇新文档（Notion 风格统一节点模型）
   *
   * 调后端 `POST /wiki/:id/nodes`（事务内同时创建 documents + wikiNodes）。
   * 支持 parentId：在任意节点下创建子文档，或在根层级创建。
   * 成功后本地插入到对应位置。若指定了 parentId，自动展开该父节点。
   *
   * 注意：失败时直接抛出，由调用方决定如何提示用户。
   *
   * @param wikiId 知识库 ID
   * @param parentId 可选，指定在哪个父节点下创建；不传则创建在根层级
   * @param title 可选，文档标题；不传则后端使用默认值「无标题文档」
   * @returns 新建节点（WikiDocItem 形状，含 documentId 供编排器拉正文）
   */
  async function createDoc(wikiId: string, parentId?: string, title?: string): Promise<WikiDocItem> {
    // 构建 API 参数（不再传 isFolder，每个节点都是文档）
    const params: { parentId?: string; title?: string } = {}
    if (parentId) params.parentId = parentId
    if (title) params.title = title

    const node = await createWikiNode(wikiId, params).send()

    // 扁平节点 → WikiDocItem（与 buildTree 内映射保持一致：children 始终初始化为 []）
    const item: WikiDocItem = {
      id: node.id,
      title: node.title,
      visible: node.isVisible !== false,
      parentId: node.parentId ?? undefined,
      index: node.sortOrder,
      documentId: node.documentId ?? undefined,
      children: [],
    }

    if (parentId) {
      // 在指定父节点下创建：插入到该父节点的 children 末尾
      const parentNode = findNodeInTree(docTree.value, parentId)
      if (parentNode && parentNode.node.children) {
        parentNode.node.children.push(item)
        // 自动展开父节点，使新子文档可见
        if (!openKeys.value.includes(parentId)) {
          openKeys.value.push(parentId)
        }
        updateParentIds(docTree.value)
      } else {
        // 父节点不存在时降级为根层级插入
        docTree.value.push(item)
        updateParentIds(docTree.value)
      }
    } else {
      // 根层级创建：插入末尾
      docTree.value.push(item)
      updateParentIds(docTree.value)
    }

    return item
  }

  /**
   * 在树中查找节点，供编排器取 documentId 等
   * @param id 节点 ID
   * @returns 节点对象（不存在返回 null）
   */
  function findNode(id: string): WikiDocItem | null {
    return findNodeInTree(docTree.value, id)?.node ?? null
  }

  /**
   * 按关联文档 ID（documents.id）反查节点
   * 用途：分享链接的 docId 段是 documents.id（share-dialog 复制），owner 登录态直接打开时
   * 树按节点 ID（wikiNodes.id）无法命中 → 以 documentId 反查定位节点，
   * 编排器（wiki/index.vue loadDocContent）据此归一化 URL 为节点 ID
   * @param documentId 文档 ID（documents.id）
   * @returns 节点对象（不存在返回 null）
   */
  function findNodeByDocumentId(documentId: string): WikiDocItem | null {
    for (const item of docTree.value) {
      if (item.documentId === documentId) return item
      if (item.children && item.children.length > 0) {
        const found = findNodeByDocumentIdInTree(item.children, documentId)
        if (found) return found
      }
    }
    return null
  }

  /**
   * 切换父级节点展开/收起状态
   * @param id 父级节点 ID
   */
  function toggleOpenKey(id: string) {
    const index = openKeys.value.indexOf(id)
    if (index > -1) {
      openKeys.value.splice(index, 1)
    } else {
      openKeys.value.push(id)
    }
  }

  /**
   * 是否所有父级节点（含根层级）都已展开
   * 无父级节点时返回 true（视为已全部展开）
   */
  const isAllExpanded = computed(() => {
    const allParentIds = getAllParentIds(docTree.value)
    if (allParentIds.length === 0) return true
    return allParentIds.every((id) => openKeys.value.includes(id))
  })

  /**
   * 展开所有父级节点（含根层级和所有二级及以下）
   */
  function expandAllFolders() {
    const rootParentIds = docTree.value
      .filter((item) => item.children && item.children.length > 0)
      .map((item) => item.id)
    const nestedParentIds = getNestedParentIds(docTree.value)
    // 根层级 + 所有二级及以下的父级节点 ID
    openKeys.value = [...rootParentIds, ...nestedParentIds]
  }

  /**
   * 收拢所有父级节点（清空全部展开状态）
   */
  function collapseAllFolders() {
    openKeys.value = []
  }

  /**
   * 移动文档节点到指定父节点下指定位置（本地内存重排，不落库）
   * Notion 风格模型下，任何节点都可作为父级，但仍需防止"将节点移入自身子树"
   * @param id 被移动节点 ID
   * @param parentId 目标父节点 ID，undefined 表示根层级
   * @param index 目标位置索引
   */
  function moveDoc(id: string, parentId?: string, index?: number) {
    if (index === undefined) return

    // 找到当前节点
    const found = findNodeInTree(docTree.value, id)
    if (!found) return

    const { node, parent: sourceParent, index: sourceIndex } = found

    // 不能将节点移动到自身
    if (parentId === id) return

    // 防止将节点移入其自身子树（造成循环）
    if (parentId) {
      let current: WikiDocItem | undefined = node
      while (current) {
        if (current.id === parentId) return
        // 查找当前节点的父节点
        const parentInfo = findNodeInTree(docTree.value, current.id)
        current = parentInfo?.parent
          ? parentInfo.parent.find((item) => item.children?.includes(current as WikiDocItem))
          : undefined
      }
    }

    // 从原位置移除
    const sourceList = sourceParent ?? docTree.value
    sourceList.splice(sourceIndex, 1)

    // 插入到目标位置
    const targetList = parentId
      ? findNodeInTree(docTree.value, parentId)?.node.children
      : docTree.value
    if (!targetList) {
      // 如果目标父节点不存在，则放回原地
      sourceList.splice(sourceIndex, 0, node)
      return
    }

    // index 即 Sortable 上报的最终索引：移除后直接插入即可，无需修正
    // （DOM 层已不再预减，修正逻辑统一收敛在这里且实际无需减 1）
    targetList.splice(index, 0, node)

    // 重新计算 parentId 和 index
    updateParentIds(docTree.value)
  }

  /**
   * 拖拽排序持久化：把节点当前本地位置同步到服务端
   *
   * 必须在 moveDoc 本地重排完成后调用——读取的是重排后的最终位置
   * （getNodePosition 返回的 index 即服务端约定的「移除后同级下标」语义）。
   *
   * 失败处理：服务端排序未生效时本地与服务端会不一致，这里强制重拉文档树回滚
   * 本地乐观更新（loadDocs(force)），调用方据返回值决定是否提示用户。
   *
   * @param id 被移动节点 ID
   * @returns true = 持久化成功；false = 失败（本地树已回滚到服务端状态）
   */
  async function moveDocPersist(id: string): Promise<boolean> {
    const pos = getNodePosition(id)
    if (!pos) return false

    try {
      // 根层级 parentId 传 null（服务端约定），其余传父节点 ID
      await moveWikiNode(id, { parentId: pos.parentId ?? null, index: pos.index }).send()
      return true
    } catch (error) {
      if (error instanceof ApiError) {
        console.warn('[WikiDocStore] moveDocPersist failed:', error.message)
      } else {
        console.error('[WikiDocStore] moveDocPersist error:', error)
      }
      // 回滚：以服务端为准重拉文档树（丢弃本地乐观重排）
      if (currentWikiId.value) {
        await loadDocs(currentWikiId.value, true)
      }
      return false
    }
  }

  /**
   * 获取节点所在父级 ID 与在父级中的索引（用于 a-tree 拖拽落点计算）
   * 根层级节点 parentId 为 undefined
   * @param id 节点 ID
   * @returns 位置信息；节点不存在返回 null
   */
  function getNodePosition(id: string): { parentId?: string; index: number } | null {
    const found = findNodeInTree(docTree.value, id)
    if (!found) return null
    // found.parent 是节点所在子数组；该列表内任一元素的 parentId 即父节点 ID（根层级时为 undefined）
    const parentId = found.parent && found.parent.length > 0 ? found.parent[0].parentId : undefined
    return { parentId, index: found.index }
  }

  /**
   * 更新文档标题（调用后端 API 并同步本地）
   * @param id 节点 ID
   * @param changes 变更内容（title 必填）
   */
  async function updateDoc(id: string, changes: { title: string }) {
    // 调用后端保存标题接口
    await saveNodeTitle(id, { title: changes.title })

    // 成功后更新本地状态
    const found = findNodeInTree(docTree.value, id)
    if (found) {
      found.node.title = changes.title
    }
  }

  /**
   * 删除文档节点（调用后端 API 并同步本地）
   * 后端为级联删除：若有子节点，会递归删除所有子节点及关联文档
   * @param id 节点 ID
   */
  async function deleteDoc(id: string) {
    // 先获取节点信息（删除前）
    const found = findNodeInTree(docTree.value, id)

    // 调用后端删除接口
    await deleteWikiNode(id).send()

    // 成功后从本地树中移除
    if (found) {
      const sourceList = found.parent ?? docTree.value
      sourceList.splice(found.index, 1)

      // 从 openKeys 中移除被删除的节点及其所有子节点（有子节点的才在 openKeys 中）
      const removeKeys = new Set<string>([id])
      const collectKeys = (items: WikiDocItem[]) => {
        items.forEach((item) => {
          if (item.children && item.children.length > 0) {
            removeKeys.add(item.id)
            collectKeys(item.children)
          }
        })
      }
      if (found.node.children) collectKeys(found.node.children)
      openKeys.value = openKeys.value.filter((key) => !removeKeys.has(key))

      updateParentIds(docTree.value)
    }
  }

  /**
   * 更新文档节点图标（调用后端 API 并同步本地）
   * @param id 节点 ID
   * @param icon emoji 字符串，空字符串表示清除图标
   */
  async function updateIcon(id: string, icon: string) {
    // 调用后端保存图标接口
    await saveNodeIcon(id, { icon }).send()

    // 成功后更新本地状态
    const found = findNodeInTree(docTree.value, id)
    if (found) {
      found.node.icon = icon || null
    }
  }

  /**
   * 获取指定节点的完整父级路径（从根到直接父节点）
   * 用于渲染面包屑导航
   * @param id 节点 ID
   * @returns 父级路径数组，每项为 { id, title, icon }；未找到返回空数组
   */
  function getNodePath(id: string): { id: string; title: string; icon?: string | null }[] {
    const path = getNodePathInTree(docTree.value, id)
    return path ?? []
  }

  // ============ 回收站 ============

  /**
   * 回收站条目列表（顶层删除项，按删除时间倒序）
   */
  const trashItems = ref<TrashItem[]>([])

  /**
   * 回收站列表加载状态
   */
  const trashLoading = ref(false)

  /**
   * 加载知识库回收站列表（每次强制拉取，保证删除/恢复后数据最新）
   * @param wikiId 知识库 ID
   */
  async function loadTrash(wikiId: string) {
    trashLoading.value = true
    try {
      trashItems.value = (await listTrash(wikiId).send()) ?? []
    } finally {
      trashLoading.value = false
    }
  }

  /**
   * 从回收站列表中移除指定条目（恢复/彻底删除成功后的本地同步）
   * @param id 顶层删除项节点 ID
   */
  function removeFromTrash(id: string) {
    trashItems.value = trashItems.value.filter((item) => item.id !== id)
  }

  /**
   * 恢复回收站节点（整棵子树恢复，调用后端 API 并同步本地）
   * 恢复成功后强制刷新文档树（节点可能回到原父级或根层级末尾）
   * @param id 顶层删除项节点 ID
   */
  async function restoreDoc(id: string) {
    await restoreTrashNode(id).send()

    // 本地移除该回收站条目
    removeFromTrash(id)

    // 强制刷新文档树（恢复可能改变树结构：原父级或根层级末尾）
    if (currentWikiId.value) {
      await loadDocs(currentWikiId.value, true)
    }
  }

  /**
   * 彻底删除回收站节点（硬删除不可恢复，调用后端 API 并同步本地）
   * @param id 顶层删除项节点 ID
   * @returns 被级联删除的节点/文档 ID 列表（组件层据此判断当前打开文档是否需要跳转离开）
   */
  async function purgeDoc(id: string) {
    const result = await purgeTrashNode(id).send()

    // 本地移除该回收站条目
    removeFromTrash(id)

    return result
  }

  /**
   * 一键清空回收站（硬删除该库回收站全部内容，不可恢复）
   * @returns 被级联删除的节点/文档 ID 列表（组件层据此判断当前打开文档是否需要跳转离开）
   */
  async function purgeAllDocs() {
    const result = await purgeAllTrash(currentWikiId.value!).send()

    // 本地清空回收站条目
    trashItems.value = []

    return result
  }

  return {
    docTree,
    currentWikiId,
    openKeys,
    loading,
    sortedDisplayDocs,
    isAllExpanded,
    loadDocs,
    createDoc,
    findNode,
    findNodeByDocumentId,
    getNodePath,
    toggleOpenKey,
    expandAllFolders,
    collapseAllFolders,
    moveDoc,
    moveDocPersist,
    getNodePosition,
    updateDoc,
    updateIcon,
    deleteDoc,
    trashItems,
    trashLoading,
    loadTrash,
    restoreDoc,
    purgeDoc,
    purgeAllDocs,
  }
})
