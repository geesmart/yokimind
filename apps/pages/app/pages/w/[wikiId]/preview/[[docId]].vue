<script setup lang="ts">
/**
 * 预览模式页 /w/:wikiId/preview/:docId?（可选）?t={previewToken}（owner 专属）
 *
 * 预览语义是「整个知识库」：URL 的 docId 段为可选（[[docId]] 动态参数），
 * 编辑器整库入口打开 /w/{wikiId}/preview（不带 docId）时，取数后自动定位
 * 文档树先序遍历的第一个文档作为首屏正文；带 docId 时直达指定文档。
 *
 * 路由位置说明：本页刻意放在 `[wikiId]/preview/[[docId]].vue` 而非
 * `[wikiId]/[docId]/preview.vue` —— Nuxt 约定「同名 .vue 文件 + 同名目录」会形成
 * 嵌套路由（子页需在父页 <NuxtPage /> 出口内渲染），后者会被当成公开站
 * `[docId].vue` 的子路由，而公开站页面没有 <NuxtPage /> 出口，结果 URL 只渲染出
 * 公开站父组件（并被其分享密码逻辑拦截显示「内容受密码保护」），预览页永不出现。
 * `preview/` 目录无同名 preview.vue 兄弟文件，是一条独立的顶层路由。
 *
 * 与公开站 [docId].vue 三栏布局一致（复用 HelpSidebar / HelpBreadcrumb / HelpToc），
 * 差异：
 * - 鉴权：URL ?t= 携带短时效预览令牌（web 编辑器签发，1 小时有效，仅 owner 可获取），
 *   所有预览接口走 X-Preview-Token 头；令牌缺失 / 过期 / 篡改 → 「无访问权限」卡片
 *   （后端 70010，不泄露任何站点内容）
 * - **不复核发布状态、不校验密码**：未发布 / 设了访问密码的库也能完整预览
 *   （能否打开只由「是不是 owner」决定 —— 预览令牌只有 owner 能签发）
 * - 顶部「预览模式」提示条：右侧操作组 = 外观设置开关（toggle 右侧整页侧边栏）/
 *   发布（未发布时显示，POST /publish/.../publish 开发布开关）/ 关闭预览；
 *   SettingsPanel 以页面级右侧侧边栏形式出现（fixed 贴视口右缘、提示条下方直达页底，
 *   布局层给全局加 lg:pr-[380px] 让位），可配置站点标题 / Logo / SEO（描述+关键词）/
 *   导航按钮 / AI 助手开关，保存后公开站即时生效；TOC 展开时让位给正文
 * - 文档切换在组件内完成（HelpSidebar preview 模式 emit select，不走公开站路由）
 * - SEO：noindex，预览页绝不收录
 *
 * 令牌存储：挂载时把 URL ?t= 转存 sessionStorage（preview-token:{wikiId}），
 * 后续无 query 的刷新/客户端取数可回退使用（URL 携带的令牌优先）
 */
import { Eye, Loader2, Rocket, Send, Settings2, ShieldX, X } from '@lucide/vue'
import { fetchPreviewAggregate, fetchPreviewDocument, publishWikiSite, unpublishWikiSite } from '~/api/publish'
import { ApiError, useApiClient } from '~/api/request'
import { buildTree, collectDocs, findNodePath, type HelpNode } from '~/utils/help-tree'
import { extractToc, scrollToHeadingText } from '~/utils/help-toc'
import type { ShareDocument, ShareNavButton, ShareNodeItem, ShareSiteConfig } from '~/api/types'

const route = useRoute()

// URL ID 全站统一小写（后端 text 查询大小写敏感，规范化出口防手输大写不命中）
// docId 可选：整库入口 /w/{wikiId}/preview 不带该段，取数后自动定位第一个文档
const wikiId = computed(() => String(route.params.wikiId ?? '').toLowerCase())
const docId = computed(() => String(route.params.docId ?? '').toLowerCase())

// 参数变化强制重建页面组件（setup 重跑 → useAsyncData 重新取数）
definePageMeta({
  key: (route) => route.fullPath,
})

// API 客户端：必须在 setup 上下文创建（useAsyncData 异步回调中 Nuxt 实例上下文会丢失）
const api = useApiClient()

// ==================== 预览令牌 ====================

/** URL ?t= 携带的令牌（SSR 也能拿到；分享链接里的令牌 1 小时后过期） */
const queryToken = computed(() => {
  const t = route.query.t
  const raw = Array.isArray(t) ? (t[0] ?? '') : (t ?? '')
  return typeof raw === 'string' ? raw : ''
})

