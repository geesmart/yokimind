import { Hono } from 'hono'
import { authMiddleware, getCurrentUserId } from '~/core/middleware/auth.middleware.js'
import { listRecentVisits, listActivities } from './dashboard.service.js'

/**
 * Dashboard 控制器
 * 提供首页「最近访问」与「操作动态」列表接口，均需登录
 * - GET /dashboard/recent-visits  获取当前用户最近访问的文档列表（targetType=document）
 * - GET /dashboard/activities      获取当前用户的操作动态列表
 *
 * 路径前缀：/api/v1/dashboard（由 routes.ts 注册）
 */
const dashboardController = new Hono()
  // 最近访问文档列表（需登录）
  .get('/recent-visits', authMiddleware, async (c) => {
    const userId = getCurrentUserId(c)!
    const list = await listRecentVisits(userId)
    return c.success(list)
  })
  // 操作动态列表（需登录）
  .get('/activities', authMiddleware, async (c) => {
    const userId = getCurrentUserId(c)!
    const list = await listActivities(userId)
    return c.success(list)
  })

export default dashboardController

// ============ fetch 测试示例（按 server_rules） ============
//
// 1) 最近访问：
// fetch('http://localhost:6001/api/v1/dashboard/recent-visits', {
//   headers: { Authorization: 'Bearer <token>' },
// })
//
// 2) 操作动态：
// fetch('http://localhost:6001/api/v1/dashboard/activities', {
//   headers: { Authorization: 'Bearer <token>' },
// })
