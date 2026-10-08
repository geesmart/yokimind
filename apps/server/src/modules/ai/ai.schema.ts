import { z } from 'zod'

/**
 * AI 写作支持的动作枚举
 * - improve   改写优化（选中文本整体润色）
 * - fix       修正拼写与语法
 * - extend    扩写（增加篇幅与细节）
 * - reduce    缩写（压缩篇幅）
 * - simplify  简化表达（更易读）
 * - emojify   适当加入 emoji
 * - complete  补全当前句子（只输出补全部分）
 * - continue  续写（只输出新内容，不重复原文）
 * - summarize 总结（选中文本或全文）
 * - translate 翻译成指定语言
 * - tone      以指定语气改写
 * - ask       根据用户指令在光标处生成内容
 * - custom    审核阶段的追加修改（对当前 AI 内容应用新指令）
 */
export const AI_WRITE_ACTIONS = [
  'improve',
  'fix',
  'extend',
  'reduce',
  'simplify',
  'emojify',
  'complete',
  'continue',
  'summarize',
  'translate',
  'tone',
  'ask',
  'custom',
] as const

/** AI 写作动作类型 */
export type AiWriteAction = (typeof AI_WRITE_ACTIONS)[number]

/**
 * AI 写作请求 Schema（POST /ai/write，SSE 流式响应）
 * - text        待处理的原文（改写类动作必传；续写/生成类可省略）
 * - instruction 用户自定义指令（ask / custom 必传，其他动作可省略）
 * - title       文档标题（帮助 AI 理解文章主题，可省略）
 * - sectionTitle  光标所在章节的标题（光标上方最近的标题块，可省略）
 * - sectionLevel  章节标题层级 1-6（与 sectionTitle 成对出现，可省略）
 * - tone        语气名（action=tone 时使用，如 Formal / Casual）
 * - language    目标语言（action=translate 时使用，如 中文 / English）
 * - contextBefore 光标/选区之前的文档上下文（帮助 AI 理解行文，可省略）
 * - contextAfter  光标/选区之后的文档上下文（可省略）
 * - requestId   前端生成的请求唯一标识（用于「停止生成」时中止服务端流）
 */
export const AiWriteSchema = z.object({
  // 写作动作类型
  action: z.enum(AI_WRITE_ACTIONS),
  // 原文内容：去首尾空白后最长 20000 字符（约等于一篇长文档选区）
  text: z.string().max(20000).optional(),
  // 自定义指令：1-2000 字符（ask/custom 时前端保证非空）
  instruction: z.string().trim().max(2000).optional(),
  // 文档标题：帮助 AI 理解整篇文章主题（生成内容贴合标题，不误判主题）
  title: z.string().max(200).optional(),
  // 当前章节标题：光标上方最近的标题块（光标正位于该标题之下编写，
  // 是「聚焦当前章节主题」的信号；空缺时后端章节块自动省略）
  sectionTitle: z.string().max(200).optional(),
  // 章节标题层级 1-6（与 sectionTitle 成对出现，仅用于文案标注「几级标题」）
  sectionLevel: z.number().int().min(1).max(6).optional(),
  // 目标语气名
  tone: z.string().max(50).optional(),
  // 目标语言名
  language: z.string().max(50).optional(),
  // 选区/光标之前的上下文（截断由前端控制，服务端再兜底限长）
  contextBefore: z.string().max(8000).optional(),
  // 选区/光标之后的上下文
  contextAfter: z.string().max(4000).optional(),
  // 请求唯一标识（前端 ULID/UUID，用于 abort）
  requestId: z.string().min(1).max(64).optional(),
})

/**
 * AI 请求中止 Schema（POST /ai/abort）
 * - requestId: 需要中止的请求唯一标识
 */
export const AiAbortSchema = z.object({
  // 需要中止的请求 ID
  requestId: z.string().min(1, 'requestId 不能为空').max(64),
})

/** AI 写作请求参数类型 */
export type AiWrite = z.infer<typeof AiWriteSchema>
/** AI 中止请求参数类型 */
export type AiAbort = z.infer<typeof AiAbortSchema>
