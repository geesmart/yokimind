<script setup lang="ts">
/**
 * 帮助中心落地页 /w/:wikiId（无 docId）
 *
 * 形态：分组目录页 —— 库头（图标 + 库名 + 帮助中心副标题）+
 * 每个顶级分组一张目录卡（组标题 + 组内全部后代文档链接平铺），
 * 整页 SSR 输出全部文档内链（SEO 友好，参考帮助中心站点的目录页）。
 *
 * 当前行为（目录首页暂不上线）：取数成功且有可读文档时，SSR 阶段直接 302
 * 跳转到树序第一个文档，访客进入 /w/{wikiId} 即见首篇正文；仅密码锁定 /
 * 空库仍在本页展示锁定卡 / 空态。目录模板整体保留，便于日后恢复上线。
 *
 * 数据流（SSR，单个 useAsyncData 聚合）：
 * 1. fetchShareMeta → needsPassword=true 时渲染密码保护卡（noindex）；
 * 2. fetchShareNodes → buildTree → 分组目录。
 * SHARE_NOT_FOUND（未分享/已关闭/越权）→ 404 错误页。
 */
import { BookOpen, FileText } from '@lucide/vue'
import { fetchShareMeta, fetchShareNodes } from '~/api/share'
import { useApiClient } from '~/api/request'
import { buildTree, collectDocs, type HelpNode } from '~/utils/help-tree'
import { getColorStyle, getIconComponent } from '~/utils/icon-meta'

const route = useRoute()

// URL ID 全站统一小写（后端 text 查询大小写敏感，规范化出口防手输大写不命中）
const wikiId = computed(() => String(route.params.wikiId ?? '').toLowerCase())

// API 客户端：必须在 setup 上下文创建（useAsyncData 异步回调中 Nuxt 实例上下文会丢失）
const api = useApiClient()

// 参数变化（理论上跨库切换）强制重建页面组件，触发重新取数
definePageMeta({
  key: (route) => route.fullPath,
})

// SSR 聚合取数：meta 探测 →（公开时）拉访客文档树
const { data, error } = await useAsyncData(`help-landing-${wikiId.value}`, async () => {
  const meta = await fetchShareMeta(api, wikiId.value)
  if (meta.needsPassword) return { locked: true as const }
  const nodes = await fetchShareNodes(api, wikiId.value)
  return { locked: false as const, meta, nodes }
})

// 分享不存在 / 已关闭 / 跨库越权（ApiError 70001 等）→ 404
if (error.value) {
  console.error('[help-landing] useAsyncData error:', error.value)
  throw createError({ statusCode: 404, statusMessage: '分享不存在或已关闭', fatal: true })
}

// 单页分享（accessType=page）没有可浏览的库目录 → 404（只能经文档直链访问）
if (data.value && !data.value.locked && data.value.meta.accessType === 'page') {
  throw createError({ statusCode: 404, statusMessage: '分享不存在或已关闭', fatal: true })
}

// ===== 目录首页暂不上线：直接进入默认第一个文档 =====
// 按树先序遍历（sortOrder 升序）找到第一个 documentId 非空的节点，302 跳转
// /w/{wikiId}/{docId}（与预览页整库入口定位首文档同款逻辑）；
// 密码锁定 / 空库不跳转，保留锁定卡与空态展示。目录页模板保留，便于日后恢复。
if (data.value && !data.value.locked) {
  const firstDoc = buildTree(data.value.nodes).flatMap((root) => collectDocs(root))[0]
  if (firstDoc?.documentId) {
    await navigateTo(`/w/${wikiId.value}/${firstDoc.documentId}`, { redirectCode: 302 })
  }
}

/** 是否密码保护态 */
const locked = computed(() => !!data.value?.locked)
/** 分享元信息（锁定态为 null） */
const meta = computed(() => (data.value && !data.value.locked ? data.value.meta : null))

// 站点外观设置注入全局状态（布局消费：页头 Logo / 主题色 / AI 助手开关 / 导航按钮；
// wikiName 供标题模板回退——发布设置的站点标题未配置时标签页后缀用库名）
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

// 离开知识库上下文（回首页等）时清空外观设置，避免主题串页。
// 注意：key=fullPath 的页面在知识库页面之间跳转时是「先挂载新页、后卸载旧页」——
// 新页 watchEffect 已写入新设置，旧页若无条件清空会把新设置抹掉（页头退回
// 默认 Logo、导航按钮丢失）。此时共享 route 已指向新路由，仍属 /w/ 或 /b/
// 前缀则保留设置交给新页接管；只有真正离开知识库上下文才清空。
if (import.meta.client) {
  onUnmounted(() => {
    if (!route.path.startsWith('/w/') && !route.path.startsWith('/b/')) siteSettings.value = null
  })
}

// 访客文档树写入共享状态（布局层搜索弹窗 components/searchbox 的标题命中数据源）；
// 密码锁定态无树可搜写空数组；客户端卸载时清空，避免离开知识库上下文后残留串页。
// 同上：知识库页面间跳转时新页先写入、旧页后卸载，仍处 /w/ 上下文则不清空（防抹掉新树）
const wikiNodes = useWikiNodes()
watchEffect(() => {
  wikiNodes.value = data.value && !data.value.locked ? data.value.nodes : []
})
if (import.meta.client) {
  onUnmounted(() => {
    if (!route.path.startsWith('/w/')) wikiNodes.value = []
  })
}

/** 站点标题：owner 自定义优先，回退库名（落地页 h1 与 SEO 共用） */
const displayTitle = computed(() => (meta.value ? meta.value.siteTitle || meta.value.wikiName : '帮助中心'))

