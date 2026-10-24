import { z } from 'zod'

/**
 * 创建个人访问令牌请求
 * name 必填（备注用途），有效期可选（ISO 日期字符串，须晚于当前时间）
 */
export const CreateTokenSchema = z
  .object({
    name: z.string().min(1, '令牌名称不能为空').max(50, '令牌名称过长'),
    /** 有效期（ISO 8601），不传 = 永不过期 */
    expiresAt: z
      .string()
      .datetime({ offset: true })
      .refine((v) => new Date(v).getTime() > Date.now(), '过期时间必须晚于当前时间')
      .optional(),
  })
  .strict()

export type CreateToken = z.infer<typeof CreateTokenSchema>

/** 吊销个人访问令牌请求 */
export const RevokeTokenSchema = z
  .object({
    tokenId: z.string().min(1, 'tokenId 不能为空'),
  })
  .strict()

export type RevokeToken = z.infer<typeof RevokeTokenSchema>
