import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { vJson } from '~/core/helper/zod.helper.js'
import { VerifySharePasswordSchema, ShareAiChatSchema } from './share.schema.js'
import {
  getShareMeta,
  verifySharePassword,
  listShareNodes,
  getShareDocument,
  listBlogPosts,
  getWikiLevelShare,
} from './share.service.js'
import { shareAuthMiddleware } from './share.middleware.js'
import { getWikiPublishRow } from '~/modules/publish/publish.service.js'
import { flattenPublishSettings } from '~/modules/publish/publish.util.js'
import { prepareVisitorChat, runChatStream, resolveChatSources, type ChatStage } from '~/modules/rag/rag.service.js'
import { isAiConfigured } from '~/core/lib/ai.js'
import { usePino } from '~/core/plugins/pino.js'
import { BizException } from '~/core/lib/biz.exception.js'
import { ErrorCode } from '~/config/error-code.js'

const logger = usePino()

// ============ Rate Limit ============

/**
 * 内存级密码校验防爆破限流
 * - key: `${wikiId}:${docId ?? 'wiki'}:${ip}` —— 加入 doc 维度：
 *   页级密码与库级密码、不同页面的密码校验彼此隔离计数，
 *   防止攻击者用多个页面的校验入口稀释同一爆破目标的限额
 * - 60 秒窗口内最多 5 次密码校验请求
 * - 明文密码采用直接字符串比较（非常数时间），抗爆破完全依赖本限流兜底
 * - 单实例部署场景足够（本项目无多实例需求）
 */
const verifyRateLimitMap = new Map<string, { count: number; windowStart: number }>()
const VERIFY_RATE_LIMIT_WINDOW = 60_000 // 60 秒窗口
const VERIFY_RATE_LIMIT_MAX = 5 // 窗口内最多尝试次数

/**
 * 检查密码校验频率是否超限
 * @param wikiId 知识库 ID
 * @param docId 文档 ID（单页访问意图）；整库访问意图传 undefined（key 中归一为 'wiki'）
 * @param ip 访客 IP
 * @returns true = 允许，false = 超限
 */
function checkVerifyRateLimit(wikiId: string, docId: string | undefined, ip: string): boolean {
  const key = `${wikiId}:${docId ?? 'wiki'}:${ip}`
  const now = Date.now()
  const entry = verifyRateLimitMap.get(key)

  // 无记录或窗口已过期：开新窗口
  if (!entry || now - entry.windowStart > VERIFY_RATE_LIMIT_WINDOW) {
    verifyRateLimitMap.set(key, { count: 1, windowStart: now })
    return true
  }

  // 窗口内计数 +1，超过上限拒绝
  entry.count += 1
  return entry.count <= VERIFY_RATE_LIMIT_MAX
}

/**
 * 从请求头提取访客 IP（优先 x-forwarded-for，兜底 unknown）
 * @param c Hono 上下文
 */
function getVisitorIp(c: { req: { header: (name: string) => string | undefined } }): string {
  return c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
}

/**
 * AI 问答防滥用限流（内存级）
 * - key: `${wikiId}:${ip}` —— 按「库 + 访客 IP」隔离计数
 * - 60 秒窗口内最多 10 次提问（公开 LLM 端点成本高，需比密码校验更严格的用量约束）
 * - 单实例部署场景足够（与密码校验限流同一策略）
 */
const aiChatRateLimitMap = new Map<string, { count: number; windowStart: number }>()
const AI_CHAT_RATE_LIMIT_WINDOW = 60_000 // 60 秒窗口
const AI_CHAT_RATE_LIMIT_MAX = 10 // 窗口内最多提问次数

/**
 * 检查 AI 问答频率是否超限
 * @param wikiId 知识库 ID
 * @param ip 访客 IP
 * @returns true = 允许，false = 超限
 */
function checkAiChatRateLimit(wikiId: string, ip: string): boolean {
  const key = `${wikiId}:${ip}`
  const now = Date.now()
  const entry = aiChatRateLimitMap.get(key)

  // 无记录或窗口已过期：开新窗口
  if (!entry || now - entry.windowStart > AI_CHAT_RATE_LIMIT_WINDOW) {
    aiChatRateLimitMap.set(key, { count: 1, windowStart: now })
    return true
  }

  // 窗口内计数 +1，超过上限拒绝
  entry.count += 1
  return entry.count <= AI_CHAT_RATE_LIMIT_MAX
}

