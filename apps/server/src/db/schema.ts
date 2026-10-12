import { pgTable, text, timestamp, jsonb, boolean, integer, varchar, index, uniqueIndex } from 'drizzle-orm/pg-core'
import { ulid } from 'ulid'

/**
 * 统一 ID 生成函数：生成小写 ULID
 * 网站全站（URL / 分享链接 / 数据库）统一使用小写 ID，避免大小写混用导致
 * PostgreSQL text 大小写敏感查询不命中；lower() 不影响 ULID 的时序单调性
 */
const generateId = () => ulid().toLowerCase()

/**
 * 用户表
 * 存储注册用户的基本信息
 */
export const users = pgTable('users', {
  /** ULID 主键（应用层生成） */
  id: text('id').primaryKey().$defaultFn(() => generateId()),
  /** 用户昵称 */
  nickname: text('nickname').notNull(),
  /** 用户邮箱，唯一 */
  email: text('email').notNull().unique(),
  /** 密码哈希值 */
  passwordHash: text('password_hash').notNull(),
  /** 用户头像 URL */
  avatar: text('avatar'),
  /** 用户状态：active - 正常，disabled - 禁用 */
  status: text('status').default('active').notNull(),
  /** 最后登录时间 */
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  /** API 密钥，用于插件认证 */
  apiKey: text('api_key').unique(),
  /** 用户偏好设置 */
  preferences: jsonb('preferences').$type<{
    theme?: 'light' | 'dark' | 'auto'
    language?: string
    defaultModel?: string
    notifications?: boolean
  }>(),
  /** 记录创建时间 */
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  /** 记录更新时间 */
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

/** 用户表查询结果类型 */
export type User = typeof users.$inferSelect
/** 用户表插入数据类型 */
export type NewUser = typeof users.$inferInsert

/**
 * 用户 Token 表
 * 存储用户登录 token，支持插件与网站统一登录
 */
export const userToken = pgTable('user_token', {
  /** ULID 主键（应用层生成） */
  id: text('id').primaryKey().$defaultFn(() => generateId()),
  /** 用户 ID，唯一约束，一个用户只有一条 token 记录 */
  userId: text('user_id').notNull().unique(),
  /** 设备唯一标识 */
  deviceId: text('device_id').notNull(),
  /** 用户登录 token（ULID 生成） */
  token: text('token').notNull(),
  /** token 过期时间 */
  tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),
  /** 记录创建时间 */
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  /** 记录更新时间 */
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

/** 用户 Token 表查询结果类型 */
export type UserToken = typeof userToken.$inferSelect
/** 用户 Token 表插入数据类型 */
export type NewUserToken = typeof userToken.$inferInsert

// ============ 知识库领域表 ============

/**
 * 知识库表（Wiki）
 * 存储用户创建的知识库，为文档的顶层容器
 */
export const wiki = pgTable('wiki', {
  /** ULID 主键（应用层生成） */
  id: text('id').primaryKey().$defaultFn(() => generateId()),
  /** 知识库名称 */
  name: text('name').notNull(),
  /** 知识库描述 */
  description: text('description'),
  /** 知识库图标（emoji 或图标标识） */
  icon: text('icon'),
  /** 主题色 */
  color: text('color'),
  /** 创建者/拥有者用户 ID */
  ownerId: text('owner_id').notNull(),
  /** 可见性：private - 私有, internal - 团队内, public - 公开 */
  visibility: text('visibility').default('private').notNull(),
  /** 状态：active - 正常, archived - 已归档 */
  status: text('status').default('active').notNull(),
  /** 文档数量（冗余计数，创建/删除时同步更新） */
  docCount: integer('doc_count').default(0).notNull(),
  /** 成员数量（创建者默认计入 1 人，添加/移除成员时同步更新） */
  memberCount: integer('member_count').default(1).notNull(),
  /**
   * 是否自动 RAG 索引：true - 文档保存后自动入队切片+向量化；
   * false - 关闭（默认，不入队；已入库向量保留，检索/问答仍可用，手动路径为 /rag/reindex）
   */
  ragEnabled: boolean('rag_enabled').default(false).notNull(),
  /** 记录创建时间 */
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  /** 记录更新时间 */
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  /** 软删除标记：false = 正常；true = 在回收站中（恢复时置回 false） */
  isDeleted: boolean('is_deleted').default(false).notNull(),
})

/**
 * 知识库成员表
 * 存储知识库的协作者信息
 */
export const wikiMembers = pgTable('wiki_members', {
  /** ULID 主键（应用层生成） */
  id: text('id').primaryKey().$defaultFn(() => generateId()),
  /** 知识库 ID */
  wikiId: text('wiki_id').notNull(),
  /** 用户 ID */
  userId: text('user_id').notNull(),
  /** 角色：owner - 所有者, admin - 管理员, writer - 编辑者, reader - 阅读者 */
  role: text('role').notNull(),
  /** 加入时间 */
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  wikiIdUserIdUnique: uniqueIndex('wiki_members_wiki_id_user_id_unique').on(table.wikiId, table.userId),
}))

/**
 * 文档树节点表（Notion 风格统一节点模型）
 * 每个节点都是文档，可同时拥有正文内容（关联 documents 行）与无限层级子节点
 */
export const wikiNodes = pgTable('wiki_nodes', {
  /** ULID 主键（应用层生成） */
  id: text('id').primaryKey().$defaultFn(() => generateId()),
  /** 所属知识库 ID */
  wikiId: text('wiki_id').notNull(),
  /** 父节点 ID，为 null 表示根层级 */
  parentId: text('parent_id'),
  /** 同层级排序顺序（真整数，非 ID 引用） */
  sortOrder: integer('sort_order').default(0).notNull(),
  /** 节点标题（文档标题） */
  title: text('title').notNull(),
  /**
   * 节点内容格式（扩展字段，为未来接入 PDF/Word 等文件节点预留）
   * - 'md'：默认值，Markdown 富文本文档（Tiptap 编辑器 JSON，存于 documents.content）
   * - 'pdf' / 'docx' 等：文件型节点（预留，原始文件元数据存 files 表，通过 fileId 绑定；
   *   documents 行仍存在但 content 为空，保持「每节点一行 documents」的既有约束）
   * 现阶段所有节点均为 'md'，消费方读到非 'md' 值前无需关心此字段
   */
  docFormat: text('doc_format').default('md').notNull(),
  /** 关联的文档 ID（每个节点都强制关联一个 documents 行） */
  documentId: text('document_id').notNull(),
  /**
   * 关联文件 ID（仅 doc_format != 'md' 的文件型节点使用，'md' 节点为 null）
   * 指向 files 表行；无数据库外键，应用层维护一致性（创建/删除节点时同步处理 files 行）
   */
  fileId: text('file_id'),
  /** 文件夹图标（可选） */
  icon: text('icon'),
  /** 文章封面图 URL（可选，博客形态列表卡使用；为空时回退正文第一图） */
  coverUrl: text('cover_url'),
  /** 是否可见 */
  isVisible: boolean('is_visible').default(true),
  /** 创建人用户 ID */
  createdBy: text('created_by'),
  /** 记录创建时间 */
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  /** 记录更新时间 */
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  /** 软删除标记：false = 正常（树中可见）；true = 已进入回收站（删除时刻取 updatedAt，删除时同步写入冻结） */
  isDeleted: boolean('is_deleted').default(false).notNull(),
}, (table) => ({
  wikiIdIndex: index('wiki_nodes_wiki_id_idx').on(table.wikiId),
  parentIdIndex: index('wiki_nodes_parent_id_idx').on(table.parentId),
}))

/**
 * 文档表
 * 存储文档的正文内容（与节点表分离，标题与树结构存于节点表）
 */
export const documents = pgTable('documents', {
  /** ULID 主键（应用层生成） */
  id: text('id').primaryKey().$defaultFn(() => generateId()),
  /** 所属知识库 ID */
  wikiId: text('wiki_id').notNull(),
  /** 关联的节点 ID */
  nodeId: text('node_id').notNull(),
  /** Tiptap 编辑器 JSON 内容 */
  content: jsonb('content'),
  /** 渲染后的 HTML 内容（用于列表展示/导出） */
  contentHtml: text('content_html'),
  /** 纯文本内容（用于搜索/字数统计） */
  plainText: text('plain_text'),
  /** 内容 MD5 指纹（规范化 JSON 序列化后取 32 位 hex；保存时服务端计算写入，内容级去重/校验用） */
  contentMd5: varchar('content_md5', { length: 32 }),
  /** 字数（真整数，非 ID 引用） */
  wordCount: integer('word_count').default(0).notNull(),
  /** 状态：draft - 草稿, published - 已发布 */
  status: text('status').default('draft').notNull(),
  /** 安全级别：private - 私有, public - 公开 */
  securityLevel: text('security_level').default('private').notNull(),
  /** 是否锁定编辑 */
  isLocked: boolean('is_locked').default(false).notNull(),
  /** 创建人用户 ID */
  creatorId: text('creator_id'),
  /** 最后编辑人用户 ID */
  lastEditorId: text('last_editor_id'),
  /** 记录创建时间 */
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  /** 记录更新时间 */
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  wikiIdIndex: index('documents_wiki_id_idx').on(table.wikiId),
}))

/**
 * 文档版本表
 * 存储文档的历史版本，用于版本回溯与变更记录
 */
export const documentVersions = pgTable('document_versions', {
  /** ULID 主键（应用层生成） */
  id: text('id').primaryKey().$defaultFn(() => generateId()),
  /** 关联文档 ID */
  documentId: text('document_id').notNull(),
  /** 版本号（同一文档内递增，真整数） */
  version: integer('version').notNull(),
  /** 该版本的标题快照 */
  title: text('title'),
  /** 该版本的 JSON 内容快照 */
  content: jsonb('content'),
  /** 该版本的 HTML 内容 */
  contentHtml: text('content_html'),
  /** 该版本的字数（真整数） */
  wordCount: integer('word_count').default(0).notNull(),
  /** 编辑人用户 ID */
  editorId: text('editor_id'),
  /** 版本说明/备注 */
  note: text('note'),
  /** 创建时间 */
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  documentIdVersionUnique: uniqueIndex('document_versions_document_id_version_unique').on(table.documentId, table.version),
}))

