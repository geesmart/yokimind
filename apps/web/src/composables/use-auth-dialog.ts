/**
 * 全局登录弹窗状态（useAuthDialog）
 *
 * 统一的「就地登录」UX，两类触发场景：
 * - 认证失效（HTTP 401 / 业务码 10003）：请求层（request.ts）自动弹出
 * - 无权限访问需登录的页面/操作（如未登录访问知识库 /edit 编辑 URL）：页面主动弹出
 * 不再只是 console.warn，而是弹出登录弹窗引导用户就地登录。
 *
 * 设计要点：
 * - 状态为模块级 ref 单例：请求层（request.ts 非组件环境）、弹窗组件、
 *   任意页面均可 import 同一份状态，天然去重（并发多个 401 只弹一次）
 * - 打开时同步 toast 提示触发原因，弹窗已打开则跳过（避免连发 401 时 toast 刷屏）
 * - hint 每次打开时刷新为本次触发原因，避免残留上一次的提示文案
 */
import { ref } from 'vue'
import { toast } from 'vue-sonner'

/** 登录弹窗显隐状态（模块级单例，跨组件/请求层共享） */
const authDialogVisible = ref(false)

/** 默认触发原因：认证过期场景 */
const DEFAULT_AUTH_HINT = '登录状态已过期，请重新登录以继续操作'

/** 弹窗副标题（本次触发原因），供弹窗组件渲染动态描述 */
const authDialogHint = ref(DEFAULT_AUTH_HINT)

/**
 * 打开全局登录弹窗
 * @param hint 本次触发原因（同时作为 toast 文案与弹窗副标题）；缺省为认证过期文案
 * - 已打开时幂等返回（不重复 toast）
 */
export function openAuthDialog(hint?: string): void {
  if (authDialogVisible.value) return
  authDialogHint.value = hint ?? DEFAULT_AUTH_HINT
  authDialogVisible.value = true
  toast.warning(hint ?? '登录已过期，请重新登录')
}

/** 关闭全局登录弹窗 */
export function closeAuthDialog(): void {
  authDialogVisible.value = false
}

/**
 * 组合式封装（供组件模板使用）
 * 状态与方法与模块级导出同一份引用
 */
export function useAuthDialog() {
  return {
    authDialogVisible,
    authDialogHint,
    openAuthDialog,
    closeAuthDialog,
  }
}
