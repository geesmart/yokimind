import { createHash } from 'node:crypto'
import { wiki, wikiNodes, documents, documentVersions, activities, recentVisits, tags, documentTags, wikiShares, wikiPublish, ragSync } from '~/db/schema.js'
import { eq, ne, desc, asc, and, isNull, sql, inArray } from 'drizzle-orm'
import { BizException } from '~/core/lib/biz.exception.js'
import { ErrorCode } from '~/config/error-code.js'
import { getDb } from '~/core/helper/db.helper.js'
import { usePino } from '~/core/plugins/pino.js'
import { backfillWikiDocuments, enqueueDocument, extractText } from '~/modules/rag/rag.service.js'
import { deleteChunks } from '~/modules/rag/rag.store.js'
import { renderAndSaveHtml } from './document-html.renderer.js'
import type { CreateWiki, CreateWikiNode, CreateDocumentTag, SaveDocument, SaveWikiNodeTitle, SaveWikiNodeIcon, UpdateWiki, UpsertWikiShare, UpsertWikiNodeShare, MoveWikiNode } from './wiki.schema.js'

const logger = usePino()

/**
 * 知识库列表/详情统一返回字段
 * 与前端 WikiItem 对齐，不暴露 ownerId 等内部字段
 * 注：docCount 不再读冗余字段（历史数据未维护恒为 0），改为查询时实时统计该库节点数
 */
const wikiSelectFields = {
  id: wiki.id,
  name: wiki.name,
  description: wiki.description,
  icon: wiki.icon,
  color: wiki.color,
  ownerId: wiki.ownerId,
  visibility: wiki.visibility,
  status: wiki.status,
  // 实时统计该知识库下的节点数（每个节点即一篇文档）
  // 注意：必须手写表别名做关联（drizzle 的 sql 模板渲染列时不带表前缀，
  // 用 ${wiki.id} 会生成裸 "id" 被内层表遮蔽导致恒为 0）
  docCount: sql<number>`(select count(*)::int from "wiki_nodes" "wn" where "wn"."wiki_id" = "wiki"."id" and "wn"."is_deleted" = false)`.as('doc_count'),
  memberCount: wiki.memberCount,
  // 是否已发布：wiki_publish 行存在且发布开关打开（发布动作 POST /publish/.../publish 置 true，
  // 取消发布置 false）。与「已分享」互相独立 —— 两个状态可同时为 true：
  // 前端独立展示（分享 → Globe/Lock 图标；发布 → Send 图标），不做互斥推断
  published: sql<boolean>`(select count(*)::int from "wiki_publish" "wp" where "wp"."wiki_id" = "wiki"."id" and "wp"."enabled" = true) > 0`.as('published'),
  // 是否已分享（独立状态，数据源 wiki_shares 表）：库级权限行（node_id=''）share_status = 'public'。
  // 与 published（wiki_publish.enabled）互不依赖 —— 已发布未分享、已分享未发布、两者皆是均合法
  shared: sql<boolean>`(select count(*)::int from "wiki_shares" "ws" where "ws"."wiki_id" = "wiki"."id" and "ws"."node_id" = '' and "ws"."share_status" = 'public') > 0`.as('shared'),
  // 是否自动 RAG 索引（文档保存挂钩按此开关决定是否入队）
  ragEnabled: wiki.ragEnabled,
  createdAt: wiki.createdAt,
  updatedAt: wiki.updatedAt,
}

/**
 * 创建知识库
 * 当前版本不写 wiki_members 表，ownerId 直接取当前登录用户 ID
 * @param userId 当前登录用户 ID（ULID）
 * @param data 知识库名称 + 描述
 * @returns 新建知识库信息
 */
export async function createWiki(userId: string, data: CreateWiki) {
  const db = getDb()

  try {
    // 事务：知识库记录与库级权限行必须同时创建成功/失败
    // 保证「每个知识库固定一行库级权限记录」的不变式，避免出现无权限行的孤儿知识库
    const created = await db.transaction(async (tx) => {
      // 插入知识库记录，ownerId 为当前用户
      // visibility/status 使用表默认值（private / active）
      // icon/color 可选，用于知识库卡片展示
      const [row] = await tx
        .insert(wiki)
        .values({
          name: data.name,
          description: data.description ?? null,
          icon: data.icon ?? null,
          color: data.color ?? null,
          // 自动 RAG 索引开关：创建时由用户选择（未传走表默认值 false），
          // 开启后文档保存即自动入队切片向量化
          ragEnabled: data.ragEnabled ?? false,
          ownerId: userId,
        })
        .returning(wikiSelectFields)

      if (!row) {
        throw new BizException(ErrorCode.WIKI_CREATE_FAILED)
      }

      // 每个知识库固定一行库级权限记录（nodeId=''），默认私密、无密码
      // 该行的 shareStatus 是库可见性的唯一事实来源，后续 GET/POST /wiki/:id/share 读写此行
      await tx.insert(wikiShares).values({
        wikiId: row.id,
        nodeId: '',
        shareStatus: 'private',
        mode: 'view',
        createdBy: userId,
        // password 不传，保持 null（默认无密码）
      })

      return row
    })

    // 非阻塞写入操作动态（Dashboard「动态」列表数据源）
    // 失败不回滚知识库创建，仅记录日志
    try {
      await db.insert(activities).values({
        userId,
        wikiId: created.id,
        actionType: 'create',
        targetType: 'wiki',
        targetId: created.id,
        content: `创建了知识库「${created.name}」`,
      })
    } catch (e) {
      logger.warn({ err: e, wikiId: created.id }, 'record activity failed')
    }

    return created
  } catch (error) {
    // 已是业务异常直接抛出
    if (error instanceof BizException) throw error
    throw new BizException(ErrorCode.WIKI_CREATE_FAILED)
  }
}

/**
 * 获取当前用户拥有的知识库列表
 * 按 updatedAt 倒序，仅返回 ownerId 命中且未进入回收站（isDeleted = false）的记录
 * @param userId 当前登录用户 ID（ULID）
 * @returns 知识库列表
 */
export async function listWikisByUserId(userId: string) {
  const db = getDb()

  const list = await db
    .select(wikiSelectFields)
    .from(wiki)
    // 软删除的知识库只在回收站中出现，不进入正式列表
    .where(and(eq(wiki.ownerId, userId), eq(wiki.isDeleted, false)))
    .orderBy(desc(wiki.updatedAt))

  return list
}

/**
 * 文档树节点列表/详情统一返回字段
 * 与前端 WikiNodeItem 对齐，扁平结构（前端 buildTree 构建嵌套）
 * 注：Notion 风格统一节点模型 —— 不再有 isFolder 字段，每个节点都可同时拥有正文与子节点
 */
const wikiNodeSelectFields = {
  id: wikiNodes.id,
  title: wikiNodes.title,
  parentId: wikiNodes.parentId,
  sortOrder: wikiNodes.sortOrder,
  // 节点内容格式（'md' 默认；为 PDF/Word 等文件节点预留，附加字段对既有消费方透明）
  docFormat: wikiNodes.docFormat,
  documentId: wikiNodes.documentId,
  // 文件型节点绑定的 files 行 ID（'md' 节点为 null；附加字段对既有消费方透明）
  fileId: wikiNodes.fileId,
  icon: wikiNodes.icon,
  // 文章封面图 URL（博客列表卡使用，可空；附加字段对既有消费方透明）
  coverUrl: wikiNodes.coverUrl,
  isVisible: wikiNodes.isVisible,
  createdAt: wikiNodes.createdAt,
  updatedAt: wikiNodes.updatedAt,
}

/**
 * 文档内容返回字段
 * 与前端 DocumentDetail 对齐
 */
const documentSelectFields = {
  id: documents.id,
  wikiId: documents.wikiId,
  nodeId: documents.nodeId,
  content: documents.content,
  contentHtml: documents.contentHtml,
  plainText: documents.plainText,
  wordCount: documents.wordCount,
  status: documents.status,
  updatedAt: documents.updatedAt,
}

/**
 * 按知识库 ID 获取知识库详情（仅 owner 可访问，且回收站中的库视为不存在）
 * 不存在 / 非本人所有 / 已软删除 → WIKI_NOT_FOUND（不泄露存在性）
 * @param id 知识库 ID
 * @param userId 当前登录用户 ID
 * @returns 知识库详情
 */
export async function getWikiById(id: string, userId: string) {
  const db = getDb()

  const [found] = await db
    .select(wikiSelectFields)
    .from(wiki)
    // 回收站中的知识库对一切常规 owner 操作不可见（含按 URL 直开）
    .where(and(eq(wiki.id, id), eq(wiki.isDeleted, false)))
    .limit(1)

  // 不存在或不属于当前用户，统一抛「不存在」
  if (!found || found.ownerId !== userId) {
    throw new BizException(ErrorCode.WIKI_NOT_FOUND)
  }

  return found
}

/**
 * 更新知识库基本信息（name / description）
 * 仅 owner 可操作，支持部分更新
 * @param id 知识库 ID
 * @param userId 当前登录用户 ID
 * @param data 更新数据（name 可选，description 可选）
 * @returns 更新后的知识库信息
 */
