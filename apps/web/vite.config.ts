import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 解析品牌资源单一真源目录：@yokimind/brand-assets 包内的 public/。
 * web 的 public/ 不再存放任何品牌图标文件（由本包统一供给），
 * dev 阶段走下方中间件伺服、build 阶段由 generateBundle 直接产出进 dist。
 * 返回 null 表示包尚未安装（新克隆未 pnpm install），此时静默跳过品牌资源伺服。
 */
function brandAssetsDir(): string | null {
  const dir = resolve(import.meta.dirname, './node_modules/@yokimind/brand-assets/public')
  return existsSync(dir) ? dir : null
}

/** 品牌文件扩展名 → Content-Type 映射（brand-assets/public 目录当前只有 svg 与 png） */
const BRAND_MIME: Record<string, string> = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
}

/** 虚拟模块前缀：品牌路径在构建期的解析产物标识（\0 前缀为 Vite 虚拟模块惯例） */
const BRAND_VIRTUAL_PREFIX = '\0yokimind-brand:'

/**
 * 判断一个 import 说明符是否指向包内品牌文件。
 * 仅接受根绝对路径（模板编译产物形如 '/logo-yokimind.png'）且文件真实存在于包目录。
 */
function resolveBrandAsset(id: string): string | null {
  if (!id.startsWith('/')) return null
  const name = id.slice(1)
  // 仅匹配平铺文件名（favicon.svg / logo-*.png），拒绝路径分隔与目录穿越
  if (!/^[A-Za-z0-9._-]+$/.test(name)) return null
  const dir = brandAssetsDir()
  return dir && statSyncSafe(join(dir, name))?.isFile() ? name : null
}

/** statSync 的不抛错封装：文件不存在返回 null */
function statSyncSafe(file: string): import('node:fs').Stats | null {
  try {
    return statSync(file)
  } catch {
    return null
  }
}

/**
 * 品牌资源单一真源插件：web 的 public/ 不落任何品牌图标，改由本插件三路供给——
 * 1. resolveId/load：SFC 模板里的 <img src="/logo-*.png"> 会被编译成 import 语句，
 *    构建期按 public 文件同样的语义解析为「原始公开路径字符串」（不参与 hash 重命名），
 *    避免清空 public/ 后出现 UNRESOLVED_IMPORT；
 * 2. dev：后置中间件从包目录实时伺服（放在 Vite 内部中间件之后，不抢占模块转换与代理）；
 * 3. build：generateBundle 把包内文件按 asset 形式直接产出进 dist 根目录，
 *    与旧版「复制进 public 再随构建拷贝」的产物布局完全一致（部署静态服务无感知）。
 * 包未安装时各路均静默跳过（vite 本身也依赖 pnpm install，此兜底仅防御性保留）。
 */
function brandAssetsPlugin(): Plugin {
  return {
    name: 'brand-assets-serve',
    resolveId(id) {
      const name = resolveBrandAsset(id)
      return name ? BRAND_VIRTUAL_PREFIX + name : undefined
    },
    load(id) {
      if (!id.startsWith(BRAND_VIRTUAL_PREFIX)) return undefined
      // 与 Vite 对 public 目录文件的构建产物语义一致：默认导出原始公开路径字符串
      return `export default ${JSON.stringify('/' + id.slice(BRAND_VIRTUAL_PREFIX.length))}`
    },
    configureServer(server) {
      // 直接 use = 前置中间件：必须在 Vite 内部中间件之前伺服。
      // 若放后置（configureServer 返回函数），带扩展名的静态请求会先被 Vite 的
      // htmlFallback/SPA fallback 改写成 /index.html，永远轮不到后置中间件（实测验证）。
      // 品牌文件名（favicon.svg / logo-*.png）与模块转换、/api 等代理路径无交集，前置无副作用。
      server.middlewares.use((req, res, next) => {
        const dir = brandAssetsDir()
        if (!dir || !req.url) return next()
        const name = new URL(req.url, 'http://localhost').pathname.slice(1)
        if (!/^[A-Za-z0-9._-]+$/.test(name)) return next()
        const stat = statSyncSafe(join(dir, name))
        if (!stat?.isFile()) return next() // 非品牌文件：交还给 Vite 后续中间件
        res.setHeader(
          'Content-Type',
          BRAND_MIME[name.slice(name.lastIndexOf('.')).toLowerCase()] ?? 'application/octet-stream'
        )
        res.end(readFileSync(join(dir, name)))
      })
    },
    generateBundle() {
      const dir = brandAssetsDir()
      if (!dir) return
      for (const name of readdirSync(dir)) {
        const file = join(dir, name)
        if (!statSync(file).isFile()) continue
        // emitFile 产出位置与旧版 public 复制一致：dist 根目录（部署路径 /<文件名> 不变）
        this.emitFile({ type: 'asset', fileName: name, source: readFileSync(file) })
      }
    },
  }
}

/**
 * 本地方名地址提示插件：vite 启动完成后，在默认的 Local/Network 地址之外
 * 追加打印 http://yokimind.local:6001（域名 → 127.0.0.1 的映射写在 /etc/hosts）。
 * 监听 'listening' 后用 setImmediate 再输出，保证这一行排在 vite 自身地址之后。
 */
function printLocalDomainUrls(): Plugin {
  return {
    name: 'print-local-domain-urls',
    configureServer(server) {
      server.httpServer?.once('listening', () => {
        setImmediate(() => {
          // 端口从 vite 解析后的配置里取，兼容 --port 临时覆盖的情况
          const port = server.config.server.port ?? 6000
          server.config.logger.info('')
          server.config.logger.info(`  ➜  Local (域名): http://yokimind.local:${port}/`)
        })
      })
    },
  }
}

