<script setup lang="ts">
/**
 * 应用根组件：全局布局 + 路由页面出口
 * Nuxt 4 的 srcDir 为 app/ 目录（pages、layouts、components 均位于此）
 */
import { useSiteSettings } from '~/composables/use-site-settings'

// 站点设置全局状态：浏览器标签页标题后缀取发布设置的「站点标题」
// （siteTitle 未配置时回退库名 wikiName，均无则回退默认品牌名）
const siteSettings = useSiteSettings()

// 站点标题模板（函数形式只能在运行时 useHead 设置，见 nuxt.config.ts 中的注释）：
// - 子页面 title → 「{文档标题} · {站点名}」，站点名优先用发布设置的站点标题
// - 库落地页 title 已是站点名（siteTitle || wikiName），去重避免「xxx · xxx」
// - 未设置 title → 站点名（知识库上下文）/ 默认品牌标题（非知识库页面，如 /b/ 博客形态库）
useHead({
  titleTemplate: (title?: string) => {
    const siteName =
      siteSettings.value?.siteTitle || siteSettings.value?.wikiName || null
    if (!title) return siteName ?? '墨刻文档 — 知识发布平台'
    if (siteName && title === siteName) return title
    return `${title} · ${siteName ?? '墨刻文档'}`
  },
})
</script>

<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>
