import { zValidator } from '@hono/zod-validator'
import { z, ZodSchema } from 'zod'

export type ZodValidationTarget = 'json' | 'query' | 'param' | 'form' | 'header'

export const validator = <T extends ZodSchema>(
  target: ZodValidationTarget,
  schema: ZodSchema,
  customMessage?: string
) =>
  zValidator(target, schema, (result, c) => {
    if (!result.success) {
      const errorMessage = customMessage || 'Validation failed'
      const fieldErrors = result.error.flatten().fieldErrors
      return c.json({
        status: 10001,
        info: errorMessage,
        meta: fieldErrors,
      })
    }
  })

export const vJson = <T extends ZodSchema>(schema: T) => {
  return zValidator('json', schema, (result, c) => {
    if (!result.success) {
      return c.json(
        {
          status: 10001,
          info: result.error.errors[0]?.message || 'Parameter error',
        },
        200
      )
    }
  })
}

export const vQuery = <T extends ZodSchema>(schema: T) => {
  return zValidator('query', schema, (result, c) => {
    if (!result.success) {
      return c.json(
        {
          status: 10001,
          info: result.error.errors[0]?.message || 'Parameter error',
        },
        200
      )
    }
  })
}
