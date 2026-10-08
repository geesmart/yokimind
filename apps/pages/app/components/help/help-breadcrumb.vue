<script setup lang="ts">
/**
 * 帮助中心面包屑导航
 *
 * 结构：库名（链接回落地页）› 分组标题… › 当前文档标题
 * - 分组段为纯文本（无独立路由页，点击无意义）；
 * - 当前文档段高亮显示；
 * - 溢出时隐藏中间分组段（flex + truncate + min-w-0）。
 */
import { ChevronRight } from '@lucide/vue'

const props = defineProps<{
  /** 知识库 ID（构成落地页链接） */
  wikiId: string
  /** 库名（面包屑首段） */
  wikiName: string
  /** 分组标题祖先链（根 → 父级，纯文本段） */
  pathTitles: string[]
  /** 当前文档标题（末段，高亮） */
  currentTitle: string
}>()
</script>

<template>
  <nav
    aria-label="面包屑"
    class="flex min-w-0 items-center gap-1 text-sm text-muted-foreground"
  >
    <!-- 首段：库名 → 落地页 -->
    <NuxtLink
      :to="`/w/${props.wikiId}`"
      class="shrink-0 cursor-pointer transition-colors hover:text-foreground"
    >
      {{ props.wikiName }}
    </NuxtLink>

    <!-- 中段：分组祖先链（窄屏直接隐藏，保证当前段可读） -->
    <template v-for="title in props.pathTitles" :key="title">
      <ChevronRight class="size-3.5 shrink-0 text-muted-foreground/50" />
      <span class="hidden truncate md:inline" :title="title">{{ title }}</span>
    </template>

    <!-- 末段：当前文档（不可点） -->
    <ChevronRight class="size-3.5 shrink-0 text-muted-foreground/50" />
    <span class="min-w-0 truncate font-medium text-foreground" :title="props.currentTitle">
      {{ props.currentTitle }}
    </span>
  </nav>
</template>
