import { createApp } from 'vue'
import { createPinia } from 'pinia'
// Inter 字体改为本地自托管（@fontsource/inter，woff2 随站点同源下发，
// 按 unicode-range 分片、font-display: swap）。
// 历史上这里依赖 style.css 顶部的 fonts.googleapis.com @import，
// 但该域名在国内网络不可达，而 CSS @import 会阻塞整张样式表生效，
// 导致 Tailwind 样式长时间整体失效（页面退化为浏览器默认样式：
// logo 以原始尺寸撑爆、flex 居中失效、按钮变原生外观）。
// 如需调整字重，同步增删这里的 CSS 入口即可。
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import ArcoVue from '@arco-design/web-vue'
import '@arco-design/web-vue/dist/arco.css'
import 'vue-sonner/style.css'
import './style.css'
// Markdown 正文排版共享样式（@yokimind/markdown-css，workspace 包）：
// 内容排版单一来源，编辑态专属规则随后的 markdown.scss 可按需覆盖。
// 注意引入顺序：共享在前、本地编辑态在后。
import '@yokimind/markdown-css'
import './assets/markdown.scss'
import App from './App.vue'
import router from './router'

/**
 * Vue 应用入口
 * 依次挂载 Pinia、Vue Router
 * 请求层基于 alova（见 src/api），Token 注入与 401 处理已在实例内配置
 * 全局 Toast 组件 Toaster 在 App.vue 中注册
 */
const app = createApp(App)

app.use(createPinia())
app.use(router)
// 注册 arco-vue，供 sideBar 文档树使用 a-tree（本处仅使用 Tree 组件能力）
app.use(ArcoVue)
app.mount('#app')