/**
 * 文档评论表
 * 存储文档的评论与回复
 */
export const documentComments = pgTable('document_comments', {
  /** ULID 主键（应用层生成） */
  id: text('id').primaryKey().$defaultFn(() => generateId()),
  /** 关联文档 ID */
  documentId: text('document_id').notNull(),
  /** 评论人用户 ID */
  userId: text('user_id').notNull(),
  /** 评论内容 */
  content: text('content').notNull(),
  /** 回复的父评论 ID（可选，支持嵌套回复） */
  parentId: text('parent_id'),
  /** 记录创建时间 */
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  /** 记录更新时间 */
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  documentIdIndex: index('document_comments_document_id_idx').on(table.documentId),
}))

/**
 * 最近访问表
 * 记录用户最近访问的知识库和文档，用于 Dashboard 最近访问列表
 */
export const recentVisits = pgTable('recent_visits', {
  /** ULID 主键（应用层生成） */
  id: text('id').primaryKey().$defaultFn(() => generateId()),
  /** 用户 ID */
  userId: text('user_id').notNull(),
  /** 目标类型：wiki - 知识库, document - 文档 */
  targetType: text('target_type').notNull(),
  /** 目标 ID */
  targetId: text('target_id').notNull(),
  /** 最近访问时间 */
  lastVisitedAt: timestamp('last_visited_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  userTargetUnique: uniqueIndex('recent_visits_user_id_target_unique').on(table.userId, table.targetType, table.targetId),
}))

