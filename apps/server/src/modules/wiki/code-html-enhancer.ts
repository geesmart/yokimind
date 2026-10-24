/**
 * contentHtml 代码块后处理（高亮 / 复制按钮）
 *
 * 输入是 renderToHTMLString 的产物（自产 HTML，形态确定）：代码块输出为
 * `<pre data-code-block ...><code class="language-x">转义文本</code></pre>`。
 * 本模块做两件事：
 *
 * 1. 高亮：data-language 已注册 → lowlight 同步 highlight 出 hast 树，
 *    扁平化为 { text, classes } 片段再序列化为 hljs-* span（与编辑器内
 *    CodeBlockLowlight 的 Decoration 类名同一套 token，markdown.css 一份主题两端通用）；
 *    未注册语言 / Plain Text 保持转义原文不染色（服务端不做 highlightAuto，
 *    避免纯文本被随机高亮，与编辑器 defaultLanguage='plaintext' 行为对齐）。
 *    高亮与纯文本统一按 \n 拆行包 span.line —— 发布态左侧行号由 markdown.css
 *    counter 渲染（行号常显，非设置项，与编辑器 gutter 同构）。
 * 2. 烘复制按钮：以静态 button 烘进 pre —— SSR 直出，点击行为由 pages 端
 *    code-block.client.ts 全局事件委托激活，无 JS 时渐进降级为纯展示。
 *    标题条（filename / 语言徽标）不在此处理 —— 由 markdown.css 十四章的
 *    pre::before / ::after 伪元素按 data-filename / data-language 渲染。
 *
 * 只处理带 data-code-block 标记的 pre：不会误伤 PromptInstr 等其他 pre > code；
 * 旧版渲染的 contentHtml（已含 .code-block-scroll 等结构，不匹配 pre>code 相邻
 * 正则）原样透传，文档下次保存重新渲染时自然升级。
 */
import { common, createLowlight } from 'lowlight'

const lowlight = createLowlight(common)

/** 代码块 pre 块（自产形态：pre > code 相邻、code 内容为转义文本，无嵌套元素） */
const PRE_BLOCK_RE = /<pre([^>]*)><code([^>]*)>([\s\S]*?)<\/code><\/pre>/g

/** renderToHTMLString 的文本转义（& < >）与属性转义（加 &quot;）的逆运算 */
function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
}

/** 文本再序列化转义（& < >，与 static-renderer 同规则） */
function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** 从 attrs 串中取 data-* 值（attrs 为 renderHTML 序列化产物，值已转义） */
function getAttr(attrs: string, name: string): string | null {
  const match = attrs.match(new RegExp(`${name}="([^"]*)"`))
  return match ? decodeEntities(match[1]!) : null
}

/** 高亮片段：classes 为 hljs token 类名集合（多级嵌套合并，如 highlight-title 下 keyword） */
interface HighlightFragment {
  text: string
  classes: string[]
}

/** hast 树扁平化为片段流（保留类名路径） */
function flattenHast(node: unknown, classes: string[], out: HighlightFragment[]): void {
  const n = node as { type?: string; value?: string; tagName?: string; properties?: { className?: string[] }; children?: unknown[] }
  if (n.type === 'text') {
    out.push({ text: n.value ?? '', classes })
    return
  }
  const childClasses = n.tagName ? [...classes, ...(n.properties?.className ?? [])] : classes
  for (const child of n.children ?? []) flattenHast(child, childClasses, out)
}

function serializeFragment(fragment: HighlightFragment): string {
  const text = escapeHtml(fragment.text)
  return fragment.classes.length
    ? `<span class="${fragment.classes.join(' ')}">${text}</span>`
    : text
}

/** 把片段流按 \n 拆成行（片段文本可跨行，切分时保持类名；行内空片段丢弃） */
function splitFragmentsToLines(fragments: HighlightFragment[]): HighlightFragment[][] {
  const lines: HighlightFragment[][] = [[]]
  for (const f of fragments) {
    const parts = f.text.split('\n')
    parts.forEach((part, i) => {
      if (i > 0) lines.push([])
      if (part) lines[lines.length - 1]!.push({ text: part, classes: f.classes })
    })
  }
  return lines
}

/** 行序列化：每行包一层 span.line（发布态行号由 markdown.css 十四章 counter 渲染）。
 * 行间不加 '\n'：display:block 的 span 自身换行，混入换行文本节点会在 pre 里
 * 产生多余空行；复制换行由 pages 端脚本按 span.line 拼接补偿 */
function serializeLines(lines: HighlightFragment[][]): string {
  return lines
    .map((line) => `<span class="line">${line.map(serializeFragment).join('')}</span>`)
    .join('')
}

/** 复制按钮（SSR 直出；.is-copied 由 pages 端脚本切换显示打勾） */
function copyButtonHtml(): string {
  return (
    `<button class="code-copy" type="button" aria-label="复制代码">` +
    `<svg class="i-copy" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>` +
    `<svg class="i-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>` +
    `</button>`
  )
}

