import { z } from 'zod'

/**
 * Dashboard 列表查询 Query Schema
 * 统一为 limit 可选参数，1-50 之间，默认值由 service 内各自控制
 */
export const DashboardQuerySchema = z.object({
  // 返回条数：1-50，可选
  limit: z
    .coerce
    .number()
    .int('limit 必须为整数')
    .min(1, 'limit 最小为 1')
    .max(50, 'limit 最大为 50')
    .optional(),
})

// ============ 类型导出 ============

export type DashboardQuery = z.infer<typeof DashboardQuerySchema>
