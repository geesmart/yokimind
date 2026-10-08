/**
 * 知识库模块接口
 *
 * 对接后端 `/api/v1/wiki/*` 接口（wiki.controller.ts）：
 * - listWikis      获取列表   GET  /wiki             需鉴权
 * - createWiki     创建知识库  POST /wiki             需鉴权
 * - getWiki        获取详情   GET  /wiki/:id         需鉴权（仅 owner）
 * - listWikiNodes  获取文档树  GET  /wiki/:id/nodes   需鉴权（仅 owner）
 * - createWikiNode 创建文档节点 POST /wiki/:id/nodes  需鉴权（仅 owner）
 * - getDocument    获取文档正文 GET  /wiki/document/:id 需鉴权（仅 owner）
 *
 * 使用方式：
 * - 组件内推荐用 `useRequest(listWikis())` 获得 loading/data/error
 * - 非组件场景（如 store action）用 `await listWikis().send()`
 *
 * 响应已被 request.ts 的 alova 实例统一解包：
 * - 成功直接返回后端 `data` 字段
 * - 业务失败抛 `ApiError`（含 code/httpStatus）
 */
import { alova } from '../request'
import { API_PATHS } from '../constants'

// ==================== 类型定义 ====================

/**
 * 知识库项
 * 与后端 wiki.service.ts 的 wikiSelectFields 对齐
 */
export interface WikiItem {
  /** 知识库 ID（ULID 字符串） */
  id: string
  /** 知识库名称 */
  name: string
  /** 知识库描述（可能为 null） */
  description: string | null
  /** 图标标识（可能为 null） */
  icon: string | null
  /** 主题色（可能为 null） */
  color: string | null
  /** 创建者用户 ID */
  ownerId: string
  /** 可见性：private / public（与库级分享配置 shareStatus 同步写，public = 库级公开） */
  visibility: string
  /**
   * 是否已发布（数据源 wiki_publish 表）：发布开关 enabled = true。
   * 与「已分享」是两个独立状态（可同时为 true），分别展示，不做互斥推断
   */
  published: boolean
  /**
   * 是否已分享（数据源 wiki_shares 表）：库级权限行（node_id=''）share_status = 'public'。
   * 与「已发布」是两个独立状态（可同时为 true），分别展示，不做互斥推断
   */
  shared: boolean
  /** 状态：active / archived */
  status: string
  /** 文档数量（冗余计数） */
  docCount: number
  /** 成员数量（冗余计数） */
  memberCount: number
  /** 是否自动 RAG 索引（文档保存后自动切片向量化） */
  ragEnabled: boolean
  /** 创建时间（ISO 字符串） */
  createdAt: string
  /** 更新时间（ISO 字符串） */
  updatedAt: string
}

/**
 * 创建知识库入参
 * 与后端 CreateWikiSchema 对齐：名称必填，描述可选，icon/color 可选
 */
export interface CreateWikiParams {
  /** 知识库名称：2-50 字符 */
  name: string
  /** 知识库描述：可选，最长 500 字符 */
  description?: string
  /** 知识库图标 key（可选，对应 icon-meta.ts 中的图标标识） */
  icon?: string
  /** 知识库主题色 key（可选，对应 icon-meta.ts 中的颜色标识） */
  color?: string
  /** 是否自动 RAG 索引（可选，不传后端默认 false） */
  ragEnabled?: boolean
}

/**
 * 创建文档节点入参（Notion 风格统一节点模型）
 * 与后端 CreateWikiNodeSchema 对齐：标题可选，未传时后端使用默认值「无标题文档」
 * parentId 可选，指定在哪个父节点下创建；不传则创建在根层级
 * 注：任何节点都可作为父节点，不再有"文件夹 / 文档"区分
 */
export interface CreateWikiNodeParams {
  /** 文档标题：可选，最长 100 字符 */
  title?: string
  /** 父节点 ID：可选，指定在哪个父节点下创建；不传则创建在根层级 */
  parentId?: string
}

/**
 * 文档树节点（扁平）
 * 与后端 wiki.service.ts 的 wikiNodeSelectFields 对齐
 * 前端 buildTree 构建嵌套结构
 * 注：Notion 风格统一节点模型 —— 每个节点都是文档，可同时拥有正文与子节点
 */
