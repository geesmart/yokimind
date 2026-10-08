/**
 * AI 写作状态机（notion-editor 专用 composable，模块级单例）
 *
 * 实现 Notion 风格的 AI 写作流（浮窗预览模式）：
 * 1. 触发：选中文字走 BubbleMenu「Improve」菜单（replace 模式，完成后替换选区），
 *    或斜杠命令「继续写作 / Ask AI」（insert 模式，完成后在光标处插入）
 * 2. 流式：AI 返回的 Markdown 增量只累积进 aiState.markdown 缓冲区，由浮窗组件
 *    （ai-writing-bar）用只读 tiptap 编辑器实例节流渲染预览 —— 文档全程不被修改，
 *    编辑器保持可编辑，用户可继续编写（目标范围靠事务映射防漂移）；
 *    reasoning 模型的思考过程增量累积进 aiState.thinking，浮窗以弱化样式流式展示，
 *    正文开始后折叠为「已思考」可回看 —— 避免「漫长思考期浮窗无内容流出」的观感
 * 3. 审核：生成完成后进入 review 阶段，浮窗提供「重新生成 / 关闭 / 完成」与追加指令输入；
 *    点「完成」才把 Markdown 一次性解析为真实文档结构写入文档（addToHistory: false），
 *    点「关闭」直接结束会话，文档零改动，无需任何回滚
 *
 * 事务约定：
 * - 「完成」的写入事务 addToHistory: false，撤销历史不收录 AI 内容，
 *   配合编辑器左上角「删除 / 恢复 AI 内容」按钮（aiAppliedState 快照）使用
 * - PM 对象（Slice/Node）绝不放入 reactive 状态（Proxy 化会破坏 PM 内部操作），
 *   用模块级普通变量保存
 *
 * 用法（模块级单例，同一页面同一时刻只有一个编辑器实例使用）：
 *   import { aiState, startAiReplace, ... } from '@/composables/useAiWriting'
 */
import { computed, shallowReactive } from 'vue'
import type { Editor, JSONContent } from '@tiptap/core'
import type { Slice } from '@tiptap/pm/model'
import type { Transaction } from '@tiptap/pm/state'
import { canJoin } from '@tiptap/pm/transform'
import { toast } from 'vue-sonner'
import { streamAiWrite, abortAiWrite, getAiStatus, type AiWriteParams } from '@/api/modules/ai'
import {
  normalizeMarkdownJson,
  normalizeMarkdownSource,
} from '@/components/notion-editor/utils/normalize-markdown-json'
import { ApiError } from '@/api/request'

/** 后端业务码：AI 服务未配置（error-code.ts RAG_NOT_CONFIGURED） */
const AI_NOT_CONFIGURED_CODE = 80001

/** /ai/status 前置检查超时（ms）：状态检查只是 UX 优化而非硬依赖，超时按检查失败
 * fail-open 放行（交给 /ai/write 既有错误链路兜底），避免慢网/服务挂起时点击长时间无响应 */
const STATUS_CHECK_TIMEOUT = 8000

/** 流式连接看门狗超时（ms）：进入 streaming 后迟迟收不到任何 SSE 事件（fetch 本身无超时，
 * 连接挂起会让浮窗永远停在「AI正在写作」），超时即本地中止并提示错误 */
const AI_CONNECT_TIMEOUT = 30000

/**
 * 给 Promise 加超时：超时以 Error reject（不取消原 Promise，仅不再等待其结果），
 * 用于 /ai/status 前置检查的快速失败
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      }
    )
  })
}

/** 会话阶段：prompt（输入指令）→ streaming（AI 写作中）→ review（审核结果） */
export type AiPhase = 'idle' | 'prompt' | 'streaming' | 'review'

/** AI 写作动作类型（与后端 AI_WRITE_ACTIONS 对齐） */
export type AiAction = AiWriteParams['action']

/**
 * AI 写作响应式状态（供浮条 / BubbleMenu / 斜杠菜单读取）
 * 注意：
 * - 只放原始值，PM 对象一律放模块级普通变量
 * - 必须用 shallowReactive 而非 reactive：reactive 的 UnwrapRef 会把
 *   tiptap Editor（带私有字段的类实例）展开成结构化类型，丢失私有字段
 *   声明导致后续传参不 assignable 给 Editor/Transaction（TS 大量报错）；
 *   shallowReactive 只追踪顶层属性（本状态全部是顶层读写），类型保持原样
 */
export const aiState = shallowReactive({
  /** 绑定的编辑器实例 */
  editor: null as Editor | null,
  /** 当前阶段 */
  phase: 'idle' as AiPhase,
  /** 当前动作 */
  action: 'improve' as AiAction,
  /** 动作展示名（日志/调试用） */
  label: '',
  /** prompt 阶段的模式：insert=光标处插入，replace=替换选区 */
  promptMode: 'insert' as 'insert' | 'replace',
  /** AI 内容起始位置（浮条锚点） */
  from: 0,
  /** AI 内容当前结束位置（流式增长，浮条跟随） */
  to: 0,
  /** 已生成的完整 Markdown（流式节流渲染的解析源） */
  markdown: '',
  /** 模型思考过程（reasoning 模型的 thinking 增量，浮窗流式展示；非 reasoning 模型为空） */
  thinking: '',
  /**
   * 提交连接中（prompt 阶段点击发送/回车后的 /ai/status 前置检查期间）：
   * 浮条发送按钮据此转 spinner 并禁用 —— 点击必有可见反馈，且拦截重复提交；
   * 无论检查结果如何（弹引导框 / 放行进入生成 / 异常退出）都会复位
   */
  connecting: false,
})

/** 是否处于 AI 会话中（BubbleMenu 等据此隐藏） */
export const isAiBusy = computed(() => aiState.phase !== 'idle')

/**
 * 「AI 尚未配置」引导弹窗状态（模块级单例，由 ai-writing-bar 渲染）
 *
 * 出现时机：
 * - prompt 输入框回车/点发送时，前置 /ai/status 检查返回 chatReady=false
 * - /ai/write 流前业务异常 80001（BubbleMenu 直接改写入口、或配置在途中被清空的兜底）
 */
