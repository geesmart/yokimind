<template>
  <!--
    AI 大模型管理页（/admin，仅管理员）
    页面外壳：标题区 + 共享 AI 配置表单（AiSettingsForm）。
    完整配置能力（chat / embedding / rerank / RAG 参数、脱敏回显、连接测试、
    无权限卡片）均封装在 AiSettingsForm，用户菜单「AI 配置」弹窗复用同一组件。
  -->
  <div class="min-h-screen bg-background">
    <div class="mx-auto w-full max-w-2xl px-4 py-10">
      <!-- 页面标题区 -->
      <div class="mb-6 flex items-start gap-3">
        <div class="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent">
          <ShieldCheck class="size-5 text-foreground" />
        </div>
        <div>
          <h1 class="text-lg font-semibold leading-tight">AI 大模型管理</h1>
          <p class="mt-1 text-xs text-muted-foreground">
            AI 服务商配置（对话 / 向量 / 精排）与检索参数，保存后新配置对全部服务即时生效
          </p>
        </div>
      </div>

      <!-- AI 配置共享表单（加载态 / 无权限卡片 / 配置主体均在组件内部） -->
      <AiSettingsForm />
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ShieldCheck } from '@lucide/vue'
import AiSettingsForm from '@/components/ai-settings/ai-settings-form.vue'
</script>

<style scoped>
/*
 * arco.css（main.ts 中先于 style.css 引入，未分层）自带 normalize 的裸 h1 规则：
 *   h1 { font-size: 2em; margin: 0.67em 0; }
 * CSS 规范中「未分层样式」优先级高于 @layer 内样式（Tailwind v4 的 preflight
 * 与工具类都在 @layer 里），导致全站 h1 的 text-lg 等字号类全部失效，
 * 页面标题被渲染成 28px 且上下多出 ~18.76px 外边距（标题与图标/描述错位的根因）。
 * 此处用 scoped 样式（未分层 + [data-v] 属性选择器，优先级更高）显式覆盖回来。
 */
h1 {
  font-size: 1.125rem; /* 对齐 text-lg */
  margin: 0;
}
</style>
