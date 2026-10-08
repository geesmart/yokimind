<template>
  <!-- 蓝色玻璃 logo 卡：蓝色光斑打底 + 蓝调毛玻璃卡身 + 蓝色流动圆锥渐变描边 -->
  <div class="relative transition-transform duration-300 hover:scale-[1.03]">
    <!-- 背景蓝色光斑：给毛玻璃提供可「折射」的色彩 -->
    <div class="absolute -inset-8 pointer-events-none" aria-hidden="true">
      <div
        class="absolute left-1/2 top-1/2 size-32 -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-400/60 blur-3xl"
      />
    </div>
    <!-- 1px 蓝色流动描边层（高光弧段大、转速快，转动一眼可见） -->
    <div class="glass-border-blue rounded-2xl p-px">
      <!-- 蓝调毛玻璃卡身 + 浅蓝内侧顶部高光，内边距随 logo 尺寸等比缩放 -->
      <div
        class="rounded-[15px] bg-gradient-to-b from-blue-100/80 to-blue-200/70 backdrop-blur-xl shadow-[inset_0_1px_0_rgba(191,219,254,0.6),0_8px_32px_rgba(37,99,235,0.25)]"
        :style="{ padding: `${size * 0.2}px` }"
      >
        <img
          src="/logo-yoki.png"
          alt="YOKI文档"
          class="block"
          :style="{ width: `${size}px`, height: `${size}px` }"
        />
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
/**
 * 可调尺寸参数：
 * - size：logo 图形的边长（px），默认 60（等价原 size-15）
 * - 卡身内边距按 size 的 20% 等比缩放，保持不同尺寸下的视觉比例
 */
withDefaults(defineProps<{ size?: number }>(), { size: 60 })
</script>

<style scoped>
/*
 * 蓝色单色流动描边：高光弧段占圆周约 40%（远大于彩色版的 25%），
 * 不透明度拉满到 1，转速加快到 4s——让「边框转动」一眼可见。
 */
@property --glass-angle {
  syntax: '<angle>';
  initial-value: 0deg;
  inherits: false;
}

.glass-border-blue {
  background: conic-gradient(
    from var(--glass-angle),
    rgba(59, 130, 246, 0) 0%,
    rgba(59, 130, 246, 0.95) 10%,
    rgba(147, 197, 253, 1) 20%,
    rgba(59, 130, 246, 0.95) 30%,
    rgba(59, 130, 246, 0) 40%,
    rgba(59, 130, 246, 0.15) 70%,
    rgba(59, 130, 246, 0) 100%
  );
  animation: glass-rotate 4s linear infinite;
}

@keyframes glass-rotate {
  to {
    --glass-angle: 360deg;
  }
}
</style>
