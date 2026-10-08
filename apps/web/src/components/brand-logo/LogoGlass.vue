<template>
  <!-- 彩色玻璃 logo 卡：彩色光斑打底 + 毛玻璃卡身 + 流动圆锥渐变描边 -->
  <div class="relative transition-transform duration-300 hover:scale-[1.03]">
    <!-- 背景彩色光斑：给毛玻璃提供可「折射」的色彩 -->
    <div class="absolute -inset-8 pointer-events-none" aria-hidden="true">
      <div class="absolute left-0 top-0 size-28 rounded-full bg-violet-400/50 blur-3xl" />
      <div class="absolute right-0 bottom-0 size-28 rounded-full bg-cyan-400/50 blur-3xl" />
      <div
        class="absolute left-1/2 top-1/2 size-24 -translate-x-1/2 -translate-y-1/2 rounded-full bg-fuchsia-400/40 blur-3xl"
      />
    </div>
    <!-- 1px 彩色流动描边层 -->
    <div class="glass-border rounded-2xl p-px">
      <!-- 毛玻璃卡身：半透白 + 背景模糊 + 内侧顶部高光，内边距随 logo 尺寸等比缩放 -->
      <div
        class="rounded-[15px] bg-white/55 backdrop-blur-xl shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_32px_rgba(31,38,135,0.15)]"
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
 * 流动圆锥渐变描边：
 * 1. @property 注册 --glass-angle 为 <angle> 类型，浏览器才能对它做补间动画
 *    （不支持的浏览器会降级为静态渐变描边，不影响展示）；
 * 2. conic-gradient 做一圈「白-紫-青-粉-白」的渐变环，作为 1px 描边层；
 * 3. 6s 无限旋转，形成高光沿边框缓慢流动的效果。
 */
@property --glass-angle {
  syntax: '<angle>';
  initial-value: 0deg;
  inherits: false;
}

.glass-border {
  background: conic-gradient(
    from var(--glass-angle),
    rgba(255, 255, 255, 0.55),
    rgba(167, 139, 250, 0.9) 25%,
    rgba(34, 211, 238, 0.9) 50%,
    rgba(244, 114, 182, 0.8) 75%,
    rgba(255, 255, 255, 0.55)
  );
  animation: glass-rotate 6s linear infinite;
}

@keyframes glass-rotate {
  to {
    --glass-angle: 360deg;
  }
}
</style>
