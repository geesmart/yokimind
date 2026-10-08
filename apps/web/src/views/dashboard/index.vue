<template>
  <!--
    Dashboard 首页（单列布局，按设计稿 design/首页-Dashboard.html 重构）
    结构：顶栏 layout-topbar + 可滚动内容区 layout-main
  -->
  <div class="flex flex-col h-screen overflow-hidden bg-background">
    <layout-topbar class="shrink-0" />
    <layout-main class="flex-1 min-h-0 overflow-y-auto" />
  </div>
</template>

<script lang="ts" setup>
import layoutTopbar from '@/views/dashboard/layout-topbar.vue'
import layoutMain from '@/views/dashboard/layout-main.vue'
</script>w
