import type { AiWrite } from './ai.schema.js'

/**
 * AI 写作「技能注册表」（纯数据层）
 *
 * 设计要点：
 * - 一个写作动作 = 一条技能（AiSkill）：展示名 + 输入供给方式 + 指令模板
 * - 指令文案集中在本文件，与组装逻辑（ai.service.ts）分离，可独立审视与调优
 * - 注册表 key 类型为 Record<AiWrite['action'], AiSkill>：schema 新增动作而漏写技能时
 *   typecheck 直接报错（编译期全覆盖保证），无需运行时兜底
 * - 新增一个动作的完整步骤：
 *   1. ai.schema.ts 的 AI_WRITE_ACTIONS 加动作枚举
 *   2. 本文件 AI_SKILLS 加一条技能定义（label / input / instruction）
 *   （AI_ACTION_LABELS 由注册表自动派生，controller 无需改动）
 */

/** 单个 AI 写作技能定义：一个动作 = 一条技能 */
export interface AiSkill {
  /** 人类可读名称（controller 日志 / 调试用） */
  label: string
  /**
   * 输入供给方式（决定 user 消息里附带的输入块形态）：
   * - text：改写类动作，待处理原文放 <text> 块（params.text 必传，可为空则无输入块）
   * - context：续写/生成类动作，光标前后上下文放 <before>/<after> 块（服务端兜底截断）
   */
  input: 'text' | 'context'
  /**
   * 指令模板：返回指令正文（不含输入块与输出规则）。
   * 需要动作参数的技能（translate/tone/ask/custom）从 params 读取对应字段
   */
  instruction: (params: AiWrite) => string
}

/** AI 写作技能注册表：key 必须覆盖 AiWrite['action'] 全部动作（编译期强制） */
export const AI_SKILLS: Record<AiWrite['action'], AiSkill> = {
  /** 改写优化：选中文本整体润色（replace 模式） */
  improve: {
    label: '改写优化',
    input: 'text',
    instruction: () =>
      '请改写下面的文本：修正不通顺的表达，提升清晰度与可读性，保持原意、信息量与语言不变。',
  },
  /** 修正拼写与语法：只改错，不改写无错误的句子（replace 模式） */
  fix: {
    label: '修正拼写与语法',
    input: 'text',
    instruction: () =>
      '请修正下面文本中的拼写、标点与语法错误，尽量保持原句结构与用词风格，不要改写无错误的句子。',
  },
  /** 扩写：补充细节与例子，篇幅扩到 2-3 倍（replace 模式） */
  extend: {
    label: '扩写',
    input: 'text',
    instruction: () =>
      '请扩写下面的文本：补充合理的细节、例子或说明，把篇幅扩展到原来的 2-3 倍，保持原文语言与风格一致，不要虚构事实。扩写只允许靠增加新信息（细节、例子、原因、步骤）达成，禁止靠重复已有内容、套话或空洞的过渡句凑篇幅。',
  },
  /** 缩写：压缩到一半篇幅，保留核心信息（replace 模式） */
  reduce: {
    label: '缩写',
    input: 'text',
    instruction: () =>
      '请缩写下面的文本：保留核心信息与关键结论，把篇幅压缩到原来的一半左右，输出可以直接替换原文的成稿。',
  },
  /** 简化表达：通俗化改写，信息点不丢失（replace 模式） */
  simplify: {
    label: '简化表达',
    input: 'text',
    instruction: () =>
      '请简化下面的文本：用更简单直白的表达改写，避免术语与冗长句式，让非专业读者也能轻松读懂，信息点不丢失。',
  },
  /** 添加表情：在关键处插入 emoji，不改文字内容（replace 模式） */
  emojify: {
    label: '添加表情',
    input: 'text',
    instruction: () =>
      '请给下面的文本适当加入 emoji：在关键句、列表项或标题处插入贴切的表情，不要改变文字内容本身，emoji 数量克制（每段最多 1-2 个）。',
  },
  /** 补全句子：只输出补全的新内容（insert 模式） */
  complete: {
    label: '补全句子',
    input: 'context',
    instruction: () => '请补全当前未写完的句子/段落。只输出补全的新内容，不要重复已有文字。',
  },
  /** 继续写作：衔接上下文续写多段（insert 模式，斜杠命令「继续写作」） */
  continue: {
    label: '继续写作',
    input: 'context',
    instruction: () =>
      '请根据上下文自然续写：衔接已有内容继续创作（可以输出多个段落）。只输出新内容，不要重复或改写已有文字。续写的是文档正文，输出应该以普通段落为主；只有确实要开启一个新章节时才输出一个标题，不要给每段内容都配标题。',
  },
  /** 总结：提炼核心观点，可用要点列表（replace 模式） */
  summarize: {
    label: '总结',
    input: 'text',
    instruction: () =>
      '请总结下面的文本：提炼核心观点与关键信息，输出结构清晰的简短总结（可用要点列表）。',
  },
  /** 翻译：目标语言取 params.language，缺省 English（replace 模式） */
  translate: {
    label: '翻译',
    input: 'text',
    instruction: (params) =>
      `请把下面的文本翻译成 ${params.language || 'English'}：保持原意与格式（Markdown 结构不变），译文要自然流畅符合目标语言习惯。`,
  },
  /** 调整语气：目标语气取 params.tone，缺省 Formal（replace 模式） */
  tone: {
    label: '调整语气',
    input: 'text',
    instruction: (params) =>
      `请把下面的文本改写成「${params.tone || 'Formal'}」的语气/风格：保持原意与信息量不变，语言随语气自然调整。`,
  },
  /** AI 生成：按用户指令在光标处生成内容（insert 模式，Ask AI / 斜杠 AI 入口） */
  ask: {
    label: 'AI 生成',
    input: 'context',
    // 按是否位于章节标题之下分型（params.sectionTitle 由前端传入）：
    // - 有章节：本次生成是该章节的正文，直接围绕章节主题展开，不另起 # 总标题
    // - 无章节：按整篇文档结构生成（# 总标题 + ## 小节）
    instruction: (params) => {
      const base = `请根据以下指令在文档当前位置生成内容：${params.instruction || ''}`
      if (params.sectionTitle?.trim()) {
        return `${base}\n光标正位于一个章节标题之下的内容区，本次生成的是这个章节的正文：直接围绕该章节的主题展开撰写，不要输出一级标题（# ）、不要复述章节标题。正文用普通段落与必要的列表书写；需要划分小节时可用二级标题（## ）。内容很短（3 段以内）时不用标题，直接输出段落。`
      }
      return `${base}\n按标准 Markdown 文档结构组织输出：先用一个一级标题（# ）概括主题，再用若干二级标题（## ）划分小节；正文用普通段落与必要的列表书写。内容很短（3 段以内）时不用标题，直接输出段落。`
    },
  },
  /** 追加修改：对当前 AI 内容应用新指令（审核阶段浮条输入框） */
  custom: {
    label: '追加修改',
    input: 'text',
    instruction: (params) =>
      `请对下面的文本应用修改要求：${params.instruction || ''}\n直接输出修改后的完整结果，保持原文已有的标题层级与 Markdown 结构不变。`,
  },
}

/**
 * 动作 → 展示名映射（由注册表派生，供 controller 日志用）。
 * 不手写第二份映射，避免「加动作改三处」的双处维护问题
 */
export const AI_ACTION_LABELS: Record<AiWrite['action'], string> = Object.fromEntries(
  Object.entries(AI_SKILLS).map(([action, skill]) => [action, skill.label]),
) as Record<AiWrite['action'], string>
