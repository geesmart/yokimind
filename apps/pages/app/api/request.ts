/**
 * 统一请求层（基于 Nuxt 原生 $fetch，SSR 友好）
 *
 * 与 apps/web 的 alova 请求层保持相同的响应约定：
 * - 后端统一返回 `{ status, data, info }`，status === 1 为成功
 * - 成功由 unwrap 解包直接返回 data；失败抛 ApiError（含业务码 code 与 HTTP 状态码）
 *
 * 为什么不用 alova：
 * - alova 的内存缓存 / 请求策略面向客户端 SPA，在 Nuxt SSR 下服务端取数走
 *   useAsyncData，客户端缓存无意义，因此改用 Nuxt 原生 $fetch / useAsyncData。
 *
 * API 连通策略（浏览器与 SSR 统一相对路径 /api/v1，无需按端切换 baseURL）：
 * - 浏览器端：dev 由 nitro.devProxy 转发，生产由反向代理（Caddy /api → server）转发
 * - SSR 端：$fetch 相对路径由 Nuxt 函数直调到 Nitro 内部代理路由
 *   （server/routes/api/[...path].ts），再转发到 apiInternalUrl（server :6001）
 *
 * 使用示例（页面内 SSR 取数）：
 * ```ts
 * const api = useApiClient()
 * const { data, error } = await useAsyncData(`share-meta-${wikiId}`, async () => {
 *   const raw = await api<ApiResponse<ShareMeta>>(`/share/wiki/${wikiId}`)
 *   return unwrap(raw) // status !== 1 时抛 ApiError
 * })
 * ```
 */
import { API_PREFIX } from './constants'

// ==================== 统一错误 ====================

/** 业务错误，携带后端业务码与 HTTP 状态码（结构对齐 apps/web 的 ApiError） */
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

// ==================== 响应结构 ====================

/** 后端统一响应包裹结构 */
export interface ApiResponse<T = unknown> {
  /** 1 = 成功，其他 = 业务错误码 */
  status: number
  /** 业务数据 */
  data: T
  /** 提示信息（成功时可能为空，失败时为错误描述） */
  info?: string
}

/**
 * 解包后端统一响应：成功返回 data，业务失败抛 ApiError
 * @param raw 后端原始响应（$fetch 已自动解析 JSON）
 */
export function unwrap<T>(raw: ApiResponse<T>): T {
  // 业务失败：status !== 1（对齐 web 的 request.ts 判定逻辑）
  if (raw.status !== 1) {
    throw new ApiError(raw.info || '请求失败', raw.status, undefined, raw)
  }
  return raw.data
}

// ==================== 客户端实例 ====================

/**
 * 全局 API 客户端（组件 / composable 内调用）
 *
 * - baseURL 两端统一为 /api/v1：浏览器走同源（devProxy / Caddy 转发），
 *   SSR 由 Nuxt 函数直调到 Nitro 内部代理路由（见 server/routes/api/[...path].ts）
 * - retry: false 关闭 ofetch 默认重试（写接口重试可能造成重复提交）
 * - 401/10003 场景在公开站极少出现（无登录态），这里不做自动清理逻辑，
 *   由调用方按 ApiError.code 分支处理
 *
 * 注意：实例不依赖 Nuxt 实例上下文，任意异步回调中可安全使用；
 * 但仍沿用「setup 里创建好、显式传入 useAsyncData 异步回调」的统一约定，
 * 不要在回调内部再调 useApiClient（见 share.ts 头注释）。
 */
export function useApiClient() {
  return $fetch.create({
    baseURL: API_PREFIX,
    retry: false,
    timeout: 30_000,
  })
}

/** API 客户端类型（$fetch 实例，可跨异步边界传递） */
export type ApiClient = ReturnType<typeof useApiClient>
