import { createRouter, createWebHistory } from 'vue-router'
import { isLoggedIn, clearAuth } from '@/utils/token'
import { getProfile } from '@/api/modules/user'
import { ApiError } from '@/api/request'
import { ERROR_CODES, HTTP_STATUS } from '@/api/constants'

/**
 * Vue Router 配置
 * 定义应用的路由映射关系
 */
const router = createRouter({
  // 使用 HTML5 History 模式
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      // 网站首页（落地页）：未登录显示登录/注册入口，已登录显示进入控制台
      path: '/',
      name: 'home',
      component: () => import('@/views/home/index.vue'),
    },
    {
      // 控制台首页（登录后）：从原 / 迁移至此，腾出根路径给落地页
      path: '/dashboard',
      name: 'dashboard',
      component: () => import('@/views/dashboard/index.vue'),
    },
    {
      // AI 大模型管理页（仅管理员）：AI 服务商配置（chat / embedding）查看、保存与连接测试
      // 页面加载时由后端校验管理员权限，非管理员渲染「无权限」卡片
      path: '/admin',
      name: 'admin',
      component: () => import('@/views/admin/index.vue'),
    },
    {
      // 知识库编辑页（语雀风格三栏：文档树 / 编辑器 / 大纲）
      // 三参数：wikiId=知识库 ID，docId=选中文档树节点 ID（可选），mode=编辑/预览模式后缀（可选）
      // mode 后缀约定：/edit=编辑态、/view=只读预览态，与顶栏「编辑/预览」Tabs 双向同步（URL 是唯一模式源）
      // 知识库首页已移除：docId 缺省时树就绪后自动打开第一篇文档（/edit），空库显示「暂无文档」空态
      // owner 打开无后缀旧链接时由 wiki 页面自动补 /edit（访客视图不重定向、URL 原样）
      path: '/wiki/:wikiId/:docId?/:mode(edit|view)?',
      name: 'wiki',
      component: () => import('@/views/wiki/index.vue'),
    },
    {
      // 登录页（基于 design/登录.html 还原）
      path: '/login',
      name: 'login',
      component: () => import('@/views/auth/login.vue'),
    },
    {
      // 注册页（基于 design/注册.html 还原）
      path: '/register',
      name: 'register',
      component: () => import('@/views/auth/register.vue'),
    },
    {
      // 忘记密码页（基于 design/忘记密码.html 还原）
      path: '/forgot-password',
      name: 'forgot-password',
      component: () => import('@/views/auth/forgot-password.vue'),
    },
    {
      // 编辑器独立测试页（无需登录，仅用于开发调试 BlockMenu 等编辑器功能）
      path: '/editor-test',
      name: 'editor-test',
      component: () => import('@/views/editor-test/index.vue'),
    },
    {
      // RAG 全流程测试页（需登录，开发调试用）：创建数据 → 保存入队 → 索引状态 → 语义检索 → AI 问答
      // 页面内自行检测登录态，不加路由守卫
      path: '/rag-test',
      name: 'rag-test',
      component: () => import('@/views/rag-test/index.vue'),
    },
    {
      // 脑图演示页（无需登录）：基于 VueFlow 的树形自动布局思维导图
      path: '/mindmap',
      name: 'mindmap',
      component: () => import('@/views/mindmap/index.vue'),
    },
    {
      // 脑图演示页（G6 版，无需登录）：基于 AntV G6 的树形布局思维导图
      path: '/mindmap-g6',
      name: 'mindmap-g6',
      component: () => import('@/views/mindmap-g6/index.vue'),
    },
    {
      // 品牌素材页（无需登录）：集中展示 YOKI 文档的 logo 素材与下载
      path: '/brand',
      name: 'brand',
      component: () => import('@/views/brand/index.vue'),
    },
  ],
})

/**
 * 与后端主动校验 token 有效性
 *
 * 背景：本地登录态（localStorage 中的 token + 过期时间）只是前端自持状态，
 * token 可能在服务端已被清除（如改密码后后端删除全部 token、多端登出、数据库重置），
 * 本地却仍显示「已登录」。因此进入 /dashboard 前必须向后端确认一次。
 *
 * 校验方式：调用 GET /user/profile（需鉴权接口，cacheFor: null 不走缓存），
 * 由后端 authMiddleware 验证 token：
 * - 校验通过：返回 true
 * - token 被后端拒绝（业务码 10003 UNAUTHORIZED / HTTP 401）：返回 false，
 *   调用方需清空浏览器缓存的认证信息并跳转登录页
 * - 其他错误（网络断开、服务端 500 等）：无法完成校验，不冤枉本地 token，
 *   放行进入页面（页面内业务请求会自行暴露错误），返回 true
 */
async function validateTokenWithBackend(): Promise<boolean> {
  try {
    await getProfile().send()
    return true
  } catch (error) {
    // 后端明确拒绝鉴权：token 无效或已过期（alova 层此时已自动清空本地认证缓存）
    if (
      error instanceof ApiError &&
      (error.code === ERROR_CODES.UNAUTHORIZED || error.httpStatus === HTTP_STATUS.UNAUTHORIZED)
    ) {
      return false
    }
    // 非鉴权失败：无法判定 token 有效性，放行
    console.warn('[router] token 后端校验未完成（网络/服务端异常），本次放行：', error)
    return true
  }
}

/**
 * 全局前置守卫
 * - 进入控制台页（/dashboard）必须与后端主动校验一次 token：
 *   本地无 token/已过期，或后端校验失败时，清空浏览器缓存的认证信息并跳转登录页
 * - 未登录访问 AI 大模型管理页（/admin）时，重定向到登录页（页内再做管理员校验）
 * - 已登录用户访问 /login 或 /register 时，重定向到首页（避免重复登录）
 * - 其余路由（含 /forgot-password）按用户明确要求保持原有行为
 */
router.beforeEach(async (to) => {
  // 进入控制台：先过本地检查，再与后端校验一次 token
  if (to.name === 'dashboard') {
    // 本地无 token 或已过期：清空残留认证缓存（含过期 token / 旧用户信息），回登录页
    if (!isLoggedIn()) {
      clearAuth()
      return { name: 'login' }
    }
    // 本地 token 未过期：仍需向后端确认（服务端可能已注销/清除该 token）
    const valid = await validateTokenWithBackend()
    if (!valid) {
      // 后端拒绝：清空浏览器缓存的 token 与用户信息，跳转登录页
      clearAuth()
      return { name: 'login' }
    }
  }
  // 未登录进入 AI 大模型管理页：跳转登录页（页内再做管理员校验）
  if (!isLoggedIn() && to.name === 'admin') {
    return { name: 'login' }
  }
  // 已登录访问登录/注册页：回首页
  if (isLoggedIn() && (to.name === 'login' || to.name === 'register')) {
    return { name: 'home' }
  }
  return true
})

export default router