export interface WikiNodeItem {
  /** 节点 ID（ULID） */
  id: string
  /** 节点标题（文档标题） */
  title: string
  /** 父节点 ID，根层级为 null */
  parentId: string | null
  /** 同层级排序顺序 */
  sortOrder: number
  /** 节点内容格式：'md' 为默认富文本文档；'pdf'/'docx' 等文件型节点为预留扩展值 */
  docFormat: string
  /** 关联的文档 ID（每个节点都强制关联一个 documents 行） */
  documentId: string
  /** 关联文件 ID：仅 doc_format != 'md' 的文件型节点有值（指向 files 表行），'md' 节点为 null */
  fileId: string | null
  /** 节点图标（可选） */
  icon: string | null
  /** 是否可见 */
  isVisible: boolean | null
  /** 创建时间（ISO 字符串） */
  createdAt: string
  /** 更新时间（ISO 字符串） */
  updatedAt: string
}

/**
 * 文档正文
 * 与后端 wiki.service.ts 的 documentSelectFields 对齐
 */
export interface DocumentDetail {
  /** 文档 ID（ULID） */
  id: string
  /** 所属知识库 ID */
  wikiId: string
  /** 关联的节点 ID */
  nodeId: string
  /** Tiptap 编辑器 JSON 内容（可能为 null，表示空文档） */
  content: unknown | null
  /** 渲染后的 HTML 内容 */
  contentHtml: string | null
  /** 纯文本内容 */
  plainText: string | null
  /** 字数 */
  wordCount: number
  /** 状态：draft / published */
  status: string
  /** 更新时间（ISO 字符串） */
  updatedAt: string
}

/**
 * 文档标签项
 * 与后端 wiki.service.ts 的 tagSelectFields 对齐
 */
export interface DocumentTagItem {
  /** 标签 ID（ULID） */
  id: string
  /** 所属知识库 ID（null 表示全局标签，本系统内均为 wiki 级标签） */
  wikiId: string | null
  /** 标签名 */
  name: string
  /** 标签颜色（可能为 null） */
  color: string | null
  /** 创建时间（ISO 字符串） */
  createdAt: string
}

/**
 * 为文档添加标签入参
 * 与后端 CreateDocumentTagSchema 对齐：name 必填，color 可选
 */
export interface CreateDocumentTagParams {
  /** 标签名：1-30 字符 */
  name: string
  /** 标签颜色：可选，最长 20 字符（当前前端不传，保持 null） */
  color?: string
}

/**
 * 保存文档内容入参（自动保存接口）
 * 与后端 SaveDocumentSchema 对齐
 */
export interface SaveDocumentParams {
  /** Tiptap JSON 内容 */
  content: unknown
  /** 乐观锁：客户端持有的最后更新时间（ISO 字符串） */
  updatedAt: string
  /** 渲染后 HTML（可选） */
  contentHtml?: string
  /** 纯文本（可选） */
  plainText?: string
  /** 字数（可选） */
  wordCount?: number
}

/**
 * 更新知识库入参
 * 与后端 UpdateWikiSchema 对齐：name/description/icon/color/ragEnabled 均可选
 */
export interface UpdateWikiParams {
  /** 知识库名称（可选，2-50 字符） */
  name?: string
  /** 知识库描述（可选，最长 500 字符） */
  description?: string
  /** 知识库图标 key（可选） */
  icon?: string
  /** 知识库主题色 key（可选） */
  color?: string
  /** 是否自动 RAG 索引（可选，未传保持不变） */
  ragEnabled?: boolean
}

/**
 * 保存文档节点标题入参
 * 与后端 SaveWikiNodeTitleSchema 对齐
 */
export interface SaveNodeTitleParams {
  /** 文档标题：1-100 字符 */
  title: string
}

// ==================== 接口函数 ====================

/**
 * 获取当前用户的知识库列表
 * GET /wiki（需鉴权）
 *
 * 注意：必须禁用 alova 的 GET 默认缓存（cacheFor: null）。
 * 知识库列表是高频变更数据（新建/删除/分享配置变更后都会强制重拉），
 * 若走 5 分钟默认缓存，创建成功后 loadWikis(true) 拿到的仍是旧列表，
 * 新知识库不会立刻出现在 Dashboard（2026-09-14 修复）。
 *
 * @returns alova Method，send 后得到 WikiItem 数组（按 updatedAt 倒序）
 */
