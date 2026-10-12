/**
 * 程序化数据库迁移入口（npm CLI / Docker 分发场景使用）
 *
 * - 使用 drizzle-orm 的 migrate() API 直接应用 drizzle/migrations 下的迁移，
 *   不依赖 drizzle-kit CLI（发布包里无法安装 devDependencies）
 * - 构建产物为 dist/migrate.js，启动流程中先于 dist/index.js 执行：
 *   `node dist/migrate.js && node dist/index.js`
 * - 迁移目录可通过 MIGRATIONS_DIR 环境变量覆盖（npm 包内为 ./migrations），
 *   默认 `./drizzle/migrations`（相对进程 cwd，与本地开发/PM2 部署一致）
 * - 迁移失败立即退出（exit 1），由启动方决定是否重试，避免半迁移状态下继续启动服务
 */
import '~/core/lib/env.js'
import path from 'node:path'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'

// 迁移 SQL 目录：默认 drizzle/migrations（开发/PM2 场景），分发场景由 CLI 注入 MIGRATIONS_DIR
const migrationsFolder = process.env.MIGRATIONS_DIR
  ? path.resolve(process.env.MIGRATIONS_DIR)
  : path.resolve(process.cwd(), 'drizzle/migrations')

const url = process.env.DATABASE_URL
if (!url) {
  console.error('[migrate] DATABASE_URL is not configured')
  process.exit(1)
}

// 迁移使用单连接即可，避免连接池开销
const client = postgres(url, { max: 1 })

try {
  const db = drizzle(client)
  await migrate(db, { migrationsFolder })
  console.log(`[migrate] migrations applied from ${migrationsFolder}`)
  process.exit(0)
} catch (err) {
  console.error('[migrate] migration failed:', err)
  process.exit(1)
} finally {
  await client.end()
}
