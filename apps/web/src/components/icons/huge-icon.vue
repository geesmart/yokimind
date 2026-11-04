<template>
  <!--
    项目统一图标组件：包装 @hugeicons/vue 的 HugeiconsIcon
    - 默认 strokeWidth 2.0（2026-11-03 用户指定），个别需要更粗/更细时单独传
    - 其余属性（size / color / class 等）经 Vue attr 透传到内部 svg
  -->
  <HugeiconsIcon :icon="icon" :stroke-width="strokeWidth" />
</template>

<script lang="ts" setup>
import { HugeiconsIcon } from '@hugeicons/vue'

/** Hugeicons 图标数据类型（core-free-icons 的 IconSvgObject 未导出，本地复刻） */
type HugeIconData = readonly (readonly [string, Record<string, any>])[]

/**
 * 组件 Props
 */
withDefaults(
  defineProps<{
    /** 图标数据，来自 @hugeicons/core-free-icons（命名形如 XxxIcon） */
    icon: HugeIconData
    /** 线宽，默认 2.0 */
    strokeWidth?: number
  }>(),
  { strokeWidth: 2 }
)
</script>
