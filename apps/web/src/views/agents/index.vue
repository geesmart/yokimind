<template>
  <!--
    智能体接入页（/settings/agents，需登录）
    页面外壳：标题区 + 访问令牌管理（PatManager）+ 接入指引（AgentGuide）。
    三协议（MCP / CLI / Skills）共用 PAT 令牌；创建与吊销在 PatManager 内完成。
  -->
  <div class="min-h-screen bg-background">
    <div class="mx-auto w-full max-w-2xl px-4 py-10">
      <!-- 页面标题区 -->
      <div class="mb-6 flex items-start gap-3">
        <div class="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent">
          <Bot class="size-5 text-foreground" />
        </div>
        <div>
          <h1 class="text-lg font-semibold leading-tight">智能体接入</h1>
          <p class="mt-1 text-xs text-muted-foreground">
            通过 MCP、CLI 或 Skills 协议，让 Claude / Cursor / Trae 等外部 AI 客户端访问你的知识库
          </p>
        </div>
      </div>

      <!-- 访问令牌管理（表格 / 创建弹窗 / 吊销确认） -->
      <PatManager />

      <Separator class="my-8" />

      <!-- 接入指引（MCP / CLI / Skills 三折叠面板） -->
      <AgentGuide />
    </div>
  </div>
</template>

<script lang="ts" setup>
import { Bot } from '@lucide/vue'
import { Separator } from '@/components/ui/separator'
import PatManager from './components/pat-manager.vue'
import AgentGuide from './components/agent-guide.vue'
</script>

<style scoped>
/*
 * arco.css（main.ts 中先于 style.css 引入，未分层）自带 normalize 的裸 h1 规则：
 *   h1 { font-size: 2em; margin: 0.67em 0; }
 * 未分层样式优先级高于 @layer 内的 Tailwind 工具类，导致标题字号类失效，
 * 此处用 scoped 样式显式覆盖（同 /admin 页处理）。
 */
h1 {
  font-size: 1.125rem; /* 对齐 text-lg */
  margin: 0;
}
</style>