export const aiConfigDialog = shallowReactive({
  /** 弹窗是否可见 */
  visible: false,
})

/** 打开「AI 尚未配置」引导弹窗 */
function openAiConfigDialog() {
  aiConfigDialog.visible = true
}

/** 关闭「AI 尚未配置」引导弹窗（取消 / 遮罩 / 跳转按钮触发） */
export function closeAiConfigDialog() {
  aiConfigDialog.visible = false
}

/**
 * 「AI 配置」弹窗状态（模块级单例，由当前 AI 会话的 ai-writing-bar 渲染）
 *
 * 与 aiConfigDialog 的区别：
 * - aiConfigDialog 是「AI 尚未配置」的说明性 AlertDialog；
 * - aiSettingsDialog 是真正的配置表单弹窗（AiSettingsModal，与 /admin 同能力），
 *   点 AlertDialog 的「去配置」后原地打开，无需跳转 AI 大模型管理页。
 * 渲染方仍需用 aiState.editor === props.editor 约束，避免多编辑器实例重复挂载。
 */
export const aiSettingsDialog = shallowReactive({
  /** 配置弹窗是否可见 */
  visible: false,
})

/** 打开「AI 配置」弹窗 */
export function openAiSettingsDialog() {
  aiSettingsDialog.visible = true
}

/** 关闭「AI 配置」弹窗（Esc / 遮罩 / 保存就绪后自动关闭） */
export function closeAiSettingsDialog() {
  aiSettingsDialog.visible = false
}

/**
 * 已应用 AI 内容的快照状态（编辑器左上角「删除 / 恢复 AI 内容」按钮）
 *
 * 背景：AI 相关事务均 addToHistory:false，内容应用后 Cmd+Z 撤不掉 AI 部分，
 * 这里在「应用」时刻单独保存会话快照，支持把 AI 内容换回原文（删除），
 * 或把已删除的 AI 内容重新插回（恢复），两种状态可反复切换
 */
export const aiAppliedState = shallowReactive({
  /** 是否存在可用的已应用快照（控制按钮显隐） */
  available: false,
  /** AI 内容当前是否在文档中：true=可删除；false=已删除可恢复 */
  present: false,
  /** 快照区域起始位置（随用户编辑经事务映射持续校正，见 handleAppliedTracker） */
  from: 0,
  /** 快照区域结束位置：present 时为 AI 内容末尾，删除后为原文末尾 */
  to: 0,
})

/* ========== 模块级普通变量（PM 对象 / 控制器，不进 reactive） ========== */

/** 本会话的撤销基准：AI 开始前的原始内容切片（insert 模式为 null = 删除 AI 内容即恢复） */
let baselineSlice: Slice | null = null
/** 是否已有基线（首次生成时捕获，追加修改不覆盖） */
let hasBaseline = false
/** 会话首次生成的参数（Try again 重试用） */
let lastRun:
  | {
      action: AiAction
      mode: 'insert' | 'replace'
      instruction?: string
      tone?: string
      language?: string
      label: string
    }
  | null = null
/** prompt 阶段暂存的选区（打开输入框时捕获，提交时使用） */
let pendingRange: { from: number; to: number } | null = null
/** 当前流式请求的本地中止控制器 */
let abortController: AbortController | null = null
/** 当前流式请求的服务端请求 ID（停止生成时通知服务端中止） */
let activeRequestId = ''
/** 最近一次错误消息（finishGeneration 决定是否提示） */
let errorMessage = ''
/** 配置状态前置检查进行中标记（防同一次回车/点击重复发 /ai/status） */
let checkingConfig = false

/**
 * 当前文档标题（AI 写作上下文的主题信号，由 notion-editor 组件实时同步）。
 * 模块级普通变量而非 aiState：标题属于环境信息不属于会话状态，无需触发浮窗重渲染；
 * 编辑器挂载/换文档时经 setAiDocTitle 更新，runGeneration 组装请求参数时读取
 */
let aiDocTitle = ''

/**
 * 同步文档标题给 AI 写作模块（notion-editor 组件在标题变化时调用）。
 * 独立导出而非放进 aiState：composable 是模块级单例且只拿到 Editor 实例，
 * 标题属于编辑器组件的 props 状态，必须由组件显式推送给本模块
 */
export function setAiDocTitle(title: string) {
  aiDocTitle = title
}

/* ========== 已应用 AI 内容的删除/恢复（编辑器左上角按钮，PM 对象不进 reactive） ========== */

/** 已应用的 AI 内容切片（应用时刻捕获，恢复时整段重新插入） */
let appliedAiSlice: Slice | null = null
/** 会话前原文切片（replace 模式才有；insert 模式为 null，删除即直接移除 AI 内容） */
let appliedBaselineSlice: Slice | null = null
/** 快照位置追踪已绑定的编辑器（同一编辑器只绑一次，幂等） */
let appliedTrackerEditor: Editor | null = null

/** 生成一次请求唯一标识（用于服务端中止） */
function genRequestId(): string {
  return `ai-write-${crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`
}

/** 重置会话状态（不影响文档内容） */
function resetSession() {
  aiState.phase = 'idle'
  aiState.action = 'improve'
  aiState.label = ''
  aiState.markdown = ''
  aiState.thinking = ''
  aiState.from = 0
  aiState.to = 0
  aiState.connecting = false
  baselineSlice = null
  hasBaseline = false
  lastRun = null
  pendingRange = null
  abortController = null
  activeRequestId = ''
  errorMessage = ''
  // editor 引用保留（浮窗组件仍绑定同一编辑器）
}

/* ========== 文档操作辅助 ========== */

/**
 * 截取文档文本片段（块级节点用换行连接）
 */
function docTextBetween(ed: Editor, from: number, to: number): string {
  try {
    return ed.state.doc.textBetween(from, to, '\n', '\n')
  } catch {
    return ''
  }
}

/**
 * 尾部截断：保留末尾 max 字符，并把截断切出的残行开头丢到下一个换行。
 * 上下文是带 Markdown 记号的文本，若在行中间切断，首行的 # 记号会被切丢
 * （如「## 标题」剩半行变「标题」），AI 反而误读结构；整行对齐后无此问题
 */
