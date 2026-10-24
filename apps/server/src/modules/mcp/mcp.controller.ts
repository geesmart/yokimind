import { Hono } from 'hono'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { requirePat } from '~/core/middleware/pat-auth.middleware.js'
import { BizException } from '~/core/lib/biz.exception.js'
import { registerAgentTools } from './mcp.tools.js'
// @ts-ignore
import pkg from '../../../package.json'

/**
 * MCP 端点（Model Context Protocol，Streamable HTTP 无状态模式）
 *
 * 接入方式：客户端配置 URL <站点>/api/v1/mcp + 请求头 Authorization: Bearer yki_xxx（PAT）
 *
 * 关键实现约束：
 * 1. 无状态模式（sessionIdGenerator: undefined）下每个请求必须 new 全新 transport + server
 *    实例（复用会因多客户端 message ID 撞号产生协议错乱），工具经闭包注入 userId；
 * 2. 本端点响应永远是 JSON-RPC 格式：全局 onError 只对「抛出的异常」生效，这里内部全部
 *    catch 自行构造响应，认证失败返回 HTTP 401 + JSON-RPC error（绝不抛 BizException）；
 * 3. GET（SSE 独立流）/ DELETE（会话终止）在无状态模式无意义，显式 405（JSON-RPC error）；
 * 4. 响应不走 c.success 包装（协议响应与业务响应格式互斥），responseMiddleware 仅挂方法不拦截。
 */
const mcpController = new Hono().all('/', async (c) => {
  if (c.req.method !== 'POST') {
    return c.json(
      {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32000, message: 'Method not allowed: stateless MCP server only accepts POST' },
      },
      405,
      { Allow: 'POST' },
    )
  }

  try {
    // PAT 校验（yki_ 前缀 Bearer）；失败抛 BizException 由下方 catch 转 401 JSON-RPC error
    const userId = await requirePat(c)

    // 每请求全新实例（无状态模式硬约束，见顶部注释）
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    const server = new McpServer({ name: 'yokimind', version: pkg.version })
    registerAgentTools(server, userId)
    await server.connect(transport)

    // Web 标准传输直接消费 Hono 的原始 Request，返回协议 Response（Hono 原样透传）。
    // 注意：request-log 中间件已 await c.req.json() 消费了 raw 的 body 流（Hono bodyCache
    // 只缓存在 HonoRequest 侧），必须用缓存的文本重建 Request，否则传输层解析 JSON 报 -32700
    const bodyText = await c.req.text()
    const mcpRequest = new Request(c.req.raw.url, {
      method: 'POST',
      headers: c.req.raw.headers,
      body: bodyText,
      // @ts-expect-error Node 的 Request 构造需要 duplex 标记流式 body
      duplex: 'half',
    })
    return await transport.handleRequest(mcpRequest)
  } catch (error) {
    const isAuthError = error instanceof BizException
    const message =
      error instanceof Error
        ? error.message
        : 'Internal error'
    // 认证失败 401（JSON-RPC 自定义码 -32001），其余 500（-32603 内部错误）
    return c.json(
      {
        jsonrpc: '2.0',
        id: null,
        error: { code: isAuthError ? -32001 : -32603, message },
      },
      isAuthError ? 401 : 500,
    )
  }
})

export default mcpController
