import pino from 'pino'
import os from 'os'

let logger: pino.Logger | null = null

export const usePino = () => {
  if (logger) return logger

  const isDev = process.env.NODE_ENV !== 'production'
  const logFile = process.env.LOG_FILE

  const targets: Array<{ target: string; options?: Record<string, unknown> }> = []

  // 如果配置了 LOG_FILE，则使用 pino-roll 做日志轮转
  if (logFile) {
    targets.push({
      target: 'pino-roll',
      options: {
        file: logFile,
        size: process.env.LOG_MAX_SIZE || '100m',
        limit: { count: parseInt(process.env.LOG_MAX_FILES || '7', 10) },
        mkdir: true,
      },
    })
  }

  // 开发环境控制台输出美化格式
  if (isDev) {
    targets.push({
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
      },
    })
  }

  logger = pino({
    level: process.env.LOG_LEVEL || 'info',
    base: {
      service: 'yokimind-server',
      env: process.env.NODE_ENV || 'development',
      pid: process.pid,
      hostname: os.hostname(),
    },
    ...(targets.length > 0 && {
      transport: {
        targets,
      },
    }),
  })

  return logger
}

export type PinoLogger = pino.Logger