function clipTail(s: string, max: number): string {
  if (s.length <= max) return s
  const cut = s.slice(-max)
  const nl = cut.indexOf('\n')
  return nl === -1 ? cut : cut.slice(nl + 1)
}

/**
 * 头部截断：保留开头 max 字符，残行只保留到行尾（与 clipTail 同理，保护末行记号完整）
 */
function clipHead(s: string, max: number): string {
  if (s.length <= max) return s
  const cut = s.slice(0, max)
  const nl = cut.lastIndexOf('\n')
  return nl === -1 ? cut : cut.slice(0, nl)
}

/**
 * 把文档 [start, end) 区间序列化为带结构标记的 Markdown。
 *
 * 之前用 doc.textBetween 输出纯文本，标题行与正文行在 AI 眼里毫无区别，
 * AI 无法从上下文推断「当前正写在哪个标题章节下」；改用编辑器自带的
 * markdown 序列化器（@tiptap/markdown 的 manager.serialize，与 getMarkdown
 * 同一条管线）后，上下文中的标题自带 # 记号，AI 可直接读懂文档结构。
 *
 * 复用编辑器序列化器而非手写块级拼接：预览/落盘/上下文三处同源，
 * 不会出现「AI 看到的结构」与「真实文档结构」不一致的双实现风险
 */
function docMarkdownBetween(ed: Editor, start: number, end: number): string {
  try {
    const doc = ed.state.doc
    if (end <= start) return ''
    // doc-wrapped JSON 是 serialize 的标准输入形态（getMarkdown 即如此），
    // 直接传节点数组虽然运行时也支持，但类型签名只收单个 JSONContent
    const json = doc.slice(start, end).content.toJSON()
    if (!json.length) return ''
    return ed.markdown ? ed.markdown.serialize({ type: 'doc', content: json }) : ''
  } catch {
    return ''
  }
}

/**
 * 光标之前的上下文：起点对齐到所在块的起始边界（起始块完整，# 记号不被切断），
 * 终点保留光标位置原值 —— 光标当前行内、光标之前的那半句要进上下文
 * （补全句子动作靠它看到「未写完的句子前半段」）
 */
function docMarkdownBefore(ed: Editor, from: number, to: number): string {
  try {
    const $from = ed.state.doc.resolve(from)
    const start = $from.depth === 0 ? $from.pos : $from.before(1)
    return docMarkdownBetween(ed, start, to)
  } catch {
    return ''
  }
}

/**
 * 光标之后的上下文：终点对齐到所在块的结束边界（末尾块完整），
 * 起点保留光标位置原值 —— 光标当前行内、光标之后的那半句要进上下文
 */
function docMarkdownAfter(ed: Editor, from: number, to: number): string {
  try {
    const doc = ed.state.doc
    const $to = doc.resolve(to)
    const end = $to.depth === 0 ? $to.pos : $to.after(1)
    return docMarkdownBetween(ed, from, Math.min(end, doc.content.size))
  } catch {
    return ''
  }
}

/**
 * 构建上下文：光标/选区前后各截取一段带 Markdown 结构标记的文本（后端 prompt 拼装用）。
 * 位置窗口（前 6000 / 后 3000）与字符上限（前 8000 / 后 4000，与后端 schema 限制一致）沿用旧约定
 */
function buildContext(ed: Editor, from: number, to: number) {
  const docSize = ed.state.doc.content.size
  return {
    contextBefore: clipTail(docMarkdownBefore(ed, Math.max(0, from - 6000), from), 8000),
    contextAfter: clipHead(docMarkdownAfter(ed, to, Math.min(docSize, to + 3000)), 4000),
  }
}

/**
 * 当前光标所在的章节标题：光标/选区上方最近的一个标题块（顶层）。
 *
 * 这是「AI 知道自己在哪个模块下编写」的关键信号：光标在某个标题下方的空行/段落时，
 * 该标题就是当前编写的章节主题（如 H1「什么是YOKI文档?」下的空行唤起 AI，
 * 生成内容应围绕这个标题展开，而不是围绕整篇文档标题）。
 * 服务端会把它单独组装成 <section_title> 块（主题优先级仅次于文档标题）
 */
function findCurrentSection(ed: Editor, pos: number): { level: number; title: string } | null {
  try {
    let section: { level: number; title: string } | null = null
    ed.state.doc.forEach((node, offset) => {
      if (node.type.name !== 'heading') return
      // 标题块整体在 pos 之前（含「pos 恰在标题块结束边界」）→ 候选章节；
      // 之后遍历到的更近标题会覆盖前面的，循环结束即得「最近的标题」
      if (offset + node.nodeSize <= pos) {
        const title = node.textContent.trim()
        if (title) section = { level: Number(node.attrs.level) || 1, title }
      }
    })
    return section
  } catch {
    return null
  }
}

/* ========== 流式增量缓冲（渲染交给浮窗组件，文档不写） ========== */

/**
 * 追加一段流式增量：只累积进 Markdown 缓冲区。
 * 浮窗预览由 ai-writing-bar 监听 aiState.markdown 节流渲染（只读 tiptap 实例），
 * 文档写入延迟到「完成」时一次性完成 —— 生成期间文档保持原样
 */
function appendDelta(delta: string) {
  if (!delta) return
  aiState.markdown += delta
}

/**
 * 追加一段思考过程增量（reasoning 模型）：只累积进 thinking 缓冲区。
 * 浮窗在思考阶段流式展示该内容（弱化样式），正文开始后折叠为「已思考」可回看，
 * 让「点击启动 → 正文出现」之间的漫长思考期也有内容持续流出
 */
function appendThinking(delta: string) {
  if (!delta) return
  aiState.thinking += delta
}

/**
 * 取光标所在「顶层块之后」的边界位置（doc 的直接子块结束处）。
 *
 * 「完成」用 insertContentAt + updateSelection 插入后，光标停在最后一个插入块内部
 * （如标题文字末尾），不能直接作为 AI 内容范围终点：以块内位置为终点会让快照范围
 * 缺一块尾部，且后续整段替换会留下最后一块的空壳。用顶层块边界（$pos.after(1)）
 * 做终点，范围始终落在块与块的交界处，类型不被污染
 */
