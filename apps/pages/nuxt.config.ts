import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'

/**
 * Nuxt 配置（apps/pages 公开内容站）
 *
 * - 默认开启 SSR：公开内容（blog / wiki / 日志）服务端渲染 HTML，面向 SEO
 * - Tailwind CSS v4 通过 Vite 插件接入（与 apps/web 同款方案，无额外模块）
 * - API 连通策略（浏览器与 SSR 统一走相对路径 /api/v1，见 app/api/request.ts）：
 *   - 浏览器端：dev 由 nitro.devProxy 转发到 server，生产由反向代理（Caddy /api → server）转发
 *   - SSR 端：$fetch 相对路径由 Nuxt 函数直调到 Nitro 内部代理路由
 *     （server/routes/api/[...path].ts），再转发到 apiInternalUrl（server :6001）
 */
export default defineNuxtConfig({
  compatibilityDate: '2026-09-06',
  devtools: { enabled: true },

  // 全局样式（Tailwind v4 入口 + 设计 token + Markdown 正文排版 + 帮助中心差异层）
  // - @yokimind/markdown-css：workspace 共享包，Markdown 正文排版单一来源
  //   （与 apps/web 编辑器同一份规则），必须排在 help-content.css 之前，
  //   后者只承载发布态差异（首尾贴边 / 锚点留白 / 段前节奏）可按需覆盖；
  // arco Tree 按需样式：帮助中心左栏文档树使用 a-tree（与 apps/web share-guest 同组件），
  // 仅引入 Tree 的组件样式，避免全量 arco.css 的全局重置影响页面既有 shadcn/tailwind 风格
  css: [
    '~/assets/css/main.css',
    '@yokimind/markdown-css/markdown.css',
    '~/assets/css/help-content.css',
    '@arco-design/web-vue/es/tree/style/index.css',
  ],

  // shadcn-vue 组件以原始名注册（components/ui/button/Button.vue → <Button>，
  // 不加路径前缀），与 apps/web 的使用习惯一致；
  // ignore 掉 index.ts 桶文件，避免其 re-export 被当成同名组件产生冲突警告
  components: [
    {
      path: '~/components',
      pathPrefix: false,
      ignore: ['**/index.ts'],
    },
  ],

  vite: {
    plugins: [tailwindcss()],
    server: {
      // Host 头校验白名单：本地方案通过 /etc/hosts 把 pages.yokimind.local 映射到 127.0.0.1，
      // 内置 Vite dev server 默认只放行 localhost/IP，浏览器带 pages.yokimind.local Host 访问
      // 会被拦下（"Blocked request ... not allowed"），需显式放行本地域名；
      // 数组会整体替换默认白名单，故把 localhost 系列一并带上（与 apps/web vite.config 同款约定）
      allowedHosts: ['pages.yokimind.local', '.yokimind.local', 'localhost', '.localhost'],
    },
  },

  runtimeConfig: {
    // 服务端私有：SSR 内部代理路由（server/routes/api/[...path].ts）的上游地址。
    // 端口统一布局后 dev 与容器同值（回环），直接写死：
    // - 本地 dev：server 进程跑宿主 6001
    // - 生产容器：server 与 pages 同容器，API 监听 6001（两进程共享 network namespace）
    // 特殊部署（pages 独立容器/独立主机）用 NUXT_API_INTERNAL_URL 覆盖
    apiInternalUrl: 'http://127.0.0.1:6001',
  },

  nitro: {
    // 品牌资源单一真源：favicon/logo 共用文件全部由 @yokimind/brand-assets 包提供
    //（public/ 只保留本应用专属文件 robots.txt，不放任何品牌图标）
    // 注意：dir 必须用绝对路径 —— nitro publicAssets 的相对路径按「构建输出目录」解析，
    // dev worker 的解析基准与 rootDir 错位（相对路径 dev 下 404 实测）；绝对路径 dev/build 均可靠。
    publicAssets: [
      {
        dir: fileURLToPath(new URL('./node_modules/@yokimind/brand-assets/public', import.meta.url)),
      },
    ],
    devProxy: {
      // /api 开头的请求转发到 Hono server（apps/server，本地 dev 宿主 6001）
      // 注意：Nuxt 4（h3 v2）的 devProxy 会剥掉匹配的路径前缀 /api（实测转发为 /v1/...），
      // 因此 target 必须自带 /api 前缀，最终拼接出 http://localhost:6001/api/v1/...
      '/api': {
        target: 'http://localhost:6001/api',
        changeOrigin: true,
      },
    },
  },

  app: {
    head: {
      // 注意：titleTemplate 的函数形式只能在 app.vue 的 useHead 中设置
      // （nuxt.config 的 head schema 对 titleTemplate 仅接受 string 类型）
      htmlAttrs: { lang: 'zh-CN' },
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'description', content: 'Yokimind：把你的知识发布成 Blog、Wiki 与图文日志' },
      ],
      link: [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
    },
  },

  hooks: {
    // dev server 监听完成后，在 nuxt 默认的 Listening 地址之外
    // 额外提示本地方名访问地址（yokimind.local → 127.0.0.1 的映射写在 /etc/hosts）
    listen() {
      console.info('  ➜  Local (域名): http://pages.yokimind.local:6002')
      // 统一入口模式（docker/Caddyfile.dev 路由 /w /b /_nuxt → 本进程）：推荐经入口访问
      console.info('  ➜  统一入口:     http://yokimind.local:60000/w/{wikiId}')
    },
  },
})