/**
 * 收藏表
 * 存储用户收藏的知识库或文档
 */
export const favorites = pgTable('favorites', {
  /** ULID 主键（应用层生成） */
  id: text('id').primaryKey().$defaultFn(() => generateId()),
  /** 用户 ID */
  userId: text('user_id').notNull(),
  /** 目标类型：wiki - 知识库, document - 文档 */
  targetType: text('target_type').notNull(),
  /** 目标 ID */
  targetId: text('target_id').notNull(),
  /** 收藏时间 */
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  userTargetUnique: uniqueIndex('favorites_user_id_target_unique').on(table.userId, table.targetType, table.targetId),
}))

/**
 * 活动/动态表
 * 存储用户在知识库中的操作记录，用于动态时间线
 */
export const activities = pgTable('activities', {
  /** ULID 主键（应用层生成） */
  id: text('id').primaryKey().$defaultFn(() => generateId()),
  /** 所属知识库 ID（可选） */
  wikiId: text('wiki_id'),
  /** 操作者用户 ID */
  userId: text('user_id').notNull(),
  /** 操作类型：create / update / comment / star / member_join ... */
  actionType: text('action_type').notNull(),
  /** 目标类型：document / wiki / comment / member */
  targetType: text('target_type').notNull(),
  /** 目标 ID */
  targetId: text('target_id'),
  /** 动态摘要/描述 */
  content: text('content'),
  /** 发生时间 */
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  wikiIdIndex: index('activities_wiki_id_idx').on(table.wikiId),
  createdAtIndex: index('activities_created_at_idx').on(table.createdAt),
}))

