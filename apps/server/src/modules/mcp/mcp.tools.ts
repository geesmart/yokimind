import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import {
  listWikis,
  getTree,
  search,
  getDocument,
  createDocument,
  updateDocument,
  type AgentTreeNode,
} from '~/modules/agent/agent.service.js'
import { prepareChat, runChatSync, type RagChatSource } from '~/modules/rag/rag.service.js'
import type { AgentSearchMode } from '~/modules/agent/agent.schema.js'

/**
 * MCP 工具注册（7 个，覆盖读 + 写 + 检索 + 问答）
 * 全部薄封装 agent.service（与 Agent HTTP API / CLI 共用底座）；
 * 工具级错误 catch 后转 isError 文本结果（不打断 MCP 会话），
 * 协议级错误（认证/传输）由 mcp.controller 处理
 */

/** 工具 handler 统一包装：BizException / Error → isError 文本 */
function tool<A>(fn: (args: A) => Promise<unknown>) {
  return async (args: A) => {
    try {
      const result = await fn(args)
      const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2)
      return { content: [{ type: 'text' as const, text }] }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        content: [{ type: 'text' as const, text: `操作失败：${message}` }],
        isError: true,
      }
    }
  }
}

/** 文档树 → 缩进大纲文本（LLM 可读，含 nodeId 供后续 read_document 引用） */
function renderTreeText(nodes: AgentTreeNode[], depth = 0): string {
  return nodes
    .map((node) => {
      const indent = '  '.repeat(depth)
      const icon = node.icon ? `${node.icon} ` : ''
      const line = `${indent}- ${icon}${node.title} (nodeId: ${node.id})`
      const children = node.children.length > 0 ? `\n${renderTreeText(node.children, depth + 1)}` : ''
      return line + children
    })
    .join('\n')
}

/** 搜索结果 → 文本（keyword 带 snippet 摘要 / semantic 带切片与得分） */
function renderSearchText(items: Array<Record<string, unknown>>, usedMode: string): string {
  if (items.length === 0) {
    return `（${usedMode} 模式）无命中结果`
  }
  return items
    .map((item, i) => {
      const head = `[${i + 1}] ${item.title ?? '（未命名）'}  nodeId=${item.nodeId ?? '-'}${item.documentId ? ` documentId=${item.documentId}` : ''}`
      if (usedMode === 'semantic') {
        return `${head}\n${item.content ?? ''}\n（相似度 ${(item.score as number)?.toFixed(4)}）`
      }
      return `${head}\n${JSON.stringify(item.snippet ?? '')}`
    })
    .join('\n\n')
}

/**
 * 向 MCP server 实例注册全部工具（userId 经闭包注入，工具内即有身份）
 * 每个请求都会 new McpServer 并调用本函数（无状态模式约束）
 */