/**
 * 公开分享控制器（无需登录，访客语义："分享给别人看"）
 * 提供访客打开 /wiki/{wikiId}/{docId?} 链接所需的数据接口，均以 wikiId 寻址：
 * - GET  /share/wiki/:wikiId                      分享元信息（wikiName + accessType + 是否需要密码）
 *                                                 可选 query ?docId= 按单页意图判定
 * - POST /share/wiki/:wikiId/verify               校验访问密码（库密码或页密码），签发对应 scope 的 X-Share-Token
 * - GET  /share/wiki/:wikiId/nodes                访客文档树（仅公开库；需令牌，若设置了库密码）
 * - GET  /share/wiki/:wikiId/document/:documentId 访客文档正文（需令牌，若设置了库密码/页密码）
 * - GET  /share/wiki/:wikiId/blog                 博客文章列表（仅公开库；博客形态 /b/:wikiId 数据源）
 * - POST /share/wiki/:wikiId/ai-chat              访客 AI 问答（SSE 流式；RAG 检索仅限该库公开内容）
 *
 * 与 publish 模块的职责边界（share/publish 语义拆分）：
 * - 本模块只负责"分享访问控制"（wiki_shares 两级 shareStatus/password 复核）；
 *   站点形态/外观的发布配置与 owner 预览见 ~/modules/publish/publish.controller.ts
 *
 * 权限模型：wiki_shares 统一权限表（node_id='' 库级 / node_id=<nodeId> 页面级覆盖），
 * 所有访客接口每次请求实时复核权限行，撤销分享即时失效
 */
