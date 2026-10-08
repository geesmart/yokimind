import { createMiddleware } from 'hono/factory'
import config from '~/config/adapter.js'
import { initPostgres } from '~/core/plugins/postgres.js'
import { usePino } from '~/core/plugins/pino.js'

export const loadConfig = createMiddleware(async (c, next) => {
  if (config.db && config.db.enable) {
    const db = initPostgres(config.db.postgres.url!)
    c.set('db', db)
  }

  if (config.pino && config.pino.enable) {
    const pinoLogger = usePino()
    c.set('log', pinoLogger)
  }

  await next()
})
