<template>
  <!--
    全局版本标签：开源版 vX.X.X
    版本号构建期由 vite define 注入（根 package.json version），
    落地页右上角与 Dashboard 顶栏 logo 旁共用此组件
  -->
  <span
    class="inline-flex items-center rounded-sm gap-1.5/10 px-2 py-1 text-gray-500 text-[12px]"
  >开源版 v{{ appVersion }}
  </span>
</template>

<script lang="ts" setup>
import { Code2 } from '@lucide/vue'

/** 构建期注入的全局常量不能直接在模板使用，先落到模块作用域 */
const appVersion = __APP_VERSION__
</script>