const shareController = new Hono()
  // 分享元信息：前端据此决定直接进入浏览态 or 弹密码卡片
  // ?docId= 可选：访客直达某页面时按"库可见性 ⊕ 页面覆盖"判定可见性与所需密码
  .get('/wiki/:wikiId', async (c) => {
    const wikiId = c.req.param('wikiId')
    // 空串归一为 undefined（整库浏览意图）
    const docId = c.req.query('docId') || undefined
    const result = await getShareMeta(wikiId, docId)
    return c.success(result)
  })
  // 密码校验：成功返回 shareToken（前端存 sessionStorage，后续请求带 X-Share-Token）
  // body.docId 可选：私密库单页公开场景校验页密码，公开库/整库场景校验库密码
  .post('/wiki/:wikiId/verify', vJson(VerifySharePasswordSchema), async (c) => {
    const wikiId = c.req.param('wikiId')
    const ip = getVisitorIp(c)
    const data = c.req.valid('json')

    // 防爆破限流：60 秒窗口内同 wiki+doc+IP 最多 5 次（doc 维度隔离，见 checkVerifyRateLimit 注释）
    if (!checkVerifyRateLimit(wikiId, data.docId, ip)) {
      throw new BizException(ErrorCode.SHARE_VERIFY_RATE_LIMITED)
    }

    const result = await verifySharePassword(wikiId, data.password, data.docId)
    return c.success(result)
  })
  // 访客文档树（仅公开库；库级/页面级权限判定 + 令牌校验由 shareAuthMiddleware 完成）
  .get('/wiki/:wikiId/nodes', shareAuthMiddleware, async (c) => {
    const wikiId = c.req.param('wikiId')
    const result = await listShareNodes(wikiId)
    return c.success(result)
  })
  // 访客文档正文（中间件实时复核可见性；service 内再做 id+wikiId 联合过滤，防跨库越权）
  .get('/wiki/:wikiId/document/:documentId', shareAuthMiddleware, async (c) => {
    const wikiId = c.req.param('wikiId')
    const documentId = c.req.param('documentId')
    const result = await getShareDocument(wikiId, documentId)
    return c.success(result)
  })
  // 博客文章列表（/b/:wikiId 数据源，仅公开库）
  // 路由上无 documentId 参数 → shareAuthMiddleware 按公开库整树语义判定：
  // 私密库 SHARE_NOT_FOUND；密码库要求 X-Share-Token（scope = wikiId）
  // 列表排序 = 文档树先序（sortOrder），配图优先级 cover > 正文第一图 > 留空
  .get('/wiki/:wikiId/blog', shareAuthMiddleware, async (c) => {
    const wikiId = c.req.param('wikiId')
    const result = await listBlogPosts(wikiId)
    return c.success(result)
  })
  // ============ 预览模式路由已迁至 publish 模块（share/publish 语义拆分） ============
  // GET  /share/wiki/:wikiId/preview*            → GET  /publish/wiki/:wikiId/preview*
  // PUT  /share/wiki/:wikiId/preview/config      → PUT  /publish/wiki/:wikiId/settings
  // POST /share/wiki/:wikiId/preview/upload      → POST /publish/wiki/:wikiId/upload
  // 访客 AI 问答（分享公开页右下角 AI 浮窗，SSE 流式）
  // 权限：shareAuthMiddleware 实时复核分享可见性 / 密码令牌（撤销分享即时失效），
  //       检索边界锁定该库（prepareVisitorChat 不做 owner 校验，仅走 RAG 向量召回）
  // 限流：同 wiki+IP 每分钟最多 10 次（公开 LLM 端点防滥用）
  // AI 开关：owner 在预览面板关闭 AI 助手后（aiEnabled=false），接口层直接拒绝（不只是 UI 隐藏）
  // SSE 事件序：stage（阶段进度 thinking/searching/reranking/generating）→ delta（增量）→
  //             sources（引用）→ done；流内异常（含检索阶段）走 error 事件
  // 降级契约：AI 未配置（isAiConfigured=false）仍在流前抛 80001 JSON（不进流）
  .post('/wiki/:wikiId/ai-chat', shareAuthMiddleware, vJson(ShareAiChatSchema), async (c) => {
    const wikiId = c.req.param('wikiId')
    const ip = getVisitorIp(c)
    const { question, history } = c.req.valid('json')

    // 防滥用限流：60 秒窗口内同 wiki+IP 最多 10 次
    if (!checkAiChatRateLimit(wikiId, ip)) {
      throw new BizException(ErrorCode.SHARE_AI_CHAT_RATE_LIMITED)
    }

    // AI 助手开关守卫：owner 关闭后公开站不开放问答（SSE 流开始前抛出，保证状态码可返回）
    // 开关值存 wiki_publish.settings.aiEnabled（share/publish 拆表后发布配置归 publish 表）
    const publishRow = await getWikiPublishRow(wikiId)
    if (publishRow && flattenPublishSettings(publishRow.settings).aiEnabled === false) {
      throw new BizException(ErrorCode.SHARE_AI_DISABLED)
    }

    // AI 配置就绪守卫（流前快速检查，保持既有降级契约）：
    // chat 模型未配置时仍返回 HTTP 200 + { status: 80001 } JSON（而非流内 error 事件），
    // 前端与集成测试的降级断言不变；真正的检索/生成阶段失败才走流内 error 事件
    if (!(await isAiConfigured())) {
      throw new BizException(ErrorCode.RAG_NOT_CONFIGURED)
    }

    // 检索与 prompt 组装移入 SSE 流内：阶段进度（thinking/searching/reranking/generating）
    // 必须在流建立后才能以 stage 事件逐个推送；prepare 失败由下方 catch 统一转 error 事件
    return streamSSE(c, async (stream) => {
      // 阶段事件发送器（onStage 回调复用）
      const sendStage = async (stage: ChatStage) => {
        await stream.writeSSE({ event: 'stage', data: JSON.stringify({ stage }) })
      }

      try {
        // 意图分析 → 检索 → 重排 → 组装 prompt（阶段随执行逐个推送）
        const context = await prepareVisitorChat(wikiId, question, history ?? [], sendStage)

        // 流式透传回答增量
        const fullText = await runChatStream(context, async (delta) => {
          await stream.writeSSE({ event: 'delta', data: JSON.stringify({ text: delta }) })
        })
        // 回答结束：裁决后推送来源（模型自述「暂无相关内容」时置空，不展示引用卡片，
        // 与 owner 端 /rag/chat 行为一致，避免「回答说没有、下方却列引用」的矛盾）
        await stream.writeSSE({ event: 'sources', data: JSON.stringify(resolveChatSources(context, fullText)) })
        await stream.writeSSE({ event: 'done', data: '{}' })
      } catch (err) {
        // 流内异常（含 prepare 阶段的检索失败）：通过 error 事件告知前端（状态码已无法修改）
        const message = err instanceof BizException ? err.message : 'AI 问答失败，请稍后重试'
        logger.error({ err, wikiId }, 'share ai chat stream failed')
        await stream.writeSSE({ event: 'error', data: JSON.stringify({ message }) })
      }
    })
  })

export default shareController
