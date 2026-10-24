import { Hono } from 'hono'
// @ts-ignore
import pkg from '../package.json'
import indexView from '~/views/index.view.js'
import healthController from '~/modules/health/health.controller.js'
import userController from '~/modules/user/user.controller.js'
import wikiController from '~/modules/wiki/wiki.controller.js'
import dashboardController from '~/modules/dashboard/dashboard.controller.js'
import mediaController from '~/modules/media/media.controller.js'
import shareController from '~/modules/share/share.controller.js'
import publishController from '~/modules/publish/publish.controller.js'
import ragController from '~/modules/rag/rag.controller.js'
import aiController from '~/modules/ai/ai.controller.js'
import adminController from '~/modules/admin/admin.controller.js'
import tokenController from '~/modules/token/token.controller.js'
import agentController from '~/modules/agent/agent.controller.js'
import mcpController from '~/modules/mcp/mcp.controller.js'
import skillsController from '~/modules/skills/skills.controller.js'

// ============ API 路由配置 ============
// /health 必须注册：docker-compose 的 healthcheck 探 /api/v1/health，
// 未注册会 404 → app 容器永不 healthy → caddy（depends_on service_healthy）永远起不来
const v1Routes = new Hono()
  .route('/health', healthController)
  .route('/user', userController)
  .route('/wiki', wikiController)
  .route('/dashboard', dashboardController)
  .route('/media', mediaController)
  .route('/share', shareController)
  .route('/publish', publishController)
  .route('/rag', ragController)
  .route('/ai', aiController)
  .route('/admin', adminController)
  // ============ 智能体接入层（MCP / Skills / CLI 共用 PAT 认证） ============
  .route('/token', tokenController)
  .route('/agent', agentController)
  .route('/mcp', mcpController)
  .route('/skills', skillsController)

// API 路由（包含版本号）
const apiRoutes = new Hono().route('/v1', v1Routes)

// ============ 根路径路由 ============
// SERVE_WEB_DIR 设置时（npm CLI/Docker 分发场景），根路径交给 app.ts 的 SPA history fallback，
// 占位页不再注册；未设置时保持原有占位页行为（前后端分离部署不受影响）
const rootRoute = new Hono().get('/', (c) => {
  return c.html(
    indexView({
      version: pkg.version,
    })
  )
})

// ============ 统一导出 ============
const routes = process.env.SERVE_WEB_DIR
  ? new Hono().route('/api', apiRoutes)
  : new Hono().route('/', rootRoute).route('/api', apiRoutes)

export default routes