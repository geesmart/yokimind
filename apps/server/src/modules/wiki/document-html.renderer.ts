/**
 * 文档 content JSON → HTML 服务端渲染器
 *
 * 背景：pages 公开站 / 预览页正文消费 documents.content_html（预渲染 HTML），
 * 而 local-first 改造后 web 端保存 payload 只含 content JSON（不再带 contentHtml），
 * 服务端拿到 HTML 的唯一途径是自行从 content 渲染。
 *
 * 技术选型：@tiptap/static-renderer 的 renderToHTMLString —— 官方无头渲染 API，
 * 构建 ProseMirror schema 并执行各扩展的 renderHTML，不需要 Editor 实例、
 * 不需要 DOM parser（Node 环境可用）；addProseMirrorPlugins / onUpdate 等运行时
 * 钩子不会执行（本项目未用 UniqueID / TOC 属性注入，无影响）。
 * 已实测：真实扩展清单 + 真实文档 JSON 渲染 ~7ms/篇，产物与编辑器 getHTML 同构。
 *
 * schema 单一来源：直接复用 web 编辑器的扩展工厂 buildSchemaExtensions
 * （apps/web/src/components/notion-editor/editor-extensions.ts），
 * 编辑器增改 schema 扩展时服务端渲染自动跟随，不会漂移。
 * 注意：该 import 链必须保持纯净 —— 只允许 @tiptap/* 官方包与纯逻辑扩展，
 * 不能引入 .vue / Vue 运行时依赖（否则服务端无法加载）。
 */
import { eq } from 'drizzle-orm'
import { renderToHTMLString } from '@tiptap/static-renderer/pm/html-string'
// .js 后缀是 NodeNext 解析惯例（映射到同名 .ts 源文件），tsx / Vite / tsc 全链路兼容
import { buildSchemaExtensions } from '../../../../web/src/components/notion-editor/editor-extensions.js'
import { documents } from '~/db/schema.js'
import { usePostgres } from '~/core/plugins/postgres.js'
import { usePino } from '~/core/plugins/pino.js'

const logger = usePino()

/**
 * 扩展清单模块级缓存：buildSchemaExtensions 只调用一次（构建 schema 有开销，
 * 渲染是高频路径，实例跨请求复用）
 */
const extensions = buildSchemaExtensions()

/**
 * 把文档 content JSON（ProseMirror JSON，documents.content 列的值）渲染为 HTML
 * @param content Tiptap JSON（{ type: 'doc', content: [...] } 形态）
 * @returns 预渲染 HTML 字符串（与编辑器 getHTML 同构）
 * @throws 渲染失败时抛出（未知节点类型 / JSON 结构损坏等），调用方决定兜底策略
 */
export function renderDocumentHtml(content: unknown): string {
  return renderToHTMLString({ extensions, content: content as never })
}

/**
 * 渲染文档 HTML 并单独落库（异步延迟保存的主实现）
 *
 * 调用时机：saveDocument 主更新成功、响应已返回之后（setImmediate 脱离请求上下文），
 * 因此数据库必须用 usePostgres()（全局单例）而非 getDb()（后者依赖 hono
 * context-storage，只在请求作用域内可用，setImmediate 回调中调用会抛 SERVER_ERROR）。
 *
 * 故意只更新 content_html 列：不动 content / updatedAt / contentMd5 / plainText、
 * 不触发 RAG 入队 —— updatedAt 不变是为了与 web 端调和逻辑（服务端 updatedAt 与
 * 本地 savedAt 比较）完全隔离，HTML 补写不构成「服务端内容更新」。
 *
 * 失败策略：仅 warn 不重试 —— 下次保存文档时自然重新渲染；期间公开站显示上一版
 * HTML（saveDocument 已改为「不传 contentHtml 不清空」，不会退化为空态）。
 *
 * @param documentId 文档 ID（documents.id）
 * @param content 文档 content JSON
 */
export async function renderAndSaveHtml(documentId: string, content: unknown): Promise<void> {
  try {
    const html = renderDocumentHtml(content)
    await usePostgres()
      .update(documents)
      .set({ contentHtml: html })
      .where(eq(documents.id, documentId))
  } catch (e) {
    logger.warn({ err: e, documentId }, 'render document html failed')
  }
}
