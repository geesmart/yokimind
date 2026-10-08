<template>
  <!-- 登录页：按设计稿 design/登录.html 还原 -->
  <AuthLayout max-width="400px">
    <!-- 标题区 -->
    <div class="text-center mb-8">
      <h2 class="text-xl font-semibold mb-2 text-foreground">账号登录</h2>
      <!--      <p class="text-body-base text-text-secondary">👏🏻欢迎回来</p>-->
    </div>

    <!-- 登录表单：复用组件，成功后跳转控制台首页 -->
    <LoginForm @success="handleLoginSuccess" />

    <!-- 演示账号提示（视觉示意） -->
    <div
      class="flex items-start gap-2.5 p-3 rounded-xl text-xs text-muted-foreground mt-6"
      style="background: rgba(47, 116, 255, 0.12); border: 1px solid rgba(47, 116, 255, 0.18)"
    >
      <Info :size="16" class="text-primary shrink-0 mt-0.5" />
      <p>演示账号：demo@example.com / demo123456</p>
    </div>

    <!-- 页脚链接 -->
    <footer class="mt-8 flex flex-col sm:flex-row items-center justify-between gap-3">
      <RouterLink
        to="/register"
        class="font-medium text-muted-foreground hover:text-primary/80 hover:underline text-xs"
      >
        没有账号？去注册
      </RouterLink>
      <RouterLink
        to="/forgot-password"
        class="font-medium text-muted-foreground hover:text-primary/80 hover:underline text-xs"
      >
        忘记密码
      </RouterLink>
    </footer>
  </AuthLayout>
</template>

<script lang="ts" setup>
import { useRouter } from 'vue-router'
import { Info } from '@lucide/vue'
import AuthLayout from './components/auth-layout.vue'
import LoginForm from './components/login-form.vue'
import type { LoginResult } from '@/api/modules/user'

const router = useRouter()

/**
 * 登录成功回调（Token/用户信息已由 LoginForm 落库）
 * 登录页场景：进入控制台首页
 */
function handleLoginSuccess(_result: LoginResult) {
  router.push('/dashboard')
}
</script>

<style scoped></style>
