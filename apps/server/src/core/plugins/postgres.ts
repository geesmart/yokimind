import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from '~/db/schema.js'
import config from '~/config/adapter.js'

let db: ReturnType<typeof drizzle<typeof schema>> | null = null

/**
 * 初始化 PostgreSQL 数据库连接
 * 设置时区为中国时区 (Asia/Shanghai)
 * @param url 数据库连接 URL
 * @returns Drizzle 数据库实例
 */
export const initPostgres = (url: string): ReturnType<typeof drizzle<typeof schema>> => {
  if (db) return db

  const client = postgres(url, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
    // 设置连接时区为中国时区
    connection: {
      TimeZone: 'Asia/Shanghai',
    },
    // SQL 调试输出 - 将参数填充到 SQL 中生成可执行的 SQL
    debug: config.pino.sql
      ? (_connection, query, params) => {
          // 将参数填充到 SQL 中生成可执行的 SQL
          let executableSql = query
          if (params && params.length > 0) {
            params.forEach((param, index) => {
              const placeholder = `$${index + 1}`
              const value = typeof param === 'string' ? `'${param}'` : param
              executableSql = executableSql.replace(placeholder, String(value))
            })
          }
          console.log('[SQL]', executableSql)
        }
      : undefined,
  })

  db = drizzle(client, { schema })
  return db
}

/**
 * 获取 PostgreSQL 数据库实例
 * 必须先调用 initPostgres 初始化
 * @returns Drizzle 数据库实例
 */
export const usePostgres = (): ReturnType<typeof drizzle<typeof schema>> => {
  if (!db) {
    throw new Error('PostgreSQL 未初始化，请先调用 initPostgres')
  }
  return db
}

export type Database = ReturnType<typeof drizzle<typeof schema>>
