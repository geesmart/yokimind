import { BizException } from '~/core/lib/biz.exception.js'
import type { Context } from 'hono'
import { usePino } from '~/core/plugins/pino.js'

export const errorHandler = (err: BizException | Error, c: Context) => {
  // 从上下文获取 logger，若失败则降级到全局实例
  const logger = c.get('log') ?? usePino()
  const requestId = c.get('requestId')
  const userId = c.get('userId')
  const path = c.req.path

  if (err instanceof BizException) {
    logger.warn(
      {
        err: { name: err.name, message: err.message, code: err.code },
        requestId,
        userId,
        path,
      },
      'business error'
    )

    return c.json({
      status: err.code,
      info: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack?.split('\n') : undefined,
    })
  }

  logger.error(
    {
      err: { name: err.name, message: err.message },
      requestId,
      userId,
      path,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    },
    'unexpected error'
  )

  return c.json(
    {
      status: 0,
      info: err.message || 'Internal Server Error',
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    },
    500,
  )
}
