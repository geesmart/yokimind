<script setup lang="ts">
/**
 * 默认布局：页头（品牌）+ 页面内容 + 页脚
 * 公开内容站的骨架，后续按需扩展导航与主题切换
 *
 * 站点外观设置（owner 在预览面板配置，useSiteSettings 全局状态，知识库页面写入）：
 * - 页头 Logo：siteLogo 有值渲染自定义图片，加载失败或未配置回退默认品牌图 /logo.png
 * - 主题色：siteColor 有值时在根容器注入 --primary 等内联 CSS 变量覆盖
 *   （Tailwind v4 @theme inline 引用 var(--primary)，运行时覆盖即全站生效）
 * - AI 助手：aiEnabled === false 时不渲染 AiAssistant 浮窗
 */
import { Search } from '@lucide/vue'

const siteSettings = useSiteSettings()

const route = useRoute()

/**
 * 页头自定义 Logo 加载失败标记：siteLogo URL 失效（如上传文件已删除，/uploads/... 404）
 * 时 <img> 会渲染成浏览器裂图图标，@error 置 true 后回退渲染默认品牌图（/logo.png）。
 * siteLogo URL 变化时重置（预览中重新上传有效 Logo / 恢复默认 → 立即恢复展示逻辑，
 * 避免旧失败状态把新 Logo 也当成裂图）。
 */
const logoBroken = ref(false)
watch(
  () => siteSettings.value?.siteLogo,
  () => {
    logoBroken.value = false
  }
)

/**
 * 预览页顶栏让位：预览模式提示条 fixed 钉在视口最顶端（高 40px），页头需整体
 * 下移让出该区域（sticky top-10 + mt-10 占位，滚动后仍吸在提示条正下方）。
 * 仅匹配 /w/{wikiId}/preview 路由（docId 为 ULID，不会与 "preview" 段冲突）。
 *
 * 注意：条件必须是纯路由判断（不能依赖 siteSettings 等页面写入的异步状态）——
 * 布局模板先于页面 slot 渲染，页头 class 计算时页面数据尚未就绪，SSR 与客户端
 * 首帧结果不一致会导致遮盖/水合告警；纯路由判断两端渲染结果恒定一致。
 * 提示条由预览页在「加载成功」与「令牌无效」两种状态下都常驻渲染，不会留空白。
 */
const isPreviewRoute = computed(() => /^\/w\/[^/]+\/preview(\/|$)/.test(route.path))

// ============ 预览设置栏让位（整页右侧侧边栏） ============

/**
 * 预览外观设置面板展开态（与预览页共享的跨组件状态：页面用同名 useState 读写，
 * 预览条「外观设置」开关 / 面板内 X 按钮均操作同一份状态）。
 * 布局 setup 先于页面 setup 执行并在此初始化默认值 true（owner 打开预览即为配置场景），
 * SSR 与客户端首帧读到同一值，无水合告警。
 */
const previewPanelOpen = useState('preview-panel-open', () => true)

/**
 * 整页让位判定：预览路由 + 设置面板展开时，根容器加 lg:pr-[380px]，sticky 页头 /
 * main / 页脚在剩余空间内整体居中，给贴视口右缘的设置栏（页面级 fixed，top-10 起）让位。
 * lg: 限定 —— 窄屏（<lg）面板为 85vw 浮层盖在内容上，布局不让位。
 */
const shiftForSettings = computed(() => isPreviewRoute.value && previewPanelOpen.value)

// ============ 页头搜索（/w/ 知识库页面：公开文档页 / 库首页 / 预览页） ============

/**
 * 搜索弹窗显隐：页头触发按钮点击唤起。
 * 弹窗为独立搜索组件（components/searchbox，移植自 web 编辑器搜索弹窗）：
 * 最近搜索记录 + 文档标题命中（本地过滤共享文档树）+ 正文命中（检索接口），
 * 点击结果路由跳转（旧版「关键词实时过滤侧栏树」交互由弹窗取代，
 * useState('help-search-keyword') 的页头筛选随之移除）。
 * 预览页同样显示：弹窗按路由自动切预览语义（预览令牌搜索 / 预览路由跳转）。
 */
