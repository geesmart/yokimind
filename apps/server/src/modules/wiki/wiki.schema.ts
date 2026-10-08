import { z } from 'zod'

/**
 * 创建知识库请求 Schema
 * 与前端 CreateWikiParams 对齐：名称（必填）+ 描述（可选）+ icon（可选）+ color（可选）
 */
export const CreateWikiSchema = z.object({
  // 知识库名称：2-50 字符
  name: z
    .string()
    .min(2, '知识库名称长度需为 2-50 位')
    .max(50, '知识库名称长度需为 2-50 位'),
  // 知识库描述：可选，最长 500 字符
  description: z
    .string()
    .max(500, '知识库描述最长 500 位')
    .optional(),
  // 知识库图标 key（可选，对应前端 icon-meta.ts 中的图标标识）
  icon: z
    .string()
    .max(50, '图标标识最长 50 位')
    .optional(),
  // 知识库主题色 key（可选，对应前端 icon-meta.ts 中的颜色标识）
  color: z
    .string()
    .max(30, '颜色标识最长 30 位')
    .optional(),
  // 是否开启自动 RAG 索引（可选，不传走表默认值 false；开启后文档保存即自动切片向量化）
  ragEnabled: z.boolean().optional(),
})

/**
 * 创建文档节点请求 Schema（Notion 风格统一节点模型）
 * title 可选，未传时由 service 给默认值「无标题文档」
 * parentId 可选，指定父节点 ID；不传则创建在根层级
 * 注：任何节点都可作为父节点，不再有"文件夹 / 文档"区分
 */
export const CreateWikiNodeSchema = z.object({
  // 文档标题：可选，最长 100 字符
  title: z
    .string()
    .max(100, '文档标题最长 100 位')
    .optional(),
  // 父节点 ID：可选，指定在哪个父节点下创建；不传则创建在根层级
  parentId: z
    .string()
    .max(26, '父节点 ID 格式无效')
    .optional(),
})

/**
 * 为文档添加标签请求 Schema
 * name 必填（去空格后 1-30 字符），color 可选（预留，当前前端不传）
 */
export const CreateDocumentTagSchema = z.object({
  // 标签名：必填，1-30 字符（service 内会 trim）
  name: z
    .string()
    .min(1, '标签名不能为空')
    .max(30, '标签名最长 30 位'),
  // 标签颜色：可选，最长 20 字符（如 "#FF5500"）
  color: z
    .string()
    .max(20, '标签颜色最长 20 位')
    .optional(),
})

/**
 * 保存文档内容请求 Schema（自动保存接口）
 * - content: Tiptap JSON 内容（必填）
 * - updatedAt: 乐观锁字段，客户端持有的最后更新时间（ISO 字符串）
 * - contentHtml/plainText/wordCount: 可选，后端可从 content 重新生成
 */
export const SaveDocumentSchema = z.object({
  // Tiptap JSON 内容
  content: z.any(),
  // 乐观锁：客户端持有的最后更新时间（ISO 字符串），用于并发冲突检测
  updatedAt: z.string().datetime(),
  // 渲染后 HTML（可选）
  contentHtml: z.string().max(1000000).optional(),
  // 纯文本（可选）
  plainText: z.string().max(1000000).optional(),
  // 字数（可选）
  wordCount: z.number().int().nonnegative().optional(),
})

/**
 * 更新知识库请求 Schema
 * - name: 知识库名称（可选，2-50 字符）
 * - description: 知识库描述（可选，最长 500 字符）
 * - icon: 知识库图标 key（可选）
 * - color: 知识库主题色 key（可选）
 */
export const UpdateWikiSchema = z.object({
  // 知识库名称：可选，2-50 字符
  name: z
    .string()
    .min(2, '知识库名称长度需为 2-50 位')
    .max(50, '知识库名称长度需为 2-50 位')
    .optional(),
  // 知识库描述：可选，最长 500 字符
  description: z
    .string()
    .max(500, '知识库描述最长 500 位')
    .optional(),
  // 知识库图标 key（可选）
  icon: z.string().max(50, '图标标识最长 50 位').optional(),
  // 知识库主题色 key（可选）
  color: z.string().max(50, '颜色标识最长 50 位').optional(),
  // 是否自动 RAG 索引（可选）：true - 文档保存后自动入队索引；false - 关闭（默认）
  ragEnabled: z.boolean().optional(),
})

/**
 * 保存文档节点标题请求 Schema
 * - title: 文档标题（1-100 字符）
 */
export const SaveWikiNodeTitleSchema = z.object({
  // 文档标题：1-100 字符
  title: z.string().min(1, '标题不能为空').max(100, '标题最长 100 位'),
})

/**
 * 保存文档节点图标请求 Schema
 * - icon: emoji 字符串（可为空字符串表示清除图标）
 */
export const SaveWikiNodeIconSchema = z.object({
  // 图标：emoji 字符串，可为空字符串表示清除图标
  icon: z.string().max(10, '图标最长 10 位'),
})

