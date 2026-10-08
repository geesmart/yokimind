/**
 * 应用配置适配器
 * 全部通过环境变量读取，分发场景（Docker / 裸机 dist 包）只需 DATABASE_URL
 */
export default {
  db: {
    enable: true,
    type: 'postgres',
    postgres: {
      url: process.env.DATABASE_URL,
    },
  } as const,

  pino: {
    enable: true,
    // 要记录的 header 列表（小写，逗号分隔）
    // 例如：'authorization,x-forwarded-for,user-agent'
    headers: process.env.LOG_HEADERS
      ? process.env.LOG_HEADERS.split(',').map(h => h.trim().toLowerCase())
      : ['authorization'], // 默认只记录 authorization

    // 是否输出 SQL 日志
    // 设置为 true 时，会输出所有执行的 SQL 语句（包括参数值）
    sql: process.env.LOG_SQL === 'true',
  } as const,

  jwt: {
    secret: process.env.JWT_SECRET || 'your-secret-key',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  } as const,
}
