import { Hono } from 'hono'
import { vJson } from '~/core/helper/zod.helper.js'
import { CreateWikiSchema, CreateWikiNodeSchema, CreateDocumentTagSchema, SaveDocumentSchema, SaveWikiNodeTitleSchema, SaveWikiNodeIconSchema, UpdateWikiSchema, UpsertWikiShareSchema, UpsertWikiNodeShareSchema, WikiContentSearchSchema, MoveWikiNodeSchema } from './wiki.schema.js'
import {
  createWiki,
  listWikisByUserId,
  getWikiById,
  listWikiNodes,
  createWikiNode,
  moveWikiNode,
  getDocumentById,
  listDocumentTags,
  addDocumentTag,
  removeDocumentTag,
  saveDocument,
  saveWikiNodeTitle,
  saveWikiNodeIcon,
  updateWiki,
  deleteWikiNode,
  deleteWiki,
  listWikiTrash,
  restoreWikiTrashNode,
  purgeWikiTrashNode,
  purgeAllWikiTrash,
  listWikiRecycle,
  restoreWikiFromTrash,
  purgeWiki,
  upsertWikiShare,
  getWikiShareConfig,
  upsertWikiNodeShare,
} from './wiki.service.js'
import { searchWikiContent } from './wiki-search.service.js'
import { authMiddleware, getCurrentUserId } from '~/core/middleware/auth.middleware.js'
import { BizException } from '~/core/lib/biz.exception.js'
import { ErrorCode } from '~/config/error-code.js'

// ============ Rate Limit ============

/**
 * 内存级保存频率限制
 * - key: `${documentId}:${userId}`
 * - 2 秒窗口内最多 1 次保存请求
 * - 单实例部署场景足够（本项目无多实例需求）
 * - 2s 窗口配合前端 local-first 同步队列（3s 节流）正常不触闸；
 *   队列 flush 立即同步撞闸后按 2s 退避重试必过闸
 */
const saveRateLimitMap = new Map<string, number>()
const SAVE_RATE_LIMIT_WINDOW = 2_000 // 2 秒窗口

/**
 * 检查保存频率是否超限
 * @returns true = 允许保存，false = 超限
 */
function checkSaveRateLimit(documentId: string, userId: string): boolean {
  const key = `${documentId}:${userId}`
  const now = Date.now()
  const lastSave = saveRateLimitMap.get(key)
  if (lastSave && now - lastSave < SAVE_RATE_LIMIT_WINDOW) {
    return false // 超限
  }
  saveRateLimitMap.set(key, now)
  return true
}