/**
 * 创建/更新知识库分享配置请求 Schema（库级可见性配置，upsert 语义）
 *
 * 权限模型：wiki_shares 是统一权限表，node_id='' 为库级行（每个知识库固定一行），
 * 库级行的 shareStatus 是「库可见性」的唯一事实来源（不再有 enabled 字段）。
 * - shareStatus: 'private' 私密（默认） | 'public' 公开
 * - password: 库级访问密码（6-32 位，明文存储，定位类似网盘提取码，owner 弹窗可回显）
 *             传 string = 设置/更新库密码；传 null = 清除库密码；不传（undefined）= 保持不变
 *             继承规则：设置库密码后，服务端会在同一事务内清空该库全部页级行的密码
 *             （库密码生效后页面统一走库密码校验，页级密码不再单独生效）
 * - mode: 分享模式，v1 仅支持 'view'（'edit' 为 v2 预留值，校验直接拒绝）
 *
 * 注：公开站点形态（publishType：help/blog）已拆至 publish 模块
 * （PUT /publish/wiki/:wikiId/settings，写 wiki_publish 表），share 只管访问控制
 */
export const UpsertWikiShareSchema = z.object({
  // 库可见性：私密 / 公开
  shareStatus: z.enum(['private', 'public']),
  // 库级访问密码：可选，string = 设置/更新，null = 清除，undefined = 保持不变
  password: z
    .string()
    .min(6, '访问密码长度需为 6-32 位')
    .max(32, '访问密码长度需为 6-32 位')
    .nullable()
    .optional(),
  // 分享模式：v1 仅 view（edit 预留给 v2 编辑分享）
  mode: z.enum(['view']).default('view'),
})

/**
 * 页面级分享配置请求 Schema（页面级行，稀疏存储：仅单独配置过分享的页面存在）
 *
 * 权限模型：wiki_shares 中 node_id=<nodeId> 的行为页面分享行；
 * shareStatus='inherit' 表示删除该行、关闭页面分享。
 * - shareStatus: 'public' 单独公开此页（库分享关闭时生效）| 'inherit' 关闭页面分享
 * - password: 页面访问密码（6-32 位，明文存储），public 时可选（支持免密分享）；
 *             传 string = 设置/更新密码；传 null = 清除密码（免密访问）；不传 = 保持不变；
 *             'inherit' 时忽略该字段
 * 注：库分享开启时全部文档跟随库开放，页面分享被锁定不可修改（service 守卫拒绝）
 */
export const UpsertWikiNodeShareSchema = z.object({
  // 页面分享状态：public = 单独公开此页（库分享关闭时生效，密码可选）；inherit = 关闭页面分享（删行）
  // 注：库分享开启时页面分享被锁定（不可单独修改），由 service 层守卫拒绝
  shareStatus: z.enum(['public', 'inherit']),
  // 页面访问密码：可选。string = 设置/更新，null = 清除（免密分享），undefined = 保持不变
  password: z
    .string()
    .min(6, '访问密码长度需为 6-32 位')
    .max(32, '访问密码长度需为 6-32 位')
    .nullable()
    .optional(),
})

/**
 * 移动文档节点请求 Schema（拖拽排序持久化）
 * - parentId: 目标父节点 ID；null 表示移动到根层级
 * - index: 目标位置索引（在被移动节点已从原位置移除后的同级列表中的最终下标，0 起）
 *   服务端按该索引对目标同级列表重新编号 sortOrder = 0..n，index 超界时收敛到末尾
 */
export const MoveWikiNodeSchema = z.object({
  // 目标父节点 ID：null = 根层级；字符串 = 挂到该节点下（任何节点都可作为父节点）
  parentId: z.string().max(26, '父节点 ID 格式无效').nullable(),
  // 目标位置索引：非负整数，超界时服务端收敛到同级列表末尾
  index: z.number().int('索引必须为整数').min(0, '索引不能为负'),
})

/**
 * 文档正文关键词搜索请求 Schema（搜索弹窗「内容命中」）
 * - q: 搜索关键词（1-100 字符，trim 后非空）
 */
export const WikiContentSearchSchema = z.object({
  // 搜索关键词：1-100 字符
  q: z.string().trim().min(1, '搜索关键词不能为空').max(100, '搜索关键词最长 100 位'),
})

// ============ 类型导出 ============

export type CreateWiki = z.infer<typeof CreateWikiSchema>
export type CreateWikiNode = z.infer<typeof CreateWikiNodeSchema>
export type CreateDocumentTag = z.infer<typeof CreateDocumentTagSchema>
export type SaveDocument = z.infer<typeof SaveDocumentSchema>
export type UpdateWiki = z.infer<typeof UpdateWikiSchema>
export type SaveWikiNodeTitle = z.infer<typeof SaveWikiNodeTitleSchema>
export type SaveWikiNodeIcon = z.infer<typeof SaveWikiNodeIconSchema>
export type MoveWikiNode = z.infer<typeof MoveWikiNodeSchema>
export type UpsertWikiShare = z.infer<typeof UpsertWikiShareSchema>
export type UpsertWikiNodeShare = z.infer<typeof UpsertWikiNodeShareSchema>
export type WikiContentSearch = z.infer<typeof WikiContentSearchSchema>
