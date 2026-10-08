<template>
  <div class="app-container bg-gray-50 h-full">
    <router-view />
    <!-- 全局 Toast 通知组件 -->
    <Toaster position="top-center" rich-colors />
    <!-- 全局登录弹窗：认证失效（401/10003）时由请求层自动弹出 -->
    <AuthLoginDialog />
  </div>
</template>

<script setup lang="ts">
import { useRoute } from 'vue-router'
import { Toaster } from '@/components/ui/sonner'
import AuthLoginDialog from '@/components/auth-login-dialog.vue'

// 获取当前路由路径，用于高亮导航菜单
const $route = useRoute()
</script>
