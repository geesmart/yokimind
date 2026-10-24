import { and, eq, or, ilike, sql } from 'drizzle-orm'
import { getDb } from '~/core/helper/db.helper.js'
import { wiki, wikiPublish, wikiShares, wikiNodes, documents } from '~/db/schema.js'
import { BizException } from '~/core/lib/biz.exception.js'
import { ErrorCode } from '~/config/error-code.js'
import { listWikiNodesFlat } from '~/modules/wiki/wiki.service.js'
import { buildWikiIconFields } from '~/modules/wiki/wiki-icon-svg.js'
import { escapeLikePattern, locateKeywordHits } from '~/modules/wiki/wiki-search.service.js'
import type { ContentHit } from '~/modules/wiki/wiki-search.service.js'
import { uploadImage } from '~/modules/media/media.service.js'
import { getWikiLevelShare, resolveDocumentScope } from '~/modules/share/share.service.js'
import { verifyShareToken } from '~/modules/share/share.util.js'
import { flattenPublishSettings } from './publish.util.js'
import type { UpdatePublishSettings, PublishSettingsData } from './publish.schema.js'

// ============ 发布设置读写（owner 语义） ============

/**
 * 读取知识库的发布配置行（wiki_publish，一库一条）
 * @param wikiId 知识库 ID
 * @returns 发布配置行；从未配置过发布时返回 null（调用方按默认值兜底）
 */
export async function getWikiPublishRow(wikiId: string) {
  const db = getDb()

  const [row] = await db
    .select()
    .from(wikiPublish)
    .where(eq(wikiPublish.wikiId, wikiId))
    .limit(1)

  return row ?? null
}

/**
 * 读取发布设置（owner 设置读取，GET /publish/wiki/:wikiId/settings）
 *
 * 无行（从未配置过发布）时按默认值兜底：publishType 'help' + 外观全 null + aiEnabled true，
 * 与历史行缺键的兜底逻辑一致（jsonb 自由集合，读取侧永远拿到完整扁平结构）
 *
 * @param wikiId 知识库 ID（归属校验由 controller 完成）
 * @returns 扁平发布设置：publishType + siteTitle/siteLogo/siteColor/aiEnabled/navButtons + updatedAt
 */
export async function getPublishSettings(wikiId: string) {
  const row = await getWikiPublishRow(wikiId)

  return {
    publishType: row?.publishType ?? ('help' as const),
    // 发布开关（wiki_publish.enabled）：发布动作置 true / 下架置 false，
    // 无配置行（从未发布过）按 false 兜底 —— 前端发布状态的唯一数据源
    enabled: row?.enabled ?? false,
    ...flattenPublishSettings(row?.settings),
    updatedAt: row?.updatedAt ?? null,
  }
}

/**
 * 更新发布设置（owner 设置保存，PUT /publish/wiki/:wikiId/settings）
 *
 * 部分更新语义（与原 updatePreviewConfig 一致）：
 * - 传入字段（undefined 之外）：合并进现有 settings jsonb 整体写回（publishType 单独写列）
 * - 未传字段：保持原值不变；null = 清除回退默认
 * - 无行时插入新行（publishType 未传按默认 'help'）
 *
 * 新增设置项只需扩展 UpdatePublishSettingsSchema 与此处的 patch 组装，表结构零变更
 *
 * @param wikiId 知识库 ID
 * @param data 发布设置（字段均可选）
 * @returns 保存后的完整扁平发布设置
 */
