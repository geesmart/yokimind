<script setup lang="ts">
/**
 * 预览模式站点外观设置面板（owner 专属，仅 /preview 页渲染）
 *
 * 右侧整页侧边栏：页面级 fixed 容器（贴视口右缘、提示条下方直达视口底）内渲染，
 * 宽度与视口定位由预览页父级控制；布局层在面板展开时给整页加 lg:pr-[380px] 让位，
 * sticky 页头 / 正文 / 页脚在剩余空间内居中。窄屏（<lg）父级回退 85vw 浮层。
 * 表单化布局：整体为 <form>（回车可提交）；body 按「基础信息 / SEO 设置 / 导航按钮 /
 * 功能」四个灰字分组组织，组内每个设置项为独立圆角边框卡片（块标题 + 描述 + 控件），
 * 块与块边界清晰。
 * 可配置站点外观（存 wiki_publish.settings jsonb，保存后公开站即时生效）：
 * - 站点标题：文本输入（空 = 回退库名）
 * - Logo：本地选图上传（预览令牌鉴权接口，成功回填 /uploads/... URL 并即时预览；
 *   「恢复默认」清空 URL = 回退默认品牌图）
 * - SEO 设置：SEO 描述（textarea）+ SEO 关键词（逗号分隔自由文本），
 *   公开站 SSR 输出 meta description / meta keywords（留空回退页面默认摘要 / 不输出）
 * - 导航按钮：标题 + 链接行编辑（最多 5 个），公开站 / 预览站页头右侧渲染跳转按钮
 * - AI 助手：开关（关闭后公开站隐藏 AI 浮窗，后端 ai-chat 接口同步拒绝）
 * - 主题色：第一版暂不开放设置入口（后端字段与逻辑保留，表单原值透传不清空）
 *
 * 保存：PUT /publish/wiki/:wikiId/settings（预览令牌鉴权，publish 模块）；
 * 成功后 emit('saved') 交给预览页更新本地 site 状态 → Logo / 导航按钮 / AI 开关即时生效。
 * 保存结果反馈用内联状态文案（pages 站无 toast 库）；头部关闭按钮 emit('close')，
 * 由父页收起面板（预览条「外观设置」toggle 同样可开合）。
 */
import { Loader2, Plus, X } from '@lucide/vue'
import { putPublishSettings, uploadPublishImage } from '~/api/publish'
import { useApiClient } from '~/api/request'
import type { PublishSettingsResult, ShareNavButton, ShareSiteConfig } from '~/api/types'

const props = defineProps<{
  /** 知识库 ID（保存接口寻址） */
  wikiId: string
  /** 预览令牌（请求头 X-Preview-Token） */
  token: string
  /** 当前站点配置（表单初始值与回退文案数据源） */
  site: ShareSiteConfig
}>()

const emit = defineEmits<{
  /** 保存成功：携带保存后的最新配置（预览页据此更新本地 site 状态） */
  saved: [result: PublishSettingsResult]
  /** 点击头部关闭按钮：父页收起抽屉 */
  close: []
}>()

// ==================== 表单状态 ====================

/** 表单项（初始值来自站点配置，null 归一为空串供输入框绑定） */
const form = reactive({
  siteTitle: props.site.siteTitle ?? '',
  siteLogo: props.site.siteLogo ?? '',
  // 主题色第一版暂无设置入口：保留初始值原样透传，保存不会清掉已配置的颜色
  siteColor: props.site.siteColor ?? '',
  aiEnabled: props.site.aiEnabled,
  seoDescription: props.site.seoDescription ?? '',
  seoKeywords: props.site.seoKeywords ?? '',
})

/** Logo 缩略图加载失败标记（失败时回退显示默认品牌图，避免破图） */
const logoBroken = ref(false)

// ==================== 页头导航按钮 ====================

/** 导航按钮数量上限（与后端 zod max(5) 对齐；页头宽度约束） */
const MAX_NAV_BUTTONS = 5

