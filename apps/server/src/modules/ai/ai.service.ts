import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import type { AiWrite } from './ai.schema.js'
import { AI_SKILLS } from './ai.skills.js'

/**
 * AI 写作 Prompt 组装服务（纯逻辑层）
 *
 * 设计要点：
 * - 各动作的指令文案集中在 ai.skills.ts 的技能注册表（一个动作 = 一条技能），
 *   本文件只负责把「技能指令 + 输入块 + 输出约束 + system 人设」拼成最终消息
 * - 所有动作共用同一个 system prompt：要求只输出结果正文（Markdown），不输出解释/围栏，
 *   默认保持原文语言（除非明确要求翻译），保证前端可以「流式插入 + 直接应用」无需二次清洗
 * - 上下文截断在前端完成（before 8000 / after 4000），服务端只做兜底拼装
 */

/** 上下文片段的最大长度（与 ai.schema.ts 限制一致） */
const CONTEXT_BEFORE_MAX = 8000
const CONTEXT_AFTER_MAX = 4000

/** 标题块模板：文章标题是最高优先级的主题信号，必须让模型在处理任何文本/指令前先知道主题。
 * 放在 user 消息最顶部（指令与输入块之前），确保 flash 档小模型不会忽略；
 * 明确标注「不要在输出中复述」，防止模型把标题当正文再输出一遍 */
function buildTitleBlock(title?: string): string {
  const t = (title ?? '').trim()
  if (!t) return ''
  return [
    '<title>',
    t,
    '</title>',
    '—— 以上是文章标题，仅用于理解主题与定位内容方向，不要在输出中复述 ——',
    '',
  ].join('\n')
}

/** 标题层级名（索引 1-6 对应 H1-H6，用于章节块文案标注） */
const HEADING_LEVEL_NAMES = ['', '一级', '二级', '三级', '四级', '五级', '六级'] as const

/**
 * 章节标题块模板：光标上方最近的标题（前端传入），是「AI 正在哪个模块/章节下编写」的信号。
 *
 * 优先级次于文档标题块（整篇主题），但直接决定「当前这段内容的主题」：
 * 光标在 H1「什么是YOKI文档?」下方的空行唤起 AI 时，生成内容应围绕该标题展开，
 * 而不是围绕整篇文档标题泛泛而谈。放在标题块之后、指令之前，确保模型先看到；
 * 明确标注「不要在输出中复述」，防止模型把章节标题当正文再输出一遍
 */
function buildSectionBlock(params: AiWrite): string {
  const t = (params.sectionTitle ?? '').trim()
  if (!t) return ''
  const level = params.sectionLevel ?? 0
  const levelText =
    level >= 1 && level <= 6 ? `（${HEADING_LEVEL_NAMES[level]}标题）` : ''
  return [
    '<section_title>',
    t,
    '</section_title>',
    `—— 以上是光标所在位置的章节标题${levelText}：光标正位于该标题之下的内容区编写，当前内容属于这个章节，主题以该标题为准 ——`,
    '',
  ].join('\n')
}

/** 上下文块模板：让模型明确区分「上下文（不可复制）」与「待处理文本」 */
function buildContextBlock(contextBefore?: string, contextAfter?: string): string {
  const before = (contextBefore ?? '').slice(-CONTEXT_BEFORE_MAX)
  const after = (contextAfter ?? '').slice(0, CONTEXT_AFTER_MAX)
  if (!before && !after) return ''
  const lines: string[] = ['', '—— 以下是文档上下文（标题行以 Markdown # 记号标注，可据此理解文档结构），仅用于理解行文风格与语境，不要在输出中复述 ——']
  if (before) lines.push(`<before>\n${before}\n</before>`)
  if (after) lines.push(`<after>\n${after}\n</after>`)
  lines.push('—— 上下文结束 ——', '')
  return lines.join('\n')
}

