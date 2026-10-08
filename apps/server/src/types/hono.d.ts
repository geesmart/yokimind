import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import type { PinoLogger } from '~/core/plugins/pino.js'
import type { TokenPayload } from '~/core/utils/token.util.js'
import * as schema from '~/db/schema.js'

/**
 * Hono 上下文变量类型定义
 */
declare module 'hono' {
  interface ContextVariableMap {
    // 数据库连接
    db: PostgresJsDatabase<typeof schema>

    // 日志记录器
    log: PinoLogger

    // 请求唯一标识
    requestId: string

    // Token 用户信息
    user: TokenPayload | null
    /** 当前用户 ID（ULID 字符串） */
    userId: string | null
  }

  // 扩展 Context 类型，添加自定义方法
  interface Context {
    success: <T>(data: T) => Response
    fail: (info: string, status?: number) => Response
  }
}

export {}