/** URL 是否携带令牌：决定 useAsyncData 是否在服务端执行（无 query 令牌时
 *  SSR 侧拿不到 sessionStorage，强制跳过 SSR 由客户端取数） */
const hasQueryToken = !!queryToken.value

/** 预览令牌 sessionStorage 键（按 wiki 隔离） */
function previewTokenKey(id: string): string {
  return `preview-token:${id}`
}

// ==================== 首屏聚合取数 ====================

const { data, error } = await useAsyncData(`preview-${wikiId.value}-${docId.value}`, async () => {
  // 令牌解析：URL ?t= 优先；客户端回退 sessionStorage（无 query 令牌的刷新场景）
  let token = queryToken.value
  if (!token && import.meta.client) {
    token = sessionStorage.getItem(previewTokenKey(wikiId.value)) ?? ''
  }
  // 无令牌：本地直接抛 70010（与后端校验失败同码，渲染同一张"无访问权限"卡片）
  if (!token) {
    throw new ApiError('预览凭证无效或已过期，请从编辑器重新打开预览', 70010)
  }
  const aggregate = await fetchPreviewAggregate(api, wikiId.value, token, docId.value || undefined)
  // 整库入口（URL 不带 docId，聚合接口 doc 为 null）：自动定位文档树先序
  // 第一个文档节点拉取正文作为首屏，复用文档切换接口（documents.id 防越权解析）
  if (!aggregate.doc) {
    // collectDocs 只收集 documentId 非空的节点，故可断言非空
    const firstDoc = buildTree(aggregate.nodes).flatMap((root) => collectDocs(root))[0]
    if (firstDoc) {
      aggregate.doc = await fetchPreviewDocument(api, wikiId.value, token, firstDoc.documentId!)
    }
  }
  return { token, ...aggregate }
}, { server: hasQueryToken })

// 挂载时把 URL 令牌转存 sessionStorage（刷新不丢；仅客户端执行）
onMounted(() => {
  if (queryToken.value) {
    sessionStorage.setItem(previewTokenKey(wikiId.value), queryToken.value)
  }
})

// ============ 正文命中跳转的标题锚点定位（?h=<标题文本>） ============

/**
 * 挂载后按 ?h= 查询参数滚动到对应标题（搜索弹窗「内容命中」跳转携带，
 * 预览态弹窗跳 /w/{wikiId}/preview/{docId}?h=...，key=fullPath 重建本页后直达该文档）。
 * 与公开页不同：预览取数走 client-only useAsyncData（URL 无 ?t= 时），
 * setup await 结束后正文才可渲染，onMounted 里先 nextTick 等 DOM 提交再查找。
 */
onMounted(async () => {
  const raw = route.query.h
  const heading = Array.isArray(raw) ? raw[0] : raw
  if (typeof heading !== 'string' || !heading) return
  await nextTick()
  scrollToHeadingText(heading)
})

// ==================== 预览数据（可变：文档切换 / 配置保存后本地更新） ====================

/** 令牌（后续文档切换 / 保存配置请求复用） */
const token = ref(data.value?.token ?? '')
/** 站点配置（保存配置成功后本地更新 → 全站即时生效） */
const site = ref<ShareSiteConfig | null>(data.value?.site ?? null)
/** 文档树扁平节点（预览为 owner 视角完整树） */
const nodes = ref<ShareNodeItem[]>(data.value?.nodes ?? [])
/** 当前文档（侧栏切换时本地更新，不走路由） */
const doc = ref<ShareDocument | null>(data.value?.doc ?? null)

/** 文档切换中标记（防重复点击连点） */
const docLoading = ref(false)

// 站点外观设置注入全局状态（布局消费：页头 Logo / 主题色 / AI 助手开关 / 导航按钮 ——
// 预览页改配置保存后经 site ref 更新传导到布局，所见即所得；
// wikiName 供标题模板回退——发布设置的站点标题未配置时标签页后缀用库名）
const siteSettings = useSiteSettings()
watchEffect(() => {
  siteSettings.value = site.value
    ? {
        siteTitle: site.value.siteTitle,
        wikiName: site.value.wikiName ?? null,
        siteLogo: site.value.siteLogo,
        siteColor: site.value.siteColor,
        aiEnabled: site.value.aiEnabled,
        navButtons: site.value.navButtons,
      }
    : null
})

