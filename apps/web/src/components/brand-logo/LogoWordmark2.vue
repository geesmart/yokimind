<template>
  <!-- 品牌字标（纯文字版）：YOKi 用 Comic Neue，文档用霞鹜文楷，绝对定位悬挂在 YOKi 右上角；组件不带内边距，外部间距由使用处自行定义 -->
  <div class="relative flex items-center gap-2">
    <span
      class="font-comic-neue font-bold leading-none text-foreground"
      :style="{ fontSize: `${size}px` }"
      >YOKi</span
    >
    <span class="bg-black rounded px-1.5 py-0.5 text-white top-0 text-[23px]">文档</span>
  </div>
</template>

<script lang="ts" setup>
import { computed } from 'vue'
import LogoMono from './LogoMono.vue'

/**
 * 可调尺寸参数：
 * - size：YOKi 的字号（px），默认 36（等价原 text-4xl）
 * - 角标字号为 size 的 39%（默认 14px），右上角偏移量随字号等比缩放
 */
const props = withDefaults(defineProps<{ size?: number }>(), { size: 36 })

/**
 * 角标的绝对定位与字号：按主字号等比换算，保证放大缩小时比例关系不变
 * - 字号：size 的 39%（默认 14px）
 * - right：角标悬挂在 YOKi 右缘外侧，偏移量 = -size × 1.1（默认 ≈ -40px，
 *   恰好让角标左缘贴住 YOKi 右缘；字号越大偏移越远，避免压住 YOKi 尾部字母）
 */
const badgeStyle = computed(() => ({
  fontSize: `${props.size * 0.39}px`,
  right: `${-props.size * 1.1}px`,
}))
</script>

<style scoped>
/*
 * 品牌字体（系统已安装，直接引用字体族名）：
 * - YOKI：Comic Neue（手写圆润风，缺省时回退 Comic Sans MS）
 * - 文档：霞鹜文楷（LXGW WenKai），中英文字体族名都写上以兼容不同系统的安装命名
 */
.font-comic-neue {
  font-family: 'Comic Neue', 'Comic Sans MS', cursive;
  font-weight: 700;
  letter-spacing: 0.02em;
}

.font-wenkai {
  font-family: 'LXGW WenKai', '霞鹜文楷', 'PingFang SC', serif;
}
</style>
