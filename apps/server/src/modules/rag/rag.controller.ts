import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { vJson } from '~/core/helper/zod.helper.js'
import { authMiddleware, getCurrentUserId } from '~/core/middleware/auth.middleware.js'
import { BizException } from '~/core/lib/biz.exception.js'
import { ErrorCode } from '~/config/error-code.js'
import { usePino } from '~/core/plugins/pino.js'
import { RagSearchSchema, RagChatSchema, RagWikiSchema, RagDocumentStatusSchema, RagStatusBatchSchema } from './rag.schema.js'
import {
  searchWiki,
  prepareChat,
  runChatStream,
  resolveChatSources,
  statusOf,
  statusBatchOf,
  documentStatusOf,
  reindexWiki,
  reindexDocument,
} from './rag.service.js'

const logger = usePino()

/**
 * RAG AI 知识库控制器
 * 基于知识库的语义检索与 AI 问答（RAG），均需登录且校验知识库归属
 * - POST /rag/search   语义搜索：返回与查询语义最相近的知识库切片（含得分与跳转信息）
 * - POST /rag/chat     AI 问答：基于检索上下文流式生成回答（SSE），结束推送引用来源
 * - POST /rag/status   索引状态统计：各状态文档数与切片总数（读 wiki_rag 快照）
 * - POST /rag/status-batch  批量索引状态统计：Dashboard 列表一次性拉取多库状态（读 wiki_rag 快照）
 * - POST /rag/document-status  单文档索引状态：文档编辑页徽标数据源
 * - POST /rag/reindex  全量重建索引：将该库全部文档重置为待索引并立即触发处理
 * - POST /rag/document-reindex  单文档立即索引：重置并重跑指定文档的索引任务
 */
const ragController = new Hono()
  // 语义搜索
  .post('/search', authMiddleware, vJson(RagSearchSchema), async (c) => {
    const userId = getCurrentUserId(c)!
    const { wikiId, query, topK } = c.req.valid('json')
    const results = await searchWiki(wikiId, query, topK, userId)
    return c.success(results)
  })
  // AI 问答（SSE 流式，支持可选 history 多轮追问）
  .post('/chat', authMiddleware, vJson(RagChatSchema), async (c) => {
    const userId = getCurrentUserId(c)!
    const { wikiId, question, history } = c.req.valid('json')

    // 权限校验、意图分析、检索与兜底判定全部放在 SSE 流开始之前：
    // 一旦进入 streamSSE 就无法再修改状态码，业务异常必须在此之前抛出
    const prepared = await prepareChat(wikiId, question, history ?? [], userId)

    return streamSSE(c, async (stream) => {
      try {
        // 三出口统一走 runChatStream：闲聊/兜底下发固定文案（单个 delta），正常问答透传生成增量
        const fullText = await runChatStream(prepared, async (delta) => {
          await stream.writeSSE({ event: 'delta', data: JSON.stringify({ text: delta }) })
        })
        // 回答结束：裁决后推送来源（正常=检索引用；模型自述无内容=置空不展示卡片；
        // 兜底=推荐文档；闲聊=空），避免「回答说暂无内容、下方却列引用」的语义矛盾
        await stream.writeSSE({ event: 'sources', data: JSON.stringify(resolveChatSources(prepared, fullText)) })
        await stream.writeSSE({ event: 'done', data: '{}' })
      } catch (err) {
        // 流内异常：通过 error 事件告知前端（状态码已无法修改）
        const message = err instanceof BizException ? err.message : 'AI 问答失败，请稍后重试'
        logger.error({ err, wikiId }, 'rag chat stream failed')
        await stream.writeSSE({ event: 'error', data: JSON.stringify({ message }) })
      }
    })
  })
  // 索引状态统计
  .post('/status', authMiddleware, vJson(RagWikiSchema), async (c) => {
    const userId = getCurrentUserId(c)!
    const { wikiId } = c.req.valid('json')
    const status = await statusOf(wikiId, userId)
    return c.success(status)
  })
  // 批量索引状态统计（Dashboard 列表四态圆点：一次请求替代逐库 N 次，越权 ID 静默过滤）
  .post('/status-batch', authMiddleware, vJson(RagStatusBatchSchema), async (c) => {
    const userId = getCurrentUserId(c)!
    const { wikiIds } = c.req.valid('json')
    const items = await statusBatchOf(wikiIds, userId)
    return c.success({ items })
  })
  // 单文档索引状态（文档编辑页徽标：none/pending/running/done/failed，纯 DB 读，不依赖 embedding 就绪）
  .post('/document-status', authMiddleware, vJson(RagDocumentStatusSchema), async (c) => {
    const userId = getCurrentUserId(c)!
    const { documentId } = c.req.valid('json')
    const status = await documentStatusOf(documentId, userId)
    return c.success(status)
  })
  // 全量重建索引
  .post('/reindex', authMiddleware, vJson(RagWikiSchema), async (c) => {
    const userId = getCurrentUserId(c)!
    const { wikiId } = c.req.valid('json')
    const result = await reindexWiki(wikiId, userId)
    return c.success(result)
  })
  // 单文档立即索引（文档编辑页 RAG 标签弹层的立即索引按钮，复用 document-status 的 documentId 入参校验）
  .post('/document-reindex', authMiddleware, vJson(RagDocumentStatusSchema), async (c) => {
    const userId = getCurrentUserId(c)!
    const { documentId } = c.req.valid('json')
    const result = await reindexDocument(documentId, userId)
    return c.success(result)
  })

export default ragController
