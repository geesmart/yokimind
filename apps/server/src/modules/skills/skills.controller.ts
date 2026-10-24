import { Hono } from 'hono'
import { patAuthMiddleware } from '~/core/middleware/pat-auth.middleware.js'
import { listSkills, renderSkillMd } from './skills.service.js'

/**
 * Skills 端点（Agent Skills 标准 / SKILL.md，每知识库一个技能）
 * 认证：PAT（Authorization: Bearer yki_xxx）
 * 响应说明：列表走 c.success（程序消费）；SKILL.md 走 c.text 原始文本
 * （CLI skills pull 与智能体直接消费文件内容，JSON 包装反而碍事）
 */
const skillsController = new Hono()
  /** 技能列表（每库一条：name/description/wikiId） */
  .get('/', patAuthMiddleware, async (c) => {
    const skills = await listSkills(c.get('userId')!)
    return c.success(skills)
  })
  /** 下载指定知识库的 SKILL.md（原始 markdown 文本，text/markdown） */
  .get('/:wikiId/SKILL.md', patAuthMiddleware, async (c) => {
    const wikiId = c.req.param('wikiId')
    const content = await renderSkillMd(c.get('userId')!, wikiId)
    return c.text(content, 200, { 'Content-Type': 'text/markdown; charset=utf-8' })
  })

export default skillsController