function blockBoundaryAfterSelection(ed: Editor): number {
  try {
    const $pos = ed.state.doc.resolve(ed.state.selection.to)
    // depth 0 = 光标已在顶层块之间（纯边界），直接用；否则取顶层块结束后的位置
    return $pos.depth === 0 ? $pos.pos : $pos.after(1)
  } catch {
    return ed.state.selection.to
  }
}

/* ========== 已应用内容的位置追踪 ========== */

/**
 * 事务监听：把快照范围（与会话范围）映射过后续所有文档变更，
 * 处理「生成期间 / 进入 review / 应用后用户继续编辑」导致的位置漂移
 *
 * - 快照范围（aiAppliedState.from/to）：available 期间始终映射，
 *   保证删除/恢复始终作用于正确区域
 * - 会话范围（aiState.from/to）：浮窗预览模式下文档全程不被 AI 修改、编辑器不锁定，
 *   用户在 streaming / review 阶段都可能增删内容；不映射会让「完成」的
 *   插入/替换目标与快照捕获作用到错误位置
 * - mapping.map 对 from 用 assoc -1（贴住变更点前方）、to 用默认 assoc：
 *   用户手动替换掉区域内内容时，范围保持包住「新内容」而不是塌到插入点之后
 */
function handleAppliedTracker({ transaction }: { transaction: Transaction }) {
  if (!transaction.docChanged) return
  if (
    (aiState.phase === 'streaming' || aiState.phase === 'review') &&
    appliedTrackerEditor &&
    aiState.editor === appliedTrackerEditor
  ) {
    aiState.from = transaction.mapping.map(aiState.from, -1)
    aiState.to = Math.max(transaction.mapping.map(aiState.to), aiState.from)
  }
  if (aiAppliedState.available) {
    aiAppliedState.from = transaction.mapping.map(aiAppliedState.from, -1)
    aiAppliedState.to = Math.max(transaction.mapping.map(aiAppliedState.to), aiAppliedState.from)
  }
}

/** 绑定快照/会话位置追踪（会话开始时调用；同一编辑器幂等） */
function bindAppliedTracker(ed: Editor) {
  if (appliedTrackerEditor === ed) return
  unbindAppliedTracker()
  appliedTrackerEditor = ed
  ed.on('transaction', handleAppliedTracker)
}

/** 解绑位置追踪（编辑器销毁 / 页面切换时调用） */
function unbindAppliedTracker() {
  if (!appliedTrackerEditor) return
  try {
    appliedTrackerEditor.off('transaction', handleAppliedTracker)
  } catch {
    /* ignore */
  }
  appliedTrackerEditor = null
}

/**
 * 结束一次生成：根据结果进入 review 或静默结束会话。
 * 浮窗预览模式下文档未被修改，无需任何回滚/恢复操作
 */
function finishGeneration() {
  if (!aiState.editor) {
    aiState.phase = 'idle'
    return
  }
  if (!aiState.markdown.trim()) {
    // 没有生成任何内容：文档未动，直接结束会话并提示
    const msg = errorMessage
    resetSession()
    if (msg) toast.error(msg || 'AI 生成失败，请稍后重试')
    return
  }
  // 有内容：进入审核阶段（内容仅存在于浮窗预览，待用户「完成 / 关闭」）
  aiState.phase = 'review'
}

/* ========== 核心流程 ========== */

/**
 * 运行一次生成（会话内可多次：首次生成 / Try again / 追加指令）
 *
 * @param opts.action 动作类型
 * @param opts.mode replace=替换选区内容；insert=在光标处插入
 * @param opts.instruction 自定义指令（ask / custom）
 * @param opts.explicitRange 显式指定范围（prompt 阶段打开时捕获的选区），缺省读当前选区
 * @param opts.keepBaseline true=不覆盖会话基线（追加修改场景）
 */
