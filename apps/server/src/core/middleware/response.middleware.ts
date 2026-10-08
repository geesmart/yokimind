import { createMiddleware } from 'hono/factory'

export const responseMiddleware = createMiddleware(async (c, next) => {
  c.success = <T>(data: T) => {
    return c.json({ status: 1, data })
  }

  c.fail = (info: string, status: number = 0) => {
    return c.json({ status, info })
  }

  await next()
})