export function listWikis() {
  return alova.Get<WikiItem[]>(API_PATHS.WIKI.LIST, { cacheFor: null })
}

/**
 * 创建知识库
 * POST /wiki（需鉴权）
 *
 * @param params 名称 + 描述
 * @returns alova Method，send 后得到新建的知识库信息
 */
export function createWiki(params: CreateWikiParams) {
  return alova.Post<WikiItem>(API_PATHS.WIKI.CREATE, params)
}

/**
 * 获取知识库详情（仅 owner）
 * GET /wiki/:id（需鉴权）
 *
 * @param id 知识库 ID
 * @returns alova Method，send 后得到知识库详情
 */
export function getWiki(id: string) {
  return alova.Get<WikiItem>(`${API_PATHS.WIKI.DETAIL}/${id}`)
}

/**
 * 更新知识库基本信息（仅 owner）
 * PATCH /wiki/:id（需鉴权）
 *
 * @param id 知识库 ID
 * @param params 更新参数（name/description 可单独或同时修改）
 * @returns alova Method，send 后得到更新后的知识库信息
 */
export function updateWiki(id: string, params: UpdateWikiParams) {
  return alova.Patch<WikiItem>(`${API_PATHS.WIKI.UPDATE}/${id}`, params)
}

/**
 * 获取知识库文档树节点（扁平，仅 owner）
 * GET /wiki/:id/nodes（需鉴权）
 *
 * @param id 知识库 ID
 * @returns alova Method，send 后得到节点扁平数组（前端 buildTree 构建嵌套）
 */
export function listWikiNodes(id: string) {
  // 必须禁用 alova 的 GET 默认缓存（cacheFor: null，默认缓存 5 分钟）：
  // 恢复回收站后 loadDocs(force) 依赖本次请求拿到最新树，
  // 若命中缓存会读到恢复前的旧快照，导致恢复的文档在目录中"不出现"
  return alova.Get<WikiNodeItem[]>(`${API_PATHS.WIKI.NODES}/${id}/nodes`, { cacheFor: null })
}

/**
 * 在知识库根层级创建文档节点（仅 owner）
 * POST /wiki/:id/nodes（需鉴权）
 *
 * 后端事务内同时创建 documents + wikiNodes 记录，并追加到目标层级末尾（同级最大 sortOrder + 1）。
 * 入参为空对象时后端使用默认标题「无标题文档」。
 *
 * @param wikiId 知识库 ID
 * @param params 可选，title 未传走后端默认值
 * @returns alova Method，send 后得到新建节点（扁平结构，与 listWikiNodes 元素格式一致）
 */
export function createWikiNode(wikiId: string, params?: CreateWikiNodeParams) {
  return alova.Post<WikiNodeItem>(
    `${API_PATHS.WIKI.CREATE_NODE}/${wikiId}/nodes`,
    params ?? {}
  )
}

/**
 * 文档正文命中类型（搜索弹窗「内容命中」单条）
 * - headingPath：命中内容所在的标题路径（不含文档标题）
 * - heading：命中所在的最深标题文本（跳转锚点用，空串表示无标题结构的兜底命中）
 * - snippet：命中片段（关键词前后约 40 字符窗口，含省略号）
 */
export interface WikiContentHit {
  headingPath: string[]
  heading: string
  snippet: string
}

/**
 * 正文搜索单文档结果类型
 * - nodeId：节点 ID（跳转 /wiki/{wikiId}/{nodeId} 用）
 * - icon：节点 emoji 图标（可空）
 */
export interface WikiContentSearchResult {
  nodeId: string
  icon: string | null
  title: string
  hits: WikiContentHit[]
}

/**
 * 文档正文关键词搜索（仅 owner，搜索弹窗「内容命中」）
 * POST /wiki/:id/search（需鉴权）
 *
 * 后端 SQL ILIKE 粗筛候选文档后，遍历 Tiptap JSON 定位命中所在标题（标题路径 + 片段）。
 * 无命中返回空数组；标题命中由前端本地过滤文档树实现，不走本接口。
 *
 * @param wikiId 知识库 ID
 * @param q 搜索关键词（1-100 字符）
 * @returns alova Method，send 后得到命中文档列表
 */