async function runGeneration(opts: {
  action: AiAction
  mode: 'insert' | 'replace'
  instruction?: string
  tone?: string
  language?: string
  label?: string
  explicitRange?: { from: number; to: number } | null
  keepBaseline?: boolean
}) {
  const ed = aiState.editor
  if (!ed || aiState.phase === 'streaming') return

  // 绑定位置追踪：review / 应用后用户编辑会移动文档位置，
  // 事务映射保证丢弃、应用捕获与快照删除恢复始终作用于正确区域（同编辑器幂等）
  bindAppliedTracker(ed)

  const sel = ed.state.selection
  const range =
    opts.explicitRange ??
    (opts.mode === 'replace' ? { from: sel.from, to: sel.to } : { from: sel.to, to: sel.to })

  // replace 模式要求有真实范围（防止选区丢失后把空范围当替换目标）。
  // 显式传入的范围（retry / 追加修改）不做此限制：insert 会话的目标就是零宽光标点
  if (opts.mode === 'replace' && !opts.explicitRange && range.to <= range.from) {
    toast.error('请先选中要处理的内容')
    return
  }

  // —— 捕获会话基线（仅首次；追加修改保持原基线，供应用后「删除 AI 内容」恢复原文）——
  if (!opts.keepBaseline && !hasBaseline) {
    baselineSlice = opts.mode === 'replace' ? ed.state.doc.slice(range.from, range.to) : null
    hasBaseline = true
  }

  // —— 记录首跑参数（Try again 重试用）——
  if (!lastRun) {
    lastRun = {
      action: opts.action,
      mode: opts.mode,
      instruction: opts.instruction,
      tone: opts.tone,
      language: opts.language,
      label: opts.label ?? '',
    }
  }

  // —— 组装请求参数 ——
  // replace 模式：text = 选区原文；insert 模式：text 为空，靠上下文续写/生成
  const text =
    opts.action === 'custom'
      ? aiState.markdown // 追加修改：原文是当前 AI 内容
      : opts.mode === 'replace'
        ? docTextBetween(ed, range.from, range.to)
        : undefined
  const { contextBefore, contextAfter } = buildContext(ed, range.from, range.to)
  // 当前章节标题：光标/选区上方最近的标题块，让 AI 知道「正在哪个标题章节下编写」
  const section = findCurrentSection(ed, range.from)

  // —— 进入流式阶段 ——
  // 浮窗预览模式：不删原文、不锁编辑器，目标范围固定为捕获范围
  // （insert = 零宽光标点），流式期间随用户编辑由事务映射持续校正
  aiState.action = opts.action
  aiState.label = opts.label ?? ''
  aiState.phase = 'streaming'
  aiState.from = range.from
  aiState.to = Math.max(range.to, range.from)
  aiState.markdown = ''
  aiState.thinking = ''

  abortController = new AbortController()
  activeRequestId = genRequestId()
  const requestId = activeRequestId
  const params: AiWriteParams = {
    action: opts.action,
    text: text || undefined,
    instruction: opts.instruction || undefined,
    // 文档标题：AI 理解主题的最高优先级信号（空标题不传，后端标题块自动省略）
    title: aiDocTitle.trim() || undefined,
    // 当前章节标题+层级：光标正位于该标题之下（成对传，后端章节块自动省略）
    sectionTitle: section?.title,
    sectionLevel: section?.level,
    tone: opts.tone,
    language: opts.language,
    contextBefore: contextBefore || undefined,
    contextAfter: contextAfter || undefined,
    requestId,
  }

  // —— 连接看门狗 ——
  // 原生 fetch 没有超时：连接挂起 / 上游 AI 无响应时浮窗会永远停在「AI正在写作」且无任何
  // 错误提示。切到 streaming 后启动看门狗，AI_CONNECT_TIMEOUT 内未收到任何 SSE 事件
  // （thinking/message/done/error 都算「连接已通」）即本地中止并提示；
  // 收到首个事件立刻解除。watchdogFired 用于区分「看门狗中止」与「用户主动停止」，
  // 前者要给错误提示，后者保持既有静默语义
  let watchdogFired = false
  let watchdogTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
    watchdogFired = true
    errorMessage = '连接 AI 服务超时，请检查网络或 AI 配置后重试'
    abortController?.abort()
  }, AI_CONNECT_TIMEOUT)
  const clearConnectWatchdog = () => {
    if (watchdogTimer) {
      clearTimeout(watchdogTimer)
      watchdogTimer = null
    }
  }

  try {
    await streamAiWrite(
      params,
      {
        onDelta: (delta) => {
          clearConnectWatchdog()
          if (abortController?.signal.aborted) return
          appendDelta(delta)
        },
        onThinking: (delta) => {
          clearConnectWatchdog()
          if (abortController?.signal.aborted) return
          appendThinking(delta)
        },
        onDone: () => {
          clearConnectWatchdog()
          finishGeneration()
        },
        onAborted: () => {
          clearConnectWatchdog()
          finishGeneration()
        },
        onError: (message) => {
          clearConnectWatchdog()
          errorMessage = message
          // 保留已生成部分进入审核；全空则由 finishGeneration 统一回退并提示
          finishGeneration()
          if (aiState.markdown.trim()) toast.error(message || 'AI 生成失败')
        },
      },
      abortController.signal
    )
    // 流结束但未收到 done 事件（服务端异常断开）的兜底
    if (aiState.phase === 'streaming') finishGeneration()
  } catch (err) {
    clearConnectWatchdog()
    if (abortController?.signal.aborted) {
      if (watchdogFired) {
        // 看门狗超时中止（非用户停止）：与流内 error 同语义 ——
        // 已有部分内容进 review 并提示，全空则由 finishGeneration 回退并提示
        finishGeneration()
        if (aiState.markdown.trim()) toast.error(errorMessage)
      } else {
        // 前端主动停止：保留已生成内容进入审核
        finishGeneration()
      }
    } else if (err instanceof ApiError && err.code === AI_NOT_CONFIGURED_CODE) {
      // AI 未配置（流前业务异常 80001）：BubbleMenu 直接改写等未走前置检查的入口在此兜底。
      // 清空 errorMessage 抑制 finishGeneration 的通用 toast，改为弹引导对话框
      errorMessage = ''
      finishGeneration()
      openAiConfigDialog()
    } else {
      // fetch 网络层失败（断网 / DNS / 拒绝连接）抛 TypeError，其 message 是英文技术
      // 信息（如 Failed to fetch），转成可读的中文提示
      errorMessage =
        err instanceof TypeError
          ? '无法连接 AI 服务，请检查网络后重试'
          : err instanceof Error
            ? err.message
            : 'AI 写作请求失败'
      finishGeneration()
    }
  } finally {
    clearConnectWatchdog()
    abortController = null
  }
}

/* ========== 对外动作 API（供 BubbleMenu / 斜杠菜单 / 浮条调用） ========== */

/**
 * 标题行显示宽度上限：全角字符按 2、半角按 1 折算，40 ≈ 中文 20 字 / 英文 40 字符。
 *
 * 为什么放宽到 20 字而不是 prompt 要求的 12 字：这里是「拦截段落误标」的最后防线，
 * 阈值必须宽于合法标题的合理水位，宁可放过个别 12-20 字的偏长标题，
 * 也绝不误伤真正的章节标题；截图实测中模型输出的误标段落普遍 50 字起步，20 字阈值足够拦截
 */
const MD_HEADING_MAX_WIDTH = 40

/**
 * 字符串显示宽度：非 ASCII（CJK/全角/emoji）按 2 计、半角按 1 计。
 * 用于把中英文标题统一折算成「中文字数」量级，避免英文标题被字节数误判为超长
 */
function mdVisualWidth(s: string): number {
  return s.replace(/[^\x00-\xff]/g, 'aa').length
}

