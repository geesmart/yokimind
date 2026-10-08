<script setup lang="ts">
/**
 * 帮助中心文档页 /w/:wikiId/:docId（三栏布局，核心页）
 *
 * 形态对照参考图（帮助中心）：
 * - 左栏（lg+）：分组文档树 + 搜索（HelpSidebar）；
 * - 中栏：面包屑 + 文档标题 + 正文（后端预渲染 contentHtml，SSR 输出利于 SEO）；
 * - 右栏（xl+）：本页目录 TOC（extractToc 同源注入锚点 + scroll-spy 高亮）；
 * - 单页分享（accessType=page）：无左右栏，仅正文；
 * - 密码库（needsPassword=true）：密码保护提示卡 + noindex。
 *
 * 数据流（SSR，单个 useAsyncData 聚合）：
 * 1. meta 探测（带 docId 判定分享形态）→ 锁定态提前终止；
 * 2. 整库分享：nodes + document 并行拉取；单页分享：只拉 document；
 * 3. docId 必须能命中访客树（否则隐藏/非本库文档）→ 404。
 *
 * 注意：动态路由参数变化（同 wiki 内切换文档）时 Nuxt 复用页面组件实例，
 * 需用 definePageMeta.key 强制重建触发重新取数。
 */
import { fetchShareDocument, fetchShareMeta, fetchShareNodes } from '~/api/share'
import { useApiClient } from '~/api/request'
import { buildTree, findNodePath, type HelpNode } from '~/utils/help-tree'
import { extractToc, scrollToHeadingText } from '~/utils/help-toc'

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
const { data, error } = await useAsyncData(`help-doc-${wikiId.value}-${docId.value}`, async () => {
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
  throw createError({ statusCode: 404, statusMessage: '分享不存在或已关闭', fatal: true })
}

/** 是否密码保护态 */
const locked = computed(() => !!data.value?.locked)
/** 分享元信息（锁定态为 null） */
const meta = computed(() => (data.value && !data.value.locked ? data.value.meta : null))
/** 文档正文（锁定态为 null） */
const doc = computed(() => (data.value && !data.value.locked ? data.value.doc : null))

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

// 离开知识库上下文时清空外观设置，避免主题串页。
// 注意：key=fullPath 的页面在站内切换文档时是「先挂载新页、后卸载旧页」——
// 新页 watchEffect 已写入新设置，旧页若无条件清空会把新设置抹掉（页头退回
// 默认 Logo、导航按钮丢失）。此时共享 route 已指向新路由，仍属 /w/ 或 /b/
// 前缀则保留设置交给新页接管；只有真正离开知识库上下文（回首页等）才清空。
if (import.meta.client) {
  onUnmounted(() => {
    if (!route.path.startsWith('/w/') && !route.path.startsWith('/b/')) siteSettings.value = null
  })
}

// 访客文档树写入共享状态（布局层搜索弹窗 components/searchbox 的标题命中数据源）；
// 单页分享 / 密码锁定态无树可搜写空数组；客户端卸载时清空，避免残留串页。
// 同上：切换文档时新页先写入、旧页后卸载，仍处 /w/ 上下文则不清空（防抹掉新树）
const wikiNodes = useWikiNodes()
watchEffect(() => {
  wikiNodes.value = data.value && !data.value.locked ? data.value.nodes : []
})
if (import.meta.client) {
  onUnmounted(() => {
    if (!route.path.startsWith('/w/')) wikiNodes.value = []
  })
}

/** 库名展示（面包屑首段）：owner 自定义站点标题优先，回退库名 */
const displayWikiTitle = computed(() =>
  meta.value ? meta.value.siteTitle || meta.value.wikiName : ''
)

/** 访客文档树（单页分享为空数组，左右栏不渲染） */
const tree = computed<HelpNode[]>(() =>
  data.value && !data.value.locked ? buildTree(data.value.nodes) : []
)

/**
 * 当前文档在访客树中的祖先链（根 → 文档节点）
 * - 整库分享：docId 必须在树中命中（对应节点未被隐藏），否则 404；
 * - 单页分享：无树可查，跳过校验。
 */
const path = computed(() =>
  doc.value ? findNodePath(tree.value, (n) => n.documentId === doc.value!.id) : null
)

if (meta.value && meta.value.accessType === 'wiki' && !path.value) {
  throw createError({ statusCode: 404, statusMessage: '文档不存在或未公开', fatal: true })
}

/** 面包屑分组段（祖先链去掉文档自身） */
const pathTitles = computed(() => path.value?.slice(0, -1).map((n) => n.title) ?? [])

/** 文档标题：优先文档记录，回退 meta.docTitle */
const currentTitle = computed(() => doc.value?.title ?? meta.value?.docTitle ?? '文档')

/** 正文 HTML 注入 TOC 锚点 id 后的结果（html 与 items 同源，锚点必然匹配） */
const tocResult = computed(() => extractToc(doc.value?.contentHtml))

// ============ 正文命中跳转的标题锚点定位（?h=<标题文本>） ============

/**
 * 挂载后按 ?h= 查询参数滚动到对应标题（搜索弹窗「内容命中」跳转携带）。
 * 客户端路由跳转因 definePageMeta.key = fullPath 必然重建页面组件，
 * onMounted 时 SSR / 重取的正文已在 DOM，可直接查找定位。
 */
onMounted(() => {
  const raw = route.query.h
  const heading = Array.isArray(raw) ? raw[0] : raw
  if (typeof heading === 'string') {
    scrollToHeadingText(heading)
  }
})

// SEO：文档页输出标题 + 正文摘要（前 150 字，缺省回退站点 SEO 描述）；密码库 noindex 不收录
/** meta description：正文摘要优先（文档相关性更强），owner 配置的站点 SEO 描述兜底 */
const seoDescription = computed(
  () => doc.value?.plainText?.replace(/\s+/g, ' ').trim().slice(0, 150) || meta.value?.seoDescription || undefined
)

useSeoMeta({
  title: () => currentTitle.value,
  description: () => seoDescription.value,
  ogTitle: () => currentTitle.value,
  ogDescription: () => seoDescription.value,
  ogType: 'article',
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

  <div v-else-if="meta && doc" class="mx-auto flex w-full max-w-[1400px] items-stretch">
    <!-- ===== 左栏：分组文档树（lg+ 显示，单页分享无左栏） ===== -->
    <aside v-if="meta.accessType === 'wiki'" class="hidden w-72 shrink-0 lg:block">
      <!-- max-h 上限 = 100vh - 7rem（页头 3.5rem + 页脚 3.5rem）：
           侧栏内容自适应高度、超长时封顶，任何内容组合下页面都不会产生
           「页脚高度」的死滚动余量（固定 h-[100vh-3.5rem] 会把短文页撑出一屏，
           且 sticky 行程耗尽后侧栏随页面上滑、搜索框被页头裁掉）。
           flex-col：内部高度链用纯 flex 分配（max-h 容器高度非 definite，
           子级 h-full 百分比会失效）。 -->
      <div class="sticky top-14 flex max-h-[calc(100vh-7rem)] flex-col">
        <HelpSidebar :wiki-id="wikiId" :tree="tree" :active-doc-id="docId" />
      </div>
    </aside>

    <!-- ===== 中栏：正文 ===== -->
    <main class="min-w-0 flex-1">
      <article class="mx-auto w-full max-w-[760px] px-4 py-8 sm:px-8">
        <!-- 面包屑（单页分享隐藏：库名落地页可能未开放）；首段展示站点标题（自定义优先） -->
        <HelpBreadcrumb
          v-if="meta.accessType === 'wiki'"
          :wiki-id="wikiId"
          :wiki-name="displayWikiTitle"
          :path-titles="pathTitles"
          :current-title="currentTitle"
        />

        <!-- 文档标题（前缀 emoji icon 可空） -->
        <h1 class="mb-8 mt-5 text-3xl font-bold leading-tight text-foreground">
          <span v-if="doc.icon" class="mr-2">{{ doc.icon }}</span
          >{{ currentTitle }}
        </h1>

        <!-- 正文：后端预渲染 HTML（.help-content 排版作用域） -->
        <div v-if="tocResult.html" class="help-content" v-html="tocResult.html" />
        <div
          v-else
          class="rounded-xl border border-dashed py-16 text-center text-sm text-muted-foreground"
        >
          该文档暂无内容
        </div>
      </article>
    </main>

    <!-- ===== 右栏：本页目录（xl+ 显示） ===== -->
    <aside class="hidden w-60 shrink-0 xl:block">
      <!-- pt-6：TOC 下移与页头留出间距，不顶到上面（border 线起点随之同步下移）；
           max-h 同左栏口径（100vh - 7rem），长目录 + 短正文时页面不产生死滚动余量 -->
      <div class="sticky top-14 max-h-[calc(100vh-7rem)] overflow-y-auto pt-10">
        <HelpToc :items="tocResult.items" />
      </div>
    </aside>
  </div>
</template>