/** 全屏按钮（SSR 直出；点击行为由 pages 端脚本切换 pre.is-fullscreen，样式 markdown.css 14.4b）。
 *  path data 烘焙自 @hugeicons/core-free-icons 的 SquareArrowDiagonal02Icon / SquareArrowShrink01Icon
 *  （web_rules §4 图标统一 hugeicons；server 不装该依赖，取其导出的 path 常量等价直出；
 *  hugeicons 线条内嵌 stroke-width 1.5，与 web 端 HugeiconsIcon 渲染一致） */
function fullscreenButtonHtml(): string {
  return (
    `<button class="code-fullscreen" type="button" aria-label="全屏切换">` +
    `<svg class="i-expand" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">` +
    `<path d="M2.5 11.9999C2.5 7.52157 2.5 5.28239 3.89124 3.89115C5.28249 2.49991 7.52166 2.49991 12 2.49991C16.4783 2.49991 18.7175 2.49991 20.1088 3.89115C21.5 5.28239 21.5 7.52157 21.5 11.9999C21.5 16.4783 21.5 18.7174 20.1088 20.1087C18.7175 21.4999 16.4783 21.4999 12 21.4999C7.52166 21.4999 5.28249 21.4999 3.89124 20.1087C2.5 18.7174 2.5 16.4783 2.5 11.9999Z"/>` +
    `<path d="M15.8008 15.8009L8.19915 8.19919M15.8008 15.8009C16.2444 15.3573 15.8098 13.2652 15.8008 12.6335M15.8008 15.8009C15.3573 16.2445 13.2652 15.8099 12.6335 15.8009M8.19915 8.19919C8.64273 7.75561 10.7348 8.19021 11.3665 8.19919M8.19915 8.19919C7.75558 8.64276 8.19018 10.7348 8.19915 11.3666"/>` +
    `</svg>` +
    `<svg class="i-collapse" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">` +
    `<path d="M2.5 12C2.5 7.52166 2.5 5.28249 3.89124 3.89124C5.28249 2.5 7.52166 2.5 12 2.5C16.4783 2.5 18.7175 2.5 20.1088 3.89124C21.5 5.28249 21.5 7.52166 21.5 12C21.5 16.4783 21.5 18.7175 20.1088 20.1088C18.7175 21.5 16.4783 21.5 12 21.5C7.52166 21.5 5.28249 21.5 3.89124 20.1088C2.5 18.7175 2.5 16.4783 2.5 12Z"/>` +
    `<path d="M11.0167 11.0167C11.5915 10.4419 11.4959 8 11.4959 8M11.0167 11.0167C10.4419 11.5915 8 11.4958 8 11.4958M11.0167 11.0167L7 7M12.9869 12.9868C13.5617 12.412 16.0036 12.5077 16.0036 12.5077M12.9869 12.9868C12.4121 13.5616 12.5078 16.0035 12.5078 16.0035M12.9869 12.9868L17 16.9999"/>` +
    `</svg>` +
    `</button>`
  )
}

/** 单个代码块 pre 的后处理：返回 null 表示无需改动（原样保留） */
function enhancePreBlock(preAttrs: string, codeAttrs: string, codeHtml: string): string | null {
  if (!preAttrs.includes('data-code-block')) return null

  const language = getAttr(preAttrs, 'data-language')
  const rawText = decodeEntities(codeHtml)

  // 高亮（未注册语言 / Plain Text 保持原文不染色），统一拆行包 span.line
  let inner: string
  if (language && lowlight.registered(language)) {
    const fragments: HighlightFragment[] = []
    flattenHast(lowlight.highlight(language, rawText), [], fragments)
    inner = serializeLines(splitFragmentsToLines(fragments))
  } else {
    inner = serializeLines(splitFragmentsToLines([{ text: rawText, classes: [] }]))
  }

  // 滚动层 wrapper：横向滚动收敛在 .code-block-scroll 内层，复制/全屏按钮钉在
  // pre 上不随内容滚动（button 为 phrasing content，置于滚动层之后合法）
  return `<pre${preAttrs}><div class="code-block-scroll"><code${codeAttrs}>${inner}</code></div>${copyButtonHtml()}${fullscreenButtonHtml()}</pre>`
}

/**
 * 后处理入口：对 renderToHTMLString 产物中的代码块做高亮 / 按钮增强
 * @param html static-renderer 产物（整篇文档 HTML）
 */
export function enhanceCodeBlocks(html: string): string {
  return html.replace(PRE_BLOCK_RE, (whole, preAttrs: string, codeAttrs: string, codeHtml: string) => {
    return enhancePreBlock(preAttrs, codeAttrs, codeHtml) ?? whole
  })
}