/**
 * 导航按钮编辑列表（独立于 form：元素为对象数组，整体随保存提交）
 * 初始值深拷贝自站点配置（避免直接改 props 引用）；空数组保存 = 清空隐藏全部按钮
 */
const navButtons = ref<ShareNavButton[]>(
  props.site.navButtons ? props.site.navButtons.map((b) => ({ ...b })) : []
)

/** 添加一个空按钮行（上限 5 个，满员后「添加」入口隐藏） */
function addNavButton() {
  if (navButtons.value.length >= MAX_NAV_BUTTONS) return
  navButtons.value.push({ title: '', href: '' })
}

/** 删除第 i 行按钮 */
function removeNavButton(i: number) {
  navButtons.value.splice(i, 1)
}

// ==================== Logo 上传 ====================

/** 允许的图片类型（与后端 media.service 白名单对齐，不含 svg 防 XSS） */
const LOGO_ACCEPT_TYPES = 'image/jpeg,image/png,image/gif,image/webp'
/** 单文件上限 5MB（与后端 MAX_FILE_SIZE 对齐） */
const MAX_LOGO_SIZE = 5 * 1024 * 1024

/** 隐藏的文件选择框（点击预览区触发） */
const fileInput = ref<HTMLInputElement | null>(null)
/** 上传中标记（预览区禁用 + loading 态） */
const uploading = ref(false)
/** 上传失败文案（本地预校验提示 / 后端 info 透出） */
const uploadError = ref('')

/**
 * 选择 Logo 图片后立即上传：
 * 1. 本地预校验类型与大小（快速反馈，省一次必败请求）
 * 2. 走预览令牌上传接口（X-Preview-Token），成功后回填 form.siteLogo
 *    （此时仅表单值变化，点「保存」后随配置接口提交才对公开站生效）
 */
async function onLogoFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  // 清空 input 值：允许下次重复选择同一文件（change 事件依赖值变化触发）
  input.value = ''
  if (!file) return
  uploadError.value = ''
  if (!LOGO_ACCEPT_TYPES.split(',').includes(file.type)) {
    uploadError.value = '仅支持 jpg / png / gif / webp 图片'
    return
  }
  if (file.size > MAX_LOGO_SIZE) {
    uploadError.value = '图片大小不能超过 5MB'
    return
  }
  uploading.value = true
  try {
    const result = await uploadPublishImage(api, props.wikiId, props.token, file)
    form.siteLogo = result.url
    logoBroken.value = false
  } catch (err) {
    uploadError.value = err instanceof Error ? err.message : '上传失败，请稍后重试'
  } finally {
    uploading.value = false
  }
}

// ==================== 保存 ====================

const api = useApiClient()

/** 保存中标记（按钮禁用 + loading 图标） */
const saving = ref(false)
/** 保存成功提示文案（几秒后自动清除） */
const successMessage = ref('')
/** 保存失败提示文案（透出后端 message） */
const errorMessage = ref('')

/** 成功提示自动清除定时器（重复保存时重置） */
let messageTimer: ReturnType<typeof setTimeout> | undefined

/**
 * 保存外观配置（form submit 触发：保存按钮 type=submit / 输入框内回车）
 * 全量提交（后端语义：空串 → null = 清除回退默认）；
 * 导航按钮先过滤整行空白的新增行（静默丢弃），半填行（有标题无链接等）保留
 * 交由后端 zod 校验报错提示；全空保存 = [] 清空隐藏。
 * 成功后 emit('saved')，由预览页更新本地 site 状态实现即时生效
 */
