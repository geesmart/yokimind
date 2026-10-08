import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic } from '@hono/node-server/serve-static'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { responseMiddleware } from '~/core/middleware/response.middleware.js'
import { loadConfig } from '~/core/middleware/load-config.js'
import { requestIdMiddleware } from '~/core/middleware/request-id.middleware.js'
import { requestLogMiddleware } from '~/core/middleware/request-log.middleware.js'
import { errorHandler } from '~/core/helper/error.helper.js'
import { contextStorage } from 'hono/context-storage'
import routes from '~/routes.js'

const app = new Hono()

// CORS 中间件 - 完全放开跨域限制
app.use(
  '*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH', 'HEAD'],
    allowHeaders: ['*'],
    exposeHeaders: ['*'],
    credentials: false,
    maxAge: 86400,
  })
)

// 中间件注册顺序：requestId -> requestLog -> loadConfig -> response
// requestId 必须在最前面，确保后续所有日志都有 requestId
// requestLog 必须在 loadConfig 之前，以便记录 loadConfig 的执行耗时
app.use('*', contextStorage())
app.use('*', requestIdMiddleware)
app.use('*', requestLogMiddleware)
app.use('*', loadConfig)
app.use('*', responseMiddleware)

// 所有路由（包含 api 和 view）
app.route('/', routes)

// ============ 分发场景目录配置 ============

/**
 * 前端 SPA 产物目录（npm CLI / Docker 分发场景由 CLI 注入）
 * - 未设置：保持现状（前后端分离部署，server 不托管前端）
 * - 设置后：托管 SPA 静态产物 + history fallback，单进程全托管
 */
const webDistDir = process.env.SERVE_WEB_DIR ? path.resolve(process.env.SERVE_WEB_DIR) : null

// ============ 静态文件服务 ============
// 上传媒体文件已迁移至 S3 兼容对象存储（RustFS），浏览器直连对象存储 URL，
// server 不再提供 /uploads/* 静态路由（history fallback 中保留排除以防老链接落进 SPA）

// SPA 托管（仅 SERVE_WEB_DIR 设置时启用）
if (webDistDir) {
  // 前端构建产物（index.html、assets/ 等），命中即返回，未命中则落到下方 history fallback
  app.use('/*', serveStatic({ root: webDistDir }))

  // history fallback：非 /api/*、非 /uploads/* 的 GET 请求统一返回 index.html，
  // 由前端路由（vue-router history 模式）接管；
  // API 与上传文件未命中时仍返回 404，避免缺失文件被兜底成 HTML
  app.get('*', async (c) => {
    if (c.req.path.startsWith('/api/') || c.req.path.startsWith('/uploads/')) {
      return c.text('Not Found', 404)
    }
    const indexFile = path.join(webDistDir, 'index.html')
    try {
      const html = await fs.readFile(indexFile, 'utf8')
      return c.html(html)
    } catch {
      return c.text(`web dist not found: ${indexFile}`, 404)
    }
  })
} else {
  // 未托管 SPA 时保持原有 /assets/* 静态服务（前端构建产物 / 资源）
  app.use('/assets/*', serveStatic({ root: './public' }))
}

// 错误处理
app.onError(errorHandler)

export default app
