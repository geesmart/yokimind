import { getWikiById, listWikisByUserId } from '~/modules/wiki/wiki.service.js'
import { getTree, type AgentTreeNode } from '~/modules/agent/agent.service.js'

/**
 * Skills 服务（Agent Skills 标准 / SKILL.md）
 * 每个知识库对外呈现为一个技能：SKILL.md 内含文档树大纲 + 检索/读写指引，
 * 供支持 Agent Skills 的智能体（Claude Code、Trae 等）装载后自主深入访问知识库
 */

/** Agent Skills 规范：name 仅小写字母/数字/连字符，最长 64 */
const NAME_MAX_LENGTH = 64
/** Agent Skills 规范：description 最长 1024 字符（frontmatter 硬限） */
const DESCRIPTION_MAX_LENGTH = 1024
/** 大纲节点数上限（防超大库生成超长 SKILL.md；截断处注明） */
const OUTLINE_MAX_NODES = 100

/** 技能名 = yokimind-<名称 slug>-<wikiId 尾 6 位>（尾缀防跨库同名） */
function slugifyWiki(name: string, wikiId: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return `yokimind-${slug || 'wiki'}-${wikiId.slice(-6)}`.slice(0, NAME_MAX_LENGTH)
}

/** 技能条目（列表接口视图） */
export interface SkillEntry {
  wikiId: string
  name: string
  description: string
}

/** 列出本人知识库对应的技能（每库一条；description 超 1024 截断） */
export async function listSkills(userId: string): Promise<SkillEntry[]> {
  const wikis = await listWikisByUserId(userId)
  return wikis.map((w) => {
    const description = (w.description?.trim() || `YokiMind 知识库「${w.name}」`).slice(0, DESCRIPTION_MAX_LENGTH)
    return { wikiId: w.id, name: slugifyWiki(w.name, w.id), description }
  })
}

/** 文档树 → 缩进大纲（与 MCP wiki_tree 同款渲染，截断到 OUTLINE_MAX_NODES 节点） */
function renderOutline(nodes: AgentTreeNode[], depth: number, counter: { count: number }): string {
  const lines: string[] = []
  for (const node of nodes) {
    if (counter.count >= OUTLINE_MAX_NODES) {
      lines.push(`${'  '.repeat(depth)}- （更多节点已截断，请用 MCP wiki_tree / CLI tree 查看）`)
      break
    }
    counter.count += 1
    const icon = node.icon ? `${node.icon} ` : ''
    lines.push(`${'  '.repeat(depth)}- ${icon}${node.title}（nodeId: ${node.id}）`)
    if (node.children.length > 0) {
      lines.push(...renderOutline(node.children, depth + 1, counter))
    }
  }
  return lines.join('\n')
}

/**
 * 渲染指定知识库的 SKILL.md（动态生成，不落库）
 * 结构遵循 Agent Skills 标准：YAML frontmatter（name/description）+ Markdown 正文
 * @throws WIKI_NOT_FOUND（越权/不存在）
 */
export async function renderSkillMd(userId: string, wikiId: string): Promise<string> {
  const wiki = await getWikiById(wikiId, userId)
  const tree = await getTree(wikiId, userId)
  const docCount = countNodes(tree.nodes)
  const description = (wiki.description?.trim() || `包含 ${docCount} 篇文档的知识库`).slice(0, DESCRIPTION_MAX_LENGTH)

  const outline = renderOutline(tree.nodes, 0, { count: 0 })

  return `---
name: ${slugifyWiki(wiki.name, wikiId)}
description: ${description}
---

# YokiMind 知识库：${wiki.name}

${description}

- 知识库 ID（wikiId）：\`${wikiId}\`
- 文档总数：${docCount}

## 文档树大纲

${outline || '（空库，无文档）'}

## 如何检索与读取

优先使用 MCP 工具（若已配置 YokiMind MCP）：

- \`wikis_list\`：列出我的知识库
- \`wiki_tree\`：查看文档树（参数 wikiId=${wikiId}）
- \`search_knowledge\`：检索（参数 query、wikiId=${wikiId}、mode 可选 keyword/semantic/auto）
- \`read_document\`：读取文档全文（参数 nodeId 取自上方大纲）
- \`ask_knowledge\`：RAG 问答（参数 wikiId=${wikiId}、question）

未配置 MCP 时，可经 CLI（\`yokimind\` 命令）访问同一能力：

\`\`\`bash
yokimind search "关键词" --wiki ${wikiId}   # 检索
yokimind doc get <nodeId>                   # 读取文档（Markdown）
yokimind tree ${wikiId}                      # 完整文档树
\`\`\`

或直接调用 REST API（POST，Bearer PAT 认证）：

\`\`\`bash
curl -X POST <站点地址>/api/v1/agent/search \\
  -H "Authorization: Bearer $YOKIMIND_TOKEN" -H "Content-Type: application/json" \\
  -d '{"wikiId":"${wikiId}","q":"关键词"}'
\`\`\`

## 如何写入

- 创建：MCP \`create_document\`（markdown 正文，首个 H1 自动提取为标题）或 CLI \`yokimind doc create\`
- 更新：MCP \`update_document\` / CLI \`yokimind doc update\`（Markdown 全量覆盖，后写覆盖语义；建议先读取原文再合并修改）
- 服务端自动把 Markdown 转为编辑器 JSON 并触发 RAG 重索引，无需关心存储细节
`
}

/** 递归统计节点数 */
function countNodes(nodes: AgentTreeNode[]): number {
  return nodes.reduce((sum, n) => sum + 1 + countNodes(n.children), 0)
}
