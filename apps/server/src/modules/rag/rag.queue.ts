import { Queue } from 'bullmq'
import type { ConnectionOptions } from 'bullmq'
import { usePino } from '~/core/plugins/pino.js'

/**
 * RAG 索引队列（BullMQ / Redis）
 *
 * 设计说明：
 * - 取代原「rag_sync 落库 + 进程内轮询」的轻量队列方案：
 *   Redis 持久化任务、内置延迟重试（指数退避）、进程重启后任务不丢失（stalled 自动恢复）
 * - rag_sync 表仍保留，但职责从「队列」退化为「状态记录」（status/contentHash/chunkCount/error），
 *   供 /rag/status 统计与内容指纹幂等使用
 * - 本文件只封装 Queue（生产者侧），与业务逻辑解耦：
 *   rag.service → rag.queue（入队）；rag.worker（消费者）→ rag.queue（复用连接配置）
 * - jobId = documentId：同一文档的 waiting/active 任务自动去重（连续保存合并为一次索引）
 *   配合 removeOnComplete: true（完成即删），文档再次保存时可重新入队
 */

const logger = usePino()

/** 队列名 */
export const RAG_QUEUE_NAME = 'yokimind-rag-index'

/** 索引任务载荷 */
export interface RagIndexJobData {
  /** 文档 ID */
  documentId: string
  /** 所属知识库 ID（冗余，便于日志排查与任务过滤） */
  wikiId: string
}

/**
 * 解析 REDIS_URL 为 BullMQ 连接配置
 * 未配置时回退 localhost:6379 db 2（与 .env 默认值一致）
 * maxRetriesPerRequest: null 是 Worker 阻塞连接的必需配置
 */
function parseRedisUrl(): ConnectionOptions {
  const raw = process.env.REDIS_URL || 'redis://127.0.0.1:6379/2'
  try {
    const url = new URL(raw)
    return {
      host: url.hostname,
      port: Number(url.port || 6379),
      db: url.pathname && url.pathname.length > 1 ? Number(url.pathname.slice(1)) : 0,
      username: url.username || undefined,
      password: url.password || undefined,
      maxRetriesPerRequest: null,
    }
  } catch {
    logger.warn({ redisUrl: raw }, 'invalid REDIS_URL, fallback to localhost:6379/2')
    return { host: '127.0.0.1', port: 6379, db: 2, maxRetriesPerRequest: null }
  }
}

/** BullMQ 连接配置单例（Queue 与 Worker 共用同一套解析结果，各自创建独立连接） */
export function getRedisConnection(): ConnectionOptions {
  return parseRedisUrl()
}

/** Queue 单例（惰性创建） */
let queue: Queue<RagIndexJobData> | null = null

/**
 * 获取 RAG 索引队列（惰性初始化）
 * defaultJobOptions 统一声明重试策略：
 * - 3 次尝试，指数退避（5s → 10s → 20s），应对 AI 服务抖动
 * - 完成即删 + 失败即删（保证同 jobId 可重复入队）：
 *   BullMQ 对任意状态下仍存在的同 jobId 任务会去重忽略，
 *   若 failed 任务保留 24h，reindex / 失败后重存将无法重新入队，
 *   因此失败任务不入 Redis（错误详情已落 rag_sync.error，由 reindex 接口负责重试）
 */
export function getRagQueue(): Queue<RagIndexJobData> {
  if (!queue) {
    queue = new Queue<RagIndexJobData>(RAG_QUEUE_NAME, {
      connection: getRedisConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: true,
        removeOnFail: true,
      },
    })
    logger.info({ name: RAG_QUEUE_NAME }, 'rag index queue initialized')
  }
  return queue
}

/**
 * 入队一个索引任务（同一文档在队列中已有 waiting/active 任务时自动去重）
 * 入队失败仅记录日志不抛错：调用方（文档保存挂钩）不应因队列异常阻断主流程
 *
 * @param data 任务载荷
 * @returns 是否成功入队（重复任务视为成功）
 */
export async function addIndexJob(data: RagIndexJobData): Promise<boolean> {
  try {
    const q = getRagQueue()
    // jobId = documentId：BullMQ 对同 jobId 的 waiting/delayed 任务去重
    await q.add('index', data, { jobId: data.documentId })
    return true
  } catch (err) {
    logger.warn({ err, ...data }, 'add rag index job failed (Redis unavailable?)')
    return false
  }
}

/**
 * 批量入队（重建索引用）
 * 逐条 add（BullMQ 内部走 Redis 流水线，量级为千条内无性能问题）
 */
export async function addIndexJobs(dataList: RagIndexJobData[]): Promise<void> {
  for (const data of dataList) {
    await addIndexJob(data)
  }
}