// 离开预览（关闭标签 / 回公开站）时清空外观设置，避免主题串页。
// 注意：key=fullPath 的页面在预览文档间切换 / 预览与公开站互跳时是「先挂载新页、
// 后卸载旧页」——新页 watchEffect 已写入新设置，旧页若无条件清空会把新设置抹掉
// （页头退回默认 Logo、导航按钮丢失）。此时共享 route 已指向新路由，仍属 /w/
// 或 /b/ 前缀则保留设置交给新页接管；只有真正离开知识库上下文才清空。
if (import.meta.client) {
  onUnmounted(() => {
    if (!route.path.startsWith('/w/') && !route.path.startsWith('/b/')) siteSettings.value = null
  })
}

// 文档树写入共享状态（布局层搜索弹窗 components/searchbox 的标题命中数据源）。
// 预览为 owner 完整树（未发布/隐藏页也在内）；令牌无效态 nodes 为空（拒绝卡片无搜索意义）；
// 客户端卸载时清空，避免离开知识库上下文后残留串页。
// 同上：预览文档间切换时新页先写入、旧页后卸载，仍处 /w/ 上下文则不清空（防抹掉新树）
const wikiNodes = useWikiNodes()
watchEffect(() => {
  wikiNodes.value = data.value ? data.value.nodes : []
})
if (import.meta.client) {
  onUnmounted(() => {
    if (!route.path.startsWith('/w/')) wikiNodes.value = []
  })
}

// ==================== 派生展示数据 ====================

/** 访问拒绝（70010 等）：渲染"无访问权限"卡片，不泄露任何内容 */
const denied = computed(() => !!error.value)
/** 拒绝卡片文案：ApiError 透出后端 message（凭证过期 / 格式校验等），其余兜底 */
const deniedMessage = computed(() =>
  error.value instanceof ApiError ? error.value.message : '预览加载失败，请稍后重试'
)

/** 未发布状态（提示条展示"尚未发布"说明） */
const unpublished = computed(() => site.value?.shareStatus !== 'public')

/** 站点标题：owner 自定义优先，回退库名（面包屑首段展示用） */
const displayWikiTitle = computed(() =>
  site.value ? site.value.siteTitle || site.value.wikiName : ''
)

/** 文档树（与公开站同构） */
const tree = computed<HelpNode[]>(() => buildTree(nodes.value))

/** 当前文档在树中的祖先链（面包屑用；树内必能命中——树来自同一次聚合数据） */
const path = computed(() =>
  doc.value ? findNodePath(tree.value, (n) => n.documentId === doc.value!.id) : null
)

/** 面包屑分组段（祖先链去掉文档自身） */
const pathTitles = computed(() => path.value?.slice(0, -1).map((n) => n.title) ?? [])

/** 当前文档标题 */
const currentTitle = computed(() => doc.value?.title ?? '文档')

/** 正文 HTML 注入 TOC 锚点 id 后的结果（html 与 items 同源，锚点必然匹配） */
const tocResult = computed(() => extractToc(doc.value?.contentHtml))

// SEO：预览页绝不收录（noindex + 独立标题）
useSeoMeta({
  title: '预览模式',
  robots: 'noindex, nofollow',
})

// ==================== 交互 ====================

/**
 * 外观设置面板展开态（默认展开，owner 打开预览的即为了配置）。
 * 与布局层共享（useState('preview-panel-open')，布局在预览路由 + 展开时给根容器
 * 加 lg:pr-[380px] 让位）；预览条开关与面板内 X 操作同一份状态。
 */
const panelOpen = useState('preview-panel-open', () => true)

/** 发布/取消发布请求进行中标记（防连点，两态共用） */
const togglingPublish = ref(false)

/**
 * 发布站点（预览条「发布」按钮）：开发布开关（shareStatus → public + 清除密码），
 * 站点形态与外观设置保持原值（后端 POST /publish/wiki/:wikiId/publish）。
 * 成功后本地更新 shareStatus → 按钮切为「已发布」、「尚未发布」徽标即时消失；
 * 失败不打断预览（控制台留痕，按钮恢复可点可重试）
 */
async function onPublish() {
  if (togglingPublish.value) return
  togglingPublish.value = true
  try {
    await publishWikiSite(api, wikiId.value, token.value)
    if (site.value) {
      site.value = { ...site.value, shareStatus: 'public' }
    }
  } catch (e) {
    console.error('[preview] 发布失败:', e)
  } finally {
    togglingPublish.value = false
  }
}

/**
 * 取消发布（预览条「已发布」按钮，点击下架）：关发布开关（shareStatus → private），
 * 访客即刻不可访问（公开接口实时复核 shareStatus）；外观与形态不变，可再次发布恢复
 */
