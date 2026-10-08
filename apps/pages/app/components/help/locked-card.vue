<script setup lang="ts">
/**
 * 密码保护提示卡
 *
 * 当分享元信息 needsPassword=true 时渲染（本期公开站不提供密码输入，
 * 由 web 端访客视图承担密码门），页面同时设置 robots noindex 不收录。
 * 样式对齐 ComingSoon 占位卡（圆形图标底 + 标题 + 描述）。
 */
import { Lock } from '@lucide/vue'
</script>

<template>
  <section
    class="mx-auto flex w-full max-w-md flex-col items-center gap-4 px-4 py-24 text-center"
  >
    <div class="flex size-14 items-center justify-center rounded-full bg-accent">
      <Lock class="size-6 text-muted-foreground" />
    </div>
    <h1 class="text-xl font-semibold">内容受密码保护</h1>
    <p class="text-sm leading-relaxed text-muted-foreground">
      该内容由作者设置了访问密码，暂不支持在此页面查看。
      如需阅读，请联系作者获取访问方式。
    </p>
  </section>
</template>