export async function updateWiki(id: string, userId: string, data: UpdateWiki) {
  const db = getDb()

  // 校验知识库归属（越权抛 WIKI_NOT_FOUND）
  const existing = await getWikiById(id, userId)

  // 动态构建更新字段，只更新客户端传入的字段
  const now = new Date()
  const updateData: Record<string, unknown> = { updatedAt: now }

  if (data.name !== undefined) {
    updateData.name = data.name
  }
  if (data.description !== undefined) {
    updateData.description = data.description
  }
  if (data.icon !== undefined) {
    updateData.icon = data.icon
  }
  if (data.color !== undefined) {
    updateData.color = data.color
  }
  // 是否自动 RAG 索引：可选更新（未传保持不变）
  if (data.ragEnabled !== undefined) {
    updateData.ragEnabled = data.ragEnabled
  }

  const [updated] = await db
    .update(wiki)
    .set(updateData)
    .where(eq(wiki.id, id))
    .returning(wikiSelectFields)

  if (!updated) {
    throw new BizException(ErrorCode.WIKI_UPDATE_FAILED)
  }

  // 开启 AI 索引（false→true 跳变）时自动为存量文档补建索引任务：
  // rag_sync 任务行只在「保存文档 / 手动重建」两个时机产生，先建文档后开开关的库
  // 会永远没有任务行（wiki_rag 快照全 0，Dashboard 徽标显示不出进度）。
  // 查漏补缺语义：只补缺失行（done 不重跑），失败仅 warn 不阻断开关保存
  //（任务可由用户手动「重建索引」或下次保存文档兜底）
  if (data.ragEnabled && !existing.ragEnabled) {
    try {
      await backfillWikiDocuments(id)
    } catch (e) {
      logger.warn({ err: e, wikiId: id }, 'backfill rag tasks on rag enable failed')
    }
  }

  return updated
}

/**
 * 获取知识库的文档树节点列表（扁平，按 sortOrder 排序）
 * 调用前先经 getWikiById 校验归属
 * @param wikiId 知识库 ID
 * @param userId 当前登录用户 ID
 * @returns 节点扁平数组
 */
export async function listWikiNodes(wikiId: string, userId: string) {
  const db = getDb()

  // 先校验知识库归属（越权抛 WIKI_NOT_FOUND）
  await getWikiById(wikiId, userId)

  return listWikiNodesFlat(wikiId)
}

/**
 * 查询知识库的文档树节点列表（扁平，不做归属校验）
 * 供 owner 侧 listWikiNodes 与公开分享模块（share.service）共用
 * 调用方自行保证 wikiId 合法（owner 已校验 / 分享已启用）
 * @param wikiId 知识库 ID
 * @returns 节点扁平数组
 */
export async function listWikiNodesFlat(wikiId: string) {
  const db = getDb()

  const list = await db
    .select(wikiNodeSelectFields)
    .from(wikiNodes)
    // 软删除过滤：已进回收站的节点不出现在文档树（owner 侧与公开分享共用本查询，一处过滤两处生效）
    .where(and(eq(wikiNodes.wikiId, wikiId), eq(wikiNodes.isDeleted, false)))
    .orderBy(asc(wikiNodes.sortOrder), asc(wikiNodes.createdAt))

  return list
}

/**
 * 在知识库中创建文档节点（Notion 风格统一节点模型）
 *
 * 每个节点都是文档，可同时拥有正文内容（关联 documents 行）与子节点（通过 parentId 嵌套）。
 * 不再有"文件夹 / 文档"区分，任何节点都可被指定为 parentId。
 *
 * 原子操作（事务）：
 *  - documents + wikiNodes 两表必须同时成功/失败，避免孤儿文档
 *
 * 支持 parentId：
 *  - 当 parentId 指定时，在该父节点下创建子节点，sortOrder 取同级最大值 + 1
 *  - 当 parentId 为 null/undefined 时，在根层级创建节点（现有逻辑）
 *
 * 步骤：
 *  1. getWikiById 校验知识库归属（越权抛 WIKI_NOT_FOUND）
 *  2. 若有 parentId：校验父节点存在且属于同一 wiki，计算新 sortOrder
 *  3. 若无 parentId：取根级最大 sortOrder + 1，追加到根层级末尾（按创建顺序正序展示）
 *  4. 插入 wikiNodes 记录（documentId 先为占位，后续回写）
 *  5. 插入 documents 空文档记录，回写 wikiNodes.documentId 建立双向关联
 *
 * @param wikiId 知识库 ID
 * @param userId 当前登录用户 ID（ULID）
 * @param data 节点创建参数（可选 title、parentId）
 * @returns 新建节点（扁平结构，与 listWikiNodes 返回格式一致）
 */
export async function createWikiNode(wikiId: string, userId: string, data: CreateWikiNode) {
  const db = getDb()

  // 校验知识库归属（越权抛 WIKI_NOT_FOUND）
  await getWikiById(wikiId, userId)

  const parentId = data.parentId ?? null

  // 标题：去除首尾空白，空串则用默认值（统一为"无标题文档"）
  const title = data.title?.trim() || '无标题文档'

  // 若指定了 parentId，校验父节点存在且属于同一 wiki（任何节点都可作为父节点）
  if (parentId) {
    const [parentNode] = await db
      .select()
      .from(wikiNodes)
      .where(eq(wikiNodes.id, parentId))
      .limit(1)

    if (!parentNode || parentNode.wikiId !== wikiId) {
      throw new BizException(ErrorCode.WIKI_NOT_FOUND)
    }
  }

  try {
    // 事务：保证数据一致性
    const [created] = await db.transaction(async (tx) => {
      // 计算新节点的 sortOrder
      let sortOrder: number

      if (parentId) {
        // 在指定父节点下创建：取同级最大 sortOrder + 1
        const siblingNodes = await tx
          .select({ sortOrder: wikiNodes.sortOrder })
          .from(wikiNodes)
          .where(and(eq(wikiNodes.wikiId, wikiId), eq(wikiNodes.parentId, parentId)))
          .orderBy(sql`${wikiNodes.sortOrder} DESC`)
          .limit(1)
        sortOrder = siblingNodes.length > 0 ? siblingNodes[0].sortOrder + 1 : 0
      } else {
        // 根层级创建：取根级最大 sortOrder + 1，追加到末尾（与子级创建行为一致，
        // 保证按创建顺序「第一篇、第二篇、第三篇」正序展示，而非新节点插顶导致倒序）
        const rootNodes = await tx
          .select({ sortOrder: wikiNodes.sortOrder })
          .from(wikiNodes)
          .where(and(eq(wikiNodes.wikiId, wikiId), isNull(wikiNodes.parentId)))
          .orderBy(sql`${wikiNodes.sortOrder} DESC`)
          .limit(1)
        sortOrder = rootNodes.length > 0 ? rootNodes[0].sortOrder + 1 : 0
      }

      // 插入 wikiNodes 节点（documentId 先占位，事务后半段回写）
      const [node] = await tx
        .insert(wikiNodes)
        .values({
          wikiId,
          parentId,
          sortOrder,
          title,
          documentId: '',
          createdBy: userId,
        })
        .returning(wikiNodeSelectFields)

      if (!node) {
        throw new BizException(ErrorCode.WIKI_NODE_CREATE_FAILED)
      }

      // 插入空文档记录（每个节点都强制关联一个 documents 行）
      const [doc] = await tx
        .insert(documents)
        .values({
          wikiId,
          nodeId: node.id,
          creatorId: userId,
          lastEditorId: userId,
        })
        .returning({ id: documents.id })

      if (!doc) {
        throw new BizException(ErrorCode.WIKI_NODE_CREATE_FAILED)
      }

      // 回写 wikiNodes.documentId，建立双向关联
      await tx
        .update(wikiNodes)
        .set({ documentId: doc.id })
        .where(eq(wikiNodes.id, node.id))

      // 返回带 documentId 的完整节点
      return [{ ...node, documentId: doc.id }]
    })

    return created
  } catch (error) {
    // 已是业务异常直接抛出（含越权、创建失败）
    if (error instanceof BizException) throw error
    // 其余异常统一包装为创建失败
    throw new BizException(ErrorCode.WIKI_NODE_CREATE_FAILED)
  }
}

/**
 * 移动文档节点（拖拽排序持久化）
 *
 * 语义：把 nodeId 移动到 targetParentId（null = 根层级）下的第 index 个位置。
 * index 为「被移动节点从原位置移除后」的同级最终下标（与前端本地 moveDoc 后
 * getNodePosition 返回的最终位置一致），服务端据此对目标同级列表重新编号。
 *
 * 排序策略：整段重编号（sortOrder = 0..n）而非取中间值/尾值 +1——
 * 避免多次拖拽产生的精度/密度问题，且软删除节点不参与编号（其残留 sortOrder 不影响展示，
 * 列表查询固定过滤 is_deleted = false）。
 *
 * 原子操作（事务）：
 *  - 被移动节点更新 parentId + sortOrder，其余兄弟节点回写新 sortOrder，必须整体成功/失败
 *
 * 守卫：
 *  - 经 getWikiById 校验知识库归属（越权抛 WIKI_NOT_FOUND）
 *  - 目标父级必须存在且属于同一 wiki
 *  - 防环：不允许移入自身或自身子树（沿目标父级向上回溯命中被移动节点即拒绝）
 *  - index 超界收敛到同级列表末尾（前端 append 场景直接传末尾即可）
 *
 * @param nodeId 被移动节点 ID
 * @param userId 当前登录用户 ID（ULID）
 * @param data 目标位置（parentId + index）
 */