export function searchWikiContent(wikiId: string, q: string) {
  return alova.Post<WikiContentSearchResult[]>(
    `${API_PATHS.WIKI.CONTENT_SEARCH}/${wikiId}/search`,
    { q }
  )
}

/**
 * 获取文档正文内容（仅 owner）
 * GET /wiki/document/:id（需鉴权）
 *
 * @param id 文档 ID（对应 wikiNodes.documentId）
 * @returns alova Method，send 后得到文档记录（含 Tiptap JSON content）
 */
export function getDocument(id: string) {
  return alova.Get<DocumentDetail>(`${API_PATHS.WIKI.DOCUMENT}/${id}`)
}

/**
 * 获取文档已关联的标签列表（仅 owner）
 * GET /wiki/document/:id/tags（需鉴权）
 *
 * 新文档默认无标签，返回空数组。
 *
 * @param documentId 文档 ID（对应 wikiNodes.documentId）
 * @returns alova Method，send 后得到标签数组（按 createdAt 升序）
 */
export function listDocumentTags(documentId: string) {
  return alova.Get<DocumentTagItem[]>(`${API_PATHS.WIKI.DOCUMENT}/${documentId}/tags`)
}

/**
 * 为文档添加标签（仅 owner）
 * POST /wiki/document/:id/tags（需鉴权）
 *
 * 后端 find-or-create：在该文档所属 wiki 内按 name 查找标签，
 * 不存在则新建；再插入 document_tags 关联（幂等，重复关联不报错）。
 *
 * @param documentId 文档 ID
 * @param params 标签名 + 可选颜色
 * @returns alova Method，send 后得到标签对象（含 id / name / color）
 */
export function addDocumentTag(documentId: string, params: CreateDocumentTagParams) {
  return alova.Post<DocumentTagItem>(`${API_PATHS.WIKI.DOCUMENT}/${documentId}/tags`, params)
}

/**
 * 解除文档与标签的关联（仅 owner）
 * DELETE /wiki/document/:id/tags/:tagId（需鉴权）
 *
 * 仅删 document_tags 关联行，不删标签本体（标签可被同 wiki 其他文档复用）。
 * 未关联时后端抛 50006 TAG_NOT_FOUND。
 *
 * @param documentId 文档 ID
 * @param tagId 标签 ID
 * @returns alova Method，send 后得到 null
 */
export function removeDocumentTag(documentId: string, tagId: string) {
  return alova.Delete<null>(`${API_PATHS.WIKI.DOCUMENT}/${documentId}/tags/${tagId}`)
}

/**
 * 保存文档内容（自动保存接口）
 * POST /wiki/document/:id/save（需鉴权）
 *
 * - 使用乐观锁（updatedAt）防止并发覆盖
 * - 后端有 rate limit：10 秒内同一文档+用户最多 1 次请求
 *
 * @param id 文档 ID（对应 documents.id）
 * @param params 保存参数（content + updatedAt 必传）
 * @returns alova Method，send 后得到更新后的文档信息（含最新 updatedAt）
 */
export function saveDocument(id: string, params: SaveDocumentParams) {
  return alova.Post<DocumentDetail>(`${API_PATHS.WIKI.DOCUMENT_SAVE}/${id}/save`, params)
}

/**
 * 保存文档节点标题
 * POST /wiki/:id/save-title（需鉴权）
 *
 * @param id 节点 ID（对应 wikiNodes.id）
 * @param params 保存参数（title 必传）
 * @returns alova Method，send 后得到更新后的节点信息
 */
export function saveNodeTitle(id: string, params: SaveNodeTitleParams) {
  return alova.Post<WikiNodeItem>(`${API_PATHS.WIKI.NODE_TITLE_SAVE}/${id}/save-title`, params)
}

/**
 * 保存文档节点图标（emoji）
 * POST /wiki/:id/save-icon（需鉴权）
 *
 * @param id 节点 ID（对应 wikiNodes.id）
 * @param params 保存参数（icon 为 emoji 字符串，空字符串表示清除图标）
 * @returns alova Method，send 后得到更新后的节点信息
 */