const searchOpen = ref(false)

/** 是否知识库页面（/w/ 前缀：有文档树上下文，页头搜索与页脚显示；/b/ 博客形态库不显示） */
const isWikiPage = computed(() => route.path.startsWith('/w/'))

/**
 * 主题色覆盖样式：仅 owner 配置过 siteColor 时生效
 * - --primary：主色（按钮 / 链接 / 高亮等 text-primary、bg-primary 全站生效）
 * - --primary-foreground：主色上的文字，固定白色（预设色板均取中深色，白字对比度达标）
 * - --ring：焦点环同主色，视觉统一
 */
const themeStyle = computed<Record<string, string> | undefined>(() => {
  const color = siteSettings.value?.siteColor
  if (!color) return undefined
  return {
    '--primary': color,
    '--primary-foreground': '#ffffff',
    '--ring': color,
  }
})
</script>

<template>
  <div
    class="flex min-h-screen flex-col bg-background text-foreground"
    :class="shiftForSettings ? 'lg:pr-[380px]' : ''"
    :style="themeStyle"
  >
    <!-- ============ 页头（无底边框横线） ============ -->
    <!-- 容器与文档页三栏同宽（max-w-[1400px]），px-4 与侧栏搜索框内边距一致 → logo 左缘与搜索框左缘对齐 -->
    <header
      class="sticky z-40 border-b border-border/60 bg-background/80 backdrop-blur"
      :class="isPreviewRoute ? 'top-10 mt-10' : 'top-0'"
    >
      <!-- 容器与文档页三栏同宽（max-w-[1400px]），px-4 与侧栏搜索框内边距一致 → logo 左缘与搜索框左缘对齐 -->
      <div class="relative mx-auto flex h-14 w-full max-w-[1400px] items-center px-4">
        <!-- 品牌区：logo + 名称（纯展示，站点已无首页路由，不做链接）
             站点 Logo 优先（owner 自定义图片），加载失败（@error）或未配置时回退默认品牌图
             /logo.png。默认图仅在「设置已加载（siteSettings 非 null）且未配置 Logo /
             自定义 Logo 裂图」时渲染：设置未就绪时什么都不渲染 —— 否则刷新首帧会先闪
             默认图、设置加载后才换成自定义 Logo（布局模板先于页面数据渲染，siteSettings
             初始为 null） -->
        <div class="flex items-center gap-2">
          <img
            v-if="siteSettings?.siteLogo && !logoBroken"
            :src="siteSettings.siteLogo"
            alt="站点 Logo"
            class="h-8"
            @error="logoBroken = true"
          />
          <img v-else-if="siteSettings" src="/logo.png" alt="YOKI文档" class="h-8" />
        </div>

        <!-- 中部搜索入口（/w/ 知识库页面显示，含预览页）：absolute 水平居中，
             样式对齐旧筛选输入框（白底 + 边框 + 圆角），点击唤起搜索弹窗 -->
        <button
          v-if="isWikiPage"
          type="button"
          class="absolute left-1/2 top-1/2 flex h-9 w-72 max-w-[40vw] -translate-x-1/2 -translate-y-1/2 items-center rounded-lg border border-border bg-card px-3 text-sm text-muted-foreground transition-colors hover:border-primary/40"
          aria-label="搜索文档"
          @click="searchOpen = true"
        >
          <span class="flex items-center gap-2">
            <Search class="size-4.5 shrink-0 text-muted-foreground" />
            搜索...
          </span>
        </button>

        <!-- 页头右侧导航按钮组（owner 在预览面板配置，最多 5 个）：
             - href 以 http(s):// 开头 → <a> 新标签打开（rel="noopener noreferrer" 防窗口句柄操控）
             - href 以 / 开头 → <NuxtLink> 站内当前页跳转（客户端路由，不整页刷新）
             - 样式主色实底 pill（bg-primary 跟随站点主题色变量），ml-auto 靠右 -->
        <nav
          v-if="siteSettings?.navButtons?.length"
          class="ml-auto flex items-center gap-2"
          aria-label="站点导航"
        >
          <template v-for="(btn, i) in siteSettings.navButtons" :key="i">
            <a
              v-if="btn.href.startsWith('http')"
              :href="btn.href"
              target="_blank"
              rel="noopener noreferrer"
              class="flex h-9 items-center rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              {{ btn.title }}
            </a>
            <NuxtLink
              v-else
              :to="btn.href"
              class="flex h-9 items-center rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              {{ btn.title }}
            </NuxtLink>
          </template>
        </nav>
      </div>
    </header>

    <!-- ============ 页面内容 ============ -->
    <main class="flex-1">
      <slot />
    </main>

    <!-- ============ 页脚 ============ -->
    <!-- /w/ 知识库页面（文章页 / 库首页 / 预览页 / 密码锁页）：Mintlify 风格品牌页脚，
         「YOKI 文档」为品牌 Logo 图（/logo.png，横版文字标 h-5 与 text-sm 行高对齐）、
         可点击回产品首页；容器 max-w-[1400px] px-4 与页头 / 三栏内容区同宽对齐
         （「由」字左缘 = 页头 Logo 左缘）。
         h-14 高度不可变：文档页左右侧栏 sticky 的 max-h-[calc(100vh-7rem)] 按
         「页头 3.5rem + 页脚 3.5rem」预留，改高度会让短文页产生死滚动余量。 -->
    <footer v-if="isWikiPage" class="border-t border-border/60">
      <div
        class="mx-auto flex h-14 w-full max-w-[1400px] items-center px-4 text-sm text-muted-foreground"
      >
        <!-- flex + gap 撑开「由 / Logo / 提供技术支持」间距（flex 容器内纯空白文本节点
             不渲染，不能用模板换行隐式空格）；Logo 悬停轻微降透明度替代原文字变色 -->
        <span class="flex items-center gap-1.5">
          <span>由</span>
          <NuxtLink
            to="/"
            aria-label="YOKI 文档"
            class="inline-flex items-center transition-opacity hover:opacity-80"
          >
            <img src="/logo.png" alt="YOKI 文档" class="h-5" />
          </NuxtLink>
          <span>提供技术支持</span>
        </span>
      </div>
    </footer>

    <!-- /b/ 博客形态库（非 /w/ 前缀）：保留版权页脚 -->
    <footer v-else class="border-t border-border/60">
      <div
        class="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-4 text-sm text-muted-foreground sm:px-6"
      >
        <span>© {{ new Date().getFullYear() }} 墨刻文档 YokiMind</span>
        <span class="hidden sm:inline">把你的知识发布成 Blog、Wiki 与图文日志</span>
      </div>
    </footer>

    <!-- ============ 搜索弹窗（独立搜索组件：历史搜索 + 标题命中 + 正文命中；
                 /w/ 知识库页面渲染，预览态自动切预览语义） ============ -->
    <SearchBox v-if="isWikiPage" v-model:open="searchOpen" />

    <!-- ============ AI 文档助手浮窗（右下角，仅 /w/:wikiId、/b/:wikiId 等带知识库上下文的页面渲染；
                 owner 关闭 AI 助手（aiEnabled=false）后不渲染。
                 预览页设置栏展开时隐藏：浮窗 z-50 高于设置栏 z-40 会盖住设置区，
                 收起面板即可预览 AI 浮窗在公开站的真实位置） ============ -->
    <AiAssistant v-if="siteSettings?.aiEnabled !== false && !shiftForSettings" />
  </div>
</template>