export async function updatePublishSettings(wikiId: string, data: UpdatePublishSettings) {
  const db = getDb()

  // wiki 必须存在：取 ownerId 供首次插入分支填 createdBy（createdBy 非空约束）
  const [w] = await db
    .select({ ownerId: wiki.ownerId })
    .from(wiki)
    .where(eq(wiki.id, wikiId))
    .limit(1)
  if (!w) {
    throw new BizException(ErrorCode.WIKI_NOT_FOUND)
  }

  // 现有行（无行时视为空配置）
  const existing = await getWikiPublishRow(wikiId)

  // 动态构建 settings patch：undefined = 保持不变；null = 清除自定义回退默认
  const patch: PublishSettingsData = {}
  if (data.siteTitle !== undefined) patch.siteTitle = data.siteTitle
  if (data.siteLogo !== undefined) patch.siteLogo = data.siteLogo
  if (data.siteColor !== undefined) patch.siteColor = data.siteColor
  if (data.aiEnabled !== undefined) patch.aiEnabled = data.aiEnabled
  // 导航按钮数组：null / [] = 清空隐藏（渲染层对空数组同样不渲染）
  if (data.navButtons !== undefined) patch.navButtons = data.navButtons
  // SEO 设置：空串经 schema 归一为 null（清除回退页面默认摘要 / 不输出 keywords）
  if (data.seoDescription !== undefined) patch.seoDescription = data.seoDescription
  if (data.seoKeywords !== undefined) patch.seoKeywords = data.seoKeywords

  // settings 合并写回：现有 jsonb ∪ patch（同键覆盖），其余键原样保留
  const nextSettings: PublishSettingsData = {
    ...((existing?.settings ?? {}) as PublishSettingsData),
    ...patch,
  }

  // upsert 发布配置行：wiki_id 上有唯一索引，冲突时走更新分支
  const [row] = await db
    .insert(wikiPublish)
    .values({
      wikiId,
      // 首次插入分支：未传 publishType 按默认帮助中心处理
      publishType: data.publishType ?? 'help',
      settings: nextSettings,
      createdBy: w.ownerId,
    })
    .onConflictDoUpdate({
      target: wikiPublish.wikiId,
      set: {
        // 站点形态仅在显式传入时更新；undefined 保持原值
        ...(data.publishType ? { publishType: data.publishType } : {}),
        settings: nextSettings,
        updatedAt: new Date(),
      },
    })
    .returning()

  if (!row) {
    throw new BizException(ErrorCode.WIKI_PUBLISH_SAVE_FAILED)
  }

  return {
    publishType: row.publishType,
    ...flattenPublishSettings(row.settings),
    updatedAt: row.updatedAt,
  }
}

// ============ 发布动作（pages 预览条「发布」按钮） ============

/**
 * 切换发布状态（pages 预览条「发布 / 已发布」按钮，预览令牌鉴权）
 *
 * 语义拆分下的「发布开关」组合动作：翻转 share 模块的库级 shareStatus + publish 模块的 enabled 开关：
 * - upsert wiki_shares 库级行（nodeId=''）：shareStatus → 'public' | 'private'、mode → 'view'、
 *   密码清除（产品约定：pages 公开站暂不支持输密码，带密码的库会卡在锁卡页，
 *   与 web 编辑器「发布成 Wiki」入口行为一致；下架同样保持无密码，重新发布即可浏览）
 * - 同步 wiki_publish.enabled（发布开关，Dashboard 列表「已发布/已分享」徽标的判定数据源）：
 *   发布 → true（行不存在时兜底创建默认配置行，保证发布状态有载体）；
 *   取消发布 → false（行不存在则忽略，无需为下架创建行）
 * - 同事务同步 wikis.visibility（Dashboard 列表锁/公开图标数据源，不同步会出现
 *   「已发布但列表仍显示上锁」的错位）
 * - 发布时不动已有行的 publishType / settings（下架后重新发布形态与外观不变）
 *
 * 鉴权说明：预览令牌 scope = preview:{wikiId}，只有 owner 能签发，等同归属校验
 *
 * @param wikiId 知识库 ID
 * @param shareStatus 目标状态：'public' 发布 / 'private' 取消发布（下架）
 * @returns { shareStatus, updatedAt }（pages 预览条据此切换按钮态与「尚未发布」徽标）
 */