/**
 * 归一化 AI 输出的 Markdown（逐行处理，代码围栏内原样跳过）。
 *
 * 修的都是 flash 档模型的顽固坏习惯：
 * 1. `##标题`（# 后无空格）：CommonMark 不识别导致标题退化为纯文本，统一补空格；
 *    列表项 `-**加粗**` 同理补空格（块记号后紧跟行内记号时）
 * 2. 「整行加粗」（**标题** / __标题__）充当章节标题：解析后成了加粗段落——
 *    仅当整行恰好是一个加粗片段、且「看起来像标题」（不超长、不带句号）时转换为 ## 标题，
 *    否则保持原样（长整行加粗是强调段落，不是标题）
 * 3. 【最关键兜底】把整段说明文字误标为标题（## 后跟几十上百字的完整段落）：
 *    prompt 的字数禁令对 flash 档模型约束力有限，这里在解析前确定性降级——
 *    超过显示宽度上限、或以句号结尾的「标题」，一律去掉 # 记号还原为普通段落。
 *    副作用为零：合法标题不受影响，误标段落只是回到它本来的形态
 *
 * 逐行 + 围栏状态机的原因：上面的替换若用全文正则（gm），会误伤代码块内的
 * shell 注释（# install ...）等以 # 开头的行；流式输出中围栏可能未闭合，
 * 状态机会把未闭合围栏后的内容也视为代码块原样保留（下一 tick 全量重算自愈）
 *
 * 导出供浮窗组件在预览渲染前使用（预览与「完成」落盘走同一归一化）
 */