/**
 * 标签表
 * 存储知识库内或全局的标签
 */
export const tags = pgTable('tags', {
  /** ULID 主键（应用层生成） */
  id: text('id').primaryKey().$defaultFn(() => generateId()),
  /** 所属知识库 ID（null 表示全局标签） */
  wikiId: text('wiki_id'),
  /** 标签名称 */
  name: text('name').notNull(),
  /** 标签颜色 */
  color: text('color'),
  /** 创建时间 */
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  wikiNameUnique: uniqueIndex('tags_wiki_id_name_unique').on(table.wikiId, table.name),
}))

/**
 * 文档-标签关联表
 * 多对多关联文档与标签
 */
export const documentTags = pgTable('document_tags', {
  /** ULID 主键（应用层生成） */
  id: text('id').primaryKey().$defaultFn(() => generateId()),
  /** 文档 ID */
  documentId: text('document_id').notNull(),
  /** 标签 ID */
  tagId: text('tag_id').notNull(),
  /** 关联时间 */
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  documentTagUnique: uniqueIndex('document_tags_document_id_tag_id_unique').on(table.documentId, table.tagId),
}))

/**
 * 媒体资产表（图片 / 附件等）
 * 记录所有通过后端上传的媒体文件元信息：
 * - 不直接存储文件内容，仅记录元数据，文件落盘到 public/uploads/{date}/{ulid}.{ext}
 * - 通过 url 字段对外提供访问路径（前端直接用作 <img src>）
 * - 不使用外键，wikiId / documentId 仅作软关联，删除对应记录时由业务层处理级联清理
 */
export const mediaAssets = pgTable('media_assets', {
  /** ULID 主键（应用层生成） */
  id: text('id').primaryKey().$defaultFn(() => generateId()),
  /** 上传人用户 ID */
  userId: text('user_id').notNull(),
  /** 所属知识库 ID（软关联，可空表示未绑定具体 wiki） */
  wikiId: text('wiki_id'),
  /** 所属文档 ID（软关联，可空表示未绑定具体文档） */
  documentId: text('document_id'),
  /** 存储后的文件名（含扩展名，如 01HXXXXXXXX.jpg） */
  fileName: text('file_name').notNull(),
  /** 相对存储路径（如 uploads/2026-08-25/01HXXX.jpg，用于磁盘定位） */
  filePath: text('file_path').notNull(),
  /** 用户上传时的原始文件名（用于下载、展示） */
  originalName: text('original_name'),
  /** MIME 类型（如 image/jpeg、image/png） */
  mimeType: text('mime_type').notNull(),
  /** 文件大小（字节） */
  size: integer('size').notNull(),
  /** 图片宽度（像素，仅图片类型有值，可选） */
  width: integer('width'),
  /** 图片高度（像素，仅图片类型有值，可选） */
  height: integer('height'),
  /** 对外访问 URL（相对路径 /media/{bucket}/{key}，浏览器按当前 origin 解析，前端直接用作 src） */
  url: text('url').notNull(),
  /**
   * 媒体类别（对象键一级前缀）：img / file / video / audio / avatar / export
   * 决定权限模式（img/avatar 公开直连，file/video/audio/export 私有预签名下载）
   * 存量 uploads/ 旧键的行由回填脚本按 mimeType 补齐
   */
  kind: text('kind'),
  /**
   * 生命周期状态：attached（已被文档引用）/ orphan（未关联，TTL 清理候选）/ deleted（待清理）
   * 上传时带 documentId 即 attached，否则 orphan；引用扫描与清理 job 维护（见媒体文件存储设计）
   */
  status: text('status'),
  /** 文件内容 SHA-256（上传时计算；用于备份完整性巡检，去重秒传不做） */
  contentHash: text('content_hash'),
  /** 记录创建时间 */
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  /** 记录更新时间 */
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  userIdIndex: index('media_assets_user_id_idx').on(table.userId),
  wikiIdIndex: index('media_assets_wiki_id_idx').on(table.wikiId),
  documentIdIndex: index('media_assets_document_id_idx').on(table.documentId),
  // 媒体库按知识库+类别筛选
  kindIndex: index('media_assets_wiki_kind_idx').on(table.wikiId, table.kind),
  // 清理 job 按 状态+时间 捞候选（orphan 超时 / deleted）
  statusIndex: index('media_assets_status_created_idx').on(table.status, table.createdAt),
}))