/**
 * 顶级分组目录：每个顶级节点一组
 * - 纯文档顶级节点（有 documentId 且无子级）→ 单行文档卡；
 * - 其余渲染分组卡，collectDocs 平铺组内全部后代文档。
 */
const groups = computed(() => {
  if (!data.value || data.value.locked) return []
  const tree = buildTree(data.value.nodes)
  return tree.map((node: HelpNode) => ({ node, docs: collectDocs(node) }))
})

/**
 * 库头图标渲染，两代数据并存：
 * - Solar 图标 id：server 在 meta 接口烘焙好完整 SVG（wikiIconSvg），v-html 直出（色值已进 SVG，
 *   底色用烘焙色值 color-mix 淡化；rainbow 色值为 null，回退中性底）；
 * - legacy lucide key：wikiIconSvg 为 null，走 icon-meta 组件渲染（视觉与历史一致）。
 */
const wikiIconSvg = computed(() => meta.value?.wikiIconSvg ?? null)

/** 烘焙图标底色（wikiIconColor 缺失/rainbow 时回退中性底） */
const wikiIconBg = computed(() => {
  const color = meta.value?.wikiIconColor
  return color ? `color-mix(in srgb, ${color} 12%, white)` : 'hsl(var(--muted))'
})

/** legacy 图标组件（icon-meta 色板，找不到 key 时回退 BookOpen） */
const wikiIcon = computed(() => getIconComponent(meta.value?.wikiIcon) ?? BookOpen)

/** legacy 路径的图标底色/前景色 */
const wikiIconStyle = computed(() => getColorStyle(meta.value?.wikiColor))

// SEO：落地页输出站点标题（owner 自定义优先回退库名）与描述；密码库 noindex 不收录
// description：owner 配置的站点 SEO 描述优先，留空回退生成文案（meta description）
const seoDescription = computed(() =>
  meta.value
    ? (meta.value.seoDescription ||
      `${meta.value.wikiName} 帮助中心，使用指南与常见问题一站式查阅`)
    : undefined
)

useSeoMeta({
  title: () => displayTitle.value,
  description: () => seoDescription.value,
  ogTitle: () => displayTitle.value,
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

  <div v-else-if="meta" class="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
    <!-- ===== 库头：图标 + 库名 + 副标题 ===== -->
    <header class="mb-12 flex flex-col items-center text-center">
      <div
        class="mb-4 flex size-16 items-center justify-center rounded-2xl"
        :style="wikiIconSvg ? { background: wikiIconBg } : wikiIconStyle"
      >
        <!-- Solar 图标：server 烘焙的完整 SVG（来源仅限 iconify 数据，色值已烘焙） -->
        <span
          v-if="wikiIconSvg"
          class="flex size-8 items-center justify-center [&_svg]:block [&_svg]:size-full"
          v-html="wikiIconSvg"
        />
        <!-- legacy lucide 图标 -->
        <component :is="wikiIcon" v-else class="size-8" />
      </div>
      <h1 class="text-3xl font-bold tracking-tight text-foreground">{{ displayTitle }}</h1>
      <p class="mt-2 text-sm text-muted-foreground">帮助中心</p>
    </header>

    <!-- ===== 分组目录卡 ===== -->
    <div class="space-y-8">
      <section v-for="group in groups" :key="group.node.id">
        <!-- 顶级纯文档：单行链接卡 -->
        <NuxtLink
          v-if="group.node.documentId && group.node.children.length === 0"
          :to="`/w/${wikiId}/${group.node.documentId}`"
          class="group flex items-center gap-3 rounded-xl border border-border bg-card px-5 py-4 transition-colors hover:border-primary/40 hover:bg-accent/50"
        >
          <span v-if="group.node.icon" class="text-lg">{{ group.node.icon }}</span>
          <FileText v-else class="size-4 text-muted-foreground" />
          <span class="min-w-0 flex-1 truncate text-sm font-medium group-hover:text-primary">
            {{ group.node.title }}
          </span>
        </NuxtLink>

        <!-- 分组卡：组标题 + 组内文档平铺 -->
        <div v-else class="overflow-hidden rounded-xl border border-border bg-card">
          <h2
            class="flex items-center gap-2 border-b border-border/70 px-5 py-3.5 text-sm font-semibold text-foreground"
          >
            <span v-if="group.node.icon" class="text-base">{{ group.node.icon }}</span>
            {{ group.node.title }}
          </h2>
          <ul>
            <li
              v-for="doc in group.docs"
              :key="doc.id"
              class="border-b border-border/40 last:border-b-0"
            >
              <NuxtLink
                :to="`/w/${wikiId}/${doc.documentId}`"
                class="flex items-center gap-3 px-5 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
              >
                <span v-if="doc.icon" class="text-base">{{ doc.icon }}</span>
                <FileText v-else class="size-4 shrink-0 text-muted-foreground/60" />
                <span class="min-w-0 flex-1 truncate">{{ doc.title }}</span>
              </NuxtLink>
            </li>
            <li v-if="group.docs.length === 0" class="px-5 py-4 text-sm text-muted-foreground/70">
              该分组暂无文档
            </li>
          </ul>
        </div>
      </section>

      <!-- 空库兜底：没有任何公开节点 -->
      <div
        v-if="groups.length === 0"
        class="rounded-xl border border-dashed py-16 text-center text-sm text-muted-foreground"
      >
        该帮助中心暂未发布任何内容
      </div>
    </div>
  </div>
</template>