/**
 * 根 package.json 的 version：发布流水线（bin/ Docker 三步）与本产物 tar 命名的版本真源。
 * 构建期经 define 注入为全局常量 __APP_VERSION__，落地页等处直接展示当前版本。
 */
const rootPkgVersion = (
  JSON.parse(readFileSync(resolve(import.meta.dirname, '../../package.json'), 'utf-8')) as {
    version: string
  }
).version

/** Vite 配置文件
 * 为 Vue3 + TypeScript 前端应用提供构建与开发服务配置
 */
export default defineConfig(() => {
  return {
    // 版本号注入：dev 与 build 均生效，前端以 __APP_VERSION__ 常量直接引用
    define: {
      __APP_VERSION__: JSON.stringify(rootPkgVersion),
    },
    // 注册 Vue 单文件组件编译插件（+ 品牌资源单一真源伺服 + 本地方名地址提示）
    plugins: [vue(), tailwindcss(), brandAssetsPlugin(), printLocalDomainUrls()],
    resolve: {
      alias: [
        // 路径别名 @ 指向 src 目录，便于源码中统一引用
        // 注意：Vite 8 的 native configLoader 不支持 __dirname，须用 import.meta.dirname
        {
          find: '@',
          replacement: resolve(import.meta.dirname, './src'),
        },
        // Vite 8 dev 解析 @tiptap/static-renderer 的 exports 深子路径存在 bug：
        // TS（vue-tsc）、esbuild 预构建、Rolldown 构建均能正常解析，唯独 dev 的
        // import-analysis 报 "Failed to resolve import ... Does the file exist?"。
        // 显式别名直指该子路径的 ESM 产物绕过 exports 解析（与 exports map 的
        // import 条件指向同一文件，dev/build 行为一致）。
        // 注意：不能用主入口 @tiptap/static-renderer 替代 —— 其顶层 import react，
        // web 未安装 react，会导致 dev 预构建直接失败，pm/html-string 是无 react 的纯净入口。
        {
          find: '@tiptap/static-renderer/pm/html-string',
          replacement: resolve(
            import.meta.dirname,
            './node_modules/@tiptap/static-renderer/dist/pm/html-string/index.js'
          ),
        },
      ],
    },
    server: {
      // 默认开发服务器端口（本地方名方案：http://yokimind.local:6000，
      // 域名→127.0.0.1 的映射写在 /etc/hosts；统一端口布局与容器内 web 静态 6000 一致）
      port: 6000,
      // 允许局域网内其他设备访问
      host: true,
      // Host 头校验白名单：本地方案通过 /etc/hosts 把 yokimind.local 映射到 127.0.0.1，
      // vite（host: true 开启 host 校验）默认只放行 localhost/IP，需显式放行本地域名；
      // 数组会整体替换默认白名单，故把 localhost 系列一并带上
      allowedHosts: ['yokimind.local', '.yokimind.local', 'localhost', '.localhost'],
      // 代理配置
      proxy: {
        // 将 /api 开头的请求代理到后端服务器（统一端口布局：server 监听 6001）
        '/api': {
          target: 'http://localhost:6001',
          changeOrigin: true,
          // 开发环境下记录代理请求（便于调试）
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              // 可以在这里添加自定义请求头
              proxyReq.setHeader('X-PROXY', 'vite-dev')
            })
          },
        },
        // /media/*（对象存储媒体）转发到 rustfs（6012）：媒体 URL 恒为相对路径
        // /media/{bucket}/{key}（浏览器按当前 origin 解析，见 server storage.buildObjectUrl），
        // 直连 vite 端口访问 web 时图片也要能加载——rustfs 直连路径无 /media 前缀，需剥掉
        '/media/': {
          target: 'http://localhost:6012',
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/media/, ''),
        },
        // /w/*（帮助中心）、/b/*（博客）、/_nuxt/*（pages 构建产物与 HMR）转发到 pages（6002）：
        // 发布弹窗链接按 window.location.origin 同源派生（publish.ts buildWikiPagesLink），
        // 直连端口访问 web 时也要能打开公开站——与 Caddyfile.dev 的路径路由同构
        // 注意：proxy 键是 startsWith 前缀匹配（vite dist/node/chunks/node.js
        // doesProxyContextMatchUrl），键必须带尾斜杠写成 /w/ /b/ ——
        // 写 /w 会误吞 /wiki（web 核心路由，被转发到 pages 后 302 回公开站）、
        // 写 /b 会误吞 /brand（品牌素材页）
        '/w/': {
          target: 'http://localhost:6002',
          changeOrigin: true,
        },
        '/b/': {
          target: 'http://localhost:6002',
          changeOrigin: true,
        },
        '/_nuxt': {
          target: 'http://localhost:6002',
          changeOrigin: true,
          // pages 的 HMR WebSocket 挂在 /_nuxt/ 路径上，需开启 ws 代理
          ws: true,
        },
      },
    },
    build: {
      // 构建输出目录，与 monorepo 约定保持一致
      outDir: './dist',
      // 每次构建前清空输出目录，避免旧文件残留
      emptyOutDir: true,
      // 生产环境压缩：Vite 8 起内置压缩器为 oxc（esbuild 压缩器已随 Rolldown 迁移移除），
      // true 即使用默认 oxc 压缩
      minify: true,
    },
  }
})