/**
 * 文件表（节点级附件，任意格式）
 * 为文件型节点（wiki_nodes.doc_format != 'md'，如 pdf / docx / xlsx / zip）承载原始文件的元数据：
 * - 不直接存储文件内容，仅记录元数据，文件落盘到 public/uploads/{date}/{ulid}.{ext}
 * - 与 media_assets 的分工：media_assets 定位「文档正文内嵌资源」（图片等，软关联 documents）；
 *   files 定位「节点本身就是文件」（由 wiki_nodes.file_id 绑定），与 documents 行无依赖
 * - 任意格式均入此表，格式差异由 mimeType 区分，不为单一格式加专属列
 * - 不使用外键，wikiId 为软关联，删除知识库/节点时由业务层处理级联清理（files 行 + 磁盘文件）
 */
export const files = pgTable('files', {
  /** ULID 主键（应用层生成） */
  id: text('id').primaryKey().$defaultFn(() => generateId()),
  /** 所属知识库 ID（软关联，用于权限判定与级联清理） */
  wikiId: text('wiki_id').notNull(),
  /** 存储后的文件名（含扩展名，如 01HXXXXXXXX.pdf） */
  fileName: text('file_name').notNull(),
  /** 相对存储路径（如 uploads/2026-09-24/01HXXX.pdf，用于磁盘定位） */
  filePath: text('file_path').notNull(),
  /** 用户上传时的原始文件名（用于下载命名、节点标题回填） */
  originalName: text('original_name').notNull(),
  /** MIME 类型（任意格式，如 application/pdf、application/zip） */
  mimeType: text('mime_type').notNull(),
  /** 文件大小（字节） */
  size: integer('size').notNull(),
  /** 对外访问 URL（如 /uploads/2026-09-24/01HXXX.pdf，前端直接用作预览/下载 src） */
  url: text('url').notNull(),
  /** 上传人用户 ID */
  createdBy: text('created_by'),
  /** 记录创建时间 */
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  /** 记录更新时间 */
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  wikiIdIndex: index('files_wiki_id_idx').on(table.wikiId),
}))

/**
 * 知识库分享权限表（统一权限表，只承载访问控制）
 * 同时承载「库级」和「页面级」分享权限，通过 node_id 区分行级别：
 * - node_id = ''（空字符串）：库级行，每个知识库固定一行
 * - node_id 非空：页面级覆盖行（稀疏，仅页面覆盖配置时存在）
 * - shareStatus：库级行存 'private' | 'public'；页级行存 'inherit' | 'public' | 'private'
 * - password 为明文（定位类似网盘提取码，非登录凭证；owner 弹窗可回显）
 * - mode 预留 'edit'（编辑分享），v1 仅支持 'view'
 *
 * 注：站点形态/外观发布配置已拆至 wiki_publish 表（share/publish 语义拆分）——
 * 本表只管"分享给别人看"（访问控制），"发布成站点"见 wikiPublish
 */
export const wikiShares = pgTable('wiki_shares', {
  /** 权限行 ID（ULID 主键，应用层生成） */
  id: text('id').primaryKey().$defaultFn(() => generateId()),
  /** 知识库 ID */
  wikiId: text('wiki_id').notNull(),
  /** 节点 ID：'' = 库级行（每库固定一行），非空 = 页面级覆盖行（仅覆盖时存在，稀疏） */
  nodeId: text('node_id').notNull().default(''),
  /** 分享状态：库级行存 'private' | 'public'；页级行存 'inherit' | 'public' | 'private' */
  shareStatus: text('share_status').notNull().default('private'),
  /** 分享密码明文（定位类似网盘提取码，非登录凭证；owner 弹窗可回显） */
  password: text('password'),
  /** 分享模式：view - 浏览；edit 预留 */
  mode: text('mode').default('view').notNull(),
  /** 创建人用户 ID（owner） */
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  /** 每个库每级最多一行：库级行 node_id=''，页级行按节点唯一 */
  wikiNodeUnique: uniqueIndex('wiki_shares_wiki_node_uniq').on(table.wikiId, table.nodeId),
}))

