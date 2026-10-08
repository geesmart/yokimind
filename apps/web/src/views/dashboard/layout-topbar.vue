<template>
  <!--
    全局顶栏（按设计稿 design/首页-Dashboard.html 还原）
    左：logo / 右：公共用户菜单组件（头像下拉）
  -->
  <header
    class="flex items-center justify-between h-14 px-4 xl:px-6 border-b border-border bg-background gap-4 shrink-0"
    role="banner"
  >
    <!-- 左侧：logo -->
    <div class="flex-1 shrink-0 flex items-center gap-1">
      <a href="/"><img src="/logo-icon.png" alt="YOKI文档" class="h-10" /></a>
      <a href="/"><img src="/logo-text.png" alt="YOKI文档" class="h-6" /></a>
    </div>

    <!-- 中间：品牌标识 -->
    <div class="flex items-center shrink-0"></div>

    <!-- 右侧：公共用户菜单（头像下拉，未登录显示登录图标）；已在工作台内，隐藏「返回工作台」项 -->
    <div class="flex items-center gap-3 shrink-0 flex-1 justify-end">
      <UserMenu :show-workspace-entry="false" />
    </div>
  </header>
</template>

<script lang="ts" setup>
import UserMenu from '@/components/user-menu.vue'
</script>

<style scoped></style>
