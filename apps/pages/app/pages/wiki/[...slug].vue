<script setup lang="ts">
/**
 * /wiki/** 兜底重定向页
 *
 * 背景：web 端分享弹窗（share-dialog.vue）生成的分享链接是
 * `/wiki/{wikiId}/{docId}/view`（web SPA 访客视图语义），正常由统一入口
 * （Caddy catch-all → web）或 web 直连端口承接，不会到达本应用。
 * 但用户可能把分享链接粘到 pages 直连地址（或任意把 /wiki 路由到本应用的
 * 部署环境），此前 Nuxt 找不到匹配路由，直接抛裸 404 错误页（附堆栈），
 * 体验差且暴露技术细节。
 *
 * 本页兜底：把 /wiki/** 重定向到 /w/** 对应页面。/w 的访客页与 web 访客视图
 * 消费同一份分享数据（share 接口），访客形态也一致（单页分享仅正文、
 * 整库分享三栏浏览），仅 URL 前缀不同：
 * - /wiki/{wikiId}/{docId}/view → /w/{wikiId}/{docId}（末段 view/edit 模式后缀剥掉）
 * - /wiki/{wikiId}             → /w/{wikiId}（pages 首页自动定位第一篇文档）
 *
 * 用 302（临时重定向）而非 308：分享链接的规范地址始终是 /wiki/**（web 语义），
 * 这里只是入口容错，不向浏览器/爬虫声明 URL 永久迁移。
 */

const route = useRoute()

// slug 段解析：[wikiId, docId?, mode?...]
// ID 统一小写：与 /w 路由的规范化口径一致（后端 text 查询大小写敏感，防手输大写不命中）
const segments = (route.params.slug as string[] | undefined) ?? []
const wikiId = (segments[0] ?? '').toLowerCase()
const docId = (segments[1] ?? '').toLowerCase()

// docId 存在 → 直达文档页；缺失 → 回库首页（由 pages 首页自动定位第一篇文档）。
// /wiki/{wikiId}/{docId}/view 末段的 view/edit 是 web 访客视图的模式后缀，
// pages 无此语义，直接剥掉（第三段及以后一并忽略）。
const target = docId ? `/w/${wikiId}/${docId}` : `/w/${wikiId}`

// SSR 端以 302 中断渲染直接重定向（与 /w/[wikiId]/index.vue 的首篇跳转同款做法）；
// redirectCode 仅作用于服务端响应，客户端导航时退化为普通路由跳转
await navigateTo(target, { redirectCode: 302 })
</script>

<template>
  <!-- 正常流程渲染不到这里（SSR 已 302 中断 / 客户端立即跳转），仅作防御性兜底展示 -->
  <div class="p-8 text-sm text-muted-foreground">正在跳转…</div>
</template>
