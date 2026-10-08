import type { Hono } from 'hono'
import config from '~/config/adapter.js'

interface RouteInfo {
  method: string
  path: string
}

interface ServiceInfo {
  name: string
  status: 'enabled' | 'disabled'
  details: { label: string; value: string }[]
}

/**
 * 递归提取 Hono 应用中的所有路由信息
 * @param app - Hono 应用实例
 * @param basePath - 基础路径（用于递归）
 * @returns 路由信息数组
 */
function extractRoutes(app: Hono, basePath: string = ''): RouteInfo[] {
  const routes: RouteInfo[] = []

  // @ts-ignore - 访问内部路由结构
  const appRoutes = app.routes || []

  for (const route of appRoutes) {
    const fullPath = basePath + route.path

    // 处理嵌套路由 - 当 handler 是 Hono 实例时
    if (route.method === 'ALL' && route.handler && typeof route.handler === 'object') {
      // 检查是否是 Hono 实例（有 routes 属性）
      // @ts-ignore
      if (route.handler.routes) {
        // 这是子路由，递归提取
        const subRoutes = extractRoutes(route.handler as Hono, fullPath)
        routes.push(...subRoutes)
      }
      // 跳过中间件路由（没有嵌套路由的 ALL 方法）
      continue
    }

    // 只添加实际的 HTTP 方法路由，跳过通配符中间件
    if (route.path !== '*' && route.method !== 'ALL') {
      routes.push({
        method: route.method,
        path: fullPath,
      })
    }
  }

  return routes
}

/**
 * 去重路由（相同方法和路径只保留一个）
 * @param routes - 路由信息数组
 * @returns 去重后的路由数组
 */
function deduplicateRoutes(routes: RouteInfo[]): RouteInfo[] {
  const seen = new Set<string>()
  return routes.filter(route => {
    const key = `${route.method}:${route.path}`
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}

/**
 * 格式化并打印路由列表
 * @param routes - 路由信息数组
 */
function printRoutes(routes: RouteInfo[]): void {
  // 去重
  const uniqueRoutes = deduplicateRoutes(routes)

  // 按路径排序，相同路径按方法排序
  const sortedRoutes = uniqueRoutes.sort((a, b) => {
    if (a.path === b.path) {
      const methodOrder = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']
      const aIndex = methodOrder.indexOf(a.method)
      const bIndex = methodOrder.indexOf(b.method)
      if (aIndex !== -1 && bIndex !== -1) {
        return aIndex - bIndex
      }
      return a.method.localeCompare(b.method)
    }
    return a.path.localeCompare(b.path)
  })

  // 计算列宽
  const maxMethodWidth = Math.max(...sortedRoutes.map(r => r.method.length), 6)
  const maxPathWidth = Math.max(...sortedRoutes.map(r => r.path.length), 4)

  // 打印表头
  console.log('\n📋 Registered Routes:')
  console.log('─'.repeat(maxMethodWidth + maxPathWidth + 7))
  console.log(` ${'METHOD'.padEnd(maxMethodWidth)} │ ${'PATH'.padEnd(maxPathWidth)}`)
  console.log('─'.repeat(maxMethodWidth + maxPathWidth + 7))

  // 打印路由
  for (const route of sortedRoutes) {
    const methodColor = getMethodColor(route.method)
    console.log(` ${methodColor}${route.method.padEnd(maxMethodWidth)}\x1b[0m │ ${route.path}`)
  }

  console.log('─'.repeat(maxMethodWidth + maxPathWidth + 7))
  console.log(`Total: ${sortedRoutes.length} routes\n`)
}

/**
 * 根据 HTTP 方法返回对应的颜色代码
 * @param method - HTTP 方法
 * @returns ANSI 颜色代码
 */
function getMethodColor(method: string): string {
  const colors: Record<string, string> = {
    'GET': '\x1b[32m',     // Green
    'POST': '\x1b[34m',    // Blue
    'PUT': '\x1b[33m',     // Yellow
    'PATCH': '\x1b[36m',   // Cyan
    'DELETE': '\x1b[31m',  // Red
    'ALL': '\x1b[35m',     // Magenta
    'OPTIONS': '\x1b[90m', // Gray
    'HEAD': '\x1b[90m',    // Gray
  }
  return colors[method] || '\x1b[0m'
}

/**
 * 显示 Hono 应用的所有路由
 * 在服务器启动时调用此函数来打印路由列表
 *
 * @example
 * ```typescript
 * import { createApp } from '~/app.js'
 * import { showRoutes } from '~/core/helper/hono.helper.js'
 *
 * const app = createApp()
 * showRoutes(app)
 * ```
 */
export function showRoutes(app: Hono): void {
  const routes = extractRoutes(app)
  printRoutes(routes)
}

/**
 * 获取路由列表（用于程序化使用）
 * @param app - Hono 应用实例
 * @returns 路由信息数组
 */
export function getRoutes(app: Hono): RouteInfo[] {
  const routes = extractRoutes(app)
  return deduplicateRoutes(routes)
}

/**
 * 隐藏数据库 URL 中的密码
 * @param url - 数据库连接 URL
 * @returns 隐藏密码后的 URL
 */
function maskDatabaseUrl(url: string | undefined): string {
  if (!url) return 'Not configured'
  try {
    const parsed = new URL(url)
    if (parsed.password) {
      parsed.password = '***'
    }
    return parsed.toString()
  } catch {
    return 'Invalid URL'
  }
}

/**
 * 打印服务信息表格
 * @param services - 服务信息数组
 */
function printServicesTable(services: ServiceInfo[]): void {
  console.log('\n🔧 Services Configuration:')
  console.log('─'.repeat(60))

  for (const service of services) {
    const statusColor = service.status === 'enabled' ? '\x1b[32m' : '\x1b[31m'
    const statusText = service.status === 'enabled' ? '●' : '○'

    console.log(`\n ${statusColor}${statusText}\x1b[0m ${service.name}`)

    for (const detail of service.details) {
      console.log(`    ${detail.label.padEnd(12)}: ${detail.value}`)
    }
  }

  console.log('\n' + '─'.repeat(60) + '\n')
}

/**
 * 显示服务配置信息
 * 在服务器启动时调用此函数来打印服务状态
 *
 * @example
 * ```typescript
 * import { showServicesInfo } from '~/core/helper/hono.helper.js'
 *
 * showServicesInfo()
 * ```
 */
export function showServicesInfo(): void {
  const services: ServiceInfo[] = [
    {
      name: 'PostgreSQL',
      status: config.db.enable ? 'enabled' : 'disabled',
      details: [
        { label: 'Type', value: 'PostgreSQL' },
        { label: 'URL', value: maskDatabaseUrl(config.db.postgres.url) },
      ],
    },
    {
      name: 'JWT',
      status: 'enabled',
      details: [
        { label: 'Expires In', value: config.jwt.expiresIn },
        { label: 'Secret', value: config.jwt.secret && config.jwt.secret !== 'your-secret-key' ? '✓ Set' : '✗ Default' },
      ],
    },
    {
      name: 'Pino Logger',
      status: config.pino.enable ? 'enabled' : 'disabled',
      details: [],
    },
  ]

  printServicesTable(services)
}