export async function publishWiki(wikiId: string, shareStatus: 'public' | 'private') {
  const db = getDb()

  // wiki 必须存在：ownerId 供首次插入分支填 createdBy（createdBy 非空约束）
  const [w] = await db
    .select({ ownerId: wiki.ownerId })
    .from(wiki)
    .where(eq(wiki.id, wikiId))
    .limit(1)
  if (!w) {
    throw new BizException(ErrorCode.SHARE_NOT_FOUND)
  }

  const result = await db.transaction(async (tx) => {
    // upsert 库级行：(wikiId, nodeId='') 上有唯一索引，冲突时走更新分支
    const [row] = await tx
      .insert(wikiShares)
      .values({
        wikiId,
        nodeId: '',
        shareStatus,
        mode: 'view',
        // 发布即清除密码（pages 公开站暂不支持输密码，保证发布即可浏览）
        password: null,
        createdBy: w.ownerId,
      })
      .onConflictDoUpdate({
        target: [wikiShares.wikiId, wikiShares.nodeId],
        set: {
          shareStatus,
          mode: 'view',
          password: null,
          updatedAt: new Date(),
        },
      })
      .returning({ updatedAt: wikiShares.updatedAt })

    if (!row) {
      throw new BizException(ErrorCode.WIKI_PUBLISH_SAVE_FAILED)
    }

    // 同步 publish 模块的发布开关（与 shareStatus 严格同向，两表状态不漂移）：
    // 发布 → enabled=true；取消发布 → enabled=false
    if (shareStatus === 'public') {
      // 发布：行不存在时兜底创建默认配置行（owner 未配置过外观直接发布也能落库）
      await tx
        .insert(wikiPublish)
        .values({ wikiId, enabled: true, createdBy: w.ownerId })
        .onConflictDoUpdate({
          target: wikiPublish.wikiId,
          set: { enabled: true, updatedAt: new Date() },
        })
    } else {
      // 取消发布：仅翻转已存在行的开关（无行 = 从未发布过，无需创建）
      await tx
        .update(wikiPublish)
        .set({ enabled: false, updatedAt: new Date() })
        .where(eq(wikiPublish.wikiId, wikiId))
    }

    // 同步冗余展示列 wikis.visibility（与 wiki.service.upsertWikiShare 同款事务内同步）
    await tx.update(wiki).set({ visibility: shareStatus }).where(eq(wiki.id, wikiId))

    return row
  })

  return { shareStatus, updatedAt: result.updatedAt }
}

// ============ 预览模式（owner 专属） ============

/**
 * 构建站点展示配置（预览聚合接口与访客 meta 共用的兜底口径）
 * wiki_publish 行 + wiki_shares 库级行 + wiki 兜底字段合并返回，前端无需二次拼接：
 * - 外观四项（siteTitle/siteLogo/siteColor/aiEnabled）与导航按钮来自 settings jsonb（缺省兜底）
 * - publishType 来自 publish 行（无行默认 'help'）
 * - shareStatus 来自 wiki_shares 库级行（预览条用 'private' 提示"未发布"）
 * @param wikiId 知识库 ID
 * @returns 站点配置对象
 */
async function buildSiteConfig(wikiId: string) {
  const db = getDb()

  const [publishRow, wikiShare] = await Promise.all([
    getWikiPublishRow(wikiId),
    getWikiLevelShare(wikiId),
  ])

  // wiki 兜底字段（标题/图标/主题色/描述回退数据源）
  // is_deleted = false 过滤：回收站中的知识库一律 SHARE_NOT_FOUND（含未过期的预览令牌）
  const [w] = await db
    .select({ name: wiki.name, icon: wiki.icon, color: wiki.color, description: wiki.description })
    .from(wiki)
    .where(and(eq(wiki.id, wikiId), eq(wiki.isDeleted, false)))
    .limit(1)

  // wiki 不存在（库已删除但令牌仍在有效期内）→ 不泄露细节，统一 SHARE_NOT_FOUND
  if (!w) {
    throw new BizException(ErrorCode.SHARE_NOT_FOUND)
  }

  return {
    wikiName: w.name,
    wikiIcon: w.icon,
    wikiColor: w.color,
    // Solar 图标烘焙结果（legacy lucide key 双 null，前端走 icon-meta 渲染）
    ...buildWikiIconFields(w.icon, w.color),
    wikiDescription: w.description,
    // 从未配置过分享（无库级行）时按未发布兜底
    shareStatus: wikiShare?.shareStatus ?? 'private',
    // 站点形态（无发布行时默认帮助中心）
    publishType: publishRow?.publishType ?? 'help',
    ...flattenPublishSettings(publishRow?.settings),
  }
}

