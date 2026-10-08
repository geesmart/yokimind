import { recentVisits, activities, documents, wikiNodes, wiki, users } from '~/db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { BizException } from '~/core/lib/biz.exception.js'
import { ErrorCode } from '~/config/error-code.js'
import { getDb } from '~/core/helper/db.helper.js'
import { usePino } from '~/core/plugins/pino.js'

const logger = usePino()

/**
 * 最近访问列表返回字段
 * 与前端 RecentVisitItem 对齐
 */
export interface RecentVisitItem {
  /** 文档 ID */
  documentId: string
  /** 所属知识库 ID（用于点击跳转） */
  wikiId: string
  /** 所属知识库名称 */
  wikiName: string
  /** 文档标题（取自 wikiNodes.title） */
  title: string
  /** 更新者昵称（可能为 null，对应 lastEditorId 缺失） */
  updater: string | null
  /** 文档最后更新时间（ISO 字符串） */
  updatedAt: string
  /** 最近访问时间（ISO 字符串） */
  lastVisitedAt: string
}

/**
 * 动态列表返回字段
 * 与前端 ActivityItem 对齐
 */
export interface ActivityItem {
  /** 活动 ID */
  id: string
  /** 操作类型：create / update / comment / star / member_join ... */
  actionType: string
  /** 目标类型：document / wiki / comment / member */
  targetType: string
  /** 目标 ID（可能为 null） */
  targetId: string | null
  /** 所属知识库 ID（用于点击跳转，可能为 null） */
  wikiId: string | null
  /** 动态摘要文案（写入时预计算，如「创建了知识库「研发 Wiki」」） */
  content: string | null
  /** 发生时间（ISO 字符串） */
  createdAt: string
  /** 操作者昵称 */
  nickname: string
  /** 操作者头像 URL（可能为 null） */
  avatar: string | null
}

/**
 * 获取当前用户的最近访问文档列表
 * 仅返回 targetType='document' 的记录，按 lastVisitedAt 倒序
 * JOIN documents / wikiNodes / wiki 取展示字段；LEFT JOIN users 取更新者
 *
 * @param userId 当前登录用户 ID（ULID）
 * @param limit 返回条数，默认 10
 * @returns 最近访问文档列表
 */
export async function listRecentVisits(userId: string, limit = 10): Promise<RecentVisitItem[]> {
  const db = getDb()

  try {
    const rows = await db
      .select({
        documentId: documents.id,
        wikiId: documents.wikiId,
        wikiName: wiki.name,
        title: wikiNodes.title,
        updater: users.nickname,
        updatedAt: documents.updatedAt,
        lastVisitedAt: recentVisits.lastVisitedAt,
      })
      .from(recentVisits)
      .innerJoin(documents, eq(documents.id, recentVisits.targetId))
      .innerJoin(wikiNodes, eq(wikiNodes.documentId, documents.id))
      .innerJoin(wiki, eq(wiki.id, documents.wikiId))
      .leftJoin(users, eq(users.id, documents.lastEditorId))
      .where(and(eq(recentVisits.userId, userId), eq(recentVisits.targetType, 'document')))
      .orderBy(desc(recentVisits.lastVisitedAt))
      .limit(limit)

    // drizzle 返回的 Date 对象序列化为 ISO 字符串
    return rows.map((r) => ({
      documentId: r.documentId,
      wikiId: r.wikiId,
      wikiName: r.wikiName,
      title: r.title,
      updater: r.updater,
      updatedAt: r.updatedAt.toISOString(),
      lastVisitedAt: r.lastVisitedAt.toISOString(),
    }))
  } catch (error) {
    logger.error({ err: error, userId }, 'listRecentVisits failed')
    throw new BizException(ErrorCode.RECENT_VISIT_FETCH_FAILED)
  }
}

/**
 * 获取当前用户的操作动态列表
 * 按当前用户自己的活动（activities.userId = current）查询，按 createdAt 倒序
 * LEFT JOIN users 取操作者昵称/头像；content 已在写入时预计算文案
 *
 * @param userId 当前登录用户 ID（ULID）
 * @param limit 返回条数，默认 20
 * @returns 动态列表
 */
export async function listActivities(userId: string, limit = 20): Promise<ActivityItem[]> {
  const db = getDb()

  try {
    const rows = await db
      .select({
        id: activities.id,
        actionType: activities.actionType,
        targetType: activities.targetType,
        targetId: activities.targetId,
        wikiId: activities.wikiId,
        content: activities.content,
        createdAt: activities.createdAt,
        nickname: users.nickname,
        avatar: users.avatar,
      })
      .from(activities)
      .leftJoin(users, eq(users.id, activities.userId))
      .where(eq(activities.userId, userId))
      .orderBy(desc(activities.createdAt))
      .limit(limit)

    return rows.map((r) => ({
      id: r.id,
      actionType: r.actionType,
      targetType: r.targetType,
      targetId: r.targetId,
      wikiId: r.wikiId,
      content: r.content,
      createdAt: r.createdAt.toISOString(),
      nickname: r.nickname ?? '',
      avatar: r.avatar,
    }))
  } catch (error) {
    logger.error({ err: error, userId }, 'listActivities failed')
    throw new BizException(ErrorCode.ACTIVITY_FETCH_FAILED)
  }
}
