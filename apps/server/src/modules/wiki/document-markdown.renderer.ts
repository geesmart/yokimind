import type { JSONContent } from '@tiptap/core'
import type { Schema } from '@tiptap/pm/model'
import { getSchemaByResolvedExtensions, flattenExtensions, getText } from '@tiptap/core'
import { MarkdownManager } from '@tiptap/markdown'
import { renderToMarkdown } from '@tiptap/static-renderer'
import { buildSchemaExtensions } from '../../../../web/src/components/notion-editor/editor-extensions.js'
import {
  normalizeMarkdownJson,
  buildMarkMeta,
  normalizeMarkdownSource,
} from '../../../../web/src/components/notion-editor/utils/normalize-markdown-json.js'
import { detectUnsupportedResidue } from '../../../../web/src/components/notion-editor/utils/detect-unsupported-syntax.js'
import { BizException } from '~/core/lib/biz.exception.js'
import { ErrorCode } from '~/config/error-code.js'
import { usePino } from '~/core/plugins/pino.js'
import { pruneUnknownNodes } from './content-json-prune.js'

/**
 * 文档 Markdown 渲染层（智能体接入层专用）
 * - 读方向：Tiptap JSON → Markdown（renderToMarkdown），供 MCP/CLI 的 read_document 直接返回
 * - 写方向：Markdown → Tiptap JSON（MarkdownManager 独立解析管线），供 create/update_document 落库
 * 与 web 端粘贴导入（markdown-import.ts）同一套 normalize 修正链，保证落库 JSON 可被编辑器正常打开
 */

// 模块级缓存：extensions 与 schema 构建开销大且无状态，进程内复用
// （与 document-html.renderer.ts 的 buildSchemaExtensions 缓存同款约定）
const rawExtensions = buildSchemaExtensions()
// 注意：splitExtensions 不展开 StarterKit 等组合扩展的子扩展，
// Editor 内部构建 schema 前会 flattenExtensions；独立管线必须自行展平
const flatExtensions = flattenExtensions(rawExtensions)
// 无 DOM 依赖：ProseMirror Schema 构造纯 JS（此前误用 headless Editor 会踩 window 依赖）
const documentSchema: Schema = getSchemaByResolvedExtensions(flatExtensions)
const markdownManager = new MarkdownManager({ extensions: flatExtensions })

const logger = usePino()

/**
 * Tiptap JSON → Markdown
 * @param content documents.content（Tiptap JSON）
 */
export function tiptapJsonToMarkdown(content: JSONContent): string {
  // 剪除 schema 外的编辑器专属节点 / 标记（如 imageUpload 上传占位）——
  // renderToMarkdown 遇 schema 外节点直接抛错（与 HTML 渲染器同源缺陷）
  const { doc, prunedTypes } = pruneUnknownNodes(content, documentSchema)
  if (prunedTypes.length > 0) {
    logger.warn({ prunedTypes }, 'prune unknown nodes before markdown render')
  }
  return renderToMarkdown({ content: doc, extensions: rawExtensions })
}

/** Markdown 解析结果 */
export interface ParsedMarkdownDoc {
  /** 规范化后的 Tiptap JSON（可直接落 documents.content） */
  content: JSONContent
  /** 从首个 H1 提取的标题（仅当正文以 H1 开头时存在） */
  title?: string
  /** 字数（与编辑器同口径：getText 全文本长度） */
  wordCount: number
  /** normalize 后残留的未支持语法节点数（>0 表示有有损转换，仅告警用） */
  residueCount: number
}

/** 标题最长 100 字符（与 CreateWikiNodeSchema 对齐） */
const TITLE_MAX_LENGTH = 100

/**
 * 从文档 JSON 顶部提取首个 H1 作为标题，并从内容中移除该标题节点
 * （web 端导入管线的同款行为：H1 消费进 wikiNodes.title，正文不再重复显示大标题）
 */
function extractH1Title(content: JSONContent[]): { title?: string; remaining: JSONContent[] } {
  const first = content[0]
  if (first && first.type === 'heading' && first.attrs?.level === 1) {
    const text = (first.content ?? [])
      .map((node: JSONContent) => node.text ?? '')
      .join('')
      .trim()
    const title = text.slice(0, TITLE_MAX_LENGTH) || undefined
    return { title, remaining: content.slice(1) }
  }
  return { remaining: content }
}

/**
 * Markdown → Tiptap JSON（写方向入口）
 * 管线：normalizeMarkdownSource（预清洗）→ MarkdownManager.parse → normalizeMarkdownJson
 * （marks 顺序修正 / emoji 短代码 / 行内图片提升）→ H1 提取 → 字数统计
 * @throws Markdown 结构非法时抛出（调用方转为工具级错误）
 */
export function markdownToDocument(markdown: string): ParsedMarkdownDoc {
  const source = normalizeMarkdownSource(markdown)
  const parsed = markdownManager.parse(source)
  if (!parsed) {
    throw new BizException(ErrorCode.INVALID_REQUEST, 'Markdown 解析结果为空')
  }
  const normalized = normalizeMarkdownJson(parsed, buildMarkMeta(documentSchema))

  // 残留未支持语法统计（表格/任务列表等扩展语法的有损提示，与 web 导入一致不阻断）
  const residueCount = detectUnsupportedResidue(normalized.content ?? []).length

  // H1 提取为标题（与 web 端创建文档行为一致）
  const rawContent: JSONContent[] = Array.isArray(normalized.content) ? normalized.content : []
  const { title, remaining } = extractH1Title(rawContent)
  const docJson: JSONContent = { ...normalized, content: remaining.length > 0 ? remaining : [{ type: 'paragraph' }] }

  // 字数口径与编辑器 editor.getText() 一致：经 ProseMirror 文档模型取全文本
  const docNode = documentSchema.nodeFromJSON(docJson)
  const wordCount = getText(docNode).length

  return { content: docJson, title, wordCount, residueCount }
}