async function onSave() {
  if (saving.value) return
  saving.value = true
  errorMessage.value = ''
  successMessage.value = ''
  try {
    const result = await putPublishSettings(api, props.wikiId, props.token, {
      siteTitle: form.siteTitle,
      siteLogo: form.siteLogo,
      siteColor: form.siteColor,
      aiEnabled: form.aiEnabled,
      seoDescription: form.seoDescription,
      seoKeywords: form.seoKeywords,
      navButtons: navButtons.value.filter((b) => b.title.trim() !== '' || b.href.trim() !== ''),
    })
    emit('saved', result)
    successMessage.value = '已保存，公开站即时生效'
    // 3 秒后自动清除成功提示（重复保存重置计时）
    clearTimeout(messageTimer)
    messageTimer = setTimeout(() => (successMessage.value = ''), 3000)
  } catch (e) {
    // ApiError.message 为后端 info（如主题色格式校验失败），直接透出
    errorMessage.value = e instanceof Error ? e.message : '保存失败，请稍后重试'
  } finally {
    saving.value = false
  }
}

// 组件卸载清理提示定时器
onUnmounted(() => clearTimeout(messageTimer))
</script>

<template>
  <!-- 设置栏主体：宽度与视口定位由预览页父级容器控制（整页侧边栏 / 窄屏浮层两种形态），
       h-full 撑满父级（父级为定高块级容器），内部滚动区 + 常驻底部保存栏；
       border-l 贴合内容区，无投影无浮层 -->
  <aside
    class="flex h-full min-h-0 flex-col overflow-hidden border-l bg-card"
    aria-label="站点外观设置"
  >
    <!-- 设置栏头部：大标题 + 关闭按钮（emit close 由父页收起面板） -->
    <header class="flex items-start justify-between gap-2 border-b px-5 py-5">
      <div>
        <h2 class="text-lg font-semibold">站点外观设置</h2>
        <p class="mt-1 text-xs text-muted-foreground">保存后对公开站即时生效</p>
      </div>
      <button
        type="button"
        aria-label="关闭设置面板"
        class="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        @click="emit('close')"
      >
        <X class="size-4" />
      </button>
    </header>

    <!-- 表单（form 语义：保存按钮 type=submit / 输入框内回车均可触发提交；
         内部 = 可滚动分组区 + 常驻底部保存栏） -->
    <form novalidate class="flex min-h-0 flex-1 flex-col" @submit.prevent="onSave">
      <!-- 表单滚动区：分组 = 灰字小标题（text-muted-foreground），组内每个设置项
           为独立圆角边框卡片（块标题 + 描述 + 控件自上而下），块间边界清晰 -->
      <div class="min-h-0 flex-1 space-y-8 overflow-y-auto px-5 py-5">
        <!-- ===== 分组一：基础信息（站点标题 / Logo 两块） ===== -->
        <section aria-labelledby="panel-group-basic">
          <h3 id="panel-group-basic" class="text-sm font-medium text-muted-foreground">
            基础信息
          </h3>
          <div class="mt-3 space-y-3">
            <!-- 块卡片：站点标题（留空回退库名，描述置于控件上方） -->
            <div class="rounded-xl border border-border p-4">
              <label
                class="block text-sm font-medium text-foreground"
                for="preview-site-title"
              >
                站点标题
              </label>
              <p class="mt-1 text-xs text-muted-foreground">留空时使用知识库名称</p>
              <Input
                id="preview-site-title"
                v-model="form.siteTitle"
                type="text"
                :placeholder="site.wikiName"
                maxlength="100"
                class="mt-3"
              />
            </div>

            <!-- 块卡片：Logo 图片（标题行右侧「恢复默认」；点击预览区选图上传） -->
            <div class="rounded-xl border border-border p-4">
              <div class="flex items-center justify-between">
                <span class="text-sm font-medium text-foreground">Logo 图片</span>
                <button
                  v-if="form.siteLogo"
                  type="button"
                  class="text-xs text-muted-foreground underline-offset-2 hover:underline"
                  :disabled="uploading"
                  @click="form.siteLogo = ''"
                >
                  恢复默认
                </button>
              </div>
              <p class="mt-1 text-xs text-muted-foreground">jpg / png / gif / webp，≤5MB</p>
              <!-- 预览区即上传入口：有自定义 Logo 显示图片，否则半透明默认品牌图占位 -->
              <button
                type="button"
                class="relative mt-3 flex h-24 w-full items-center justify-center overflow-hidden rounded-lg border border-dashed bg-muted/40 transition-colors hover:bg-muted/70"
                :disabled="uploading"
                aria-label="上传 Logo 图片"
                @click="fileInput?.click()"
              >
                <img
                  v-if="form.siteLogo && !logoBroken"
                  :src="form.siteLogo"
                  alt="Logo 预览"
                  class="max-h-16 max-w-[80%] object-contain"
                  @error="logoBroken = true"
                />
                <img v-else src="/logo.png" alt="默认品牌图" class="h-8 opacity-50" />
                <!-- 底部提示行：上传中显示 loading -->
                <span
                  class="absolute inset-x-0 bottom-1 flex items-center justify-center gap-1 text-[11px] text-muted-foreground"
                >
                  <Loader2 v-if="uploading" class="size-3 animate-spin" />
                  {{ uploading ? '上传中...' : '点击上传' }}
                </span>
              </button>
              <!-- 隐藏文件选择框（accept 限定图片类型，仍以本地 JS + 服务端双重校验为准） -->
              <input
                ref="fileInput"
                type="file"
                :accept="LOGO_ACCEPT_TYPES"
                class="hidden"
                @change="onLogoFileChange"
              />
              <p v-if="uploadError" class="mt-1.5 text-xs text-red-600">{{ uploadError }}</p>
            </div>
          </div>
        </section>

        <!-- ===== 分组二：SEO 设置（描述 / 关键词两块，公开站 SSR 输出 meta 标签） ===== -->
        <section aria-labelledby="panel-group-seo">
          <h3 id="panel-group-seo" class="text-sm font-medium text-muted-foreground">SEO 设置</h3>
          <div class="mt-3 space-y-3">
            <!-- 块卡片：SEO 描述（多行文本，搜索引擎结果摘要） -->
            <div class="rounded-xl border border-border p-4">
              <label
                class="block text-sm font-medium text-foreground"
                for="preview-seo-description"
              >
                SEO 描述
              </label>
              <p class="mt-1 text-xs text-muted-foreground">
                显示在搜索引擎结果的网页摘要（meta description），留空使用页面默认摘要
              </p>
              <textarea
                id="preview-seo-description"
                v-model="form.seoDescription"
                rows="3"
                maxlength="200"
                placeholder="留空时使用页面默认摘要"
                aria-label="SEO 描述"
                class="dark:bg-input/30 border-input focus-visible:border-ring focus-visible:ring-ring/50 mt-3 min-h-20 w-full resize-y rounded-lg border bg-transparent px-2.5 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:ring-2"
              />
            </div>

            <!-- 块卡片：SEO 关键词（逗号分隔自由文本，留空不输出） -->
            <div class="rounded-xl border border-border p-4">
              <label
                class="block text-sm font-medium text-foreground"
                for="preview-seo-keywords"
              >
                SEO 关键词
              </label>
              <p class="mt-1 text-xs text-muted-foreground">
                多个关键词用英文逗号分隔（meta keywords）
              </p>
              <Input
                id="preview-seo-keywords"
                v-model="form.seoKeywords"
                type="text"
                placeholder="如：帮助文档, 使用指南, FAQ"
                maxlength="200"
                aria-label="SEO 关键词"
                class="mt-3"
              />
            </div>
          </div>
        </section>

        <!-- ===== 分组三：导航按钮（行编辑；整行空白的新增行保存时忽略） ===== -->
        <section aria-labelledby="panel-group-nav">
          <h3 id="panel-group-nav" class="text-sm font-medium text-muted-foreground">导航按钮</h3>
          <div class="mt-3 space-y-3">
            <div class="rounded-xl border border-border p-4">
              <!-- 块标题行：右侧「添加按钮」（上限 5 个，满员后隐藏添加入口） -->
              <div class="flex items-center justify-between">
                <span class="text-sm font-medium text-foreground">导航按钮</span>
                <button
                  v-if="navButtons.length < MAX_NAV_BUTTONS"
                  type="button"
                  class="flex items-center gap-0.5 text-xs text-blue-600 hover:underline"
                  @click="addNavButton"
                >
                  <Plus class="size-3.5" />
                  添加按钮
                </button>
              </div>
              <p class="mt-1 text-xs text-muted-foreground">
                最多 {{ MAX_NAV_BUTTONS }} 个；以 http(s) 开头的链接新标签打开，/ 开头站内跳转
              </p>
              <div class="mt-3">
                <!-- 未配置提示 -->
                <p v-if="navButtons.length === 0" class="text-xs text-muted-foreground">
                  未配置，添加后公开站页头右侧显示跳转按钮
                </p>
                <div v-else class="space-y-2">
                  <div v-for="(btn, i) in navButtons" :key="i" class="flex items-center gap-1.5">
                    <!-- 按钮文字（页头 pill 按钮文案） -->
                    <Input
                      v-model="btn.title"
                      type="text"
                      placeholder="按钮文字"
                      class="w-24 shrink-0"
                      maxlength="50"
                      :aria-label="`第 ${i + 1} 个按钮文字`"
                    />
                    <!-- 跳转链接：http(s) 外链或 / 开头站内路径（后端正则兜底校验） -->
                    <Input
                      v-model="btn.href"
                      type="text"
                      placeholder="https://... 或 /path"
                      class="min-w-0 flex-1"
                      maxlength="500"
                      :aria-label="`第 ${i + 1} 个按钮链接`"
                    />
                    <!-- 删除行 -->
                    <button
                      type="button"
                      :aria-label="`删除第 ${i + 1} 个按钮`"
                      class="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      @click="removeNavButton(i)"
                    >
                      <X class="size-4" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <!-- ===== 分组四：功能（AI 助手开关） ===== -->
        <section aria-labelledby="panel-group-func">
          <h3 id="panel-group-func" class="text-sm font-medium text-muted-foreground">功能</h3>
          <div class="mt-3 space-y-3">
            <div class="rounded-xl border border-border p-4">
              <!-- 块内左右布局：左标题 + 描述，右开关 -->
              <div class="flex items-center justify-between gap-3">
                <div>
                  <p class="text-sm font-medium text-foreground">AI 助手</p>
                  <p class="mt-1 text-xs text-muted-foreground">关闭后公开站隐藏 AI 浮窗</p>
                </div>
                <!-- 自绘开关（pages 站无 Switch 组件；role=switch 保证可访问性） -->
                <button
                  type="button"
                  role="switch"
                  :aria-checked="form.aiEnabled"
                  class="relative h-6 w-11 shrink-0 rounded-full transition-colors"
                  :class="form.aiEnabled ? 'bg-blue-500' : 'bg-input'"
                  @click="form.aiEnabled = !form.aiEnabled"
                >
                  <span
                    class="absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow transition-transform"
                    :class="form.aiEnabled ? 'translate-x-5' : 'translate-x-0'"
                  />
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>

      <!-- 底部保存栏：按钮常驻可见 + 保存结果反馈（内联文案，pages 站无 toast 库） -->
      <footer class="space-y-2 border-t px-5 py-4">
        <Button type="submit" class="w-full" :disabled="saving">
          <Loader2 v-if="saving" class="mr-1 size-4 animate-spin" />
          {{ saving ? '保存中...' : '保存' }}
        </Button>
        <p v-if="successMessage" class="text-xs text-emerald-600">{{ successMessage }}</p>
        <p v-if="errorMessage" class="text-xs text-red-600">{{ errorMessage }}</p>
      </footer>
    </form>
  </aside>
</template>