export async function moveWikiNode(nodeId: string, userId: string, data: MoveWikiNode) {
  const db = getDb()

  // 节点必须存在；经其 wikiId 校验知识库归属（越权/不存在抛 WIKI_NOT_FOUND）
  const [node] = await db
    .select({ id: wikiNodes.id, wikiId: wikiNodes.wikiId })
    .from(wikiNodes)
    .where(eq(wikiNodes.id, nodeId))
    .limit(1)
  if (!node) {
    throw new BizException(ErrorCode.WIKI_NOT_FOUND)
  }
  await getWikiById(node.wikiId, userId)

  const targetParentId = data.parentId ?? null

  try {
    await db.transaction(async (tx) => {
      // 防环校验：沿目标父级一路向上回溯，任何一层命中被移动节点都意味着
      // 「把节点移入它自己的子树」，会造成环，直接拒绝
      if (targetParentId) {
        let cursorId: string | null = targetParentId
        while (cursorId) {
          const [cursor] = await tx
            .select({ id: wikiNodes.id, wikiId: wikiNodes.wikiId, parentId: wikiNodes.parentId })
            .from(wikiNodes)
            .where(eq(wikiNodes.id, cursorId))
            .limit(1)
          // 目标父级不存在或不属于同一 wiki（跨库拖拽非法）
          if (!cursor || cursor.wikiId !== node.wikiId) {
            throw new BizException(ErrorCode.WIKI_NODE_MOVE_FAILED)
          }
          if (cursor.id === nodeId) {
            // 目标父级是被移动节点自身或其后代
            throw new BizException(ErrorCode.WIKI_NODE_MOVE_FAILED)
          }
          cursorId = cursor.parentId
        }
      }

      // 目标同级列表：排除被移动节点本身（index 语义 = 移除后的最终下标），
      // 排除软删除节点（回收站行不参与排序），与列表查询 asc(sortOrder), asc(createdAt) 一致
      // 根层级时 parentId 为 NULL，需用 isNull 匹配
      const siblings = await tx
        .select({ id: wikiNodes.id })
        .from(wikiNodes)
        .where(
          and(
            eq(wikiNodes.wikiId, node.wikiId),
            targetParentId === null
              ? isNull(wikiNodes.parentId)
              : eq(wikiNodes.parentId, targetParentId),
            eq(wikiNodes.isDeleted, false),
            ne(wikiNodes.id, nodeId)
          )
        )
        .orderBy(asc(wikiNodes.sortOrder), asc(wikiNodes.createdAt))

      // 插入到目标索引（超界收敛到末尾）后整段重编号 0..n
      const clampedIndex = Math.min(data.index, siblings.length)
      siblings.splice(clampedIndex, 0, { id: nodeId })

      // 回写：被移动节点更新 parentId + sortOrder；其余兄弟仅更新 sortOrder
      // 逐行 UPDATE 行数 = 同级节点数（侧栏场景几十行内），事务内开销可接受
      for (const [i, sibling] of siblings.entries()) {
        if (sibling.id === nodeId) {
          await tx
            .update(wikiNodes)
            .set({ parentId: targetParentId, sortOrder: i })
            .where(eq(wikiNodes.id, nodeId))
        } else {
          await tx
            .update(wikiNodes)
            .set({ sortOrder: i })
            .where(eq(wikiNodes.id, sibling.id))
        }
      }
    })
  } catch (error) {
    // 已是业务异常直接抛出（防环 / 目标父级非法）
    if (error instanceof BizException) throw error
    // 其余异常统一包装为移动失败
    throw new BizException(ErrorCode.WIKI_NODE_MOVE_FAILED)
  }
}

/**
 * 按 ID 获取文档正文内容（仅 owner 可访问）
 * 先查文档，再经 wikiId 校验知识库归属
 * @param id 文档 ID（wikiNodes.documentId）
 * @param userId 当前登录用户 ID
 * @returns 文档记录（含 Tiptap JSON content）
 */
export async function getDocumentById(id: string, userId: string) {
  const db = getDb()

  const [found] = await db
    .select(documentSelectFields)
    .from(documents)
    .where(eq(documents.id, id))
    .limit(1)

  if (!found) {
    throw new BizException(ErrorCode.WIKI_NOT_FOUND)
  }

  // 经 wikiId 校验知识库归属（越权抛 WIKI_NOT_FOUND）
  await getWikiById(found.wikiId, userId)

  // 副作用：记录最近访问（Dashboard「最近访问」列表数据源）
  // GET 接口带写入副作用，仅用于访问埋点；非阻塞，失败不影响文档读取
  // 命中 (userId, targetType, targetId) 唯一约束时更新 lastVisitedAt
  try {
    await db
      .insert(recentVisits)
      .values({
        userId,
        targetType: 'document',
        targetId: id,
        lastVisitedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [recentVisits.userId, recentVisits.targetType, recentVisits.targetId],
        set: { lastVisitedAt: new Date() },
      })
  } catch (e) {
    logger.warn({ err: e, userId, documentId: id }, 'record recent visit failed')
  }

  return found
}

// ============ 文档自动保存 ============

