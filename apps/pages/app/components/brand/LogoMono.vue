<template>
  <!-- 黑白配色 logo 卡：灰色光斑 + 白色渐变卡身 + 黑色剪影 + 银灰流动描边 -->
  <div class="relative transition-transform duration-300 hover:scale-[1.03]">
    <!-- 单色氛围光斑：中性灰柔光衬出白卡轮廓，保持黑白灰体系 -->
    <div class="absolute -inset-8 pointer-events-none" aria-hidden="true">
      <div
        class="absolute left-1/2 top-1/2 size-28 -translate-x-1/2 -translate-y-1/2 rounded-full bg-neutral-300/40 blur-3xl"
      />
    </div>
    <!-- 银灰流动描边 + 中性灰实线边框（白卡在白底上需要可见轮廓），圆角随 logo 尺寸等比缩放 -->
    <div
      class="glass-border-mono border border-neutral-300 shadow-[0_8px_32px_rgba(0,0,0,0.12)]"
      :style="{ borderRadius: `${radius}px` }"
    >
      <!-- 不透明白渐变卡身 + 内侧顶部高光模拟受光边，内边距随 logo 尺寸等比缩放 -->
      <div
        class="bg-gradient-to-b from-white to-neutral-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]"
        :style="{ padding: `${size * 0.2}px`, borderRadius: `${radius - 1}px` }"
      >
        <!-- 品牌图标原图直出，不加滤镜 -->
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
import { computed } from 'vue'

/**
 * 可调尺寸参数：
 * - size：logo 图形的边长（px），默认 60（等价原 size-15）
 * - 卡身内边距按 size 的 20% 等比缩放，保持不同尺寸下的视觉比例
 * - 圆角按 size 的 35% 等比缩放（默认 ≈21px，圆弧感更明显）
 */
const props = withDefaults(defineProps<{ size?: number }>(), { size: 60 })

/** 卡片圆角：随 logo 尺寸等比缩放；内层卡身比外层描边小 1px，保持 1px 描边的同心观感 */
const radius = computed(() => Math.round(props.size * 0.35))
</script>

<style scoped>
/*
 * 黑白配色的流动描边：只用白色不同透明度做单色高光，
 * 呈现银灰色金属质感。不支持的浏览器降级为静态渐变。
 */
@property --glass-angle {
  syntax: '<angle>';
  initial-value: 0deg;
  inherits: false;
}

.glass-border-mono {
  background: conic-gradient(
    from var(--glass-angle),
    rgba(255, 255, 255, 0.5),
    rgba(255, 255, 255, 0.12) 25%,
    rgba(255, 255, 255, 0.85) 50%,
    rgba(255, 255, 255, 0.12) 75%,
    rgba(255, 255, 255, 0.5)
  );
  animation: glass-rotate 6s linear infinite;
}

@keyframes glass-rotate {
  to {
    --glass-angle: 360deg;
  }
}
</style>