/**
 * 知识库控制器
 * 提供知识库创建、列表、详情、文档树、文档正文、文档标签接口，均需登录
 * - POST   /wiki                       创建知识库（名称 + 描述）
 * - GET    /wiki                       获取当前用户的知识库列表
 * - GET    /wiki/:id                   获取知识库详情（仅 owner）
 * - GET    /wiki/:id/nodes             获取知识库文档树节点（扁平，仅 owner）
 * - POST   /wiki/:id/nodes             在知识库根层级创建文档节点（仅 owner）
 * - POST   /wiki/node/:nodeId/move     移动文档节点（拖拽排序持久化，仅 owner）
 * - GET    /wiki/document/:id          获取文档正文内容（仅 owner）
 * - GET    /wiki/document/:id/tags     获取文档已关联的标签列表（仅 owner）
 * - POST   /wiki/document/:id/tags     为文档添加标签（find-or-create，仅 owner）
 * - DELETE /wiki/document/:id/tags/:tagId 解除文档与标签的关联（仅 owner）
 * - POST   /wiki/document/:id/save     保存文档内容（自动保存，仅 owner）
 * - POST   /wiki/:id/save-title        保存文档节点标题（仅 owner）
 * - POST   /wiki/:id/delete            删除文档节点（软删除进回收站，子树整体标记，仅 owner）
 * - POST   /wiki/:wikiId/trash         回收站列表（文档节点顶层删除项，仅 owner）
 * - POST   /wiki/:id/trash/restore     恢复回收站节点（整棵子树，仅 owner）
 * - POST   /wiki/:id/trash/purge       彻底删除回收站节点（硬删除级联清理，仅 owner）
 * - POST   /wiki/:wikiId/trash/empty   一键清空回收站（硬删除全部回收站内容，仅 owner）
 * - POST   /wiki/trash                 知识库回收站列表（软删除的知识库，仅 owner）
 * - POST   /wiki/:id/restore           从回收站恢复知识库（撤销软删除，仅 owner）
 * - POST   /wiki/:id/purge             彻底删除回收站中的知识库（硬删除级联清理，仅 owner）
 * - POST   /wiki/:id/delete-wiki       删除知识库（软删除移入回收站，分享/发布即时失效，仅 owner）
 * - GET    /wiki/:id/share             查询分享配置（仅 owner，弹窗回填，含页面级覆盖行 nodes）
 * - POST   /wiki/:id/share             创建/更新库级分享配置（仅 owner，upsert 库级行）
 * - POST   /wiki/node/:nodeId/share    创建/更新页面级分享配置（仅 owner，upsert 页级覆盖行）
 * - POST   /wiki/:id/search            文档正文关键词搜索（仅 owner，搜索弹窗「内容命中」）
 *
 * 预览令牌签发已迁至 publish 模块（POST /publish/wiki/:wikiId/token，share/publish 语义拆分）
 *
 * 路由顺序：/:id、/:id/nodes、/:id/save-title、/:id/delete、/document/:id 等互不冲突
 */