/**
 * 知识库发布配置表（一库一条，wiki_id 唯一）
 *
 * 与 wiki_shares 的职责边界（share/publish 语义拆分）：
 * - wiki_shares：访问控制（库级/页级 shareStatus、password、mode）——"分享给别人看"
 * - wiki_publish：发布配置（站点形态 + 站点外观）——"发布成站点"（wiki 帮助中心 / blog 博客等形态）
 *
 * 设计要点：settings 用 jsonb 存放自由配置集合（写入经 zod 校验、未知键剥离），
 * 新增设置项只改 zod 校验与读写代码，**表结构零变更**；读取按字段兜底默认值。
 * 页级分享不产生 publish 行（外观/形态是库级语义）。
 */
export const wikiPublish = pgTable('wiki_publish', {
  /** 发布配置 ID（ULID 主键，应用层生成；迁移时复用原 wiki_shares 库级行 id） */
  id: text('id').primaryKey().$defaultFn(() => generateId()),
  /** 知识库 ID（每库一条发布配置） */
  wikiId: text('wiki_id').notNull(),
  /**
   * 站点形态（原 wiki_shares.site_template）：
   * - 'help'：帮助中心（默认，分组目录 + 文档树，pages 站 /w/:wikiId）
   * - 'blog'：博客（卡片列表 + 文章页，pages 站 /b/:wikiId）
   * text 列 + 应用层 zod enum 校验，未来加新形态枚举不需要迁移
   */
  publishType: text('publish_type').notNull().default('help'),
  /**
   * 发布开关（库是否已发布成公开站点）：
   * - true：已发布（pages 公开站可达，Dashboard 列表「已发布」徽标数据源）
   * - false：未发布/已下架（配置行保留，重新发布形态与外观不变）
   * 发布动作（POST /publish/wiki/:wikiId/publish）置 true；取消发布置 false；
   * 仅保存外观设置（PUT settings）不改变本开关。
   * 注：历史"存在配置行即已发布"的判定由本列替代，存量行迁移时回填 true。
   */
  enabled: boolean('enabled').notNull().default(false),
  /**
   * 站点外观与发布设置（jsonb，自由配置集合），已知键：
   * - siteTitle: 站点标题（null/缺省 = 回退 wiki.name）
   * - siteLogo: Logo 图片 URL（null/缺省 = 回退默认品牌图）
   * - siteColor: 主题色 hex（null/缺省 = 回退默认主题色）
   * - aiEnabled: AI 助手开关（缺省 = true）
   * - navButtons: 页头导航按钮 { title, href }[]（null/缺省 = 不渲染）
   * 写入经 PublishSettingsSchema 校验（未知键剥离），读取按字段兜底，历史行缺字段自然回退
   */
  settings: jsonb('settings').notNull().default({}),
  /** 创建人用户 ID（owner） */
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  /** 每库最多一条发布配置 */
  wikiUnique: uniqueIndex('wiki_publish_wiki_uniq').on(table.wikiId),
}))

// ============ RAG / AI 知识库领域表 ============

/**
 * RAG 索引同步状态表（任务队列落库）
 * 每个文档一行，记录其向量化索引的同步状态：
 * - 文档保存时 upsert 为 pending（由 wiki.service.saveDocument 挂钩触发），作为轻量任务队列
 * - 进程内 worker（rag.worker.ts）轮询 pending/failed 行执行「切片 → 向量化 → 写入 rag_chunks」
 * - 状态落库保证进程重启不丢任务；running 行在启动时会被重置为 pending（崩溃自愈）
 */
export const ragSync = pgTable('rag_sync', {
  /** ULID 主键（应用层生成） */
  id: text('id').primaryKey().$defaultFn(() => generateId()),
  /** 关联文档 ID（一个文档最多一行同步状态） */
  documentId: text('document_id').notNull().unique(),
  /** 所属知识库 ID（冗余存储，便于按库统计与全量重建索引） */
  wikiId: text('wiki_id').notNull(),
  /** 同步状态：pending - 待处理, running - 处理中, done - 已完成, failed - 失败（重试超限后不再处理） */
  status: text('status').default('pending').notNull(),
  /**
   * 文档内容指纹（plainText + JSON 序列化内容拼接后取 sha256 前 16 位）
   * worker 处理时与文档当前内容指纹比对，一致则跳过重复切片/向量化
   */
  contentHash: text('content_hash'),
  /** 该文档当前已入库的切片数量 */
  chunkCount: integer('chunk_count').default(0).notNull(),
  /** 处理尝试次数（失败 +1，达到 3 次后不再重试） */
  attempts: integer('attempts').default(0).notNull(),
  /** 最近一次失败原因（成功后清空） */
  error: text('error'),
  /** 最近一次成功同步时间 */
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
  /** 记录创建时间 */
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  /** 记录更新时间 */
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  /** 按状态 + 尝试次数联合查询（worker 扫描待处理任务的高频查询） */
  statusIndex: index('rag_sync_status_idx').on(table.status, table.attempts),
  wikiIdIndex: index('rag_sync_wiki_id_idx').on(table.wikiId),
}))

