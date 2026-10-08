<template>
  <!--
  AuthLoginDialog：全局登录弹窗
  两类触发场景（触发原因由 use-auth-dialog 的 authDialogHint 动态描述）：
  1. 认证失效（HTTP 401 / 业务码 10003）时由请求层（api/request.ts）自动打开
  2. 无权限访问需登录的页面（如未登录访问知识库 /edit 编辑 URL）时由页面主动打开
  内嵌复用的 LoginForm（views/auth/components/login-form.vue）完成就地重新登录。
  登录成功后刷新当前页面：页面数据均在登录失效期间请求失败过，整页刷新
  恢复一致性最可靠（编辑器内容有 local-first 的 IndexedDB 缓存兜底，不丢失）

  不可关闭设计：认证失效后必须重新登录才能继续操作，
  因此隐藏右上角关闭按钮，且忽略 Esc / 点击遮罩触发的关闭事件，
  仅在登录成功后由 handleLoginSuccess 关闭弹窗。
-->
<Dialog :open="authDialogVisible">
  <DialogContent class="sm:max-w-sm" :show-close-button="false">
    <!--
      顶部 Logo 区：图标与文字水平排列，整体居中
      点击 logo 跳转首页：给不想就地登录的用户一个离开当前页面的出口
      （关闭弹窗 + 跳转落地页，首页路由无需登录态）
    -->
    <button
      type="button"
      class="flex flex-row items-center justify-center gap-2.5 pt-2 mx-auto cursor-pointer rounded-lg transition-opacity hover:opacity-80"
      title="回到首页"
      @click="handleLogoClick"
    >
      <img src="/logo-icon.png" alt="YOKI 文档" class="h-11 rounded-[10px]" />
      <img src="/logo-text.png" alt="" class="h-8" />
    </button>

    <!-- 标题区：居中排版 -->
    <DialogHeader class="items-center text-center sm:text-center">
      <DialogTitle>账号登录</DialogTitle>
      <DialogDescription>{{ authDialogHint }}</DialogDescription>
    </DialogHeader>

    <!-- 复用登录表单：登录成功后关闭弹窗并刷新页面恢复数据 -->
    <LoginForm @success="handleLoginSuccess" />
  </DialogContent>
</Dialog>
</template>

<script lang="ts" setup>
import { useRouter } from 'vue-router'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { closeAuthDialog, useAuthDialog } from '@/composables/use-auth-dialog'
import LoginForm from '@/views/auth/components/login-form.vue'

const router = useRouter()
const { authDialogVisible, authDialogHint } = useAuthDialog()

/**
 * 点击 logo 跳转首页
 * 先关闭弹窗再跳转，避免弹窗（全局单例状态）在新页面上仍然残留；
 * 首页为公开落地页，无需登录态即可访问
 */
function handleLogoClick() {
  closeAuthDialog()
  router.push('/')
}

/**
 * 弹窗内登录成功回调（Token/用户信息已由 LoginForm 落库）
 * 关闭弹窗后整页刷新，让当前页面的数据请求带着新 Token 重新发起
 */
function handleLoginSuccess() {
  closeAuthDialog()
  // 稍作延迟，让「登录成功」toast 有机会展示
  window.setTimeout(() => {
    window.location.reload()
  }, 800)
}
</script>

<style scoped></style>