/**
 * 规范化 JSON 序列化：递归对对象键排序后序列化，数组保持原序，undefined 值剔除
 * 目的：规避 JSON.stringify 依赖键插入顺序 + PostgreSQL jsonb 存取会重排键序的问题，
 * 保证「同一内容无论键序如何，算出的 MD5 指纹恒定」
 */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`
}

/**
 * 计算文档内容 MD5 指纹（32 位小写 hex）
 * 基于规范化序列化（键序无关），保存文档时由服务端计算写入 documents.contentMd5，
 * 供内容级去重 / 完整性校验 / 变更比对使用；客户端无需上传
 */
export function computeContentMd5(content: unknown): string {
  return createHash('md5').update(canonicalJson(content)).digest('hex')
}

/**
 * 保存文档内容（自动保存接口）
 * - 更新 content/contentMd5/contentHtml/plainText/wordCount/lastEditorId/updatedAt
 * - 注：当前版本暂不考虑多人并发编辑冲突，乐观锁校验已移除
 * @param documentId 文档 ID（documents.id）
 * @param userId 当前登录用户 ID
 * @param data SaveDocumentSchema 数据
 * @returns 更新后的文档信息
 */
export async function saveDocument(documentId: string, userId: string, data: SaveDocument) {
  const db = getDb()

  // 1. 查询文档并校验归属
  const [existing] = await db
    .select(documentSelectFields)
    .from(documents)
    .where(eq(documents.id, documentId))
    .limit(1)

  if (!existing) {
    throw new BizException(ErrorCode.WIKI_NOT_FOUND)
  }

  // 校验归属（返回知识库行，ragEnabled 供 RAG 挂钩判断是否自动入队）
  const wikiRow = await getWikiById(existing.wikiId, userId)

  // 2. 更新文档
  const now = new Date()
  const [updated] = await db
    .update(documents)
    .set({
      content: data.content,
    // contentHtml：local-first 改造后客户端只传 content JSON 不再带 HTML。
    // 不传时保留原值（不得清空！此前 ?? null 的行为导致每次自动保存把
    // content_html 置 null，pages 公开站/预览页正文渲染退化为「该文档暂无内容」）。
    // 服务端 HTML 由下方 renderAndSaveHtml 异步渲染落库；
    // 显式传入时（旧客户端 / 手动接口调用）以传入值为准
    contentHtml: data.contentHtml !== undefined ? data.contentHtml : existing.contentHtml,
    // plainText 兜底：客户端（local-first 同步队列）只传 content JSON 时不带 plainText，
    // 服务端从 content 递归提取，保证下游 RAG 切片兜底 / 搜索粗筛 / 博客摘要不受影响
    plainText: data.plainText ?? (extractText(data.content) || null),
    // 内容 MD5 指纹：保存时服务端计算写入（规范化序列化，键序无关），
    // 供内容级去重 / 完整性校验 / 变更比对使用，客户端无需上传
    contentMd5: computeContentMd5(data.content),
    wordCount: data.wordCount ?? 0,
      lastEditorId: userId,
      updatedAt: now,
    })
    .where(eq(documents.id, documentId))
    .returning(documentSelectFields)

  if (!updated) {
    throw new BizException(ErrorCode.DOCUMENT_SAVE_FAILED)
  }

  // 4. 同步更新 wiki.updatedAt，确保知识库最后更新时间准确
  await db
    .update(wiki)
    .set({ updatedAt: now })
    .where(eq(wiki.id, existing.wikiId))

  // 5. RAG 挂钩：文档内容变更后入队索引任务（切片 + 向量化）
  // 仅在知识库开启「自动 RAG 索引」（wiki.ragEnabled）时入队；
  // 关闭时不入队且不清理已入库向量（检索/问答对已有切片仍生效），手动路径为 /rag/reindex 全库重建
  // 非阻塞：索引失败不影响保存主流程，任务留在队列由 worker 重试
  if (wikiRow.ragEnabled) {
    try {
      await enqueueDocument(documentId, existing.wikiId)
    } catch (e) {
      logger.warn({ err: e, documentId, wikiId: existing.wikiId }, 'enqueue rag index task failed')
    }
  }

  // 6. HTML 异步延迟渲染：pages 公开站 / 预览页正文消费预渲染的 content_html，
  // 而保存 payload 只有 content JSON。主更新已成功、响应即将返回，这里 setImmediate
  // 把渲染挪到请求之后执行（不阻塞保存响应；渲染 ~7ms/篇）。
  // setImmediate 回调脱离 hono 请求上下文，renderAndSaveHtml 内部必须用
  // usePostgres()（全局单例）而非 getDb()（context-storage 在回调中不可用）。
  // 失败仅 warn：旧 HTML 因「不传不清空」得以保留，下次保存自然重试
  setImmediate(() => void renderAndSaveHtml(documentId, data.content))

  return updated
}

/**
 * 保存文档节点标题
 * - 查询节点并校验归属
 * - 更新 wikiNodes.title
 * @param nodeId 节点 ID（wikiNodes.id）
 * @param userId 当前登录用户 ID
 * @param data SaveWikiNodeTitleSchema 数据（含 title）
 * @returns 更新后的节点信息
 */
export async function saveWikiNodeTitle(nodeId: string, userId: string, data: SaveWikiNodeTitle) {
  const db = getDb()

  // 查询节点并校验归属
  const [existing] = await db
    .select()
    .from(wikiNodes)
    .where(eq(wikiNodes.id, nodeId))
    .limit(1)

  if (!existing) {
    throw new BizException(ErrorCode.WIKI_NOT_FOUND)
  }

  await getWikiById(existing.wikiId, userId)

  const [updated] = await db
    .update(wikiNodes)
    .set({ title: data.title })
    .where(eq(wikiNodes.id, nodeId))
    .returning(wikiNodeSelectFields)

  if (!updated) {
    throw new BizException(ErrorCode.DOCUMENT_SAVE_FAILED)
  }

  // 同步更新 wiki.updatedAt，确保知识库最后更新时间准确
  await db
    .update(wiki)
    .set({ updatedAt: new Date() })
    .where(eq(wiki.id, existing.wikiId))

  return updated
}

/**
 * 保存文档节点图标（emoji）
 *
 * 流程：
 *  1. 查询节点并校验归属
 *  2. 更新 wiki_nodes.icon 字段
 *  3. 同步更新 wiki.updatedAt
 *
 * @param nodeId 节点 ID（wikiNodes.id）
 * @param userId 当前登录用户 ID
 * @param data 保存参数（含 icon，空字符串表示清除图标）
 * @returns 更新后的节点信息
 */
export async function saveWikiNodeIcon(nodeId: string, userId: string, data: SaveWikiNodeIcon) {
  const db = getDb()

  // 查询节点并校验归属
  const [existing] = await db
    .select()
    .from(wikiNodes)
    .where(eq(wikiNodes.id, nodeId))
    .limit(1)

  if (!existing) {
    throw new BizException(ErrorCode.WIKI_NOT_FOUND)
  }

  await getWikiById(existing.wikiId, userId)

  // icon 为空字符串时存为 NULL（清除图标）
  const iconValue = data.icon.trim() || null

  const [updated] = await db
    .update(wikiNodes)
    .set({ icon: iconValue })
    .where(eq(wikiNodes.id, nodeId))
    .returning(wikiNodeSelectFields)

  if (!updated) {
    throw new BizException(ErrorCode.DOCUMENT_SAVE_FAILED)
  }

  // 同步更新 wiki.updatedAt，确保知识库最后更新时间准确
  await db
    .update(wiki)
    .set({ updatedAt: new Date() })
    .where(eq(wiki.id, existing.wikiId))

  return updated
}

/**
 * 删除文档节点（软删除：移入回收站，子树整体标记）
 *
 * 流程：
 *  1. 查询节点并校验归属
 *  2. 查询知识库所有节点，递归收集待删除的节点 ID（子树整体）
 *  3. 事务内批量标记 is_deleted（documents / RAG 数据保留，支持恢复）
 *
 * @param id 节点 ID（wikiNodes.id）
 * @param userId 当前登录用户 ID
 */
export async function deleteWikiNode(id: string, userId: string) {
  const db = getDb()

  // 1. 查询节点并校验归属
  const [existing] = await db
    .select()
    .from(wikiNodes)
    .where(eq(wikiNodes.id, id))
    .limit(1)

  if (!existing) {
    throw new BizException(ErrorCode.WIKI_NOT_FOUND)
  }

  await getWikiById(existing.wikiId, userId)

  try {
    // 2. 查询该知识库所有节点（含已在回收站中的），构建父子关系映射，递归收集待删除节点
    const allNodes = await db
      .select({
        id: wikiNodes.id,
        parentId: wikiNodes.parentId,
      })
      .from(wikiNodes)
      .where(eq(wikiNodes.wikiId, existing.wikiId))

    // 构建 parentId -> children 的映射
    const childrenMap = new Map<string | null, typeof allNodes>()
    for (const node of allNodes) {
      const key = node.parentId
      if (!childrenMap.has(key)) {
        childrenMap.set(key, [])
      }
      childrenMap.get(key)!.push(node)
    }

    // 递归收集所有待删除的节点（子树整体，含全部后代）
    const nodeIdsToDelete: string[] = []

    function collectDescendants(nodeId: string) {
      // 找到当前节点
      const node = allNodes.find((n) => n.id === nodeId)
      if (!node) return

      nodeIdsToDelete.push(node.id)

      // 递归收集子节点
      const children = childrenMap.get(node.id) || []
      for (const child of children) {
        collectDescendants(child.id)
      }
    }

    collectDescendants(id)

    // 3. 事务内批量软删除：仅标记 wiki_nodes.is_deleted，正文 / RAG / 分享数据全部保留
    // updatedAt 同步写入并冻结（被删节点不可再编辑）= 回收站「删除于 xx」展示与排序依据
    const now = new Date()
    await db.transaction(async (tx) => {
      if (nodeIdsToDelete.length > 0) {
        await tx
          .update(wikiNodes)
          .set({ isDeleted: true, updatedAt: now })
          .where(inArray(wikiNodes.id, nodeIdsToDelete))
      }
    })
  } catch (error) {
    if (error instanceof BizException) throw error
    throw new BizException(ErrorCode.WIKI_NODE_DELETE_FAILED)
  }
}

// ============ 回收站 ============

/**
 * 回收站条目（顶层删除项）返回结构
 * 与前端 TrashItem 对齐；count 为该条目携带的子树总节点数（含自身）
 */
export interface WikiTrashItem {
  /** 顶层被删节点 ID（wikiNodes.id） */
  id: string
  /** 节点标题 */
  title: string
  /** 节点 emoji 图标（可空） */
  icon: string | null
  /** 关联文档 ID（documents.id） */
  documentId: string
  /** 删除时刻（取删除时同步写入并冻结的 updatedAt） */
  deletedAt: Date
  /** 子树总节点数（含自身），用于前端展示「N 项」 */
  count: number
}

/**
 * 查询知识库回收站列表（仅顶层删除项，嵌套子项不单独出现）
 *
 * 顶层判定：节点的父级行不存在（从未有 / 父已彻底删除）或父节点未删除（单独删除子树场景）。
 * 父节点也在回收站时，子项跟随父条目展示与恢复，不重复列出。
 *
 * @param wikiId 知识库 ID（wikis.id）
 * @param userId 当前登录用户 ID
 * @returns 顶层删除项列表，按删除时间倒序
 */
export async function listWikiTrash(wikiId: string, userId: string): Promise<WikiTrashItem[]> {
  const db = getDb()

  // 归属校验（越权抛 WIKI_NOT_FOUND）
  await getWikiById(wikiId, userId)

  // 已删除节点全集（含嵌套子项，用于顶层判定与子树规模统计）
  // deletedAt 返回字段取 updatedAt（删除时同步写入冻结的删除时刻，见 deleteWikiNode）
  const deletedNodes = await db
    .select({
      id: wikiNodes.id,
      parentId: wikiNodes.parentId,
      title: wikiNodes.title,
      icon: wikiNodes.icon,
      documentId: wikiNodes.documentId,
      deletedAt: wikiNodes.updatedAt,
    })
    .from(wikiNodes)
    .where(and(eq(wikiNodes.wikiId, wikiId), eq(wikiNodes.isDeleted, true)))

  // 已删节点 ID 索引 + 子树 children 映射
  const byId = new Map(deletedNodes.map((n) => [n.id, n]))
  const childrenMap = new Map<string, typeof deletedNodes>()
  for (const node of deletedNodes) {
    if (node.parentId == null) continue
    const list = childrenMap.get(node.parentId) ?? []
    list.push(node)
    childrenMap.set(node.parentId, list)
  }

  // 子树规模计数（含自身），memoized 防止重复遍历
  const countCache = new Map<string, number>()
  function subtreeCount(nodeId: string): number {
    const cached = countCache.get(nodeId)
    if (cached !== undefined) return cached
    const children = childrenMap.get(nodeId) ?? []
    const total = 1 + children.reduce((sum, child) => sum + subtreeCount(child.id), 0)
    countCache.set(nodeId, total)
    return total
  }

  // 顶层删除项：父级不在已删集合（父未删除 / 父行不存在 / 根层级）
  return deletedNodes
    .filter((n) => n.parentId == null || !byId.has(n.parentId))
    .map((n) => ({
      id: n.id,
      title: n.title,
      icon: n.icon,
      documentId: n.documentId,
      deletedAt: n.deletedAt,
      count: subtreeCount(n.id),
    }))
    .sort((a, b) => b.deletedAt.getTime() - a.deletedAt.getTime())
}

/**
 * 恢复回收站节点（整棵子树恢复）
 *
 * 流程：
 *  1. 校验节点存在、归属、确在回收站中（is_deleted = true）
 *  2. 收集以该节点为根的子树，事务内 is_deleted 全部置回 false
 *  3. 父级归位：原父节点缺失或仍在回收站时，挂到根层级末尾（Notion 同款语义）
 *
 * @param id 节点 ID（wikiNodes.id）
 * @param userId 当前登录用户 ID
 * @returns 恢复后的节点信息（扁平结构，与 listWikiNodes 返回格式一致）
 */
export async function restoreWikiTrashNode(id: string, userId: string) {
  const db = getDb()

  // 1. 查询节点并校验归属
  const [existing] = await db
    .select()
    .from(wikiNodes)
    .where(eq(wikiNodes.id, id))
    .limit(1)

  if (!existing) {
    throw new BizException(ErrorCode.WIKI_NOT_FOUND)
  }

  await getWikiById(existing.wikiId, userId)

  // 只允许恢复已在回收站中的节点
  if (!existing.isDeleted) {
    throw new BizException(ErrorCode.WIKI_NODE_NOT_IN_TRASH)
  }

  try {
    // 2. 查询该库全部节点（含未删除的），用于子树收集与父级状态判定
    const allNodes = await db
      .select({
        id: wikiNodes.id,
        parentId: wikiNodes.parentId,
        isDeleted: wikiNodes.isDeleted,
      })
      .from(wikiNodes)
      .where(eq(wikiNodes.wikiId, existing.wikiId))

    const childrenMap = new Map<string | null, typeof allNodes>()
    for (const node of allNodes) {
      const key = node.parentId
      if (!childrenMap.has(key)) {
        childrenMap.set(key, [])
      }
      childrenMap.get(key)!.push(node)
    }

    // 收集子树全部节点（无论后代是否被单独删除过，统一恢复）
    const nodeIdsToRestore: string[] = []

    function collectDescendants(nodeId: string) {
      const node = allNodes.find((n) => n.id === nodeId)
      if (!node) return
      nodeIdsToRestore.push(node.id)
      const children = childrenMap.get(node.id) || []
      for (const child of children) {
        collectDescendants(child.id)
      }
    }

    collectDescendants(id)

    // 3. 父级归位判定：父行缺失或父节点仍在回收站 → 挂到根层级末尾
    let reparentToRoot = false
    if (existing.parentId) {
      const parent = allNodes.find((n) => n.id === existing.parentId)
      if (!parent || parent.isDeleted) {
        reparentToRoot = true
      }
    }

    await db.transaction(async (tx) => {
      // 子树整体恢复：is_deleted 置回 false
      await tx
        .update(wikiNodes)
        .set({ isDeleted: false, updatedAt: new Date() })
        .where(inArray(wikiNodes.id, nodeIdsToRestore))

      // 需要时将恢复节点挂到根层级末尾（sortOrder = 根级最大值 + 1）
      if (reparentToRoot) {
        const [orderRow] = await tx
          .select({ maxOrder: sql<number>`coalesce(max(${wikiNodes.sortOrder}), -1)`.mapWith(Number) })
          .from(wikiNodes)
          .where(and(eq(wikiNodes.wikiId, existing.wikiId), isNull(wikiNodes.parentId)))

        await tx
          .update(wikiNodes)
          .set({ parentId: null, sortOrder: (orderRow?.maxOrder ?? -1) + 1 })
          .where(eq(wikiNodes.id, id))
      }
    })

    // 返回恢复后的节点（重新查询保证字段完整）
    const [restored] = await db
      .select(wikiNodeSelectFields)
      .from(wikiNodes)
      .where(eq(wikiNodes.id, id))
      .limit(1)

    return restored
  } catch (error) {
    if (error instanceof BizException) throw error
    throw new BizException(ErrorCode.WIKI_NODE_RESTORE_FAILED)
  }
}

/**
 * 彻底删除回收站节点（硬删除，不可恢复）
 *
 * 仅允许对已在回收站中的节点执行。级联清理范围（原硬删实现 + 补齐残留）：
 *  - documents 正文 + documentVersions 历史版本（原实现遗漏，这里补齐）
 *  - rag_sync 索引任务行
 *  - wiki_shares 页级分享行（nodeId 命中被删节点；库级行 nodeId='' 不受影响）
 *  - wiki_nodes 节点本体（子树整体）
 *  - 事务后清理 Qdrant 切片向量（跨存储无法同事务，失败仅 warn 不阻断）
 *
 * @param id 节点 ID（wikiNodes.id）
 * @param userId 当前登录用户 ID
 * @returns 被彻底删除的节点 ID 与文档 ID 列表（前端据此判断当前打开文档是否被级联删除）
 */
export async function purgeWikiTrashNode(id: string, userId: string) {
  const db = getDb()

  // 查询节点并校验归属
  const [existing] = await db
    .select()
    .from(wikiNodes)
    .where(eq(wikiNodes.id, id))
    .limit(1)

  if (!existing) {
    throw new BizException(ErrorCode.WIKI_NOT_FOUND)
  }

  await getWikiById(existing.wikiId, userId)

  // 只允许彻底删除已在回收站中的节点（防止误删正常节点）
  if (!existing.isDeleted) {
    throw new BizException(ErrorCode.WIKI_NODE_NOT_IN_TRASH)
  }

  try {
    // 查询该库全部节点，递归收集待删除节点与关联文档（与原硬删逻辑一致）
    const allNodes = await db
      .select({
        id: wikiNodes.id,
        parentId: wikiNodes.parentId,
        documentId: wikiNodes.documentId,
      })
      .from(wikiNodes)
      .where(eq(wikiNodes.wikiId, existing.wikiId))

    const childrenMap = new Map<string | null, typeof allNodes>()
    for (const node of allNodes) {
      const key = node.parentId
      if (!childrenMap.has(key)) {
        childrenMap.set(key, [])
      }
      childrenMap.get(key)!.push(node)
    }

    const nodeIdsToDelete: string[] = []
    const documentIdsToDelete: string[] = []

    function collectDescendants(nodeId: string) {
      const node = allNodes.find((n) => n.id === nodeId)
      if (!node) return

      nodeIdsToDelete.push(node.id)

      // 每个节点都关联一个 document，统一收集
      if (node.documentId) {
        documentIdsToDelete.push(node.documentId)
      }

      const children = childrenMap.get(node.id) || []
      for (const child of children) {
        collectDescendants(child.id)
      }
    }

    collectDescendants(id)

    // 事务内执行硬删除（顺序：正文/版本/任务/分享行 → 节点本体）
    await db.transaction(async (tx) => {
      if (documentIdsToDelete.length > 0) {
        // 文档正文
        await tx.delete(documents).where(inArray(documents.id, documentIdsToDelete))

        // 文档历史版本（原 deleteWikiNode 实现遗漏，这里补齐避免孤儿版本）
        await tx
          .delete(documentVersions)
          .where(inArray(documentVersions.documentId, documentIdsToDelete))

        // RAG 索引任务行（无外键，应用层维护）
        await tx.delete(ragSync).where(inArray(ragSync.documentId, documentIdsToDelete))
      }

      // 页级分享配置行（nodeId 命中被删节点），库级主开关行 nodeId='' 不在集合内，不受影响
      await tx
        .delete(wikiShares)
        .where(and(eq(wikiShares.wikiId, existing.wikiId), inArray(wikiShares.nodeId, nodeIdsToDelete)))

      // 节点本体
      if (nodeIdsToDelete.length > 0) {
        await tx.delete(wikiNodes).where(inArray(wikiNodes.id, nodeIdsToDelete))
      }
    })

    // 切片向量清理（Qdrant payload 过滤删除，跨存储无法同事务）
    // 失败不阻断删除主流程：残留切片无 ragSync 行不会再被引用，可由后续清理兜底
    if (documentIdsToDelete.length > 0) {
      try {
        await deleteChunks({ documentId: { in: documentIdsToDelete } })
      } catch (err) {
        logger.warn({ err, documentIds: documentIdsToDelete }, 'cleanup rag chunks after trash purge failed')
      }
    }

    // 返回被删除的 ID 列表，供前端判断当前打开文档是否被级联删除
    return { nodeIds: nodeIdsToDelete, documentIds: documentIdsToDelete }
  } catch (error) {
    if (error instanceof BizException) throw error
    throw new BizException(ErrorCode.WIKI_NODE_DELETE_FAILED)
  }
}

/**
 * 一键清空回收站（硬删除该库回收站中的全部内容，不可恢复）
 *
 * 与 purgeWikiTrashNode 的级联清理范围一致（documents / documentVersions / rag_sync /
 * 页级分享行 / wiki_nodes / Qdrant 切片向量），区别是不需要子树收集：回收站内的节点
 * 本身就是全量子集（is_deleted = true），直接按集合清理。
 *
 * @param wikiId 知识库 ID（wikis.id）
 * @param userId 当前登录用户 ID
 * @returns 被彻底删除的节点 / 文档 ID 列表（前端据此判断当前打开文档是否被级联删除）
 */
export async function purgeAllWikiTrash(wikiId: string, userId: string) {
  const db = getDb()

  // 归属校验（越权抛 WIKI_NOT_FOUND）
  await getWikiById(wikiId, userId)

  try {
    // 查询该库回收站全量节点（顶层 + 嵌套子项一并清除）
    const deletedNodes = await db
      .select({
        id: wikiNodes.id,
        documentId: wikiNodes.documentId,
      })
      .from(wikiNodes)
      .where(and(eq(wikiNodes.wikiId, wikiId), eq(wikiNodes.isDeleted, true)))

    const nodeIds = deletedNodes.map((n) => n.id)
    const documentIds = deletedNodes.map((n) => n.documentId).filter(Boolean)

    // 事务内执行硬删除（顺序与 purgeWikiTrashNode 一致：正文/版本/任务/分享行 → 节点本体）
    await db.transaction(async (tx) => {
      if (documentIds.length > 0) {
        // 文档正文
        await tx.delete(documents).where(inArray(documents.id, documentIds))

        // 文档历史版本
        await tx
          .delete(documentVersions)
          .where(inArray(documentVersions.documentId, documentIds))

        // RAG 索引任务行
        await tx.delete(ragSync).where(inArray(ragSync.documentId, documentIds))
      }

      // 页级分享配置行（库级主开关行 nodeId='' 不在集合内，不受影响）
      if (nodeIds.length > 0) {
        await tx
          .delete(wikiShares)
          .where(and(eq(wikiShares.wikiId, wikiId), inArray(wikiShares.nodeId, nodeIds)))

        // 节点本体
        await tx.delete(wikiNodes).where(inArray(wikiNodes.id, nodeIds))
      }
    })

    // 切片向量清理（Qdrant payload 过滤删除，跨存储无法同事务，失败不阻断：残留切片无 ragSync 行不可达）
    if (documentIds.length > 0) {
      try {
        await deleteChunks({ documentId: { in: documentIds } })
      } catch (err) {
        logger.warn({ err, wikiId, count: documentIds.length }, 'cleanup rag chunks after trash empty failed')
      }
    }

    // 返回被删除的 ID 列表，供前端判断当前打开文档是否被级联删除
    return { nodeIds, documentIds }
  } catch (error) {
    if (error instanceof BizException) throw error
    throw new BizException(ErrorCode.WIKI_NODE_DELETE_FAILED)
  }
}

/**
 * 删除知识库（软删除：移入回收站，可恢复）
 *
 * 流程：
 *  1. 校验知识库存在且当前用户为 owner（非 owner / 已在回收站统一抛「不存在」）
 *  2. 仅标记 wiki.is_deleted = true —— 节点 / 文档 / 分享 / 发布 / RAG 数据全部保留：
 *     - 恢复时无需重建任何配置即恢复原状
 *     - 访客分享与发布访问由 share/publish 模块实时复核 isDeleted 即时失效（不依赖令牌过期）
 *  3. 彻底删除（硬删除级联清理）由 purgeWiki 提供，仅允许对回收站中的库执行
 *
 * @param id 知识库 ID（wikis.id）
 * @param userId 当前登录用户 ID
 */
export async function deleteWiki(id: string, userId: string) {
  const db = getDb()

  // 1. 存在性 + 归属校验（getWikiById 已排除回收站中的库：重复删除 = 不存在，天然幂等）
  await getWikiById(id, userId)

  // 2. 软删除：仅打标记；updatedAt 同步写入并冻结 = 回收站「删除于 xx」展示与排序依据
  const now = new Date()
  await db
    .update(wiki)
    .set({ isDeleted: true, updatedAt: now })
    .where(and(eq(wiki.id, id), eq(wiki.ownerId, userId)))
}

/**
 * 知识库回收站条目返回结构
 * 与前端 WikiTrashItem 对齐
 */
export interface WikiRecycleItem {
  /** 知识库 ID（wikis.id） */
  id: string
  /** 知识库名称 */
  name: string
  /** 知识库描述（可空） */
  description: string | null
  /** 知识库图标（可空） */
  icon: string | null
  /** 主题色（可空） */
  color: string | null
  /** 库内文档数（实时统计未删除节点，复用 wikiSelectFields 同款口径） */
  docCount: number
  /** 删除时刻（取删除时同步写入并冻结的 updatedAt） */
  deletedAt: Date
}

/**
 * 查询当前用户的知识库回收站列表（按删除时间倒序）
 *
 * docCount 实时统计该库未被软删除的节点数，与 Dashboard 列表口径一致，
 * 前端回收站展示「N 篇文档」。
 *
 * @param userId 当前登录用户 ID
 * @returns 回收站条目列表
 */
export async function listWikiRecycle(userId: string): Promise<WikiRecycleItem[]> {
  const db = getDb()

  const list = await db
    .select({
      id: wiki.id,
      name: wiki.name,
      description: wiki.description,
      icon: wiki.icon,
      color: wiki.color,
      // 实时统计该库未删除节点数（手写别名子查询，原因见 wikiSelectFields 注释）
      docCount: sql<number>`(select count(*)::int from "wiki_nodes" "wn" where "wn"."wiki_id" = "wiki"."id" and "wn"."is_deleted" = false)`.as('doc_count'),
      // deletedAt 语义 = 删除时刻（deleteWiki 软删除时同步写入的 updatedAt）
      deletedAt: wiki.updatedAt,
    })
    .from(wiki)
    .where(and(eq(wiki.ownerId, userId), eq(wiki.isDeleted, true)))
    .orderBy(desc(wiki.updatedAt))

  return list
}

/**
 * 从回收站恢复知识库（撤销软删除）
 *
 * 恢复后该库重新出现在 Dashboard 列表，分享 / 发布访问自动恢复
 * （share/publish 模块实时复核 isDeleted，无需重建任何配置）。
 *
 * @param id 知识库 ID
 * @param userId 当前登录用户 ID
 * @returns 恢复后的知识库详情
 */
export async function restoreWikiFromTrash(id: string, userId: string) {
  const db = getDb()

  // 按归属查询（不经过 getWikiById —— 它会把回收站中的库当作不存在）
  const [existing] = await db
    .select({ id: wiki.id, ownerId: wiki.ownerId })
    .from(wiki)
    .where(eq(wiki.id, id))
    .limit(1)

  if (!existing || existing.ownerId !== userId) {
    throw new BizException(ErrorCode.WIKI_NOT_FOUND)
  }

  // 幂等恢复：无论当前是否在回收站，统一置回正常态
  const now = new Date()
  await db
    .update(wiki)
    .set({ isDeleted: false, updatedAt: now })
    .where(and(eq(wiki.id, id), eq(wiki.ownerId, userId)))

  // 返回恢复后的详情（此时 isDeleted 已为 false，getWikiById 可正常命中）
  return getWikiById(id, userId)
}

/**
 * 彻底删除知识库（硬删除，不可恢复；仅允许对回收站中的库执行）
 *
 * @param id 知识库 ID
 * @param userId 当前登录用户 ID
 * @returns null（与文档回收站 purge 返回风格一致）
 */
export async function purgeWiki(id: string, userId: string) {
  const db = getDb()

  // 按归属 + 在回收站中查询：不在回收站（正常库 / 不存在 / 非 owner）分别处理
  const [existing] = await db
    .select({ id: wiki.id, ownerId: wiki.ownerId, isDeleted: wiki.isDeleted })
    .from(wiki)
    .where(eq(wiki.id, id))
    .limit(1)

  if (!existing || existing.ownerId !== userId) {
    throw new BizException(ErrorCode.WIKI_NOT_FOUND)
  }

  // 防误清：正常库不允许 purge（彻底删除必须先进回收站）
  if (!existing.isDeleted) {
    throw new BizException(ErrorCode.WIKI_NOT_IN_TRASH)
  }

  await purgeWikiHard(id)
  return null
}

/**
 * 硬删除知识库的级联清理（原 deleteWiki 硬删实现，仅由 purgeWiki 调用）
 *
 * 事务内删除：documents → ragSync → wikiNodes → wikiShares → wikiPublish → wiki 本行；
 * 事务外清理 Qdrant 切片向量（跨存储无法同事务，失败仅 warn 不阻断）。
 *
 * @param id 知识库 ID（调用方必须已完成归属 + 在回收站中校验）
 */
async function purgeWikiHard(id: string) {
  const db = getDb()

  // 收集该库全部节点的 documentId（每个节点强制关联一个 documents 行）
  const nodeRows = await db
    .select({ documentId: wikiNodes.documentId })
    .from(wikiNodes)
    .where(eq(wikiNodes.wikiId, id))
  const documentIds = nodeRows.map((n) => n.documentId)

  try {
    // 事务级联删除（顺序：子表 → 主表）
    await db.transaction(async (tx) => {
      // 删除关联的 documents 记录
      if (documentIds.length > 0) {
        await tx.delete(documents).where(inArray(documents.id, documentIds))
      }

      // RAG 级联清理：删除该库全部索引任务行（无外键，应用层维护）
      // 切片向量在 Qdrant（rag.store.ts），事务后单独清理（跨存储无法同事务）
      await tx.delete(ragSync).where(eq(ragSync.wikiId, id))

      // 删除该库全部文档节点
      await tx.delete(wikiNodes).where(eq(wikiNodes.wikiId, id))

      // 删除该库全部分享配置（库级行 nodeId='' + 页面级覆盖行）
      await tx.delete(wikiShares).where(eq(wikiShares.wikiId, id))

      // 删除该库发布配置（wiki_publish 一库一条；无外键，应用层维护）
      await tx.delete(wikiPublish).where(eq(wikiPublish.wikiId, id))

      // 删除知识库本行
      await tx.delete(wiki).where(eq(wiki.id, id))
    })

    // 切片向量清理（Qdrant payload 过滤删除，跨存储无法同事务）
    // 失败不阻断删除主流程：库已删除，残留切片不可达（检索按 wikiId 过滤），可由后续清理兜底
    try {
      await deleteChunks({ wikiId: id })
    } catch (err) {
      logger.warn({ err, wikiId: id }, 'cleanup rag chunks after wiki delete failed')
    }
  } catch (error) {
    if (error instanceof BizException) throw error
    logger.error({ error, wikiId: id }, 'purgeWikiHard failed')
    throw new BizException(ErrorCode.WIKI_DELETE_FAILED)
  }
}

// ============ 文档标签 ============

/**
 * 标签返回字段
 * 与前端 DocumentTagItem 对齐
 */
const tagSelectFields = {
  id: tags.id,
  wikiId: tags.wikiId,
  name: tags.name,
  color: tags.color,
  createdAt: tags.createdAt,
}

/**
 * 获取文档已关联的标签列表
 * 先经 getDocumentById 校验归属（越权 / 不存在抛 WIKI_NOT_FOUND）
 * @param documentId 文档 ID（wikiNodes.documentId）
 * @param userId 当前登录用户 ID
 * @returns 标签数组
 */
export async function listDocumentTags(documentId: string, userId: string) {
  const db = getDb()

  // 校验文档归属（越权抛 WIKI_NOT_FOUND）
  await getDocumentById(documentId, userId)

  // 关联查询：documentTags → tags，取当前文档的所有标签
  const rows = await db
    .select(tagSelectFields)
    .from(documentTags)
    .innerJoin(tags, eq(documentTags.tagId, tags.id))
    .where(eq(documentTags.documentId, documentId))
    .orderBy(asc(tags.createdAt))

  return rows
}

/**
 * 为文档添加标签（find-or-create + 关联）
 * 1. 校验文档归属，拿到 wikiId
 * 2. 在该 wiki 内按 name 查找标签，不存在则新建（onConflictDoNothing 防并发同名校验）
 * 3. 插入 document_tags 关联（onConflictDoNothing 幂等，重复关联不报错）
 * @param documentId 文档 ID
 * @param userId 当前登录用户 ID
 * @param data 标签名 + 可选颜色
 * @returns 标签对象（含 id / name / color 等）
 */
export async function addDocumentTag(documentId: string, userId: string, data: CreateDocumentTag) {
  const db = getDb()

  // 校验文档归属（越权抛 WIKI_NOT_FOUND）
  const doc = await getDocumentById(documentId, userId)
  const wikiId = doc.wikiId

  // 标签名去首尾空白，空串兜底抛 INVALID_REQUEST
  const name = data.name.trim()
  if (!name) {
    throw new BizException(ErrorCode.INVALID_REQUEST, '标签名不能为空')
  }

  try {
    // 1. 在该 wiki 内查找同名标签
    let [existing] = await db
      .select(tagSelectFields)
      .from(tags)
      .where(and(eq(tags.wikiId, wikiId), eq(tags.name, name)))
      .limit(1)

    // 2. 不存在则新建（onConflictDoNothing 处理并发同名校验，再 select 兜底）
    if (!existing) {
      const [created] = await db
        .insert(tags)
        .values({
          wikiId,
          name,
          color: data.color ?? null,
        })
        .onConflictDoNothing({
          target: [tags.wikiId, tags.name],
        })
        .returning(tagSelectFields)

      // 并发冲突时 returning 为空，重新查询拿到已存在的标签
      if (created) {
        existing = created
      } else {
        const [found] = await db
          .select(tagSelectFields)
          .from(tags)
          .where(and(eq(tags.wikiId, wikiId), eq(tags.name, name)))
          .limit(1)
        existing = found
      }
    }

    if (!existing) {
      throw new BizException(ErrorCode.TAG_CREATE_FAILED)
    }

    // 3. 插入文档-标签关联（onConflictDoNothing 幂等，重复关联不报错）
    await db
      .insert(documentTags)
      .values({
        documentId,
        tagId: existing.id,
      })
      .onConflictDoNothing({
        target: [documentTags.documentId, documentTags.tagId],
      })

    return existing
  } catch (error) {
    // 已是业务异常直接抛出
    if (error instanceof BizException) throw error
    // 其余异常统一包装为创建失败
    throw new BizException(ErrorCode.TAG_CREATE_FAILED)
  }
}

/**
 * 解除文档与标签的关联（不删除标签本体）
 * 1. 校验文档归属
 * 2. 删除 document_tags 关联行
 * 3. 无行删除 → TAG_NOT_FOUND（标签未关联该文档）
 * @param documentId 文档 ID
 * @param tagId 标签 ID
 * @param userId 当前登录用户 ID
 */
export async function removeDocumentTag(documentId: string, tagId: string, userId: string) {
  const db = getDb()

  // 校验文档归属（越权抛 WIKI_NOT_FOUND）
  await getDocumentById(documentId, userId)

  // 删除关联行，返回受影响行数
  const result = await db
    .delete(documentTags)
    .where(and(eq(documentTags.documentId, documentId), eq(documentTags.tagId, tagId)))
    .returning({ id: documentTags.id })

  // 无行删除：标签未关联该文档，抛 TAG_NOT_FOUND
  if (!result || result.length === 0) {
    throw new BizException(ErrorCode.TAG_NOT_FOUND)
  }

  return
}

// ============ 知识库分享配置（owner 侧） ============

/**
 * 库级分享配置统一返回字段（仅 nodeId='' 的库级行）
 * password 为明文存储（定位类似网盘提取码，非登录凭证），owner 弹窗需要明文回显以便复制发给访客
 * 注：站点形态/外观已拆至 wiki_publish 表（share/publish 语义拆分），此处仅访问控制字段
 */
const wikiShareSelectFields = {
  id: wikiShares.id,
  wikiId: wikiShares.wikiId,
  shareStatus: wikiShares.shareStatus,
  password: wikiShares.password,
  mode: wikiShares.mode,
  createdAt: wikiShares.createdAt,
  updatedAt: wikiShares.updatedAt,
}

/**
 * 将库级分享配置行转换为对前端的返回结构
 * password 明文回显（可为 null 表示未设置密码），不再返回 hasPassword 布尔值
 */
function toShareConfig(row: {
  id: string
  wikiId: string
  shareStatus: string
  password: string | null
  mode: string | null
  updatedAt: Date
}) {
  return {
    shareId: row.id,
    wikiId: row.wikiId,
    shareStatus: row.shareStatus,
    password: row.password,
    mode: row.mode,
    updatedAt: row.updatedAt,
  }
}

/**
 * 创建/更新知识库分享配置（库级主开关，upsert 库级行 node_id=''）
 *
 * 权限模型：库分享是全库主开关 ——
 * - 'public'：整库开放（只读），全部文档跟随开放，密码统一继承库密码（可选）
 * - 'private'：库分享关闭，此时各页面的独立分享行（node_id != ''）恢复生效
 * 页面分享行在本函数中不做任何修改（数据保留），与库级状态完全解耦
 *
 * 密码语义（password 字段）：
 * - string：设置/更新库级密码（6-32 位校验由 Schema 完成，明文存储）
 * - null：清除库级密码（库变为免密访问）
 * - undefined：保持原密码不变
 *
 * 注：站点形态（publishType）配置已拆至 publish 模块
 * （PUT /publish/wiki/:wikiId/settings 写 wiki_publish 表），本函数只管访问控制
 *
 * @param wikiId 知识库 ID
 * @param userId 当前登录用户 ID
 * @param data 分享配置参数（shareStatus 必填，password/mode 可选）
 * @returns 库级分享配置（password 明文回显）+ 全部页级行 nodes（前端回填用）
 */
export async function upsertWikiShare(wikiId: string, userId: string, data: UpsertWikiShare) {
  const db = getDb()

  // 校验知识库归属（越权抛 WIKI_NOT_FOUND）
  await getWikiById(wikiId, userId)

  // 密码语义解析：string = 设置/更新库密码；null = 清除；undefined = 保持原值
  // upsert 更新分支实际要写入的密码值：setPassword 时为明文，显式 null 时为 null，undefined 时不写该字段
  const passwordToWrite = typeof data.password === 'string' ? data.password : data.password === null ? null : undefined

  try {
    const result = await db.transaction(async (tx) => {
      // upsert 库级行：(wikiId, nodeId='') 上有唯一索引，冲突时走更新分支
      const [row] = await tx
        .insert(wikiShares)
        .values({
          wikiId,
          nodeId: '',
          shareStatus: data.shareStatus,
          mode: data.mode,
          // 首次插入分支：undefined（未传密码）按无密码处理
          password: passwordToWrite ?? null,
          createdBy: userId,
        })
        .onConflictDoUpdate({
          target: [wikiShares.wikiId, wikiShares.nodeId],
          set: {
            shareStatus: data.shareStatus,
            mode: data.mode,
            // 密码仅在显式传入（string 或 null）时更新；undefined 保持原值
            ...(passwordToWrite !== undefined ? { password: passwordToWrite } : {}),
            updatedAt: new Date(),
          },
        })
        .returning(wikiShareSelectFields)

      if (!row) {
        throw new BizException(ErrorCode.WIKI_SHARE_SAVE_FAILED)
      }

      // 同步冗余展示列 wikis.visibility = 库级分享状态（同一事务内，保证一致）。
      // 知识库列表接口返回的是 wikis.visibility（而非 wiki_shares.share_status），
      // Dashboard 卡片/列表的锁/公开图标由它驱动，不同步会导致「改了分享但锁不变」
      await tx.update(wiki).set({ visibility: data.shareStatus }).where(eq(wiki.id, wikiId))

      return toShareConfig(row)
    })

    // 查询该库全部页面级分享行（node_id != ''），与 GET /wiki/:id/share 返回结构保持一致：
    // 前端保存后需要用 nodes 同步本地缓存的页级分享状态。
    // 注：页级行数据在库分享开关切换时始终保留 —— 库分享开启期间不生效，
    // 关闭后自动恢复生效（新权限模型：库级主开关与页面独立分享解耦）
    const nodeRows = await db
      .select({
        nodeId: wikiShares.nodeId,
        shareStatus: wikiShares.shareStatus,
        password: wikiShares.password,
      })
      .from(wikiShares)
      .where(and(eq(wikiShares.wikiId, wikiId), ne(wikiShares.nodeId, '')))

    return {
      ...result,
      nodes: nodeRows.map((nodeRow) => ({
        nodeId: nodeRow.nodeId,
        shareStatus: nodeRow.shareStatus,
        password: nodeRow.password,
      })),
    }
  } catch (error) {
    // 已是业务异常直接抛出（含归属校验失败）
    if (error instanceof BizException) throw error
    // 其余异常统一包装为保存失败
    throw new BizException(ErrorCode.WIKI_SHARE_SAVE_FAILED)
  }
}

/**
 * 查询知识库分享配置（仅 owner，用于分享弹窗回填 / 文档树分享 icon 展示）
 *
 * 返回两部分数据：
 * 1. 库级配置（nodeId='' 的库级行）：库可见性的唯一事实来源
 * 2. nodes：该库全部页面级覆盖行（node_id != ''），前端用于回填各页面分享状态、
 *    文档树上显示分享 icon。wiki_shares 对页级覆盖采用稀疏存储 —— 没有覆盖行的页面
 *    即为「跟随库（inherit）」状态，因此未覆盖的页面不会出现在 nodes 中，
 *    前端按「不在 nodes 里 = inherit」处理即可
 *
 * @param wikiId 知识库 ID
 * @param userId 当前登录用户 ID
 * @returns 库级分享配置（password 明文回显）+ 页面级覆盖行列表 nodes
 *          （每项 { nodeId, shareStatus: 'public'|'private', password }，无覆盖行时为空数组）；
 *          无库级行时返回 null（前端按默认 private 处理）
 */
export async function getWikiShareConfig(wikiId: string, userId: string) {
  const db = getDb()

  // 校验知识库归属（越权抛 WIKI_NOT_FOUND）
  await getWikiById(wikiId, userId)

  // 1. 查库级行（nodeId=''）
  const [row] = await db
    .select(wikiShareSelectFields)
    .from(wikiShares)
    .where(and(eq(wikiShares.wikiId, wikiId), eq(wikiShares.nodeId, '')))
    .limit(1)

  // 无库级行时仍返回 null（保持原语义：正常创建流程必有库级行，null 仅出现在脏数据兜底场景）
  if (!row) {
    return null
  }

  // 2. 查该库全部页面级覆盖行（node_id != ''），一次查出供前端批量回填
  //    shareStatus 实际取值为 'public' | 'private'（inherit 会删除覆盖行，不会落库）
  const nodeRows = await db
    .select({
      nodeId: wikiShares.nodeId,
      shareStatus: wikiShares.shareStatus,
      password: wikiShares.password,
    })
    .from(wikiShares)
    .where(and(eq(wikiShares.wikiId, wikiId), ne(wikiShares.nodeId, '')))

  // 库级配置 + 页面级覆盖行列表合并返回
  // password 均为明文回显（owner 弹窗需要复制发给访客），null 表示未设置密码
  return {
    ...toShareConfig(row),
    nodes: nodeRows.map((nodeRow) => ({
      nodeId: nodeRow.nodeId,
      shareStatus: nodeRow.shareStatus,
      password: nodeRow.password,
    })),
  }
}

/**
 * 页面级分享配置返回结构类型
 * inherit（关闭页面分享）时无行，password 固定返回 null
 */
interface WikiNodeShareResult {
  nodeId: string
  shareStatus: string
  password: string | null
}

/**
 * 创建/更新页面级分享配置（upsert 页面级行 node_id=<nodeId>，稀疏存储）
 *
 * 权限模型：页面分享仅在「库分享关闭」时可独立配置 ——
 * - 'public'：单独公开此页，密码可选（可免密分享），密码由页面分享自行管理
 * - 'inherit'：删除该节点的页面分享行，关闭页面分享
 * 库分享开启时全部文档跟随库开放，页面分享被锁定不可修改（守卫拒绝）；
 * 页面分享行数据在库分享开启期间保留不动，关闭后自动恢复生效
 *
 * 密码语义（password 字段，与库级 upsertWikiShare 一致的三态）：
 * - string：设置/更新页面密码（6-32 位校验由 Schema 完成，明文存储）
 * - null：清除页面密码（该页变为免密访问）
 * - undefined：保持原密码不变（首次插入时按无密码处理）
 *
 * @param nodeId 节点 ID（wikiNodes.id）
 * @param userId 当前登录用户 ID
 * @param data 页面分享配置参数（shareStatus 必填，password 可选）
 * @returns 页面分享状态（含最终生效的密码明文）
 */
export async function upsertWikiNodeShare(nodeId: string, userId: string, data: UpsertWikiNodeShare): Promise<WikiNodeShareResult> {
  const db = getDb()

  // 1. 查询节点，确定所属知识库（节点不存在抛 WIKI_NOT_FOUND）
  const [node] = await db
    .select({ id: wikiNodes.id, wikiId: wikiNodes.wikiId })
    .from(wikiNodes)
    .where(eq(wikiNodes.id, nodeId))
    .limit(1)

  if (!node) {
    throw new BizException(ErrorCode.WIKI_NOT_FOUND)
  }

  // 2. owner 校验：确认节点所属知识库属于当前用户（越权抛 WIKI_NOT_FOUND，不泄露存在性）
  await getWikiById(node.wikiId, userId)

  try {
    // 3. 守卫：库分享开启时页面分享被锁定（全部文档跟随库开放，不可单独修改）
    //    防御外部直接调 API 绕过前端锁定态
    const [wikiLevelRow] = await db
      .select({ shareStatus: wikiShares.shareStatus })
      .from(wikiShares)
      .where(and(eq(wikiShares.wikiId, node.wikiId), eq(wikiShares.nodeId, '')))
      .limit(1)

    if (wikiLevelRow?.shareStatus === 'public') {
      throw new BizException(ErrorCode.SHARE_PAGE_LOCKED_BY_WIKI)
    }

    // 4. inherit：删除该节点的页面分享行，关闭页面分享
    //    删除不存在的行是幂等操作（无行删除不报错），重复调用安全
    if (data.shareStatus === 'inherit') {
      await db
        .delete(wikiShares)
        .where(and(eq(wikiShares.wikiId, node.wikiId), eq(wikiShares.nodeId, nodeId)))

      return { nodeId, shareStatus: 'inherit', password: null }
    }

    // 5. public：单独公开此页。密码三态语义（与库级 upsertWikiShare 一致）：
    //    string = 设置/更新；null = 清除（免密分享）；undefined = 保持原密码不变。
    //    不强制必填 —— 无密码分享时 password 落库为 null，访客侧 shareAuthMiddleware /
    //    getShareMeta / verifySharePassword 按「password 是否存在」自动免令牌放行
    const passwordToWrite =
      typeof data.password === 'string' ? data.password : data.password === null ? null : undefined

    // 6. upsert 页面分享行：(wikiId, nodeId) 唯一索引冲突时走更新分支
    const [row] = await db
      .insert(wikiShares)
      .values({
        wikiId: node.wikiId,
        nodeId,
        shareStatus: data.shareStatus,
        // 首次插入分支：undefined（未传密码）按无密码处理
        password: passwordToWrite ?? null,
        mode: 'view',
        createdBy: userId,
      })
      .onConflictDoUpdate({
        target: [wikiShares.wikiId, wikiShares.nodeId],
        set: {
          shareStatus: data.shareStatus,
          // 密码仅在显式传入（string 或 null）时更新；undefined 保持原值
          ...(passwordToWrite !== undefined ? { password: passwordToWrite } : {}),
          mode: 'view',
          updatedAt: new Date(),
        },
      })
      .returning({ shareStatus: wikiShares.shareStatus, password: wikiShares.password })

    return {
      nodeId,
      shareStatus: row?.shareStatus ?? data.shareStatus,
      password: row?.password ?? null,
    }
  } catch (error) {
    // 已是业务异常直接抛出（含库分享锁定、页面密码缺失、归属校验失败）
    if (error instanceof BizException) throw error
    // 其余异常统一包装为保存失败
    throw new BizException(ErrorCode.WIKI_SHARE_SAVE_FAILED)
  }
}