/**
 * 预览聚合接口（GET /publish/wiki/:wikiId/preview，previewAuthMiddleware 校验令牌）
 * 一次请求返回预览页首屏全部数据：站点配置 + 完整文档树 + 可选首屏正文
 *
 * 与访客接口的核心差异：**不复核 shareStatus**（未发布的库也能完整预览），
 * 访问权限由短时效预览令牌保证（只能由 owner 签发）
 *
 * @param wikiId 知识库 ID
 * @param docId 可选文档 ID（documents.id 或 wikiNodes.id 均可），传值时附带首屏正文
 * @returns { site, nodes, doc }；doc 缺省为 null（前端再按树内选中节点拉取正文）
 */
export async function getPreviewData(wikiId: string, docId?: string) {
  // 站点配置（wiki 不存在时抛 SHARE_NOT_FOUND）
  const site = await buildSiteConfig(wikiId)

  // 文档树：复用 owner 侧扁平树查询（预览 = owner 视角的完整树，不做可见性剔除）
  const nodes = await listWikiNodesFlat(wikiId)

  // 首屏正文：URL 带 docId 时解析返回（防跨库越权同 resolveDocumentScope）
  const doc = docId ? await getPreviewDocument(wikiId, docId) : null

  return { site, nodes, doc }
}

/**
 * 预览文档正文（GET /publish/wiki/:wikiId/preview/document/:documentId）
 * 预览模式内切换文档时取正文，返回结构与访客 getShareDocument 完全一致
 * （额外携带节点 title / icon），前端可复用同一文档视图组件
 *
 * @param wikiId 知识库 ID
 * @param documentId 文档 ID（documents.id 或 wikiNodes.id 均可）
 * @returns 文档记录（含 title / icon）
 */
export async function getPreviewDocument(wikiId: string, documentId: string) {
  // 解析文档作用域（id + wikiId 联合过滤，防跨库越权；双 ID 兼容）
  const doc = await resolveDocumentScope(wikiId, documentId)

  // 补充节点标题 / 图标（文档标题与 emoji 图标存于 wiki_nodes 表）
  const db = getDb()
  const [node] = await db
    .select({ title: wikiNodes.title, icon: wikiNodes.icon })
    .from(wikiNodes)
    .where(eq(wikiNodes.id, doc.nodeId))
    .limit(1)

  return { ...doc, title: node?.title ?? null, icon: node?.icon ?? null }
}

/**
 * 预览模式图片上传（POST /publish/wiki/:wikiId/upload，owner 预览面板调用）
 *
 * 预览站无登录态，鉴权由 previewAuthMiddleware 的预览令牌保证（中间件层已完成）；
 * 落盘与入库复用 media.service 的 uploadImage（MIME 白名单 / 5MB 上限 / ULID 命名 /
 * media_assets 入库），归属 userId 取 wiki.ownerId（资产归属到库主），并绑定 wikiId
 * 便于后续按库清理无引用图片
 *
 * @param wikiId 知识库 ID
 * @param file 上传的图片文件（Hono parseBody 解析出的 web 标准 File）
 * @returns { url } 对外可访问的图片地址（RustFS 对象存储绝对 URL，浏览器直连可达，pages 站 <img> 直接加载）
 */
export async function uploadPreviewImage(wikiId: string, file: File) {
  const db = getDb()

  // wiki 必须存在：ownerId 同时用作 media_assets 的归属用户
  const [w] = await db
    .select({ ownerId: wiki.ownerId })
    .from(wiki)
    .where(eq(wiki.id, wikiId))
    .limit(1)
  if (!w) {
    throw new BizException(ErrorCode.SHARE_NOT_FOUND)
  }

  const { url } = await uploadImage({ file, userId: w.ownerId, wikiId })
  return { url }
}

// ============ 公开站正文搜索（访客可达） ============

/** 正文搜索单文档结果（公开站语义：pages 站按 documents.id 跳转 /w/{wikiId}/{documentId}） */
export interface PublishedContentSearchItem {
  /** 文档 ID（documents.id，pages 前端跳转用；区别于 owner 侧搜索返回 nodeId） */
  documentId: string
  /** 节点 emoji 图标（可空） */
  icon: string | null
  /** 文档标题 */
  title: string
  /** 该文档的正文命中列表 */
  hits: ContentHit[]
}