export function normalizeAiMarkdown(md: string): string {
  let inFence = false
  return md
    .split('\n')
    .map((line) => {
      // 围栏开关行（``` / ~~~ 开头）：切换状态，本行原样保留
      if (/^\s*(```|~~~)/.test(line)) {
        inFence = !inFence
        return line
      }
      // 代码块内容原样保留，防止把代码注释/示例误当 Markdown 记号改写
      if (inFence) return line

      // 记号后补空格：##标题 → ## 标题（# 后无空格 CommonMark 不识别）；
      // -**加粗** → - **加粗**（- 后必须空格才是列表项，否则整行退化为段落；
      // 仅处理 - 开头：* 开头紧贴 ** 是整行加粗的形态，加空格会把它误判成列表项）
      let out = line
        .replace(/^(#{1,6})([^#\s])/, '$1 $2')
        .replace(/^-(?=\*\*|__)/, '- ')
        .replace(/^(-|\*|\+)([^*\s+-])/, '$1 $2')

      // 整行加粗矫正为标题：仅「短且不带句号」（像标题）时才转，长加粗段落保持原样
      const boldLine = out.match(/^[ \t]*(\*\*|__)(?=\S)((?:(?!\1)[^\n])*?\S)\1[ \t]*$/)
      if (boldLine && boldLine[2]) {
        const text = boldLine[2]
        if (mdVisualWidth(text) <= MD_HEADING_MAX_WIDTH && !/[。．]$/.test(text)) {
          out = `## ${text}`
        }
        return out
      }

      // 标题降级兜底：超长（显示宽度超限）或以句号结尾的「标题」还原为普通段落
      const heading = out.match(/^#{1,6} (.+)$/)
      if (heading && heading[1]) {
        const text = heading[1]
        if (mdVisualWidth(text) > MD_HEADING_MAX_WIDTH || /[。．]$/.test(text)) {
          return text
        }
      }
      return out
    })
    .join('\n')
}

/**
 * 替换式改写：对选中文本应用 AI 动作（BubbleMenu 菜单入口）
 * 支持：improve / fix / extend / reduce / simplify / emojify / summarize / translate / tone
 *
 * @param ed 编辑器实例
 * @param action 动作
 * @param opts.tone / opts.language 动作参数
 */
export function startAiReplace(
  ed: Editor,
  action: AiAction,
  opts?: { tone?: string; language?: string; label?: string }
) {
  if (isAiBusy.value) return
  aiState.editor = ed
  void runGeneration({
    action,
    mode: 'replace',
    tone: opts?.tone,
    language: opts?.language,
    label: opts?.label ?? action,
  })
}

/**
 * 插入式续写：从光标处继续写作（斜杠命令「继续写作」入口）
 */
export function startAiContinue(ed: Editor) {
  if (isAiBusy.value) return
  aiState.editor = ed
  void runGeneration({ action: 'continue', mode: 'insert', label: '继续写作' })
}

/**
 * 打开指令输入框（Ask AI / 补全句子入口）
 *
 * @param opts.mode replace=BubbleMenu 对选区提问（生成后替换选区）；insert=光标处生成
 * @param opts.anchorPos 可选的浮条显示锚点（内容坐标）。insert 模式默认锚在当前光标；
 *   空标题唤起时光标已被移到块边界（防标题壳污染），传标题内位置可让浮条仍贴着标题行
 */
export function openAiPrompt(
  ed: Editor,
  opts?: { mode?: 'insert' | 'replace'; action?: AiAction; label?: string; anchorPos?: number }
) {
  if (isAiBusy.value) return
  const mode = opts?.mode ?? 'insert'
  const sel = ed.state.selection
  // replace 模式必须先有选区
  if (mode === 'replace' && sel.to <= sel.from) {
    toast.error('请先选中要处理的内容')
    return
  }
  // 暂存当前选区（用户在输入框打字期间选区可能变化，提交时用暂存值）
  pendingRange = mode === 'replace' ? { from: sel.from, to: sel.to } : null
  aiState.editor = ed
  aiState.phase = 'prompt'
  aiState.promptMode = mode
  aiState.action = opts?.action ?? 'ask'
  aiState.label = opts?.label ?? 'Ask AI'
  // 浮条锚点：replace 锚在选区起点，insert 锚在光标处（或调用方显式指定的位置）
  aiState.from = opts?.anchorPos ?? (mode === 'replace' ? sel.from : sel.to)
  aiState.to = aiState.from
}

/**
 * 提交 prompt 输入框的指令，开始生成
 *
 * 提交前先调用 POST /ai/status 做前置检查：
 * - AI 未配置（chatReady=false）：停在 prompt 阶段、保留输入内容，弹引导对话框，返回 false
 * - 状态接口自身异常（网络/超时）：fail-open 放行，交给 /ai/write 既有错误链路兜底
 *
 * 指令为空时视为「直接续写」：从当前光标处继续写作（仅 insert 模式生效；
 * replace 模式空指令无意义，维持不提交）
 *
 * @returns 是否成功进入生成流程（false 时调用方不要清空输入框）
 */
export async function submitAiPrompt(instruction: string): Promise<boolean> {
  if (aiState.phase !== 'prompt') return false
  const ed = aiState.editor
  if (!ed) return false
  const mode = aiState.promptMode
  const trimmed = instruction.trim()
  // replace 模式空指令无意义，维持不提交
  if (!trimmed && mode !== 'insert') return false

  // 并发守卫：同一次回车/点击的检查未结束时忽略后续提交
  if (checkingConfig) return false
  checkingConfig = true
  // 连接反馈：从提交这一刻起 connecting=true（浮条发送按钮转 spinner 并禁用），
  // 保证「点击必有反馈」；无论后续是弹引导框、放行进入生成还是中途退出，
  // finally 都会复位，不会出现按钮永久转圈
  aiState.connecting = true
  try {
    try {
      // 前置检查加超时：/ai/status 只是 UX 优化不是硬依赖，慢网/服务挂起时不能让
      // 点击长时间无响应 —— 超时按检查失败处理（fail-open），交给 /ai/write 既有错误链路兜底
      const { chatReady } = await withTimeout(getAiStatus().send(), STATUS_CHECK_TIMEOUT)
      if (!chatReady) {
        // 未配置：不动 phase、不清输入，弹引导框；用户点「去配置」原地打开 AI 配置弹窗
        openAiConfigDialog()
        return false
      }
    } catch (err) {
      // fail-open：状态查询失败不能阻断正常使用，继续发起生成，由 /ai/write 的错误处理兜底
      console.warn('[ai-writing] get ai status failed, fallback to write request', err)
    }

    // await 期间用户可能已 Esc 取消或关闭了浮条：重新校验会话仍属于当前编辑器
    if (aiState.phase !== 'prompt' || aiState.editor !== ed) return false

    const action = aiState.action
    const range = pendingRange
    // 空指令 = 直接续写（action=continue，靠光标前后上下文生成）
    if (!trimmed) {
      aiState.phase = 'idle'
      pendingRange = null
      void runGeneration({ action: 'continue', mode: 'insert', label: '继续写作' })
      return true
    }
    aiState.phase = 'idle' // 让 runGeneration 的 busy 检查通过
    void runGeneration({
      action,
      mode,
      instruction: trimmed,
      label: aiState.label,
      explicitRange: mode === 'replace' ? range : null,
    })
    return true
  } finally {
    checkingConfig = false
    aiState.connecting = false
  }
}

/**
 * 取消 prompt 输入框（Esc / 输入为空时按回退键 / 浮窗上的关闭按钮）
 * 浮窗打开后一直显示（不做「点外取消」），只能通过显式操作结束会话。
 *
 * 关闭后把光标与焦点放回浮窗锚定位置（aiState.from，即唤起时的当前行）：
 * 输入框随浮窗卸载会把焦点丢到 body，不主动还焦用户需要再点一次编辑器才能继续写作；
 * replace 模式锚在选区起点、insert 模式锚在光标处（或调用方显式指定位置），均为合法文档位置
 */
export function cancelAiPrompt() {
  if (aiState.phase !== 'prompt') return
  const ed = aiState.editor
  const focusPos = aiState.from
  pendingRange = null
  resetSession()
  // 焦点还给编辑器并定位到当前行（浮窗卸载在 nextTick，先聚焦不受影响）
  if (ed && !ed.isDestroyed) {
    try {
      const pos = Math.min(Math.max(0, focusPos), ed.state.doc.content.size)
      ed.commands.focus(pos)
    } catch {
      /* 位置越界等异常不阻断关闭 */
    }
  }
}

/**
 * 审核阶段：应用 AI 内容（「完成」按钮）
 *
 * 浮窗预览模式下内容只存在于 aiState.markdown 缓冲区，应用时才真正写入文档：
 * 1. 归一化 + editor.markdown.parse 解析为块级 JSON（与最终文档结构同管线）
 * 2. insertContentAt 一次性写入 [from, to]（replace=替换原选区，insert=光标处插入），
 *    事务 addToHistory: false（撤销历史不收录 AI 内容，靠左上角删除/恢复按钮管理）
 * 3. 捕获应用快照（AI 内容切片 + 会话前原文切片 + 范围），
 *    供编辑器左上角「删除 / 恢复 AI 内容」按钮反复切换
 */
export function applyAiContent() {
  if (aiState.phase !== 'review') return
  const ed = aiState.editor
  if (!ed || ed.isDestroyed || !aiState.markdown.trim()) {
    resetSession()
    return
  }

  // 解析为块级 JSON（未注册 Markdown 扩展属异常配置，按解析失败处理）
  // normalizeMarkdownSource：parse 前清理源文本（语雀式内嵌 HTML / 空加粗残留）
  // normalizeMarkdownJson：parse 后修正（重复 marks 去重 + emoji 短代码 → Unicode emoji
  // + 段落内行内图片提升为块级，markdown-it 把图片解析为行内 token，
  // paragraph > image 过不了 schema 校验，见 normalize-markdown-json.ts 注释）
  const md = normalizeMarkdownSource(normalizeAiMarkdown(aiState.markdown))
  let blocks: JSONContent[] = []
  try {
    blocks = ed.markdown ? (normalizeMarkdownJson(ed.markdown.parse(md)).content ?? []) : []
  } catch (err) {
    console.warn('[ai-writing] markdown parse failed on apply', err)
  }
  if (!blocks.length) {
    toast.error('AI 内容解析失败，请重试')
    resetSession()
    return
  }

  const from = aiState.from
  const to = Math.max(aiState.to, from)
  try {
    const ok = ed
      .chain()
      .command(({ tr }) => {
        tr.setMeta('addToHistory', false)
        return true
      })
      .insertContentAt({ from, to }, blocks, { updateSelection: true })
      .run()
    if (!ok) throw new Error('insertContentAt returned false')
    // 捕获应用快照：AI 内容切片取自插入结果（from → 顶层块边界），
    // 原文切片沿用会话基线（replace 模式才有，insert 模式为 null = 删除即移除）
    const appliedTo = blockBoundaryAfterSelection(ed)
    appliedAiSlice = ed.state.doc.slice(from, appliedTo)
    appliedBaselineSlice = baselineSlice
    aiAppliedState.from = from
    aiAppliedState.to = appliedTo
    aiAppliedState.available = true
    aiAppliedState.present = true
  } catch (err) {
    console.warn('[ai-writing] apply AI content failed', err)
    toast.error('AI 内容插入失败，请重试')
  }
  resetSession()
}

/**
 * 审核阶段：关闭浮窗并丢弃 AI 内容
 * 浮窗预览模式下文档全程未被修改，直接结束会话即可（无需任何回滚）
 */
export function discardAiContent() {
  if (aiState.phase !== 'review') return
  resetSession()
}

/**
 * 删除已应用的 AI 内容，恢复为会话前原文（编辑器左上角 ↩ 按钮）
 * - replace 模式：AI 区域整段换回原文切片
 * - insert 模式：直接删除 AI 内容，并把被块级插入拆开的同类型段落接回
 * 操作同样 addToHistory:false，不污染用户自己的撤销历史
 */
export function undoAiContent() {
  if (!aiAppliedState.available || !aiAppliedState.present) return
  const ed = aiState.editor
  if (!ed || ed.isDestroyed) return
  const from = aiAppliedState.from
  try {
    const tr = ed.state.tr
    if (appliedBaselineSlice) {
      // replace 模式：AI 区域（含区域内被用户改过的内容）整段换回原文
      tr.replace(from, Math.max(aiAppliedState.to, from), appliedBaselineSlice)
      aiAppliedState.to = from + appliedBaselineSlice.size
    } else {
      // insert 模式：无原文基线，仅删除 AI 内容
      if (aiAppliedState.to > from) tr.delete(from, aiAppliedState.to)
      // AI 内容是块级结构，插入段落中间时会把原段落拆成两半（AAA/BBB），
      // 删除后仅当边界两侧是同类型 textblock（被拆开的两半）且可拼接时 join 回去；
      // 不限定类型会把「标题+段落」这类相邻块误拼（标题可吸收段落文本）
      try {
        const $pos = tr.doc.resolve(from)
        const before = $pos.nodeBefore
        const after = $pos.nodeAfter
        if (
          before &&
          after &&
          before.isTextblock &&
          before.type === after.type &&
          canJoin(tr.doc, from)
        ) {
          tr.join(from)
        }
      } catch {
        /* join 失败不阻断删除 */
      }
      aiAppliedState.to = from
    }
    tr.setMeta('addToHistory', false)
    ed.view.dispatch(tr)
    aiAppliedState.present = false
    // 光标放回快照区域起始处（编辑器未聚焦时仅更新 state，不抢焦点）
    try {
      ed.commands.setTextSelection(from)
    } catch {
      /* ignore */
    }
  } catch (err) {
    console.warn('[ai-writing] undoAiContent failed', err)
  }
}

/**
 * 恢复已删除的 AI 内容（编辑器左上角 ↪ 按钮）
 * 把快照区域（当前为原文 / 用户后续输入 / 空）整段换回应用时刻的 AI 内容切片；
 * insert 模式区域为空时即纯插入
 */
export function redoAiContent() {
  if (!aiAppliedState.available || aiAppliedState.present || !appliedAiSlice) return
  const ed = aiState.editor
  if (!ed || ed.isDestroyed) return
  const from = aiAppliedState.from
  try {
    const tr = ed.state.tr
    tr.replace(from, Math.max(aiAppliedState.to, from), appliedAiSlice)
    tr.setMeta('addToHistory', false)
    ed.view.dispatch(tr)
    aiAppliedState.to = from + appliedAiSlice.size
    aiAppliedState.present = true
    try {
      ed.commands.setTextSelection(aiAppliedState.to)
    } catch {
      /* ignore */
    }
  } catch (err) {
    console.warn('[ai-writing] redoAiContent failed', err)
  }
}

/**
 * 审核阶段：重新生成（Try again）
 * 文档未被修改（内容只在浮窗预览），无需回滚 —— 直接按首次生成的参数重跑，
 * 目标范围用当前映射值（replace 模式的原文仍在原处，可重新捕获基线）
 */
export function retryAi() {
  const ed = aiState.editor
  if (!ed || aiState.phase !== 'review' || !lastRun) return
  const run = lastRun

  // 重置基线标记让 runGeneration 重新捕获（原文仍在目标范围内）
  hasBaseline = false
  baselineSlice = null
  aiState.phase = 'idle'

  void runGeneration({
    action: run.action,
    mode: run.mode,
    instruction: run.instruction,
    tone: run.tone,
    language: run.language,
    label: run.label,
    explicitRange: { from: aiState.from, to: Math.max(aiState.to, aiState.from) },
  })
}

/**
 * 审核阶段：提交追加修改指令（「告诉 AI 还需要怎么改」输入框）
 * 对当前 AI 内容（markdown 缓冲区）应用新指令，目标范围不变；
 * 文档仍未被修改，Discard 依旧零操作
 */
export function submitAiFollowUp(instruction: string) {
  if (aiState.phase !== 'review' || !instruction.trim()) return
  // 目标范围 = 当前映射范围（replace=原选区，insert=零宽光标点），显式传入，
  // 不再移动编辑器选区（内容尚未写入文档，选区与 AI 范围无关）
  aiState.phase = 'idle'
  void runGeneration({
    action: 'custom',
    mode: 'replace',
    instruction: instruction.trim(),
    label: '追加修改',
    explicitRange: { from: aiState.from, to: Math.max(aiState.to, aiState.from) },
    keepBaseline: true,
  })
}

/**
 * 流式阶段：停止生成
 * 本地立即切断流读取，同时通知服务端中止（释放上游资源）
 */
export function stopAi() {
  if (aiState.phase !== 'streaming') return
  abortController?.abort()
  // 服务端中止：best-effort，失败不影响本地流程
  if (activeRequestId) {
    abortAiWrite(activeRequestId).catch(() => {})
  }
}

/**
 * 组件卸载时清理（页面切换 / 编辑器销毁前调用）
 */
export function destroyAiWriting() {
  abortController?.abort()
  abortController = null
  aiState.editor = null
  resetSession()
  // 清理已应用快照与其位置追踪（编辑器即将销毁，快照随之失效）
  unbindAppliedTracker()
  aiAppliedState.available = false
  aiAppliedState.present = false
  appliedAiSlice = null
  appliedBaselineSlice = null
}
