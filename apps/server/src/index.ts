import 'dotenv/config'
import { serve } from '@hono/node-server'
import { showRoutes, showServicesInfo } from '~/core/helper/hono.helper.js'
import { initPostgres } from '~/core/plugins/postgres.js'
import app from '~/app.js'
import { usePino } from '~/core/plugins/pino.js'
import { startRagWorker } from '~/modules/rag/rag.worker.js'
import { ensureBucket, isStorageConfigured } from '~/core/lib/storage.js'

const logger = usePino()

// 初始化数据库连接
const dbUrl = process.env.DATABASE_URL
if (dbUrl) {
  initPostgres(dbUrl)
  logger.info('database connection initialized')
  // 启动 RAG 索引同步 worker（BullMQ 消费 Redis 队列，embedding 未就绪时任务延迟等待）
  startRagWorker()
} else {
  logger.warn('DATABASE_URL not configured')
}

// 初始化对象存储：确保桶存在且公开可读（幂等；未配置时仅提示）
if (isStorageConfigured()) {
  ensureBucket()
} else {
  logger.warn('S3 storage not configured (S3_ENDPOINT/S3_BUCKET/S3_ACCESS_KEY/S3_SECRET_KEY), media upload will fail')
}

const port = parseInt(process.env.PORT || '6001', 10)

serve(
  {
    fetch: app.fetch,
    port,
  },
  (info) => {
    logger.info({ port: info.port }, 'server started')
    // 本地方名直连地址（yokimind.local → 127.0.0.1 的映射写在 /etc/hosts）
    logger.info(`Local (域名): http://api.yokimind.local:${info.port}`)
    showServicesInfo()
    showRoutes(app)
  }
)

// 生产容器第二监听：web SPA 静态专用端口（Dockerfile 注入 WEB_STATIC_PORT=6000）。
// 同一 Hono app（含静态托管 + API），生产由 Caddy 把 / 流量导到该端口、/api 导到主监听；
// 本地 dev / 裸机直连不设 WEB_STATIC_PORT，跳过本监听，行为与旧版完全一致。
const webStaticPort = process.env.WEB_STATIC_PORT
if (webStaticPort) {
  serve(
    {
      fetch: app.fetch,
      port: parseInt(webStaticPort, 10),
    },
    (info) => {
      logger.info({ port: info.port }, 'web static listener started (SPA)')
    }
  )
}

type AppType = typeof app

export default app
export type { AppType }