/** SQL 粗筛候选文档上限（同 owner 侧 wiki-search，防止候选过多拖慢接口） */
const SEARCH_CANDIDATE_LIMIT = 30

/** 返回文档数上限（弹窗展示空间有限） */
const SEARCH_RESULT_LIMIT = 20

/**
 * 公开站文档正文关键词搜索（GET /publish/wiki/:wikiId/search）
 *
 * 定位：pages 站搜索弹窗的「内容命中」数据源（标题命中由前端本地过滤文档树实现）。
 * 复用 owner 侧 wiki-search 的命中定位逻辑（locateKeywordHits / escapeLikePattern），
 * 差异仅在可见性模型与返回 ID：
 * - 返回 documentId（documents.id）而非 nodeId，对齐 pages 站路由约定。
 * - 可见性放行条件二选一：
 *   a) 访客路径（无令牌）：库级 shareStatus 'public' 且未设密码（服务内复核，口径与
 *      访客树 / 正文读取一致——公开库下全部文档可读，仅排除回收站软删文档）；
 *      密码库公开站进不了内容，搜索不得绕过密码泄露正文，与未发布同口径拒绝；
 *   b) 预览路径（携带有效预览令牌）：owner 预览态，语义同 previewAuthMiddleware ——
 *      **不复核 shareStatus / 密码**，未发布的库也能完整搜索（令牌仅 owner 可签发）；
 *      令牌无效/过期/跨库 → 与拒绝同码 SHARE_NOT_FOUND（不暴露库存在性差异）。
 *
 * @param wikiId 知识库 ID
 * @param q 搜索关键词（调用方已 trim 非空）
 * @param previewToken 可选预览令牌（controller 从 X-Preview-Token 头 / ?t= 透传；空串归一为 undefined）
 * @returns 命中文档列表（无命中返回空数组，不抛业务异常）
 */
export async function searchPublishedContent(
  wikiId: string,
  q: string,
  previewToken?: string
): Promise<PublishedContentSearchItem[]> {
  const db = getDb()

  // 可见性放行判定（见函数注释的 a/b 两条路径）
  const share = await getWikiLevelShare(wikiId)
  const guestAllowed = !!share && share.shareStatus === 'public' && !share.password
  if (!guestAllowed) {
    const previewAllowed = previewToken
      ? await verifyShareToken(previewToken, `preview:${wikiId}`)
      : false
    if (!previewAllowed) {
      throw new BizException(ErrorCode.SHARE_NOT_FOUND)
    }
  }

  const pattern = `%${escapeLikePattern(q)}%`

  // 粗筛候选：plain_text 命中 OR content JSON 序列化文本命中（兜底 plain_text 缺失的存量文档）
  // join wiki_nodes 取标题/图标；排除回收站文档（is_deleted = true），其余口径同访客树（全量）
  const candidates = await db
    .select({
      documentId: documents.id,
      icon: wikiNodes.icon,
      title: wikiNodes.title,
      content: documents.content,
      plainText: documents.plainText,
    })
    .from(documents)
    .innerJoin(wikiNodes, eq(wikiNodes.id, documents.nodeId))
    .where(
      and(
        eq(documents.wikiId, wikiId),
        eq(wikiNodes.isDeleted, false),
        or(ilike(documents.plainText, pattern), sql`${documents.content}::text ilike ${pattern}`),
      ),
    )
    .limit(SEARCH_CANDIDATE_LIMIT)

  // 逐篇定位命中（纯内存 JSON 遍历，候选数有限）；无可定位命中的文档剔除
  const results: PublishedContentSearchItem[] = []
  for (const doc of candidates) {
    const hits = locateKeywordHits(doc.content, doc.plainText, q)
    if (hits.length === 0) continue
    results.push({ documentId: doc.documentId, icon: doc.icon, title: doc.title, hits })
    if (results.length >= SEARCH_RESULT_LIMIT) break
  }

  return results
}
