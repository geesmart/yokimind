/**
 * yokimind CLI 命令定义
 * 命令树：
 *   yokimind login                                  保存服务地址与访问令牌
 *   yokimind wikis                                  列出我的知识库
 *   yokimind tree <wikiId>                          查看知识库文档树
 *   yokimind search [wikiId] <q>                    检索（auto 语义优先自动降级关键词）
 *   yokimind doc get <id> [--node] [-o file]        读取文档（Markdown）
 *   yokimind doc create <wikiId> [--title ...]      创建文档（markdown 来源 --file/-）
 *   yokimind doc update <id> [--node] [--title ...] 更新文档（后写覆盖）
 *   yokimind skills list                            技能列表
 *   yokimind skills pull [wikiId] [-o dir]          下载 SKILL.md（不传 wikiId 拉全部）
 *   yokimind mcp print                              生成 MCP 配置片段
 */
import { createRequire } from 'node:module'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Command } from 'commander'
import { DEFAULT_URL, configFileLabel, loadConfig, saveConfig } from './config.mjs'
import {
  ApiError,
  createDocument,
  fetchSkillMd,
  getDocument,
  getWikiTree,
  listSkills,
  listWikis,
  renderMcpJson,
  requestRaw,
  search,
  updateDocument,
} from './api.mjs'

const require = createRequire(import.meta.url)
const { version } = require('../package.json')

const program = new Command()

program
  .name('yokimind')
  .description('YokiMind 命令行工具：让智能体与脚本读写你的知识库（PAT 令牌认证）')
  .version(version, '-v, --version', '显示版本号')
  .option('--json', '以 JSON 格式输出原始结果')

/** 全局 --json 选项 */
function jsonMode() {
  return program.opts().json === true
}

/** 统一错误退出：ApiError 附带错误码 */
function fail(error) {
  const detail = error instanceof ApiError ? `${error.message}（错误码 ${error.code}）` : error.message
  console.error(`✗ ${detail}`)
  process.exit(1)
}

/** 从 stdin 读取全部文本（--stdin 用） */
function readStdin() {
  return new Promise((resolve, reject) => {
    let data = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => (data += chunk))
    process.stdin.on('end', () => resolve(data))
    process.stdin.on('error', reject)
  })
}

/** 读取 markdown 内容：--file 优先，其次 --stdin；两者都没有报错 */
async function readMarkdown(file) {
  if (file) return readFile(resolve(file), 'utf8')
  if (!process.stdin.isTTY) return readStdin()
  throw new Error('缺少文档内容：用 --file <path> 指定文件，或通过管道输入（echo ... | yokimind doc update ...）')
}

