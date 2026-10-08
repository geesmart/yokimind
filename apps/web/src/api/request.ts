/**
 * 统一请求层（基于 alova）
 *
 * 内建能力：
 * - Token 自动注入（localStorage，登录等公开接口用 `meta: { auth: false }` 跳过）
 * - 统一 baseURL（`/api/v1`）、超时控制
 * - 统一响应解包：后端 `{ status, data, info }`，成功直接返回 `data`
 * - 统一错误处理：业务失败抛 `ApiError`；HTTP 401 自动清除认证信息
 * - 请求共享 / 缓存 / 重试等策略（alova 原生支持）
 *
 * 使用：业务模块直接基于 `alova` 按 alova 原生格式写请求，
 * 例如 `alova.Get<T>(path, config)` / `alova.Post<T>(path, data, config)`。
 * 组件内可用 `useRequest` 获得 loading/data/error 等响应式状态。
 */
import { createAlova } from 'alova'
import type { Method } from 'alova'
import VueHook from 'alova/vue'
import adapterFetch from 'alova/fetch'
import { API_BASE_URL, API_PREFIX, DEFAULT_TIMEOUT, ERROR_CODES } from './constants'
import { getAccessToken, clearAuth } from '../utils/token'
import { openAuthDialog } from '../composables/use-auth-dialog'

// ==================== 统一错误 ====================

/** 业务错误，携带后端业务码与 HTTP 状态码 */
export class ApiError extends Error {
  /** 业务错误码（对应 constants.ts 的 ERROR_CODES） */
  code: number
  /** HTTP 状态码 */
  httpStatus?: number
  /** 原始响应数据 */
  data?: unknown

  constructor(message: string, code: number, httpStatus?: number, data?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.httpStatus = httpStatus
    this.data = data
  }
}

// ==================== alova 实例 ====================

/**
 * 认证失效统一处理：弹出全局登录弹窗引导重新登录
 * - 免鉴权接口（`meta: { auth: false }`，如登录/注册本身）不弹：由页面自行提示错误
 * - 已处于登录/注册页时不弹：页面表单与弹窗功能重复，只保留页面自身提示
 * （本地认证缓存的清除由调用方完成，此处只负责 UI 引导）
 */
function notifyAuthExpired(method?: Method): void {
  if (method?.meta?.auth === false) return
  const { pathname } = window.location
  if (pathname.startsWith('/login') || pathname.startsWith('/register')) return
  openAuthDialog()
}

/**
 * 全局唯一的 alova 实例
 * beforeRequest 注入 Token；responded 统一解包响应、处理 401 并抛出业务错误
 */
export const alova = createAlova({
  // 统一接口前缀：/api/v1
  baseURL: `${API_BASE_URL}${API_PREFIX}`,
  // 绑定 Vue 的响应式状态（供 useRequest 等策略使用）
  statesHook: VueHook,
  // 使用原生 fetch 作为请求适配器
  requestAdapter: adapterFetch(),
  // 默认超时
  timeout: DEFAULT_TIMEOUT,

  /** 请求前：自动注入 Token（登录等公开接口用 `meta: { auth: false }` 跳过） */
  beforeRequest(method) {
    if (method.meta?.auth === false) return
    const token = getAccessToken()
    if (token) {
      method.config.headers = {
        ...method.config.headers,
        Authorization: `Bearer ${token}`,
      }
    }
  },

  /** 响应后：统一解包 `{ status, data, info }`，由 alova 接管缓存与错误链路 */
  responded: {
    onSuccess: async (response, method) => {
      // HTTP 401 未授权：清除本地认证信息，并弹出全局登录弹窗引导重新登录
      if (response.status === 401) {
        clearAuth()
        console.warn('[API] 登录已过期，请重新登录')
        notifyAuthExpired(method)
      }

      // 统一解包后端响应
      const result = await response.json().catch(() => ({}))
      // 接口判定未登录（业务码 10003）：清空本地认证缓存（token + 用户信息），
      // 避免过期用户信息残留在 localStorage 导致页面仍展示旧登录态，
      // 并弹出全局登录弹窗引导重新登录
      if (result.status === ERROR_CODES.UNAUTHORIZED) {
        clearAuth()
        console.warn('[API] 登录已过期，已清除本地用户缓存，请重新登录')
        notifyAuthExpired(method)
      }
      // 业务失败：status !== 1
      if (result.status !== 1) {
        throw new ApiError(result.info || '请求失败', result.status, response.status, result)
      }
      // 成功：直接返回业务数据
      return result.data
    },
    onError: (error) => {
      // 统一错误兜底（网络错误 / 业务错误），可按需接入全局提示
      console.error('[API]', error)
    },
  },
})