<template>
  <!-- 横向组合：纯图 logo 与品牌文字水平排列，图片不需要特效 -->
  <div class="flex items-center justify-center gap-2 border border-neutral-200 rounded-2xl p-3 bg-white">
    <img
      src="/logo-yoki.png"
      alt="YOKI文档"
      class="block"
      :style="{ width: `${size}px`, height: `${size}px` }"
    />
    <span class="font-comic-neue font-bold text-foreground" :style="{ fontSize: `${size * 0.875}px` }">
      YOKi
    </span>
    <span class="font-wenkai font-bold text-foreground" :style="{ fontSize: `${size * 0.8125}px` }">
      文档
    </span>
  </div>
</template>

<script lang="ts" setup>
/**
 * 可调尺寸参数：
 * - size：logo 图形的边长（px），默认 32（等价原 size-8）
 * - 文字随图片等比缩放：YOKi 为 size 的 87.5%（默认 28px），文档为 81.25%（默认 26px）
 */
withDefaults(defineProps<{ size?: number }>(), { size: 32 })
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