/**
 * 知识库级 RAG 聚合状态表（每库一行快照）
 *
 * 背景：Dashboard 知识库列表需要展示每个库的 RAG 四态圆点（灰=未开启/蓝=进行中/红=失败/绿=正常），
 * 此前由 /rag/status 实时 GROUP BY rag_sync + 调 Qdrant countChunksByWiki 统计，
 * N 个库 = N 次全表聚合 + N 次 Qdrant 计数，开销随库数线性增长。
 * 本表把聚合结果落成快照（计数口径与 statusOf 一致：pending = pending + running），
 * 由 rag.service.ts 在状态变更点（入队/完成/失败/重索引/删除）调用 refreshWikiRag 重聚合并写回，
 * /rag/status 与 /rag/status-batch 改为纯读本表，O(1) 单行查询。
 *
 * 注：四态颜色由前端根据计数派生（pending>0 蓝 / failed>0 红 / total>0 绿 / 其余灰），不落枚举列；
 * chunkCount 为 rag_sync.chunk_count 求和的冗余快照（切片正文实际存储在 Qdrant）；
 * wiki 关闭 ragEnabled 开关不清空本行（灰点由前端门控，重新开启快照立即可用）。
 */
export const wikiRag = pgTable('wiki_rag', {
  /** ULID 主键（应用层生成） */
  id: text('id').primaryKey().$defaultFn(() => generateId()),
  /** 知识库 ID（每库一行快照） */
  wikiId: text('wiki_id').notNull(),
  /** 总文档数（rag_sync 有状态行的文档总数） */
  total: integer('total').default(0).notNull(),
  /** 已完成索引数 */
  done: integer('done').default(0).notNull(),
  /** 待处理数（pending + running，与 /rag/status 聚合口径一致） */
  pending: integer('pending').default(0).notNull(),
  /** 失败数（重试超限后停留 failed 的文档数） */
  failed: integer('failed').default(0).notNull(),
  /** 已入库切片总数（rag_sync.chunk_count 求和快照，实际切片存储在 Qdrant） */
  chunkCount: integer('chunk_count').default(0).notNull(),
  /** 全库最新一次成功同步时间（= max(rag_sync.last_synced_at)，从未成功过为 null） */
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  /** 每库最多一行快照（refreshWikiRag 按 wikiId upsert） */
  wikiUnique: uniqueIndex('wiki_rag_wiki_uniq').on(table.wikiId),
}))

/**
 * RAG 切片向量与 payload 已迁移至 Qdrant（rag.store.ts），drizzle 不再管理 rag_chunks 表。
 * rag_sync 仍由 drizzle 管理（状态记录 + 任务队列落库，非向量数据）。
 * 切片正文（content）与业务元数据（wikiId/documentId/nodeId/headingPath/chunkIndex/charCount）
 * 现统一作为 Qdrant point 的 payload 字段存储，检索/删除按 payload 过滤。
 */

/** RAG 切片 payload 结构（Qdrant point.payload，检索过滤字段）
 *  迁移自旧 rag_chunks.metadata：字段含义完全一致，仅存储位置从 PG jsonb 改为 Qdrant payload */
export interface RagChunkMetadata {
  /** 所属知识库 ID（检索边界，Qdrant filter 字段） */
  wikiId: string
  /** 关联文档 ID（重建索引时按文档删旧插新） */
  documentId: string
  /** 文档树节点 ID（冗余，用于检索结果跳转链接） */
  nodeId: string | null
  /** 切片在文档内的序号（从 0 递增） */
  chunkIndex: number
  /** 标题路径（"文档标题 > 一级标题 > 二级标题"） */
  headingPath: string | null
  /** 切片字符数 */
  charCount: number
}

/**
 * 应用配置表（通用 key-value）
 * 存储运行时可被管理员动态修改的系统级配置（如 AI 服务商配置 AI_BASE_URL 等）
 * 读取优先级：本表有值 > process.env 兜底；value 为空/无行 = 未覆盖，回退环境变量
 */
