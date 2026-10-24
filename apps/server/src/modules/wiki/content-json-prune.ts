/**
 * content JSON 未知节点 / 标记剪除（服务端渲染边界）
 *
 * 背景：buildSchemaExtensions 只含「决定 schema 与渲染」的扩展，编辑器交互类
 * 扩展（imageUpload 上传占位等，含 Vue NodeView 依赖）不进服务端 schema。
 * @tiptap/static-renderer 的 renderToHTMLString / renderToMarkdown 遍历 content
 * JSON 时遇 schema 外节点直接抛错（Unknown node type: xxx）→ renderAndSaveHtml
 * 失败仅 warn，content_html 停留旧版（发布/预览页代码块无增强、提示词卡片缺失）。
 *
 * 本模块在渲染入口前递归剪除 schema 外的节点与标记并返回等价 JSON：
 * 发布/预览正文本就不该渲染「上传中」占位等编辑态专属块，剔除即正确语义。
 * 未来再有编辑器专属扩展流入正文，渲染链路静默自愈，不复发。
 */
import type { JSONContent } from '@tiptap/core'
import type { Schema } from '@tiptap/pm/model'

/** 剪除结果：doc 为剪除后的等价 JSON（不原地修改入参），prunedTypes 为被剪类型清单（去重） */
export interface PruneResult {
  doc: JSONContent
  prunedTypes: string[]
}

/**
 * 递归剪除 content JSON 中 schema 外的节点与标记
 * @param content Tiptap JSON（documents.content 形态）
 * @param schema 由 buildSchemaExtensions 构建的 ProseMirror Schema
 */
export function pruneUnknownNodes(content: JSONContent, schema: Schema): PruneResult {
  const pruned = new Set<string>()

  /** 重建单个节点：未知类型返回 null（调用方丢弃），已知类型递归处理子树与 marks */
  const walkNode = (node: JSONContent): JSONContent | null => {
    if (node.type && !schema.nodes[node.type]) {
      pruned.add(node.type)
      return null
    }

    const next: JSONContent = { ...node }

    // marks：text 节点的行内标记，schema 外标记同样会让 static-renderer 抛错
    if (node.marks) {
      const marks = node.marks.filter((mark) => {
        if (schema.marks[mark.type]) return true
        pruned.add(mark.type)
        return false
      })
      if (marks.length !== node.marks.length) next.marks = marks
    }

    if (node.content) {
      const children = node.content.map(walkNode).filter((n): n is JSONContent => n !== null)
      next.content = children
    }

    return next
  }

  const doc = walkNode(content)
  return {
    doc: doc ?? { type: 'doc', content: [] },
    prunedTypes: [...pruned],
  }
}
