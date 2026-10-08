import { z } from 'zod'

/**
 * 访客密码校验请求 Schema
 * - password: 访客输入的访问密码（1-32 位，服务端明文 === 比较）
 * - docId: 可选，单页访问意图时传目标文档 ID（私密库单页公开场景，校验页密码）；
 *          缺省 = 整库访问意图（公开库场景，校验库密码）
 */
export const VerifySharePasswordSchema = z.object({
  // 访客输入的密码：必填，1-32 位（服务端与存储的明文密码直接比较，抗爆破依赖限流）
  password: z.string().min(1, '请输入访问密码').max(32, '访问密码最长 32 位'),
  // 目标文档 ID：可选。传值时按页面级覆盖判定可访问性与所需密码（scope = `${wikiId}:${nodeId}`）
  docId: z.string().optional(),
})

/**
 * 访客对话历史条目 Schema（分享公开页 AI 浮窗多轮追问）
 * 限长较登录端（rag.schema.ts）更严：公开端点防滥用，question 与主问题同限 500、answer 放宽到 2000
 */
export const ShareAiChatHistoryItemSchema = z.object({
  // 历史用户提问：去空格后 1-500 字符（与主问题同限）
  question: z.string().trim().min(1, '历史提问不能为空').max(500, '历史提问最长 500 字'),
  // 历史 AI 回答：去空格后 1-2000 字符
  answer: z.string().trim().min(1, '历史回答不能为空').max(2000, '历史回答最长 2000 字'),
})

/**
 * 访客 AI 问答请求 Schema（分享公开页 AI 浮窗）
 * - question: 访客输入的问题（1-500 字符，公开端点从严限制长度防滥用）
 * - history: 可选对话历史（最多 10 条，时间正序；用于问题改写与多轮上下文）
 */
export const ShareAiChatSchema = z.object({
  // 用户问题：去空格后 1-500 字符
  question: z.string().trim().min(1, '问题不能为空').max(500, '问题最长 500 字'),
  // 对话历史：可选，最多 10 条
  history: z.array(ShareAiChatHistoryItemSchema).max(10, '对话历史最多 10 条').optional(),
})

// ============ 类型导出 ============

export type VerifySharePassword = z.infer<typeof VerifySharePasswordSchema>
export type ShareAiChat = z.infer<typeof ShareAiChatSchema>

// 说明：原「预览模式站点外观配置」Schema（UpdatePreviewConfigSchema）已迁至
// ~/modules/publish/publish.schema.ts（UpdatePublishSettingsSchema）——
// share/publish 语义拆分后，站点形态与外观属于 publish（发布成站点），
// 本模块只保留访客分享访问（密码校验 / AI 问答）相关 Schema。
