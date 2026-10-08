import { Hono } from 'hono'
import { vJson } from '~/core/helper/zod.helper.js'
import { authMiddleware } from '~/core/middleware/auth.middleware.js'
import { adminGuard } from '~/core/middleware/admin.middleware.js'
import { SaveAiSettingsSchema, TestAiSchema } from './admin.schema.js'
import { getSettingsView, saveSettings, testAi } from './admin.service.js'

/**
 * 管理后台控制器
 * 全部接口要求「登录 + 管理员」双重校验（authMiddleware + adminGuard），
 * 按项目规范统一使用 POST 请求，通过接口名区分操作
 * - POST /admin/settings       查看 AI 配置（apiKey 脱敏为掩码）
 * - POST /admin/settings/save  保存 AI 配置（保存后新配置即时生效）
 * - POST /admin/test-ai        AI 连接测试（chat / embedding，失败以 ok:false 返回）
 */
const adminController = new Hono()
  // 查看 AI 配置
  .post('/settings', authMiddleware, adminGuard, async (c) => {
    return c.success(await getSettingsView())
  })
  // 保存 AI 配置
  .post('/settings/save', authMiddleware, adminGuard, vJson(SaveAiSettingsSchema), async (c) => {
    const patch = c.req.valid('json')
    const view = await saveSettings(patch)
    return c.success(view)
  })
  // AI 连接测试（可用 overrides 测试未保存的表单值）
  .post('/test-ai', authMiddleware, adminGuard, vJson(TestAiSchema), async (c) => {
    const params = c.req.valid('json')
    const results = await testAi(params)
    return c.success(results)
  })

export default adminController
