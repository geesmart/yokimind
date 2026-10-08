import { Hono } from 'hono'
import { usePostgres } from '~/core/plugins/postgres.js'

/**
 * 健康检查控制器
 * 用于验证数据库连接和其他服务状态
 */
const healthController = new Hono()

/**
 * 基础健康检查
 * 检查服务是否正常运行
 */
healthController.get('/', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'reddit-helper-api',
  })
})

/**
 * 数据库连接测试
 * 验证与远程 PostgreSQL 的连接是否正常
 */
healthController.get('/db', async (c) => {
  try {
    const db = usePostgres()

    // 执行简单查询测试连接
    const result = await db.execute('SELECT NOW() as current_time, version() as db_version')

    return c.json({
      status: 'ok',
      message: '数据库连接正常',
      timestamp: new Date().toISOString(),
      data: {
        currentTime: result[0].current_time,
        dbVersion: result[0].db_version,
      },
    })
  } catch (error) {
    return c.json(
      {
        status: 'error',
        message: '数据库连接失败',
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : '未知错误',
      },
      500
    )
  }
})

/**
 * 详细健康检查
 * 检查数据库连接并返回表统计信息
 */
healthController.get('/detail', async (c) => {
  try {
    const db = usePostgres()

    // 测试连接
    const timeResult = await db.execute('SELECT NOW() as current_time')

    // 获取所有表名
    const tables = await db.execute(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
    `)

    // 获取数据库大小
    const dbSize = await db.execute(`
      SELECT pg_size_pretty(pg_database_size(current_database())) as size
    `)

    return c.json({
      status: 'ok',
      message: '所有服务正常',
      timestamp: new Date().toISOString(),
      data: {
        database: {
          connected: true,
          currentTime: timeResult[0].current_time,
          size: dbSize[0].size,
          tableCount: tables.length,
        },
      },
    })
  } catch (error) {
    return c.json(
      {
        status: 'error',
        message: '健康检查失败',
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : '未知错误',
      },
      500
    )
  }
})

export default healthController
