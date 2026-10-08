<script setup lang="ts">
/**
 * 博客首页 /b/:wikiId（无 docId）
 *
 * 形态：知识库发布为博客时的站点首页（与帮助中心 /w/:wikiId 并列的公开形态，
 * 由 wiki_publish.publishType = 'blog' 标识，owner 在发布设置中配置）。
 * 布局还原参考稿：Hero（库名大标题 + 描述副标题，左对齐）+ 文章卡片网格
 * （3 列 lg / 2 列 sm / 1 列移动端），卡片 = 封面图 + 标题 + 摘要。
 *
 * 数据流（SSR，单个 useAsyncData 聚合）：
 * 1. fetchShareMeta → needsPassword=true 时渲染密码保护卡（noindex）；
 * 2. fetchBlogPosts → 卡片网格（排序已由后端按文档树先序保证）。
 * SHARE_NOT_FOUND（未分享/已关闭/私密库）→ 404 错误页。
 *
 * 注意：动态路由参数变化时 Nuxt 复用页面组件实例，
 * 需用 definePageMeta.key 强制重建触发重新取数（与 /w 页面同模式）。
 */
import { fetchShareMeta } from '~/api/share'
import { fetchBlogPosts } from '~/api/blog'
import { useApiClient } from '~/api/request'

const route = useRoute()

// URL ID 全站统一小写（后端 text 查询大小写敏感，规范化出口防手输大写不命中）
const wikiId = computed(() => String(route.params.wikiId ?? '').toLowerCase())

// API 客户端：必须在 setup 上下文创建（useAsyncData 异步回调中 Nuxt 实例上下文会丢失）
const api = useApiClient()

// 参数变化（理论上跨库切换）强制重建页面组件，触发重新取数
definePageMeta({
  key: (route) => route.fullPath,
})

// SSR 聚合取数：meta 探测 →（公开时）拉博客文章列表
const { data, error } = await useAsyncData(`blog-landing-${wikiId.value}`, async () => {
  const meta = await fetchShareMeta(api, wikiId.value)
  if (meta.needsPassword) return { locked: true as const }
  const posts = await fetchBlogPosts(api, wikiId.value)
  return { locked: false as const, meta, posts }
})

// 分享不存在 / 已关闭 / 私密库（ApiError 70001 等）→ 404
if (error.value) {
  console.error('[blog-landing] useAsyncData error:', error.value)
  throw createError({ statusCode: 404, statusMessage: '博客不存在或已关闭', fatal: true })
}

// 单页分享（accessType=page）没有博客列表入口 → 404（只能经文档直链访问）
if (data.value && !data.value.locked && data.value.meta.accessType === 'page') {
  throw createError({ statusCode: 404, statusMessage: '博客不存在或已关闭', fatal: true })
}

/** 是否密码保护态 */
const locked = computed(() => !!data.value?.locked)
/** 分享元信息（锁定态为 null） */
const meta = computed(() => (data.value && !data.value.locked ? data.value.meta : null))
/** 文章列表（锁定态为空数组） */
const posts = computed(() => (data.value && !data.value.locked ? data.value.posts : []))

// 站点外观设置注入全局状态（布局消费：页头 Logo / 主题色 / AI 助手开关 / 导航按钮；
// wikiName 供标题模板回退——与 /w 帮助中心页面同模式，博客形态库同样支持自定义外观）
const siteSettings = useSiteSettings()
watchEffect(() => {
  const m = meta.value
  siteSettings.value = m
    ? {
        siteTitle: m.siteTitle ?? null,
        wikiName: m.wikiName ?? null,
        siteLogo: m.siteLogo ?? null,
        siteColor: m.siteColor ?? null,
        aiEnabled: m.aiEnabled ?? true,
        navButtons: m.navButtons ?? null,
      }
    : null
})

// 离开知识库/博客上下文（回首页等）时清空外观设置，避免主题串页。
// 注意：key=fullPath 的页面在博客页与 /w 帮助中心互跳时是「先挂载新页、后卸载旧页」——
// 新页 watchEffect 已写入新设置，旧页若无条件清空会把新设置抹掉（页头退回默认 Logo、
// 导航按钮丢失）。此时共享 route 已指向新路由，仍属 /w/ 或 /b/ 前缀则保留设置交给
// 新页接管；只有真正离开两种知识库上下文才清空。
if (import.meta.client) {
  onUnmounted(() => {
    if (!route.path.startsWith('/w/') && !route.path.startsWith('/b/')) siteSettings.value = null
  })
}

// SEO：首页输出库名与描述；密码库 noindex 不收录
// description：owner 配置的站点 SEO 描述优先，回退库描述与生成文案（meta description）
const seoDescription = computed(() =>
  meta.value
    ? (meta.value.seoDescription ||
      meta.value.wikiDescription ||
      `${meta.value.wikiName} 博客文章列表`)
    : undefined
)

useSeoMeta({
  title: () => meta.value?.wikiName ?? '博客',
  description: () => seoDescription.value,
  ogTitle: () => meta.value?.wikiName,
  ogDescription: () => seoDescription.value,
  robots: () => (locked.value ? 'noindex, nofollow' : undefined),
})

// 关键词单独走 useHead（useSeoMeta 的类型不含 keywords）：owner 配置的 SEO 关键词，留空不输出
useHead({
  meta: [{ name: 'keywords', content: () => meta.value?.seoKeywords || undefined }],
})
</script>

<template>
  <!-- 密码保护库：提示卡（本期不支持在此输密码） -->
  <LockedCard v-if="locked" />

  <div v-else-if="meta" class="mx-auto w-full max-w-[1400px] px-4 py-12 sm:px-6">
    <!-- ===== Hero：库名大标题 + 描述副标题（左对齐，还原参考稿） ===== -->
    <header class="mb-10">
      <h1 class="text-4xl font-bold tracking-tight text-foreground">{{ meta.wikiName }}</h1>
      <p v-if="meta.wikiDescription" class="mt-3 text-lg text-muted-foreground">
        {{ meta.wikiDescription }}
      </p>
    </header>

    <!-- ===== 文章卡片网格：3 列（lg）/ 2 列（sm）/ 1 列（移动端） ===== -->
    <div class="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
      <PostCard v-for="post in posts" :key="post.nodeId" :post="post" :wiki-id="wikiId" />
    </div>

    <!-- 空库兜底：没有任何公开文章 -->
    <div
      v-if="posts.length === 0"
      class="rounded-xl border border-dashed py-16 text-center text-sm text-muted-foreground"
    >
      该博客暂未发布任何内容
    </div>
  </div>
</template>