/**
 * 通用输出约束（拼在 user 消息末尾，强化 system 约定）。
 *
 * 针对 flash 档小模型的经验：规则必须逐条、具体、带禁令，否则会走极端——
 * 之前「标题用 Markdown 语法」一句就导致模型给整段正文都加 ###；
 * 而无差别的标题禁令又会让模型矫枉过正，整篇一个标题都不输出（2026-09-24 反馈：
 * AI 生成的内容全是正文段落）。因此标题规则（第 4 条）按动作分型：
 * - structure（生成型）：ask 按标准 Markdown 文档结构输出 # 总标题 + ## 小节；
 * - preserve（保持型）：custom 的输入文本（当前 AI 内容）可能已含标题，不得丢失；
 * - strict（压制型）：其余动作（改写/续写/补全）标题是例外而非常态，防误标段落。
 *
 * 2026-09-23 实测反馈的两类顽固问题及对策（均需「禁令 + 示例」双管齐下）：
 * - 啰嗦：模型默认爱写套话空转（「需要注意的是」「综上所述」）、换说法复述同一信息，
 *   甚至靠重复凑篇幅 → 新增信息密度条款，逐条列出禁写的套话形态
 * - 标题过长：20 字软上限模型执行很差，必须把上限收紧到 12 字（中文短标题的常用水位）
 *   并给出正/反示例——flash 档模型对「带示例的规则」服从度远高于纯数字约束
 */

/** 输出约束公共头部（第 1-3 条，所有动作一致；第 4 条标题规则按动作插入） */
const OUTPUT_RULE_HEAD = [
  '输出格式（逐条严格遵守）：',
  '1. 只输出结果正文（Markdown 格式）：不要任何解释、前言、结语，不要代码围栏（```），不要 <br>、<p> 等任何 HTML 标签。',
  '2. 默认输出普通段落：正文文字直接写，不要加任何记号；段落之间用且仅用一个空行分隔。',
  '3. 表达精炼，信息密度优先，逐条遵守：',
  '   - 一句话只承载一个信息点；能一句话说清的，不拆成两句，也不用两句铺垫。',
  '   - 禁止套话与空洞句：「需要注意的是」「值得一提的是」「总的来说」「综上所述」「众所周知」「在实际应用中」以及任何「随着…的发展」式开头，一律不写。',
  '   - 禁止重复：同一信息只出现一次，不换种说法再说一遍；不写没有信息量的开场白与收尾句。',
]

/** 输出约束公共尾部（第 5-7 条，所有动作一致） */
const OUTPUT_RULE_TAIL = [
  '5. **加粗** 只允许强调句中的个别词语（一两处以内）；禁止加粗整行、整段，禁止用加粗代替标题。',
  '6. 列表用 Markdown 语法（- 或 1.），每条独占一行，列表与前后正文之间各空一行。',
  '7. 标题、段落、列表不能写在同一行；每个块级结构之间都必须换行分隔。',
]

/** 标题规则（生成型）：ask 生成整篇内容时按标准 Markdown 结构输出标题层级 */
const HEADING_RULE_STRUCTURE = [
  '4. 按标准 Markdown 文档结构组织内容，标题逐条遵守：',
  '   - 先输出一个一级标题（# ）作为文章总标题，再用若干二级标题（## ）划分小节。',
  '   - 标题只能是 4-12 字的短语（如 # 快速上手指南、## 部署步骤）；想写成标题的句子超过 12 字时，一律直接写成普通段落。',
  '   - 说明性段落、完整长句、带句号或逗号的行，一律禁止加标题；内容很短（3 段以内）时不用标题，直接输出段落。',
]

/** 标题规则（保持型）：custom 的输入是当前 AI 内容，可能已含标题结构，修改时不得丢失 */
const HEADING_RULE_PRESERVE = [
  '4. 保持输入文本已有的 Markdown 结构：原有的标题层级（#/##/###）、列表原样保留，不得删除或降级为普通段落；需要新增标题时，标题只能是 4-12 字的短语（如 ## 部署步骤），说明性长句禁止加标题。',
]

