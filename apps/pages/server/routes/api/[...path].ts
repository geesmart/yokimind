/**
 * SSR 内部 API 代理路由（catch-all /api/**）
 *
 * 为什么需要这个路由：
 * - SSR 取数发生在本进程（Node）里，Node fetch 没有页面 origin，不能像浏览器那样
 *   直接用相对路径 /api/v1。为了让请求层（app/api/request.ts）两端统一 baseURL='/api/v1'，
 *   SSR 端 $fetch 的相对路径会被 Nuxt「函数直调」到本路由（同进程，无 HTTP 自绕），
 *   再由这里 proxyRequest 转发到真正的 Hono server（apps/server）。
 *
 * 上游地址：runtimeConfig.apiInternalUrl（nuxt.config.ts，server-only）
 * - dev 宿主：server 进程监听 6001，回环直连
 * - 生产容器：server 与 pages 同容器共享 network namespace，同为 127.0.0.1:6001
 * - 特殊部署（pages 独立容器/主机）：NUXT_API_INTERNAL_URL 环境变量覆盖
 *
 * 浏览器端 /api 请求不会走到这里：
 * - dev：nitro.devProxy 在监听层拦截（见 nuxt.config.ts）
 * - 生产：Caddy 把 /api/* 直接路由到 server 端口（根 Caddyfile）
 *
 * 注意：event.path 自带完整 /api 前缀与查询串，所以 target 只写 host——
 * 与 devProxy「剥掉 /api 前缀、target 必须自带 /api」的行为相反，勿混淆。
 */
import { proxyRequest } from 'h3'

export default defineEventHandler((event) => {
  const { apiInternalUrl } = useRuntimeConfig(event)
  return proxyRequest(event, apiInternalUrl + event.path)
})