export function saveNodeIcon(id: string, params: SaveNodeIconParams) {
  return alova.Post<WikiNodeItem>(`${API_PATHS.WIKI.NODE_ICON_SAVE}/${id}/save-icon`, params)
}

/**
 * 保存图标参数
 */
export interface SaveNodeIconParams {
  /** emoji 字符串，空字符串表示清除图标 */
  icon: string
}

/**
 * 删除文档节点（级联删除，含所有子节点）
 * POST /wiki/:id/delete（需鉴权）
 *
 * 若为文件夹，会递归删除所有子节点及关联的 documents 记录
 *
 * @param id 节点 ID（对应 wikiNodes.id）
 * @returns alova Method，send 后得到 null
 */
export function deleteWikiNode(id: string) {
  return alova.Post<null>(`${API_PATHS.WIKI.DELETE_NODE}/${id}/delete`, {})
}

/**
 * 移动文档节点参数（拖拽排序持久化）
 * 与后端 MoveWikiNodeSchema 对齐
 */
export interface MoveWikiNodeParams {
  /** 目标父节点 ID；null 表示移动到根层级 */
  parentId: string | null
  /** 目标位置索引：被移动节点从原位置移除后的同级最终下标（0 起），超界服务端收敛到末尾 */
  index: number
}

/**
 * 移动文档节点（拖拽排序持久化，仅 owner）
 * POST /wiki/node/:nodeId/move（需鉴权）
 *
 * 服务端事务内对目标同级列表整段重编号 sortOrder = 0..n：
 * 被移动节点更新 parentId + sortOrder，其余兄弟回写新 sortOrder
 *
 * @param nodeId 被移动节点 ID（wikiNodes.id）
 * @param params 目标位置（parentId + index）
 * @returns alova Method，send 后得到 null
 */
export function moveWikiNode(nodeId: string, params: MoveWikiNodeParams) {
  return alova.Post<null>(`${API_PATHS.WIKI.NODE_MOVE}/${nodeId}/move`, params)
}

/**
 * 回收站条目（顶层删除项）
 * 与后端 WikiTrashItem 对齐；嵌套子项跟随顶层条目展示，不单独出现
 */
export interface TrashItem {
  /** 顶层被删节点 ID（wikiNodes.id），恢复/彻底删除接口使用该 ID */
  id: string
  /** 节点标题 */
  title: string
  /** 节点 emoji 图标（可空） */
  icon: string | null
  /** 关联文档 ID（documents.id） */
  documentId: string
  /** 删除时间（ISO 字符串，后端取删除时冻结的 updatedAt） */
  deletedAt: string
  /** 子树总节点数（含自身），展示「N 项」用 */
  count: number
}

/**
 * 查询知识库回收站列表（顶层删除项，按删除时间倒序）
 * POST /wiki/:wikiId/trash（需鉴权，仅 owner）
 *
 * @param wikiId 知识库 ID
 * @returns alova Method，send 后得到 TrashItem[]
 */
export function listTrash(wikiId: string) {
  return alova.Post<TrashItem[]>(`${API_PATHS.WIKI.TRASH}/${wikiId}/trash`)
}

/**
 * 恢复回收站节点（整棵子树恢复）
 * POST /wiki/:id/trash/restore（需鉴权，仅 owner）
 *
 * 原父节点缺失或仍在回收站时，节点会挂到根层级末尾
 *
 * @param id 节点 ID（wikiNodes.id）
 * @returns alova Method，send 后得到恢复后的节点信息
 */
export function restoreTrashNode(id: string) {
  return alova.Post<WikiNodeItem>(`${API_PATHS.WIKI.TRASH_RESTORE}/${id}/trash/restore`)
}

/**
 * 彻底删除结果：被级联删除的节点 / 文档 ID 列表
 * 前端据此判断当前打开文档是否在被删子树内（需跳转离开）
 */
export interface PurgeResult {
  /** 被彻底删除的节点 ID 列表（wikiNodes.id，子树整体） */
  nodeIds: string[]
  /** 被彻底删除的文档 ID 列表（documents.id） */
  documentIds: string[]
}