async function onUnpublish() {
  if (togglingPublish.value) return
  togglingPublish.value = true
  try {
    await unpublishWikiSite(api, wikiId.value, token.value)
    if (site.value) {
      site.value = { ...site.value, shareStatus: 'private' }
    }
  } catch (e) {
    console.error('[preview] 取消发布失败:', e)
  } finally {
    togglingPublish.value = false
  }
}

/**
 * 预览内切换文档（HelpSidebar preview 模式 emit select）
 * 组件内拉取正文更新本地 doc，不走路由（公开站路由对未发布库 404）
 */
async function onSelectDoc(documentId: string) {
  if (docLoading.value || doc.value?.id === documentId) return
  docLoading.value = true
  try {
    doc.value = await fetchPreviewDocument(api, wikiId.value, token.value, documentId)
  } catch (e) {
    // 切换失败不打断预览：控制台记录 + 文档区维持现状
    console.error('[preview] 切换文档失败:', e)
  } finally {
    docLoading.value = false
  }
}

/** 外观配置保存成功：更新本地 site → 主题色 / Logo / AI 开关即时生效 */
function onConfigSaved(result: {
  siteTitle: string | null
  siteLogo: string | null
  siteColor: string | null
  aiEnabled: boolean
  navButtons: ShareNavButton[] | null
}) {
  if (!site.value) return
  site.value = { ...site.value, ...result }
}

/** 关闭预览：预览页由编辑器 window.open 打开，close 可直接关掉该标签 */
function onClosePreview() {
  window.close()
}
</script>

