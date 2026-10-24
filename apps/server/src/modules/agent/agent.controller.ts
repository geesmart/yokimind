import { Hono } from 'hono'
import { vJson } from '~/core/helper/zod.helper.js'
import { patAuthMiddleware } from '~/core/middleware/pat-auth.middleware.js'
import {
  AgentWikisListSchema,
  AgentWikiTreeSchema,
  AgentSearchSchema,
  AgentDocumentGetSchema,
  AgentDocumentCreateSchema,
  AgentDocumentUpdateSchema,
} from './agent.schema.js'
import { listWikis, getTree, search, getDocument, createDocument, updateDocument } from './agent.service.js'

/**
 * 智能体接入层 HTTP API（CLI 主消费方，MCP 工具走同一 service 层）
 * 认证：PAT（Authorization: Bearer yki_xxx，patAuthMiddleware 注入 userId）；全部 POST（server_rules 约定）
 * 响应统一 c.success 包装；错误经全局 onError 转 { status: <错误码>, info }
 */
const agentController = new Hono()
  /** 列出本人知识库 */
  .post('/wikis', vJson(AgentWikisListSchema), patAuthMiddleware, async (c) => {
    const wikis = await listWikis(c.get('userId')!)
    return c.success(wikis)
  })
  /** 知识库文档树 */
  .post('/wiki/tree', vJson(AgentWikiTreeSchema), patAuthMiddleware, async (c) => {
    const { wikiId } = c.req.valid('json')
    const tree = await getTree(wikiId, c.get('userId')!)
    return c.success(tree)
  })
  /** 检索（keyword / semantic / auto） */
  .post('/search', vJson(AgentSearchSchema), patAuthMiddleware, async (c) => {
    const params = c.req.valid('json')
    const result = await search(params, c.get('userId')!)
    return c.success(result)
  })
  /** 读取文档（markdown + plainText） */
  .post('/document/get', vJson(AgentDocumentGetSchema), patAuthMiddleware, async (c) => {
    const params = c.req.valid('json')
    const doc = await getDocument(params, c.get('userId')!)
    return c.success(doc)
  })
  /** 创建文档（markdown 正文） */
  .post('/document/create', vJson(AgentDocumentCreateSchema), patAuthMiddleware, async (c) => {
    const params = c.req.valid('json')
    const result = await createDocument(params, c.get('userId')!)
    return c.success(result)
  })
  /** 更新文档（markdown 正文，后写覆盖） */
  .post('/document/update', vJson(AgentDocumentUpdateSchema), patAuthMiddleware, async (c) => {
    const params = c.req.valid('json')
    const result = await updateDocument(params, c.get('userId')!)
    return c.success(result)
  })

export default agentController
