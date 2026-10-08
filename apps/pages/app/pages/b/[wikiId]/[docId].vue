<script setup lang="ts">
/**
 * 博客文章页 /b/:wikiId/:docId（博客形态阅读排版，对照参考稿）
 *
 * 形态：博客形态的文章详情页（与帮助中心文档页 /w/:wikiId/:docId 并列）。
 * 布局（还原参考稿三段式）：
 * 1. 面包屑：{库名}（链回博客首页）/ {文章标题}（当前段）；
 * 2. Hero 两栏：左侧大标题 + 导语摘要 + 阅读时长/日期；右侧封面大图
 *    （coverUrl > 正文第一图，无图不渲染右栏、左侧占满，lg+ 两栏 / 移动端单栏）；
 * 3. 正文两栏：左侧正文（后端预渲染 contentHtml，.help-content 排版，SSR 利于 SEO）+
 *    右侧 sticky 目录（xl+ 显示，HelpToc scroll-spy 高亮，顶部小字标题为参考稿样式）。
 *
 * 数据流（SSR，单个 useAsyncData 聚合）：
 * 1. meta 探测（带 docId）→ needsPassword=true 渲染密码卡（noindex）；
 * 2. 整库分享：nodes + document 并行拉取（nodes 用于树校验 + 取节点封面 coverUrl）；
 *    单页分享：只拉 document（封面回退正文第一图）；
 * 3. docId 必须能命中访客树（整库分享时）→ 否则 404（隐藏/越权文档）。
 */
import { fetchShareDocument, fetchShareMeta, fetchShareNodes } from '~/api/share'
import { useApiClient } from '~/api/request'
import { buildTree, findNodePath, type HelpNode } from '~/utils/help-tree'
import { extractToc } from '~/utils/help-toc'

const route = useRoute()

// URL ID 全站统一小写（后端 text 查询大小写敏感，规范化出口防手输大写不命中）
const wikiId = computed(() => String(route.params.wikiId ?? '').toLowerCase())
const docId = computed(() => String(route.params.docId ?? '').toLowerCase())

// 参数变化强制重建页面组件（setup 重跑 → useAsyncData 重新取数）
definePageMeta({
  key: (route) => route.fullPath,
})

// API 客户端：必须在 setup 上下文创建（useAsyncData 异步回调中 Nuxt 实例上下文会丢失）
const api = useApiClient()

// SSR 聚合取数：meta 探测 →（按分享形态）拉取树与正文
const { data, error } = await useAsyncData(`blog-doc-${wikiId.value}-${docId.value}`, async () => {
  const meta = await fetchShareMeta(api, wikiId.value, docId.value)
  if (meta.needsPassword) return { locked: true as const }

  if (meta.accessType === 'wiki') {
    // 整库公开：访客树 + 正文并行拉取
    const [nodes, doc] = await Promise.all([
      fetchShareNodes(api, wikiId.value),
      fetchShareDocument(api, wikiId.value, docId.value),
    ])
    return { locked: false as const, meta, nodes, doc }
  }

  // 单页分享：无访客树，只拉正文
  const doc = await fetchShareDocument(api, wikiId.value, docId.value)
  return { locked: false as const, meta, nodes: [], doc }
})

// 请求失败（分享不存在 / 已关闭 / 越权，ApiError 70001 等）→ 404
if (error.value) {
  throw createError({ statusCode: 404, statusMessage: '文章不存在或已关闭', fatal: true })
}

/** 是否密码保护态 */
const locked = computed(() => !!data.value?.locked)
/** 分享元信息（锁定态为 null） */
const meta = computed(() => (data.value && !data.value.locked ? data.value.meta : null))
/** 文档正文（锁定态为 null） */
const doc = computed(() => (data.value && !data.value.locked ? data.value.doc : null))

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
// 注意：key=fullPath 的页面在博客文章页与 /w 帮助中心互跳时是「先挂载新页、后卸载旧页」——
// 新页 watchEffect 已写入新设置，旧页若无条件清空会把新设置抹掉（页头退回默认 Logo、
// 导航按钮丢失）。此时共享 route 已指向新路由，仍属 /w/ 或 /b/ 前缀则保留设置交给
// 新页接管；只有真正离开两种知识库上下文才清空。
if (import.meta.client) {
  onUnmounted(() => {
    if (!route.path.startsWith('/w/') && !route.path.startsWith('/b/')) siteSettings.value = null
  })
}

