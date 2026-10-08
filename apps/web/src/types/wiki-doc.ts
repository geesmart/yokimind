/**
 * Wiki 文档树节点类型（Notion 风格统一节点模型）
 * 每个节点都是文档，可同时拥有正文内容（关联 documentId）与子节点（通过 children 嵌套）
 */
export interface WikiDocItem {
  /** 节点唯一标识 */
  id: string
  /** 显示标题 */
  title: string
  /** 节点图标（emoji 字符串，为空表示无图标） */
  icon?: string | null
  /** 子节点列表，有 children 时表示该节点作为父级 */
  children?: WikiDocItem[]
  /** 父节点 ID，用于拖拽后重建层级关系 */
  parentId?: string
  /** 同层级中的排序位置 */
  index?: number
  /** 是否可见，用于过滤展示 */
  visible?: boolean
  /** 关联的文档 ID（每个节点都强制关联一个 documents 行，用于拉取正文内容） */
  documentId?: string | null
  /** 更新时间（ISO 字符串），用于首页展示最近更新时间 */
  updatedAt?: string
}