/**
 * 彻底删除回收站节点（硬删除，不可恢复）
 * POST /wiki/:id/trash/purge（需鉴权，仅 owner）
 *
 * 级联清理正文 / 历史版本 / RAG 索引 / 页级分享配置
 *
 * @param id 节点 ID（wikiNodes.id）
 * @returns alova Method，send 后得到 PurgeResult
 */
export function purgeTrashNode(id: string) {
  return alova.Post<PurgeResult>(`${API_PATHS.WIKI.TRASH_PURGE}/${id}/trash/purge`)
}

/**
 * 一键清空回收站（硬删除该库回收站全部内容，不可恢复）
 * POST /wiki/:wikiId/trash/empty（需鉴权，仅 owner）
 *
 * 级联清理范围与单节点 purge 一致（正文 / 历史版本 / RAG 索引 / 页级分享配置）
 *
 * @param wikiId 知识库 ID
 * @returns alova Method，send 后得到 PurgeResult
 */
export function purgeAllTrash(wikiId: string) {
  return alova.Post<PurgeResult>(`${API_PATHS.WIKI.TRASH_EMPTY}/${wikiId}/trash/empty`)
}

/**
 * 删除知识库（软删除移入回收站，仅 owner）
 * POST /wiki/:id/delete-wiki（需鉴权）
 *
 * 软删除语义：仅标记 is_deleted，不再级联硬删；
 * 移入回收站后该库的访客分享、发布站点、AI 问答、预览全部即时失效；
 * 可通过 restoreWikiTrash 恢复，彻底删除用 purgeWikiTrash / emptyWikiTrash
 *
 * @param id 知识库 ID（wikis.id）
 * @returns alova Method，send 后得到 null
 */
export function deleteWiki(id: string) {
  return alova.Post<null>(`${API_PATHS.WIKI.DELETE_WIKI}/${id}/delete-wiki`, {})
}

/**
 * 知识库回收站条目（软删除的知识库）
 * 与后端 WikiRecycleItem 对齐；deletedAt 取删除时冻结的 updatedAt
 */
export interface WikiTrashItem {
  /** 知识库 ID（wikis.id），恢复/彻底删除接口使用该 ID */
  id: string
  /** 知识库名称 */
  name: string
  /** 知识库描述（可空） */
  description: string | null
  /** 知识库 emoji 图标（可空） */
  icon: string | null
  /** 知识库主题色（可空） */
  color: string | null
  /** 库内正常文档数（实时子查询，恢复后原样可用） */
  docCount: number
  /** 删除时间（ISO 字符串，删除时冻结的 updatedAt） */
  deletedAt: string
}

/**
 * 查询知识库回收站列表（软删除的知识库，按删除时间倒序）
 * POST /wiki/trash（需鉴权，仅 owner）
 *
 * @returns alova Method，send 后得到 WikiTrashItem[]
 */
export function listWikiTrash() {
  return alova.Post<WikiTrashItem[]>(`${API_PATHS.WIKI.WIKI_TRASH_LIST}`)
}

/**
 * 从回收站恢复知识库（撤销软删除，仅 owner）
 * POST /wiki/:id/restore（需鉴权）
 *
 * 恢复后分享/发布配置原样保留，访客访问自动恢复
 *
 * @param id 知识库 ID（wikis.id）
 * @returns alova Method，send 后得到恢复后的知识库信息
 */
export function restoreWikiTrash(id: string) {
  return alova.Post<WikiItem>(`${API_PATHS.WIKI.WIKI_RESTORE}/${id}/restore`, {})
}

/**
 * 彻底删除回收站中的知识库（硬删除级联清理，不可恢复）
 * POST /wiki/:id/purge（需鉴权，仅 owner）
 *
 * 级联清理范围与旧硬删除一致：文档树、正文、历史版本、分享配置、发布配置、RAG 向量
 *
 * @param id 知识库 ID（wikis.id）
 * @returns alova Method，send 后得到 null
 */
export function purgeWikiTrash(id: string) {
  return alova.Post<null>(`${API_PATHS.WIKI.WIKI_PURGE}/${id}/purge`, {})
}