/** 访客文档树（单页分享为空数组，跳过树校验） */
const tree = computed<HelpNode[]>(() =>
  data.value && !data.value.locked ? buildTree(data.value.nodes) : []
)

/**
 * 当前文档在访客树中的命中链
 * - 整库分享：docId 必须在树中命中（对应节点未被隐藏），否则 404；
 * - 单页分享：无树可查，跳过校验。
 */
const path = computed(() =>
  doc.value ? findNodePath(tree.value, (n) => n.documentId === doc.value!.id) : null
)

if (meta.value && meta.value.accessType === 'wiki' && !path.value) {
  throw createError({ statusCode: 404, statusMessage: '文章不存在或未公开', fatal: true })
}

/** 文章标题：优先文档记录，回退 meta.docTitle */
const currentTitle = computed(() => doc.value?.title ?? meta.value?.docTitle ?? '文章')

/** 更新日期（YYYY-MM-DD，ISO 字符串直接截取，SSR/客户端格式确定无 hydration 偏差） */
const updatedDate = computed(() => doc.value?.updatedAt?.slice(0, 10) ?? '')

/** 正文 HTML 注入 TOC 锚点 id 后的结果（复用 help-content 排版作用域） */
const tocResult = computed(() => extractToc(doc.value?.contentHtml))

/** 当前文档在访客树中的节点（整库分享才有，用于取 owner 设置的封面 coverUrl） */
const currentNode = computed(
  () => data.value && !data.value.locked
    ? data.value.nodes.find((n) => n.documentId === doc.value?.id) ?? null
    : null,
)

/**
 * Hero 封面（与列表卡片同优先级）：owner 设置的封面 > 正文第一图 > 不渲染
 * - coverUrl 来自访客树节点（owner 在文档设置里配置）；单页分享无树，只有第一图回退
 */
const coverImage = computed(() => currentNode.value?.coverUrl ?? firstImage.value ?? null)

/** Hero 导语：纯文本压缩空白后取前 150 字（有末尾省略号提示截断） */
const heroExcerpt = computed(() => {
  const text = doc.value?.plainText?.replace(/\s+/g, ' ').trim() ?? ''
  if (!text) return ''
  return text.length > 150 ? `${text.slice(0, 150)}…` : text
})

/**
 * 阅读时长（分钟）：后端 wordCount（纯文本字数）÷ 中文阅读速度约 400 字/分钟，
 * 至少 1 分钟；与参考稿「阅读时长：11 分钟 / 2026-09-06」同款格式在模板拼接
 */
const readingMinutes = computed(() => Math.max(1, Math.round((doc.value?.wordCount ?? 0) / 400)))

/**
 * 从 Tiptap JSON 提取第一张图片 src（og:image 用）
 * 与后端 extractFirstImage 同逻辑的精简版；仅本文页一处使用，不抽公共工具
 */
const firstImage = computed<string | null>(() => {
  const walk = (node: unknown): string | null => {
    if (!node || typeof node !== 'object') return null
    const n = node as { type?: unknown; attrs?: { src?: unknown }; content?: unknown }
    if (n.type === 'image' && typeof n.attrs?.src === 'string' && n.attrs.src) return n.attrs.src
    if (Array.isArray(n.content)) {
      for (const child of n.content) {
        const found = walk(child)
        if (found) return found
      }
    }
    return null
  }
  return walk(doc.value?.content)
})

