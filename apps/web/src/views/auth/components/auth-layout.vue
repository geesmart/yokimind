<template>
  <!--
    AuthLayout：认证页通用布局
    提供全屏居中容器 + 白色卡片外壳，仅渲染居中容器，内容由各认证页通过插槽提供
    注意：此处使用 <div> 而非 <main>，避免全局样式 main{display:block} 覆盖 Tailwind 的 .flex 工具类导致无法居中
  -->
  <div
    class="min-h-screen w-full flex items-center flex-col justify-center px-4 sm:px-6 py-10 bg-muted"
  >
    <div class="flex flex-col items-center justify-center gap-4 mb-4">
      <img src="/logo-icon.png" alt="Yoki文档" class="h-14 rounded-[13px]" />
      <div class="flex items-center justify-center gap-2">
        <img src="/logo-text.png" alt="Yoki文档" class="h-10" />
      </div>
    </div>
    <section
      class="w-full bg-background border border-border rounded-3xl shadow-sm"
      :style="{ maxWidth }"
    >
      <div class="px-6 py-8 sm:px-8 sm:py-10">
        <!-- 顶部 Logo 与产品名 -->

        <slot />
      </div>
    </section>
  </div>
</template>

<script lang="ts" setup>
/**
 * 卡片最大宽度（默认 420px）
 */
defineProps<{
  maxWidth?: string
}>()
</script>

<style scoped></style>