export const appSettings = pgTable('app_settings', {
  /** ULID 主键（应用层生成，小写） */
  id: text('id').primaryKey().$defaultFn(() => generateId()),
  /** 配置键，唯一（如 AI_BASE_URL / AI_API_KEY / AI_CHAT_MODEL / AI_EMBEDDING_*） */
  key: text('key').notNull().unique(),
  /** 配置值；NULL = 未覆盖（读取时回退 process.env） */
  value: text('value'),
  /** 最近更新时间 */
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

/**
 * 管理员表
 * 管理员白名单：userId 关联 users.id（仅逻辑关联，项目规范不建数据库外键）
 * 由 scripts/set-admin.ts 种子脚本维护，adminGuard 中间件据此判定接口权限
 */
export const admins = pgTable('admins', {
  /** ULID 主键（应用层生成，小写） */
  id: text('id').primaryKey().$defaultFn(() => generateId()),
  /** 管理员用户 ID（users.id，小写 ULID） */
  userId: text('user_id').notNull().unique(),
  /** 记录创建时间 */
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

// ============ 知识库领域表类型导出 ============

/** 知识库表查询结果类型 */
export type Wiki = typeof wiki.$inferSelect
/** 知识库表插入数据类型 */
export type NewWiki = typeof wiki.$inferInsert
/** 知识库成员表查询结果类型 */
export type WikiMember = typeof wikiMembers.$inferSelect
/** 知识库成员表插入数据类型 */
export type NewWikiMember = typeof wikiMembers.$inferInsert
/** 文档树节点表查询结果类型 */
export type WikiNode = typeof wikiNodes.$inferSelect
/** 文档树节点表插入数据类型 */
export type NewWikiNode = typeof wikiNodes.$inferInsert
/** 文档表查询结果类型 */
export type Document = typeof documents.$inferSelect
/** 文档表插入数据类型 */
export type NewDocument = typeof documents.$inferInsert
/** 文档版本表查询结果类型 */
export type DocumentVersion = typeof documentVersions.$inferSelect
/** 文档版本表插入数据类型 */
export type NewDocumentVersion = typeof documentVersions.$inferInsert
/** 文档评论表查询结果类型 */
export type DocumentComment = typeof documentComments.$inferSelect
/** 文档评论表插入数据类型 */
export type NewDocumentComment = typeof documentComments.$inferInsert
/** 最近访问表查询结果类型 */
export type RecentVisit = typeof recentVisits.$inferSelect
/** 最近访问表插入数据类型 */
export type NewRecentVisit = typeof recentVisits.$inferInsert
/** 收藏表查询结果类型 */
export type Favorite = typeof favorites.$inferSelect
/** 收藏表插入数据类型 */
export type NewFavorite = typeof favorites.$inferInsert
/** 活动表查询结果类型 */
export type Activity = typeof activities.$inferSelect
/** 活动表插入数据类型 */
export type NewActivity = typeof activities.$inferInsert
/** 标签表查询结果类型 */
export type Tag = typeof tags.$inferSelect
/** 标签表插入数据类型 */
export type NewTag = typeof tags.$inferInsert
/** 文档-标签关联表查询结果类型 */
export type DocumentTag = typeof documentTags.$inferSelect
/** 文档-标签关联表插入数据类型 */
export type NewDocumentTag = typeof documentTags.$inferInsert
/** 媒体资产表查询结果类型 */
export type MediaAsset = typeof mediaAssets.$inferSelect
/** 媒体资产表插入数据类型 */
export type NewMediaAsset = typeof mediaAssets.$inferInsert
/** 知识库分享配置表查询结果类型 */
export type WikiShare = typeof wikiShares.$inferSelect
/** 知识库分享配置表插入数据类型 */
export type NewWikiShare = typeof wikiShares.$inferInsert
/** 知识库发布配置表查询结果类型 */
export type WikiPublish = typeof wikiPublish.$inferSelect
/** 知识库发布配置表插入数据类型 */
export type NewWikiPublish = typeof wikiPublish.$inferInsert
/** RAG 索引同步状态表查询结果类型 */
export type RagSync = typeof ragSync.$inferSelect
/** RAG 索引同步状态表插入数据类型 */
export type NewRagSync = typeof ragSync.$inferInsert
/** 应用配置表查询结果类型 */
export type AppSetting = typeof appSettings.$inferSelect
/** 应用配置表插入数据类型 */
export type NewAppSetting = typeof appSettings.$inferInsert
/** 管理员表查询结果类型 */
export type Admin = typeof admins.$inferSelect
/** 管理员表插入数据类型 */
export type NewAdmin = typeof admins.$inferInsert
