<script setup lang="ts">
/**
 * RAG 索引状态标签（共用组件）
 *
 * 「圆点 + RAG 文本」的描边徽章样式，文档侧边栏（layout-main）与
 * 知识库左侧栏（layout-left）共用，保证两处视觉一致。
 * 圆点颜色由父组件根据索引状态计算后通过 dotClass 传入：
 * 未索引（灰）/ 索引中（琥珀，呼吸闪烁）/ 已索引（绿）/ 失败（红）。
 */
import { Badge } from '@/components/ui/badge'

/** 状态圆点的样式类（如 bg-green-500、bg-amber-500 animate-pulse） */
defineProps<{
  /** 状态圆点的样式类，由父组件按索引状态计算传入 */
  dotClass: string
}>()
</script>

<template>
  <Badge variant="outline" class="rounded-md cursor-pointer">
    <!-- 状态圆点：颜色语义见组件说明 -->
    <span class="inline-block size-1.5 rounded-full" :class="dotClass" aria-hidden="true" />
    <!-- 标签文本：固定为 RAG -->
    <label class="!text-[10px] ml-1">RAG</label>
  </Badge>
</template>