<template>
  <!-- ============ 预览模式提示条（两种状态都常驻渲染） ============
       fixed 钉在视口最顶端，盖在页头上方；布局页头对预览路由固定下移 40px 让位
       （纯路由判断，SSR/客户端一致），提示条补位避免顶部空白；令牌无效时仍提供
       「关闭预览」出口，未发布徽标仅在拿到站点配置后展示。
       右侧操作组：外观设置开关（激活态高亮）/ 发布开关（未发布=深色「发布」、
       已发布=绿色「已发布」点击下架）/ 关闭预览（ghost），操作成功后按钮态与徽标即时切换 -->
  <div
    class="fixed inset-x-0 top-0 z-50 border-b border-amber-200/70 bg-amber-50/95 backdrop-blur dark:border-amber-500/20 dark:bg-amber-950/40"
  >
    <div class="mx-auto flex h-10 w-full max-w-[1400px] items-center gap-2 px-4 text-sm">
      <Eye class="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
      <span class="min-w-0 truncate text-amber-900 dark:text-amber-200">
        预览模式 · 仅所有者可见（链接 1 小时内有效）
      </span>
      <!-- 未发布说明：预览的核心场景是发布前检查（拒绝态无 site 数据不展示） -->
      <span
        v-if="site && unpublished"
        class="hidden shrink-0 rounded-full bg-amber-200/70 px-2 py-0.5 text-xs text-amber-900 md:inline dark:bg-amber-500/20 dark:text-amber-200"
      >
        该站点尚未发布
      </span>
      <span class="flex-1" />
      <!-- 右侧操作组：外观设置开关 / 发布 / 关闭预览 -->
      <div class="flex shrink-0 items-center gap-1.5">
        <!-- 外观设置开关：面板展开时保持激活高亮（aria-pressed 供无障碍） -->
        <button
          type="button"
          :aria-pressed="panelOpen"
          class="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-colors"
          :class="
            panelOpen
              ? 'bg-amber-200/80 text-amber-900 dark:bg-amber-500/25 dark:text-amber-100'
              : 'text-amber-900/80 hover:bg-amber-200/80 hover:text-amber-900 dark:text-amber-200/80 dark:hover:bg-amber-500/25 dark:hover:text-amber-100'
          "
          @click="panelOpen = !panelOpen"
        >
          <Settings2 class="size-3.5" />
          外观设置
        </button>
        <!-- 发布开关（状态切换按钮）：
             未发布 → 深色实心「发布」（Rocket，主操作）；已发布 → 绿色描边「已发布」（Send，
             title 提示点击即下架）；请求中转 loading + 文案，成功后按钮态与徽标即时切换 -->
        <button
          v-if="site"
          type="button"
          :disabled="togglingPublish"
          :title="unpublished ? '发布到公开站' : '点击取消发布'"
          class="flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60"
          :class="
            unpublished
              ? 'bg-amber-900 text-amber-50 hover:bg-amber-800 dark:bg-amber-200 dark:text-amber-950 dark:hover:bg-amber-100'
              : 'border border-emerald-600/40 bg-emerald-600/10 text-emerald-700 hover:bg-emerald-600/20 dark:border-emerald-400/30 dark:text-emerald-300 dark:hover:bg-emerald-400/15'
          "
          @click="unpublished ? onPublish() : onUnpublish()"
        >
          <Loader2 v-if="togglingPublish" class="size-3.5 animate-spin" />
          <Rocket v-else-if="unpublished" class="size-3.5" />
          <Send v-else class="size-3.5" />
          {{ togglingPublish ? (unpublished ? '发布中…' : '取消中…') : unpublished ? '发布' : '已发布' }}
        </button>
        <!-- 关闭预览：ghost 弱化（编辑器标签页 window.close） -->
        <button
          type="button"
          class="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium text-amber-900/80 transition-colors hover:bg-amber-200/80 hover:text-amber-900 dark:text-amber-200/80 dark:hover:bg-amber-500/25 dark:hover:text-amber-100"
          @click="onClosePreview"
        >
          <X class="size-3.5" />
          关闭预览
        </button>
      </div>
    </div>
  </div>

  <!-- ============ 无访问权限（令牌缺失 / 过期 / 篡改，70010）：不泄露任何内容 ============ -->
  <div v-if="denied" class="mx-auto w-full max-w-md px-4 py-24">
    <div class="rounded-2xl border bg-card p-8 text-center shadow-sm">
      <ShieldX class="mx-auto mb-4 size-10 text-muted-foreground" />
      <h1 class="text-lg font-semibold">无访问权限</h1>
      <p class="mt-2 text-sm leading-relaxed text-muted-foreground">{{ deniedMessage }}</p>
    </div>
  </div>

  <!-- site 在非拒绝态必有值（同一份聚合数据），v-else-if 兼做 TS 非空收窄 -->
  <template v-else-if="site">
    <!-- ============ 右侧整页侧边栏：站点外观设置（页面级 fixed，不随内容行居中） ============
         贴视口右缘、top-10 让位提示条、直达视口底（页脚已在布局层让位）；
         布局在「预览路由 + 面板展开」时给根容器加 lg:pr-[380px]，页头 / 正文 / 页脚
         整体在剩余空间内居中；窄屏（<lg）四栏放不下，回退 85vw 浮层盖在内容上 -->
    <div
      v-if="panelOpen"
      class="fixed top-10 right-0 bottom-0 z-40 w-[380px] max-lg:w-[85vw] max-lg:max-w-[380px]"
    >
      <SettingsPanel
        :wiki-id="wikiId"
        :token="token"
        :site="site"
        @saved="onConfigSaved"
        @close="panelOpen = false"
      />
    </div>

    <!-- ============ 三栏内容（同公开站文档页布局；侧栏 sticky 偏移加上了提示条高度） ============ -->
    <div class="mx-auto flex w-full max-w-[1400px] items-stretch">
      <!-- 左栏：文档树（preview 模式：点击 emit select 组件内切换，不走路由） -->
      <aside class="hidden w-72 shrink-0 lg:block">
        <div class="sticky top-24 flex max-h-[calc(100vh-10rem)] flex-col">
          <HelpSidebar
            :wiki-id="wikiId"
            :tree="tree"
            :active-doc-id="doc?.id"
            preview
            @select="onSelectDoc"
          />
        </div>
      </aside>

      <!-- 中栏：正文 -->
      <main class="min-w-0 flex-1">
        <article class="mx-auto w-full max-w-[760px] px-4 py-8 sm:px-8">
          <HelpBreadcrumb
            v-if="path"
            :wiki-id="wikiId"
            :wiki-name="displayWikiTitle"
            :path-titles="pathTitles"
            :current-title="currentTitle"
          />

          <!-- 文档标题（前缀 emoji icon 可空） -->
          <h1 class="mb-8 mt-5 text-3xl font-bold leading-tight text-foreground">
            <span v-if="doc?.icon" class="mr-2">{{ doc.icon }}</span
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

      <!-- 右栏：本页目录（设置栏展开时隐藏，正文优先；收起后恢复） -->
      <aside :class="panelOpen ? 'hidden' : 'hidden w-60 shrink-0 xl:block'">
        <div class="sticky top-24 max-h-[calc(100vh-10rem)] overflow-y-auto pt-10">
          <HelpToc :items="tocResult.items" />
        </div>
      </aside>
    </div>
  </template>
</template>