/** 标题规则（章节型）：光标位于某个章节标题之下时，生成的是该章节的正文，不再另起总标题 */
const HEADING_RULE_SECTION = [
  '4. 光标位于一个章节标题之下，本次生成的是该章节的正文内容，标题逐条遵守：',
  '   - 禁止输出一级标题（# ），禁止复述所在章节的标题；直接从该章节的正文写起。',
  '   - 需要划分小节时可用二级标题（## ），标题只能是 4-12 字的短语（如 ## 部署步骤）；说明性长句、带句号或逗号的行，一律禁止加标题。',
  '   - 内容很短（3 段以内）时不用标题，直接输出段落。',
]

/** 标题规则（压制型）：改写/续写/补全类动作，标题是例外而非常态（防误标段落、防标题刷屏） */
const HEADING_RULE_STRICT = [
  '4. 标题（##/###）是最容易犯错的点，逐条遵守：',
  '   - 标题只能是 4-12 字的短语（如 ## 部署步骤、## 常见问题）；想写成标题的句子超过 12 字时，一律直接写成普通段落。',
  '   - 说明性段落、完整长句、带句号或逗号的行，一律禁止加 ##/###，无论多想给它们分节。',
  '   - 宁可整篇一个标题都不用，也不允许出现长标题；3 段以内的短内容不要输出任何标题。',
]

/**
 * 按技能取输出约束：生成/章节/保持/压制四型标题规则 + 公共头尾拼装。
 * ask 按是否位于章节标题之下再分型：无章节=生成型（整篇带 # 总标题），
 * 有章节=章节型（该章节正文，禁 # 总标题）；custom=保持型，其余=压制型
 */
function buildOutputRule(params: AiWrite): string {
  const headingRule =
    params.action === 'ask'
      ? params.sectionTitle?.trim()
        ? HEADING_RULE_SECTION
        : HEADING_RULE_STRUCTURE
      : params.action === 'custom'
        ? HEADING_RULE_PRESERVE
        : HEADING_RULE_STRICT
  return [...OUTPUT_RULE_HEAD, ...headingRule, ...OUTPUT_RULE_TAIL].join('\n')
}

/**
 * 按技能定义组装 user 消息主体：指令正文 + 输入块。
 *
 * 输入块形态由技能的 input 字段决定（与 ai.skills.ts 的分型一致）：
 * - text：改写类动作，原文放 <text> 块（text 缺省时无输入块）
 * - context：续写/生成类动作，光标前后上下文放 <before>/<after> 块
 */
function buildActionInstruction(params: AiWrite): string {
  const skill = AI_SKILLS[params.action]
  const inputBlock =
    skill.input === 'text'
      ? params.text
        ? `<text>\n${params.text}\n</text>`
        : ''
      : buildContextBlock(params.contextBefore, params.contextAfter)
  return `${skill.instruction(params)}\n${inputBlock}`
}

/**
 * 组装 AI 写作的消息列表（OpenAI 格式，供 streamChatSSE 使用）
 *
 * @param params AI 写作请求参数（controller 已校验）
 * @returns OpenAI 格式消息列表（system + user）
 */
export function buildWriteMessages(params: AiWrite): ChatCompletionMessageParam[] {
  // 消息结构：标题块（整篇主题，最前）→ 章节块（当前章节主题）→ 动作指令 + 输入块 → 输出约束
  const userMessage = [
    buildTitleBlock(params.title),
    buildSectionBlock(params),
    buildActionInstruction(params),
    buildOutputRule(params),
  ]
    .filter(Boolean)
    .join('\n')

  return [
    {
      role: 'system',
      content:
        '你是一位专业的写作助手，嵌入在文档编辑器中帮助用户高效创作。' +
        '你的输出会被直接写入用户的文档，因此必须严格遵守：只输出结果正文，不输出任何解释或多余内容。' +
        '输出始终是合法的 Markdown：标题、列表等结构都用 Markdown 记号表达，标题必须是 4-12 字的短语。' +
        '除非用户明确要求翻译，否则始终使用与原文（或上下文）相同的语言写作。',
    },
    { role: 'user', content: userMessage },
  ]
}
