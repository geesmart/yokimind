import { eq } from 'drizzle-orm'
import { DelayedError, Worker } from 'bullmq'
import type { Job } from 'bullmq'
import { ragSync } from '~/db/schema.js'
import { usePostgres } from '~/core/plugins/postgres.js'
import { isEmbeddingReady } from '~/core/lib/ai.js'
import { usePino } from '~/core/plugins/pino.js'
import { RAG_QUEUE_NAME, addIndexJob, getRedisConnection, type RagIndexJobData } from './rag.queue.js'
import { processJob } from './rag.service.js'

const logger = usePino()

/**
 * RAG 索引 Worker（BullMQ / Redis 消费者）
 *
 * 职责：
 * 1. 消费 yokimind-rag-index 队列，执行「切片 → 向量化 → 入库」（processJob）
 * 2. embedding 未就绪时任务转入 delayed 状态延迟重试（不消耗 attempts，
 *    AI_EMBEDDING_* 配好后自动恢复消费，无需重启）
 * 3. 失败重试由队列 defaultJobOptions 管理（3 次尝试 + 指数退避），此处仅记录日志
 * 4. 启动恢复：把 rag_sync 遗留的 running 状态重置为 pending 并重新入队
 *    （进程上次运行中断的悬挂状态；Redis 侧任务中断由 BullMQ stalled 机制自动重派）
 *
 * 在 src/index.ts 启动流程中调用（initPostgres 之后）
 */

/** embedding 未就绪时任务延迟重试的间隔（毫秒），默认 60s */
const EMBEDDING_WAIT_MS = Number(process.env.RAG_EMBEDDING_WAIT_MS || 60_000)
/** 并发消费任务数（embedding API 有速率限制，默认 2 保守并发） */
const CONCURRENCY = Number(process.env.RAG_WORKER_CONCURRENCY || 2)

/**
 * 任务处理器
 * @param job BullMQ 任务（data: { documentId, wikiId }）
 */
async function processRagJob(job: Job<RagIndexJobData>): Promise<void> {
  // embedding 未就绪（如 AI_EMBEDDING_API_KEY 未配置）：
  // 任务转入 delayed 状态延迟重试，不消耗 attempts 也不打必败请求；
  // 抛出 DelayedError 告知 BullMQ 这是「主动延迟」而非失败
  if (!(await isEmbeddingReady())) {
    await job.moveToDelayed(Date.now() + EMBEDDING_WAIT_MS, job.token)
    throw new DelayedError()
  }
  await processJob(job.data.documentId)
}

/** Worker 单例（防止重复启动） */
let worker: Worker<RagIndexJobData> | null = null

/**
 * 启动 RAG 索引同步 Worker
 * @returns Worker 实例（重复调用返回同一实例）
 */
export function startRagWorker(): Worker<RagIndexJobData> {
  if (worker) return worker

  // embedding 就绪检查（异步读配置层）仅为启动日志提示，不阻塞 worker 启动
  void isEmbeddingReady().then((ready) => {
    if (!ready) {
      // embedding 未就绪（如 AI_EMBEDDING_API_KEY 未填）：任务在队列中延迟等待，
      // 不打必败请求；key 配好后无需重启即可恢复消费
      logger.warn('embedding service not ready (AI_EMBEDDING_*), rag jobs will be delayed in queue')
    }
  })

  worker = new Worker<RagIndexJobData>(RAG_QUEUE_NAME, processRagJob, {
    connection: getRedisConnection(),
    concurrency: CONCURRENCY,
  })

  // 任务完成日志（成功时 processJob 内已记录 chunks 数，这里只做轻量标记）
  worker.on('completed', (job) => {
    logger.debug({ jobId: job.id, documentId: job.data.documentId }, 'rag job completed')
  })

  // 任务失败日志：DelayedError 是延迟重试的正常信号，跳过；
  // 其余失败由 BullMQ 自动按退避策略重试，最终失败后任务从队列移除（rag_sync.error 有详情）
  worker.on('failed', (job, err) => {
    if (err instanceof DelayedError) return
    logger.warn(
      {
        jobId: job?.id,
        documentId: job?.data.documentId,
        attemptsMade: job?.attemptsMade,
        err,
      },
      'rag job failed',
    )
  })

  // Worker 级别错误（连接断开等，非单任务失败）
  worker.on('error', (err) => {
    logger.error({ err }, 'rag worker error')
  })

  // 启动恢复：处理 rag_sync 悬挂的 running 状态
  void recoverStaleTasks()

  logger.info({ queue: RAG_QUEUE_NAME, concurrency: CONCURRENCY }, 'rag worker started')
  return worker
}

/**
 * 启动恢复：补齐「有状态记录但无 Redis 任务」的孤儿任务
 * - running：进程上次处理中中断的悬挂状态，先重置为 pending
 * - pending：入队时 Redis 不可用 / 任务意外丢失的状态行
 * 然后统一重新入队：BullMQ 同 jobId 去重保证对仍存在的 delayed 任务不产生重复消费
 */
async function recoverStaleTasks(): Promise<void> {
  try {
    const db = usePostgres()
    // 1. 悬挂 running 重置为 pending
    const reset = await db
      .update(ragSync)
      .set({ status: 'pending', updatedAt: new Date() })
      .where(eq(ragSync.status, 'running'))
      .returning({ id: ragSync.id })
    if (reset.length > 0) {
      logger.info({ count: reset.length }, 'reset stale running rag tasks to pending')
    }
    // 2. 全部 pending 行重新入队（孤儿任务自愈；已入队的被 jobId 去重，无副作用）
    const rows = await db
      .select({ documentId: ragSync.documentId, wikiId: ragSync.wikiId })
      .from(ragSync)
      .where(eq(ragSync.status, 'pending'))
    for (const row of rows) {
      await addIndexJob(row)
    }
    if (rows.length > 0) {
      logger.info({ count: rows.length }, 're-enqueued pending rag tasks for recovery')
    }
  } catch (err) {
    logger.warn({ err }, 'recover stale rag tasks failed')
  }
}