const wikiController = new Hono()
  // 创建知识库（需要登录）
  .post('/', authMiddleware, vJson(CreateWikiSchema), async (c) => {
    const userId = getCurrentUserId(c)!
    const data = c.req.valid('json')
    const result = await createWiki(userId, data)
    return c.success(result)
  })
  // 获取当前用户的知识库列表（需要登录）
  .get('/', authMiddleware, async (c) => {
    const userId = getCurrentUserId(c)!
    const list = await listWikisByUserId(userId)
    return c.success(list)
  })
  // 获取知识库详情（仅 owner）
  .get('/:id', authMiddleware, async (c) => {
    const userId = getCurrentUserId(c)!
    const id = c.req.param('id')
    const result = await getWikiById(id, userId)
    return c.success(result)
  })
  // 更新知识库基本信息（仅 owner）
  // - body: { name?: string, description?: string }
  .patch('/:id', authMiddleware, vJson(UpdateWikiSchema), async (c) => {
    const userId = getCurrentUserId(c)!
    const id = c.req.param('id')
    const data = c.req.valid('json')
    const result = await updateWiki(id, userId, data)
    return c.success(result)
  })
  // 获取知识库文档树节点（扁平，仅 owner）
  .get('/:id/nodes', authMiddleware, async (c) => {
    const userId = getCurrentUserId(c)!
    const id = c.req.param('id')
    const list = await listWikiNodes(id, userId)
    return c.success(list)
  })
  // 在知识库根层级创建文档节点（仅 owner）
  // - title 可选，未传时使用默认值「无标题文档」
  // - 事务内创建 documents + wikiNodes 两表记录，详见 wiki.service.ts
  .post('/:id/nodes', authMiddleware, vJson(CreateWikiNodeSchema), async (c) => {
    const userId = getCurrentUserId(c)!
    const wikiId = c.req.param('id')
    const data = c.req.valid('json')
    const result = await createWikiNode(wikiId, userId, data)
    return c.success(result)
  })
  // 移动文档节点（拖拽排序持久化，仅 owner）
  // - body: { parentId: string | null, index: number } — parentId null 表示根层级；
  //   index 为被移动节点从原位置移除后的同级最终下标（与前端本地重排后的位置一致）
  // - 事务内对目标同级列表整段重编号 sortOrder = 0..n，详见 wiki.service.ts moveWikiNode
  .post('/node/:nodeId/move', authMiddleware, vJson(MoveWikiNodeSchema), async (c) => {
    const userId = getCurrentUserId(c)!
    const nodeId = c.req.param('nodeId')
    const data = c.req.valid('json')
    await moveWikiNode(nodeId, userId, data)
    return c.success(null)
  })
  // 文档正文关键词搜索（仅 owner，搜索弹窗「内容命中」）
  // - SQL ILIKE 粗筛候选文档 → Tiptap JSON 结构化定位命中所在标题（标题路径 + 片段）
  // - 无命中返回空数组（不抛业务异常）；标题命中由前端本地过滤文档树实现，不走本接口
  // - body: { q: string }
  .post('/:id/search', authMiddleware, vJson(WikiContentSearchSchema), async (c) => {
    const userId = getCurrentUserId(c)!
    const wikiId = c.req.param('id')
    const { q } = c.req.valid('json')
    const list = await searchWikiContent(wikiId, userId, q)
    return c.success(list)
  })
  // 获取文档正文内容（仅 owner）
  .get('/document/:id', authMiddleware, async (c) => {
    const userId = getCurrentUserId(c)!
    const id = c.req.param('id')
    const result = await getDocumentById(id, userId)
    return c.success(result)
  })
  // 获取文档已关联的标签列表（仅 owner）
  // - 返回该文档的所有标签，按创建时间升序
  // - 默认无标签（空数组）
  .get('/document/:id/tags', authMiddleware, async (c) => {
    const userId = getCurrentUserId(c)!
    const id = c.req.param('id')
    const list = await listDocumentTags(id, userId)
    return c.success(list)
  })
  // 为文档添加标签（仅 owner）
  // - find-or-create：在该 wiki 内按 name 查找标签，不存在则新建
  // - 关联表 onConflictDoNothing 幂等，重复关联不报错
  // - body: { name: string, color?: string }
  .post('/document/:id/tags', authMiddleware, vJson(CreateDocumentTagSchema), async (c) => {
    const userId = getCurrentUserId(c)!
    const documentId = c.req.param('id')
    const data = c.req.valid('json')
    const result = await addDocumentTag(documentId, userId, data)
    return c.success(result)
  })
  // 解除文档与标签的关联（仅 owner）
  // - 仅删 document_tags 关联行，不删标签本体（标签可被同 wiki 其他文档复用）
  // - 未关联时返回 50006 TAG_NOT_FOUND
  .delete('/document/:id/tags/:tagId', authMiddleware, async (c) => {
    const userId = getCurrentUserId(c)!
    const documentId = c.req.param('id')
    const tagId = c.req.param('tagId')
    await removeDocumentTag(documentId, tagId, userId)
    return c.success(null)
  })

  // 保存文档内容（自动保存，仅 owner）
  // - 乐观锁校验：客户端需传 updatedAt，防止并发覆盖
  // - Rate limit：10 秒内同一文档+用户最多 1 次请求
  // - body: { content, updatedAt, contentHtml?, plainText?, wordCount? }
  .post('/document/:id/save', authMiddleware, vJson(SaveDocumentSchema), async (c) => {
    const userId = getCurrentUserId(c)!
    const documentId = c.req.param('id')

    // Rate limit 检查：10 秒窗口内最多 1 次保存
    if (!checkSaveRateLimit(documentId, userId)) {
      throw new BizException(ErrorCode.DOCUMENT_SAVE_RATE_LIMITED)
    }

    const data = c.req.valid('json')
    const result = await saveDocument(documentId, userId, data)
    return c.success(result)
  })

  // 保存文档节点标题（仅 owner）
  // - body: { title: string }
  .post('/:id/save-title', authMiddleware, vJson(SaveWikiNodeTitleSchema), async (c) => {
    const userId = getCurrentUserId(c)!
    const nodeId = c.req.param('id')
    const data = c.req.valid('json')
    const result = await saveWikiNodeTitle(nodeId, userId, data)
    return c.success(result)
  })

  // 保存文档节点图标（仅 owner）
  // - body: { icon: string } — emoji 字符串，空字符串表示清除图标
  .post('/:id/save-icon', authMiddleware, vJson(SaveWikiNodeIconSchema), async (c) => {
    const userId = getCurrentUserId(c)!
    const nodeId = c.req.param('id')
    const data = c.req.valid('json')
    const result = await saveWikiNodeIcon(nodeId, userId, data)
    return c.success(result)
  })

  // 删除文档节点（级联删除文件夹及其子节点，仅 owner）
  // 若为文件夹，会递归删除所有子节点及关联文档
  .post('/:id/delete', authMiddleware, async (c) => {
    const userId = getCurrentUserId(c)!
    const nodeId = c.req.param('id')
    await deleteWikiNode(nodeId, userId)
    return c.success(null)
  })

  // 回收站列表（仅 owner）
  // - 返回该库顶层删除项（嵌套子项跟随顶层条目，不重复出现），按删除时间倒序
  // - 每项含 count（子树总节点数）与 deletedAt（删除时刻 = 删除时冻结的 updatedAt）
  .post('/:wikiId/trash', authMiddleware, async (c) => {
    const userId = getCurrentUserId(c)!
    const wikiId = c.req.param('wikiId')
    const list = await listWikiTrash(wikiId, userId)
    return c.success(list)
  })

  // 恢复回收站节点（仅 owner）
  // - 整棵子树恢复（is_deleted 置回 false）；原父节点缺失或仍在回收站时挂到根层级末尾
  // - 对未删除节点执行返回 50013 WIKI_NODE_NOT_IN_TRASH
  .post('/:id/trash/restore', authMiddleware, async (c) => {
    const userId = getCurrentUserId(c)!
    const nodeId = c.req.param('id')
    const result = await restoreWikiTrashNode(nodeId, userId)
    return c.success(result)
  })

  // 彻底删除回收站节点（仅 owner，硬删除不可恢复）
  // - 级联清理 documents / documentVersions / rag_sync / 页级分享行 / rag_chunks
  // - 对未删除节点执行返回 50013 WIKI_NODE_NOT_IN_TRASH
  // - 返回被删节点/文档 ID 列表（前端据此判断当前打开文档是否被级联删除）
  .post('/:id/trash/purge', authMiddleware, async (c) => {
    const userId = getCurrentUserId(c)!
    const nodeId = c.req.param('id')
    const result = await purgeWikiTrashNode(nodeId, userId)
    return c.success(result)
  })

  // 一键清空回收站（仅 owner，硬删除该库回收站全部内容，不可恢复）
  // - 级联清理范围与单节点 purge 一致
  // - 返回被删节点/文档 ID 列表（前端据此判断当前打开文档是否被级联删除）
  .post('/:wikiId/trash/empty', authMiddleware, async (c) => {
    const userId = getCurrentUserId(c)!
    const wikiId = c.req.param('wikiId')
    const result = await purgeAllWikiTrash(wikiId, userId)
    return c.success(result)
  })

  // ============ 知识库回收站（库级软删除） ============

  // 知识库回收站列表（仅 owner）
  // - 返回当前用户全部软删除的知识库，按删除时间倒序
  // - 每项含 docCount（库内未删除文档数）与 deletedAt（删除时刻 = 删除时冻结的 updatedAt）
  // - 单段静态路径 /trash 与两段的 /:wikiId/trash（文档回收站）不冲突：段数不同 + 字面量错开
  .post('/trash', authMiddleware, async (c) => {
    const userId = getCurrentUserId(c)!
    const list = await listWikiRecycle(userId)
    return c.success(list)
  })

  // 从回收站恢复知识库（仅 owner，撤销软删除）
  // - 恢复后重新出现在 Dashboard 列表，分享 / 发布访问自动恢复（无需重建配置）
  // - 幂等：不在回收站中的库执行恢复无副作用
  .post('/:id/restore', authMiddleware, async (c) => {
    const userId = getCurrentUserId(c)!
    const wikiId = c.req.param('id')
    const result = await restoreWikiFromTrash(wikiId, userId)
    return c.success(result)
  })

  // 彻底删除回收站中的知识库（仅 owner，硬删除不可恢复）
  // - 级联清理 documents / rag_sync / wiki_nodes / wiki_shares / wiki_publish + Qdrant 切片向量
  // - 仅允许对回收站中的库执行：对未软删除的库执行返回 50015 WIKI_NOT_IN_TRASH（防误清）
  .post('/:id/purge', authMiddleware, async (c) => {
    const userId = getCurrentUserId(c)!
    const wikiId = c.req.param('id')
    await purgeWiki(wikiId, userId)
    return c.success(null)
  })

  // 删除知识库（仅 owner，软删除移入回收站，可恢复）
  // - 仅标记 wiki.is_deleted = true：节点/文档/分享/发布/RAG 数据全部保留，恢复即还原
  // - 回收站中的库对访客立即不可见（share/publish 实时复核 isDeleted → SHARE_NOT_FOUND）
  // - 路由用 /:id/delete-wiki 避免与上方节点删除 /:id/delete 冲突（wikiId 与 nodeId 同为 ULID）
  .post('/:id/delete-wiki', authMiddleware, async (c) => {
    const userId = getCurrentUserId(c)!
    const wikiId = c.req.param('id')
    await deleteWiki(wikiId, userId)
    return c.success(null)
  })

  // 查询知识库分享配置（仅 owner，分享弹窗回填 / 文档树分享 icon 展示用）
  // 返回 { shareId, wikiId, shareStatus, password, mode, updatedAt, nodes }
  //   - password 明文回显，可为 null（库级密码）
  //   - nodes：该库全部页面级覆盖行列表，每项 { nodeId, shareStatus: 'public'|'private', password }，
  //     前端用于回填各页面分享状态与文档树分享 icon；无覆盖行时为空数组（未覆盖页面 = inherit 跟随库）
  // 无库级行时返回 null（前端按默认 private 处理）
  .get('/:id/share', authMiddleware, async (c) => {
    const userId = getCurrentUserId(c)!
    const wikiId = c.req.param('id')
    const result = await getWikiShareConfig(wikiId, userId)
    return c.success(result)
  })

  // 创建/更新库级分享配置（仅 owner，upsert 语义：每个知识库固定一行库级权限记录 nodeId=''）
  // - body: { shareStatus: 'private' | 'public', password?: string | null, mode?: 'view' }
  // - shareStatus: 库可见性的唯一事实来源（private 私密 / public 公开）
  // - password: string = 设置/更新库密码（明文存储，并清除该库全部页级密码——继承规则），
  //              null = 清除库密码，不传 = 保持不变
  .post('/:id/share', authMiddleware, vJson(UpsertWikiShareSchema), async (c) => {
    const userId = getCurrentUserId(c)!
    const wikiId = c.req.param('id')
    const data = c.req.valid('json')
    const result = await upsertWikiShare(wikiId, userId, data)
    return c.success(result)
  })

  // 创建/更新页面级分享配置（仅 owner，upsert 页面级覆盖行 node_id=<nodeId>，稀疏存储）
  // - body: { shareStatus: 'public' | 'inherit', password?: string | null }
  // - public: 公开该页，密码可选（string = 设置/更新；null = 清除为免密分享；不传 = 保持不变）
  // - inherit: 删除页级覆盖行，回到跟随库状态
  // - 返回 { nodeId, shareStatus, password }
  .post('/node/:nodeId/share', authMiddleware, vJson(UpsertWikiNodeShareSchema), async (c) => {
    const userId = getCurrentUserId(c)!
    const nodeId = c.req.param('nodeId')
    const data = c.req.valid('json')
    const result = await upsertWikiNodeShare(nodeId, userId, data)
    return c.success(result)
  })

  // 预览令牌签发已迁至 publish 模块（share/publish 语义拆分）：
  // POST /wiki/:id/preview-token → POST /publish/wiki/:wikiId/token

export default wikiController