export function registerAgentTools(server: McpServer, userId: string): void {
  // 列出本人知识库
  server.registerTool(
    'wikis_list',
    {
      title: '列出知识库',
      description: '列出当前用户有权限访问的全部知识库（含 wikiId、名称、描述、文档数）',
      inputSchema: {},
    },
    tool(async () => {
      const wikis = await listWikis(userId)
      return {
        total: wikis.length,
        wikis: wikis.map((w) => ({ wikiId: w.id, name: w.name, description: w.description ?? '' })),
      }
    }),
  )

  // 知识库文档树
  server.registerTool(
    'wiki_tree',
    {
      title: '文档树',
      description: '获取指定知识库的文档树大纲（缩进层级文本，含每篇文档的 nodeId，供 read_document 使用）',
      inputSchema: { wikiId: z.string().describe('知识库 ID（wikis_list 返回的 wikiId）') },
    },
    tool(async (args: { wikiId: string }) => {
      const tree = await getTree(args.wikiId, userId)
      const outline = renderTreeText(tree.nodes)
      return `知识库 ${args.wikiId} 文档树：\n\n${outline || '（空库，无文档）'}`
    }),
  )

  // 检索
  server.registerTool(
    'search_knowledge',
    {
      title: '知识检索',
      description:
        '在知识库中检索：mode=keyword 关键词（无需配置）；semantic 语义（需配置 embedding，且必须指定 wikiId）；auto 自动（语义不可用时降级关键词）。不传 wikiId 时在全部知识库内做关键词搜索',
      inputSchema: {
        query: z.string().describe('检索词'),
        wikiId: z.string().optional().describe('限定知识库 ID（不传则搜索全部知识库）'),
        mode: z.enum(['keyword', 'semantic', 'auto']).optional().describe('检索模式，默认 auto'),
        limit: z.number().int().min(1).max(50).optional().describe('返回条数上限，默认 10'),
      },
    },
    tool(async (args: { query: string; wikiId?: string; mode?: AgentSearchMode; limit?: number }) => {
      const result = await search(
        { wikiId: args.wikiId, q: args.query, mode: args.mode ?? 'auto', limit: args.limit ?? 10 },
        userId,
      )
      return `检索模式：${result.usedMode}\n\n${renderSearchText(result.items as unknown as Array<Record<string, unknown>>, result.usedMode)}`
    }),
  )

  // 读取文档
  server.registerTool(
    'read_document',
    {
      title: '读取文档',
      description: '读取一篇文档的完整内容（Markdown 格式）。nodeId 与 documentId 至少提供一个',
      inputSchema: {
        nodeId: z.string().optional().describe('节点 ID（wiki_tree / search_knowledge 返回）'),
        documentId: z.string().optional().describe('文档 ID（与 nodeId 二选一）'),
        wikiId: z.string().optional().describe('可选，用于参数一致性校验'),
      },
    },
    tool(async (args: { nodeId?: string; documentId?: string; wikiId?: string }) => {
      const doc = await getDocument({ nodeId: args.nodeId, documentId: args.documentId, wikiId: args.wikiId }, userId)
      return `# ${doc.title ?? '（未命名）'}\n\n${doc.markdown || '（空文档）'}`
    }),
  )

  // 创建文档
  server.registerTool(
    'create_document',
    {
      title: '创建文档',
      description:
        '在知识库中创建新文档。markdown 支持 H1 提取为标题（未显式传 title 时）；表格/任务列表等扩展语法会尽量转换，residueCount>0 表示存在有损转换',
      inputSchema: {
        wikiId: z.string().describe('知识库 ID'),
        markdown: z.string().describe('Markdown 正文'),
        title: z.string().optional().describe('文档标题（不传则取 markdown 首个 H1）'),
        parentId: z.string().optional().describe('父节点 ID（不传则创建在根层级）'),
      },
    },
    tool(async (args: { wikiId: string; markdown: string; title?: string; parentId?: string }) => {
      const result = await createDocument(
        { wikiId: args.wikiId, markdown: args.markdown, title: args.title, parentId: args.parentId },
        userId,
      )
      return `文档已创建：${JSON.stringify(result)}`
    }),
  )

  // 更新文档
  server.registerTool(
    'update_document',
    {
      title: '更新文档',
      description:
        '用 Markdown 全量覆盖一篇文档的内容（后写覆盖语义；建议先 read_document 获取原文再合并修改）。title 可选：同时更新节点标题',
      inputSchema: {
        markdown: z.string().describe('新的 Markdown 正文（全量覆盖）'),
        nodeId: z.string().optional().describe('节点 ID（与 documentId 二选一）'),
        documentId: z.string().optional().describe('文档 ID（与 nodeId 二选一）'),
        title: z.string().optional().describe('可选，同步更新文档标题'),
      },
    },
    tool(async (args: { markdown: string; nodeId?: string; documentId?: string; title?: string }) => {
      const result = await updateDocument(
        { markdown: args.markdown, nodeId: args.nodeId, documentId: args.documentId, title: args.title },
        userId,
      )
      return `文档已更新：${JSON.stringify(result)}`
    }),
  )

  // 知识库问答
  server.registerTool(
    'ask_knowledge',
    {
      title: '知识库问答',
      description:
        '基于指定知识库做 RAG 问答（检索 + LLM 生成，回答带 [n] 来源标注）。需已配置 AI 模型；未配置语义检索时使用关键词召回',
      inputSchema: {
        wikiId: z.string().describe('知识库 ID'),
        question: z.string().describe('问题'),
      },
    },
    tool(async (args: { wikiId: string; question: string }) => {
      const prepared = await prepareChat(args.wikiId, args.question, [], userId)
      const { answer, sources } = await runChatSync(prepared)
      const sourceLines = sources.map((s: RagChatSource, i: number) => `[${i + 1}] ${s.title ?? '未命名'}${s.url ? ` ${s.url}` : ''}`)
      return [answer, sourceLines.length > 0 ? `\n\n参考来源：\n${sourceLines.join('\n')}` : ''].join('')
    }),
  )
}
