/**
 * 「问问 YOKI AI」回答的 Markdown 渲染管线（tiptap 生态，纯函数模块，无 Vue 运行时）
 *
 * 自 apps/pages 的 chat-markdown.ts 整体移植（两端的 @tiptap/* 版本已对齐 3.31.x），
 * 供知识库侧边栏「问问 YOKI AI」弹窗（yoki-ai-dialog.vue）渲染流式回答使用。
 *
 * 渲染链路：markdown 源文本
 *   → MarkdownManager.parse（@tiptap/markdown，headless 解析器，底层 marked + GFM）
 *   → JSON 后处理：把 text 节点中的 [n] 引用标注拆为 citation mark（蓝色上标）
 *   → renderToHTMLString（@tiptap/static-renderer，纯函数渲染，无 ProseMirror DOM）
 *   → HTML 字符串（气泡内 v-html 注入）
 *
 * XSS 防线：
 * - HTML 全部由 schema 的 renderHTML 产出，text 节点内容自动转义
 * - Link 走 StarterKit 默认协议限制（http/https/mailto，javascript: 被拒绝）
 * - parse 抛异常（流式半截语法等）时降级为「转义纯文本 + <br>」，绝不注入未转义内容
 */
import { Mark, mergeAttributes, type JSONContent } from '@tiptap/core'
import { StarterKit } from '@tiptap/starter-kit'
import { TableKit } from '@tiptap/extension-table'
import { MarkdownManager } from '@tiptap/markdown'
import { renderToHTMLString } from '@tiptap/static-renderer/pm/html-string'

// ==================== 扩展集合（schema 单一来源，parse 与 render 必须同一份） ====================

/**
 * 自定义引用标注 mark：[n] 来源角标
 * - 仅用于渲染侧（JSON 后处理注入），不参与 markdown 解析/序列化
 * - renderHTML 输出 <sup data-citation>，蓝色上标样式由气泡容器 scoped CSS 提供
 */
const Citation = Mark.create({
  name: 'citation',
  renderHTML({ HTMLAttributes }) {
    return ['sup', mergeAttributes(HTMLAttributes, { 'data-citation': '' }), 0]
  },
})

/** 问答气泡的 schema 扩展集合：基础文档结构 + GFM 表格 + 引用角标 */
const chatExtensions = [StarterKit.configure({}), TableKit, Citation]

/** MarkdownManager 模块级单例（headless 可脱离 editor 实例化，构造开销只需一次） */
let manager: MarkdownManager | null = null
function getManager(): MarkdownManager {
  if (!manager) {
    manager = new MarkdownManager({ extensions: chatExtensions })
  }
  return manager
}

// ==================== [n] 引用标注拆分（JSON 后处理） ====================

/** 引用标注形态：[1]、[2] ……（与 system prompt 约束的输出格式一致） */
const CITATION_SPLIT_RE = /(\[\d+\])/g
const CITATION_EXACT_RE = /^\[\d+\]$/

/**
 * 递归遍历 doc JSON，把 text 节点内的 [n] 拆为 text + citation mark 序列
 * - codeBlock 子树与带 code mark 的文本保持字面（代码示例里的 arr[1] 不误转）
 * - 非 text 文本片段继承原 marks（粗体/斜体/链接内的角标同样生效）
 */
function splitCitationsInDoc(node: JSONContent): JSONContent {
  // codeBlock 子树整体跳过（内容是代码示例，[n] 是字面数组下标）
  if (node.type === 'codeBlock') return node

  // text 节点：拆 [n]（带 code mark 的跳过）
  if (node.type === 'text' && typeof node.text === 'string') {
    const marks = node.marks ?? []
    if (marks.some((m) => m.type === 'code') || !CITATION_SPLIT_RE.test(node.text)) {
      return node
    }
    // test 后 lastIndex 已推进，重置避免下次 split 漏配（或直接用字符串重建）
    CITATION_SPLIT_RE.lastIndex = 0
    const parts = node.text.split(CITATION_SPLIT_RE).filter(Boolean)
    if (parts.length === 1) return node
    const children: JSONContent[] = parts.map((part) => {
      if (CITATION_EXACT_RE.test(part)) {
        // 引用角标：citation mark 追加在原 marks 之后（同色叠加场景极罕见）
        return { type: 'text', text: part, marks: [...marks, { type: 'citation' }] }
      }
      // 普通文本片段：继承原 marks（浅拷贝避免多节点共享同一数组引用）
      return { type: 'text', text: part, marks: marks.length ? [...marks] : undefined }
    })
    // 拆分产物通过父级 content 展开（text 节点不能有 content，借 fragment 标记交给父级展平）
    return { type: '__frag', content: children }
  }

  // 容器节点：递归处理子内容并展平 fragment
  if (Array.isArray(node.content)) {
    const flattened: JSONContent[] = []
    for (const child of node.content) {
      const processed = splitCitationsInDoc(child)
      if (processed.type === '__frag' && Array.isArray(processed.content)) {
        flattened.push(...processed.content)
      } else {
        flattened.push(processed)
      }
    }
    return { ...node, content: flattened }
  }
  return node
}

// ==================== 降级渲染（parse/渲染异常时） ====================

/** HTML 转义（降级路径的唯一防线：绝不让源文本以未转义形态进入 v-html） */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** 降级渲染：转义纯文本 + 换行转 <br>（保留 [n] 字面，样式由容器统一控制） */
function escapeFallback(content: string): string {
  return escapeHtml(content).replace(/\n/g, '<br>')
}

// ==================== 对外入口 ====================

/**
 * 把 AI 回答的 markdown 文本渲染为可安全注入 v-html 的 HTML 字符串
 *
 * @param content 回答文本（SSE delta 顺序拼接产物；可为流式中的半截 markdown）
 * @returns HTML 字符串；空文本返回 ''；解析/渲染异常时降级为转义纯文本
 */
export function renderChatMarkdown(content: string): string {
  if (!content) return ''
  try {
    const parsed = getManager().parse(content)
    const processed = splitCitationsInDoc(parsed)
    return renderToHTMLString({ content: processed, extensions: chatExtensions })
  } catch {
    // 流式半截语法（未闭合的 ** / 表格行）等解析异常：降级纯文本，下次节流重渲自动恢复
    return escapeFallback(content)
  }
}