/** 截断单行文本（表格列宽控制） */
function truncate(text, max) {
  const line = String(text ?? '').replace(/\s+/g, ' ').trim()
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

/** 递归渲染文档树（缩进 + 制表符分支） */
function renderTree(nodes, prefix = '') {
  const lines = []
  nodes.forEach((node, i) => {
    const last = i === nodes.length - 1
    lines.push(`${prefix}${last ? '└─ ' : '├─ '}${node.title}${node.documentId ? '' : ' (目录)'}`)
    lines.push(...renderTree(node.children, `${prefix}${last ? '   ' : '│  '}`))
  })
  return lines
}

// ==================== login ====================

program
  .command('login')
  .description('保存服务地址与访问令牌到 ' + configFileLabel)
  .option('--url <url>', `服务地址（默认 ${DEFAULT_URL}）`)
  .option('--token <token>', '访问令牌（yki_ 开头，在 web「智能体接入」页创建）')
  .action(async (opts) => {
    try {
      const current = await loadConfig()
      const url = opts.url || current.url
      const token = opts.token
      if (!token) {
        throw new Error('缺少令牌：--token yki_xxx（web「智能体接入」页创建后复制）')
      }
      // 校验：用待保存的 url+token 真实请求一次（列库接口轻量且无副作用）
      await requestRaw(url, token, '/agent/wikis', { body: {} })
      await saveConfig({ url, token })
      console.log(`✓ 登录成功，配置已保存到 ${configFileLabel}`)
      console.log(`  服务地址：${url}`)
    } catch (error) {
      fail(error)
    }
  })

// ==================== wikis ====================

program
  .command('wikis')
  .description('列出我的知识库')
  .action(async () => {
    try {
      const wikis = await listWikis()
      if (jsonMode()) {
        console.log(JSON.stringify(wikis, null, 2))
        return
      }
      if (!wikis.length) {
        console.log('（还没有知识库）')
        return
      }
      for (const w of wikis) {
        console.log(`${w.id}  ${w.name ?? ''}${w.docCount !== undefined ? `（${w.docCount} 篇文档）` : ''}`)
      }
    } catch (error) {
      fail(error)
    }
  })

// ==================== tree ====================

program
  .command('tree')
  .description('查看知识库文档树')
  .argument('<wikiId>', '知识库 ID')
  .action(async (wikiId) => {
    try {
      const { nodes } = await getWikiTree(wikiId)
      if (jsonMode()) {
        console.log(JSON.stringify(nodes, null, 2))
        return
      }
      if (!nodes.length) {
        console.log('（知识库为空）')
        return
      }
      console.log(renderTree(nodes).join('\n'))
    } catch (error) {
      fail(error)
    }
  })

// ==================== search ====================

program
  .command('search')
  .description('检索知识库（auto=语义优先，未配置 embedding 自动降级关键词）')
  .argument('[wikiId]', '知识库 ID（不传则在全部知识库内关键词搜索）')
  .argument('<query>', '搜索词')
  .option('-m, --mode <mode>', '检索模式：keyword / semantic / auto', 'auto')
  .option('-n, --limit <n>', '返回条数上限（1-50）', '10')
  .action(async (wikiId, query, opts) => {
    try {
      const result = await search({
        ...(wikiId && { wikiId }),
        q: query,
        mode: opts.mode,
        limit: Number(opts.limit),
      })
      if (jsonMode()) {
        console.log(JSON.stringify(result, null, 2))
        return
      }
      console.log(`检索模式：${result.usedMode}，命中 ${result.items.length} 条`)
      for (const [i, item] of result.items.entries()) {
        const id = item.documentId || item.nodeId || '-'
        const extra = item.score !== undefined ? `（score ${item.score.toFixed(3)}）` : ''
        console.log(`\n${i + 1}. ${item.title ?? '(无标题)'} ${extra}`)
        console.log(`   id: ${id}`)
        if (item.content) console.log(`   ${truncate(item.content, 160)}`)
        if (item.snippet) console.log(`   ${truncate(JSON.stringify(item.snippet), 160)}`)
      }
    } catch (error) {
      fail(error)
    }
  })

// ==================== doc ====================

const doc = program.command('doc').description('文档读写')

doc
  .command('get')
  .description('读取文档正文（Markdown 输出到 stdout 或 -o 文件）')
  .argument('<id>', '文档 ID（--node 时为节点 ID）')
  .option('--node', '按文档树节点 ID 读取（默认按文档 ID）')
  .option('-o, --output <file>', '写入文件（默认输出到 stdout）')
  .action(async (id, opts) => {
    try {
      const view = await getDocument(opts.node ? { nodeId: id } : { documentId: id })
      if (opts.output) {
        await writeFile(resolve(opts.output), view.markdown, 'utf8')
        console.error(`✓ 已保存到 ${resolve(opts.output)}`)
        return
      }
      if (jsonMode()) {
        console.log(JSON.stringify(view, null, 2))
        return
      }
      console.log(view.markdown)
    } catch (error) {
      fail(error)
    }
  })

doc
  .command('create')
  .description('创建文档（markdown 正文；可含 H1，服务端自动提取为标题）')
  .argument('<wikiId>', '知识库 ID')
  .option('-t, --title <title>', '文档标题（缺省取正文首个 H1）')
  .option('-p, --parent <nodeId>', '父节点 ID（缺省挂根目录）')
  .option('-f, --file <path>', 'markdown 文件路径（缺省读 stdin）')
  .action(async (wikiId, opts) => {
    try {
      const markdown = await readMarkdown(opts.file)
      if (!markdown.trim()) throw new Error('文档内容为空')
      const result = await createDocument({
        wikiId,
        markdown,
        ...(opts.title && { title: opts.title }),
        ...(opts.parent && { parentId: opts.parent }),
      })
      if (jsonMode()) {
        console.log(JSON.stringify(result, null, 2))
        return
      }
      console.log(`✓ 已创建「${result.title}」（documentId: ${result.documentId}，${result.wordCount} 字）`)
    } catch (error) {
      fail(error)
    }
  })

doc
  .command('update')
  .description('更新文档正文（后写覆盖；--title 可同步改节点标题）')
  .argument('<id>', '文档 ID（--node 时为节点 ID）')
  .option('--node', '按文档树节点 ID 更新（默认按文档 ID）')
  .option('-t, --title <title>', '同步更新文档标题')
  .option('-f, --file <path>', 'markdown 文件路径（缺省读 stdin）')
  .action(async (id, opts) => {
    try {
      const markdown = await readMarkdown(opts.file)
      if (!markdown.trim()) throw new Error('文档内容为空')
      const result = await updateDocument({
        ...(opts.node ? { nodeId: id } : { documentId: id }),
        markdown,
        ...(opts.title && { title: opts.title }),
      })
      if (jsonMode()) {
        console.log(JSON.stringify(result, null, 2))
        return
      }
      console.log(`✓ 已更新「${result.title}」（${result.wordCount} 字${result.residueCount ? `，${result.residueCount} 处未识别语法已降级保留` : ''}）`)
    } catch (error) {
      fail(error)
    }
  })

// ==================== skills ====================

const skills = program.command('skills').description('Agent Skills（SKILL.md）管理')

skills
  .command('list')
  .description('列出全部技能（每个知识库一条）')
  .action(async () => {
    try {
      const list = await listSkills()
      if (jsonMode()) {
        console.log(JSON.stringify(list, null, 2))
        return
      }
      if (!list.length) {
        console.log('（还没有可用的技能）')
        return
      }
      for (const s of list) {
        console.log(`${s.name}\n  wikiId: ${s.wikiId}\n  ${truncate(s.description, 100)}`)
      }
    } catch (error) {
      fail(error)
    }
  })

skills
  .command('pull')
  .description('下载 SKILL.md 到本地（Agent Skills 目录约定：<out>/<技能名>/SKILL.md）')
  .argument('[wikiId]', '知识库 ID（不传则拉取全部技能）')
  .option('-o, --out <dir>', '输出目录', './skills')
  .action(async (wikiId, opts) => {
    try {
      const targets = wikiId
        ? [{ wikiId, name: (await listSkills()).find((s) => s.wikiId === wikiId)?.name ?? wikiId }]
        : await listSkills()
      if (!targets.length) {
        console.log('（没有可下载的技能）')
        return
      }
      for (const t of targets) {
        const content = await fetchSkillMd(t.wikiId)
        const dir = resolve(opts.out, t.name)
        await mkdir(dir, { recursive: true })
        await writeFile(resolve(dir, 'SKILL.md'), content, 'utf8')
        console.log(`✓ ${t.name} → ${resolve(dir, 'SKILL.md')}`)
      }
    } catch (error) {
      fail(error)
    }
  })

// ==================== mcp ====================

const mcp = program.command('mcp').description('MCP 接入辅助')

mcp
  .command('print')
  .description('打印 MCP 客户端配置片段（含真实令牌，粘贴到 Claude / Cursor / Trae 配置）')
  .action(async () => {
    try {
      console.log(await renderMcpJson())
      console.error('\n# 将上面片段合并到客户端的 MCP 配置（如 ~/.claude/claude_desktop_config.json 的 mcpServers）')
    } catch (error) {
      fail(error)
    }
  })

program.parseAsync(process.argv).catch(fail)