/** og:image 仅输出绝对地址（相对路径 /uploads/... 拼绝对地址依赖部署域名，本期不处理） */
const ogImage = computed(() => {
  const src = firstImage.value
  return src && /^https?:\/\//.test(src) ? src : undefined
})

// SEO：文章页输出标题 + 正文摘要（前 150 字，缺省回退站点 SEO 描述）+ article og 标签；密码库 noindex 不收录
/** meta description：正文摘要优先（文章相关性更强），owner 配置的站点 SEO 描述兜底 */
const seoDescription = computed(
  () => doc.value?.plainText?.replace(/\s+/g, ' ').trim().slice(0, 150) || meta.value?.seoDescription || undefined
)

useSeoMeta({
  title: () => currentTitle.value,
  description: () => seoDescription.value,
  ogTitle: () => currentTitle.value,
  ogDescription: () => seoDescription.value,
  ogType: 'article',
  ogImage,
  articleModifiedTime: () => doc.value?.updatedAt,
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

  <div v-else-if="meta && doc" class="mx-auto w-full max-w-[1200px] px-4 py-8 sm:px-6">
    <!-- ===== 面包屑：{库名}（链回博客首页）/ {文章标题} ===== -->
    <nav aria-label="面包屑" class="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
      <NuxtLink
        :to="`/b/${wikiId}`"
        class="shrink-0 cursor-pointer transition-colors hover:text-foreground"
      >
        {{ meta.wikiName }}
      </NuxtLink>
      <span class="shrink-0 text-muted-foreground/50">/</span>
      <span class="min-w-0 truncate" :title="currentTitle">{{ currentTitle }}</span>
    </nav>

    <!-- ===== Hero 两栏：左标题/导语/阅读时长 + 右封面大图（无封面不渲染右栏） ===== -->
    <header
      class="mt-8 flex flex-col gap-8 lg:flex-row lg:items-center lg:gap-12"
    >
      <div class="min-w-0 flex-1">
        <h1 class="text-3xl font-bold leading-tight tracking-tight text-foreground sm:text-4xl">
          {{ currentTitle }}
        </h1>
        <!-- 导语摘要：纯文本前 150 字（无内容不渲染） -->
        <p v-if="heroExcerpt" class="mt-5 text-base leading-relaxed text-muted-foreground">
          {{ heroExcerpt }}
        </p>
        <!-- 阅读时长 / 更新日期（参考稿「阅读时长：N 分钟 / YYYY-MM-DD」格式） -->
        <p v-if="updatedDate" class="mt-7 text-sm text-muted-foreground">
          阅读时长：约 {{ readingMinutes }} 分钟 / {{ updatedDate }}
        </p>
      </div>

      <!-- 封面图：coverUrl > 正文第一图；无图不占位（与列表「留空」策略一致） -->
      <div v-if="coverImage" class="shrink-0 lg:w-[46%]">
        <img
          :src="coverImage"
          :alt="currentTitle"
          class="aspect-video w-full rounded-xl border border-border/60 object-cover"
        />
      </div>
    </header>

    <!-- ===== 正文两栏：左正文 + 右 sticky 目录（xl+ 显示） ===== -->
    <div class="mt-14 flex items-stretch gap-12">
      <main class="min-w-0 flex-1">
        <!-- 正文：后端预渲染 HTML（.help-content 排版作用域） -->
        <div v-if="tocResult.html" class="help-content" v-html="tocResult.html" />
        <div
          v-else
          class="rounded-xl border border-dashed py-16 text-center text-sm text-muted-foreground"
        >
          该文档暂无内容
        </div>
      </main>

      <!-- 右栏目录：与正文同源锚点（extractToc 注入 id），scroll-spy 高亮当前章节 -->
      <aside class="hidden w-64 shrink-0 xl:block">
        <div class="sticky top-14 max-h-[calc(100vh-7rem)] overflow-y-auto pt-1">
          <HelpToc :items="tocResult.items" :title="currentTitle" />
        </div>
      </aside>
    </div>
  </div>
</template>
