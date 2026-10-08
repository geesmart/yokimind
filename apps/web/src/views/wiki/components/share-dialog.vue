<template>
  <Dialog :open="visible" @update:open="onOpenChange">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2">
          <Share2 :size="16" />
          分享设置
        </DialogTitle>
        <DialogDescription>
          {{
            mode === 'wiki-only'
              ? '管理知识库的公开访问、访问密码及分享链接（访客只读）'
              : '管理当前页面与知识库的公开访问、访问密码及分享链接（访客只读）'
          }}
        </DialogDescription>
      </DialogHeader>

      <div
        v-if="loading"
        class="flex items-center justify-center py-8 text-sm text-muted-foreground"
      >
        加载中…
      </div>

      <!-- 双 Tab：分享此页面（单页覆盖配置，主路径） / 知识库可见性（库级配置） -->
      <Tabs
        v-else
        :model-value="activeTab"
        @update:model-value="(v) => (activeTab = v as 'page' | 'wiki')"
      >
        <!-- Tab 头：wiki-only 模式下只展示知识库可见性配置，无需 Tab 切换 -->
        <TabsList v-if="mode === 'full'" class="grid w-full grid-cols-2">
          <TabsTrigger value="page">分享此页面</TabsTrigger>
          <TabsTrigger value="wiki">知识库可见性</TabsTrigger>
        </TabsList>

        <!-- ==================== Tab 1：分享此页面 ==================== -->
        <!-- 对应接口：POST /wiki/node/:nodeId/share（upsertNodeShare） -->
        <!-- 状态语义：开关 on = 页级 public（单独公开此页，密码可选）；off = inherit（关闭页面分享） -->
        <!-- 锁定规则：库分享开启（以「知识库可见性」Tab 当前开关状态为准）时页面分享锁定，
             全部文档跟随库公开、密码继承库密码，不可单独修改 -->
        <!-- Tab 1 仅 full 模式渲染：wiki-only 模式无页级上下文（不传 nodeId/documentId） -->
        <TabsContent v-if="mode === 'full'" value="page" class="mt-5 flex flex-col gap-5">
          <!-- 锁定提示：库分享开启中（含开关刚打开未保存的场景），页面分享跟随库设置 -->
          <div v-if="wikiPublic" class="flex flex-col gap-3">
            <div
              class="rounded-md bg-muted px-3 py-2.5 text-xs leading-relaxed text-muted-foreground"
            >
              知识库分享开启中：全部文档随知识库一起公开，访客密码由知识库统一管理。
              如需单独管理本页分享，请先在「知识库可见性」中关闭分享并保存。
            </div>
          </div>

          <!-- 可编辑态：库分享关闭时页面分享独立配置 -->
          <template v-else>
            <!-- 公开开关 -->
            <div class="flex items-center justify-between gap-4">
              <div class="space-y-0.5">
                <Label for="page-share-switch" class="text-sm">公开此页面</Label>
                <p class="text-xs text-muted-foreground">仅公开本页文档，知识库其余内容保持私密</p>
              </div>
              <Switch id="page-share-switch" v-model="pagePublic" />
            </div>

            <!-- 页级密码：仅开关开启时展示（可选，支持免密分享，由页面分享自行管理） -->
            <!-- 密码语义（upsertNodeShare 的 password）：string = 设置/更新；null = 清除（免密访问）；
                 不传（undefined）= 保持不变 -->
            <div v-if="pagePublic" class="flex flex-col gap-1.5">
              <div class="space-y-0.5">
                <Label for="page-password-input" class="text-sm">页面密码</Label>
                <p class="text-xs text-muted-foreground">
                  可选。设置后访客需输入密码（6-32 位）；清空并保存即清除密码（免密访问）
                </p>
              </div>
              <div class="flex items-center gap-2">
                <!-- 明文回显（type=text）：分享密码定位类似网盘提取码，owner 可查看/找回 -->
                <Input
                  id="page-password-input"
                  v-model="pagePassword"
                  type="text"
                  class="flex-1"
                  placeholder="输入 6-32 位访问密码"
                  maxlength="32"
                />
                <!-- 纯图标复制按钮：hover 有 title 提示，复制成功走 toast -->
                <Button
                  variant="outline"
                  size="icon"
                  class="size-9 shrink-0"
                  title="复制密码"
                  :disabled="!pagePassword"
                  @click="copyText(pagePassword, '密码已复制')"
                >
                  <Copy :size="14" />
                </Button>
              </div>
            </div>
          </template>

          <!-- 文档链接：docId 段使用 documents.id（documents 表主键） -->
          <!-- 未公开时也允许复制，但提示对方暂时无法访问 -->
          <div v-if="docLink" class="flex flex-col gap-1.5">
            <Label class="text-sm">文档链接</Label>
            <div class="flex items-center gap-2">
              <Input
                :model-value="docLink"
                readonly
                class="text-xs flex-1"
                @focus="(e: FocusEvent) => (e.target as HTMLInputElement)?.select()"
              />
              <!-- 纯图标复制按钮：hover 有 title 提示，复制成功走 toast -->
              <Button
                variant="outline"
                size="icon"
                class="size-9 shrink-0"
                title="复制文档链接"
                @click="copyText(docLink, '文档链接已复制')"
              >
                <Copy :size="14" />
              </Button>
            </div>
            <p v-if="wikiPublic" class="text-xs text-muted-foreground/70">
              知识库公开中：访客通过此链接即可访问本页
            </p>
            <p v-else-if="!pagePublic" class="text-xs text-muted-foreground/70">
              页面尚未公开：打开上方开关并保存后，对方才能访问
            </p>
          </div>
        </TabsContent>

        <!-- ==================== Tab 2：知识库可见性 ==================== -->
        <!-- 对应接口：POST /wiki/:wikiId/share（upsertWikiShare） -->
        <!-- 状态语义：开关 on = public（整库公开）；off = private（私密） -->
        <TabsContent value="wiki" class="mt-5 flex flex-col gap-5">
          <!-- 公开开关 -->
          <div class="flex items-center justify-between gap-4">
            <div class="space-y-0.5">
              <Label for="wiki-share-switch" class="text-sm">公开知识库</Label>
              <p class="text-xs text-muted-foreground">
                开启后，任何人可通过知识库链接浏览全部文档（只读）， 访客密码由知识库密码统一管理
              </p>
            </div>
            <Switch id="wiki-share-switch" v-model="wikiPublic" />
          </div>

          <!-- 开启影响提示：开启库分享后各页面的单独分享配置将被锁定（数据保留，关闭后恢复生效） -->
          <p v-if="wikiPublic && !wikiSavedPublic" class="text-xs text-amber-600">
            开启后所有文档随知识库一起公开，各页面已单独配置的分享将被锁定（关闭知识库分享后自动恢复生效）
          </p>

          <!-- 库级密码（可选）：仅公开时展示 -->
          <!-- 密码语义（upsertWikiShare 的 password）：string = 设置/更新；null = 清除；不传 = 保持不变 -->
          <template v-if="wikiPublic">
            <div class="flex flex-col gap-1.5">
              <div class="space-y-0.5">
                <Label for="wiki-password-input" class="text-sm">知识库密码</Label>
                <p class="text-xs text-muted-foreground">
                  可选。设置后访客需输入密码（6-32 位）；清空并保存即清除密码
                </p>
              </div>
              <div class="flex items-center gap-2">
                <!-- 明文回显（type=text），旁置复制按钮，owner 可直接告知协作者提取码 -->
                <Input
                  id="wiki-password-input"
                  v-model="wikiPassword"
                  type="text"
                  class="flex-1"
                  placeholder="输入 6-32 位访问密码"
                  maxlength="32"
                />
                <!-- 纯图标复制按钮：hover 有 title 提示，复制成功走 toast -->
                <Button
                  variant="outline"
                  size="icon"
                  class="size-9 shrink-0"
                  title="复制密码"
                  :disabled="!wikiPassword"
                  @click="copyText(wikiPassword, '密码已复制')"
                >
                  <Copy :size="14" />
                </Button>
              </div>
            </div>
          </template>

          <!-- 知识库链接：始终展示（与 owner 浏览页 URL 一致，不引入新路径） -->
          <!-- 未公开时也允许复制，但提示对方暂时无法访问 -->
          <div class="flex flex-col gap-1.5">
            <Label class="text-sm">知识库链接</Label>
            <div class="flex items-center gap-2">
              <Input
                :model-value="wikiLink"
                readonly
                class="text-xs flex-1"
                @focus="(e: FocusEvent) => (e.target as HTMLInputElement)?.select()"
              />
              <!-- 纯图标复制按钮：hover 有 title 提示，复制成功走 toast -->
              <Button
                variant="outline"
                size="icon"
                class="size-9 shrink-0"
                title="复制知识库链接"
                @click="copyText(wikiLink, '知识库链接已复制')"
              >
                <Copy :size="14" />
              </Button>
            </div>
            <p v-if="!wikiPublic" class="text-xs text-muted-foreground/70">
              知识库尚未公开：开启上方开关并保存后，对方才能通过此链接访问
            </p>
          </div>
        </TabsContent>
      </Tabs>

      <DialogFooter>
        <Button variant="outline" size="sm" @click="onOpenChange(false)">取消</Button>
        <!-- 保存按钮：统一保存——一次提交两个 Tab 的配置（先库级后页级，见 onSave）；
             仅在 Tab 1 锁定态（库开关开启时查看锁定提示）禁用，避免误触无意义的库级重提交 -->
        <Button
          size="sm"
          :disabled="saving || (activeTab === 'page' && wikiPublic)"
          @click="onSave"
        >
          {{ saving ? '保存中…' : '保存' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script lang="ts" setup>
import { ref, computed, watch } from 'vue'
import { toast } from 'vue-sonner'
import { Share2, Copy } from '@lucide/vue'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { getWikiShareConfig, upsertWikiShare, upsertNodeShare } from '@/api/modules/share'
import type { WikiShareConfig, NodeShareConfig, UpsertNodeShareParams } from '@/api/modules/share'
import { ApiError } from '@/api/request'
import { copyTextToClipboard } from '@/lib/utils'

/**
 * 分享弹窗组件（双 Tab）
 *
 * 权限模型（v2 两级独立）：
 * - 库分享开启（Tab 2 开关状态为准）：全部文档跟随库公开，访客密码统一继承知识库密码（可选），
 *   页面分享配置锁定不可修改（Tab 1 渲染为锁定态，保存按钮禁用；后端守卫兜底拒绝）
 * - 库分享关闭：页面分享可独立开关 —— 开关 on = 单独公开此页（密码可选，可免密分享，由页面自行管理）；
 *   开关 off = 关闭页面分享（inherit，后端删除配置行）
 *
 * Tab 1「分享此页面」（upsertNodeShare，仅库分享关闭时可配置）
 * - 开关 on = 单独公开此页（密码可选）；off = 关闭页面分享（inherit 删行）
 * - 密码明文回显（产品定位类似网盘提取码）
 * - 保存 password 语义：string=设置/更新，null=清除（免密访问），不传=保持
 *
 * Tab 2「知识库可见性」（upsertWikiShare）
 * - 开关 on = public；off = private；库密码可选
 * - 保存 password 语义：string=设置/更新，null=清除，不传=保持
 * - 不在此处管理站点形态（help/blog）：形态由顶栏「发布成 Wiki / 发布成博客」入口决定
 *   （publish 模块 wiki_publish 表），保存时不传 publishType 相关字段，后端保持原值
 * - 库分享开启/关闭不影响页面分享行数据（保留不动，关闭库分享后自动恢复生效）
 *
 * 保存策略：统一保存——点一次「保存」同时提交两个 Tab 的更改（先库级后页级），
 * 支持「关闭库分享 + 配置页面分享」一次完成；库开关开启时页级跳过（锁定语义）
 *
 * 回填：打开弹窗时 GET /wiki/:wikiId/share（getWikiShareConfig，已禁用缓存），
 * 返回 null 视为默认私密、无密码、nodes 为空；页级状态在返回的 nodes（稀疏分享行）中
 * 按当前 nodeId 查找，不在列表 = 未单独分享。
 *
 * 保存成功后广播 window 事件 'wiki-share-updated'，供左侧文档树刷新分享状态 icon。
 */

/**
 * 组件 Props
 */
const props = withDefaults(
  defineProps<{
    /** 弹窗显示状态（v-model:visible） */
    visible: boolean
    /** 当前知识库 ID */
    wikiId: string
    /** 当前文档节点 ID（wikiNodes.id）：页级分享配置的定位键（nodes 列表匹配 + upsertNodeShare 入参） */
    nodeId?: string
    /** 当前文档 ID（documents.id）：拼文档分享链接用（链接 docId 段是 documents.id） */
    documentId?: string
    /**
     * 展示模式：
     * - full（默认）：双 Tab「分享此页面 + 知识库可见性」，layout-main 分享按钮入口使用
     * - wiki-only：仅知识库可见性配置（不渲染 Tab 头与页级 Tab），
     *   layout-left 知识库切换器锁状态图标入口使用（无页级上下文，不传 nodeId/documentId，
     *   保存逻辑中页级分支因 nodeId 缺失自然跳过）
     */
    mode?: 'full' | 'wiki-only'
  }>(),
  {
    /** 默认完整模式，保持 layout-main 原有行为不变 */
    mode: 'full',
  }
)

/**
 * 组件 Emits
 */
const emit = defineEmits<{
  /** 弹窗显示状态变化 */
  (e: 'update:visible', value: boolean): void
}>()

/**
 * 配置加载中
 */
const loading = ref(false)

/**
 * 保存中（两个 Tab 共用，按钮置灰防重复提交）
 */
const saving = ref(false)

/**
 * 当前分享配置（GET 返回的完整结构，回填 + 前端校验的数据源；null = 从未配置过分享）
 */
const config = ref<WikiShareConfig | null>(null)

/**
 * 当前激活的 Tab：page = 分享此页面（默认，主路径）；wiki = 知识库可见性
 */
const activeTab = ref<'page' | 'wiki'>('page')

// ==================== Tab 1 状态：分享此页面 ====================

/**
 * 页面公开开关（仅库分享关闭时可操作）：true = 页级 public（单独公开此页）；
 * false = inherit（关闭页面分享，后端删除配置行）
 */
const pagePublic = ref(false)

/**
 * 页级密码输入（明文回显：打开弹窗时已设密码直接填入）
 */
const pagePassword = ref('')

/**
 * 页级密码原始值（本次打开时的已存密码，null = 未设置）
 * 用途：保存时推导 password 参数 —— 输入为空但原本有密码 → 提交 null 清除；
 * 输入为空且原本没有 → 不传保持（首次公开即免密）
 */
const origPagePassword = ref<string | null>(null)

// ==================== Tab 2 状态：知识库可见性 ====================

/**
 * 知识库公开开关：true = public；false = private
 */
const wikiPublic = ref(false)

/**
 * 库级密码输入（明文回显）
 */
const wikiPassword = ref('')

/**
 * 库级密码原始值（null = 未设置）：保存时用于推导 password 参数
 * （输入为空但原本有密码 → 提交 null 清除；输入为空且原本无密码 → 不传保持）
 */
const origWikiPassword = ref<string | null>(null)

// ==================== 计算属性 ====================

/**
 * 库级是否公开（以后端已保存状态为准，而非当前开关状态）
 * 用途：
 * 1. Tab 2 提示条判定（「开启后所有文档随知识库一起公开…」仅在状态即将发生变化时提示）；
 * 2. 与后端 upsertWikiNodeShare 守卫口径一致（后端读库里已保存的库级 shareStatus）。
 * 注意：Tab 1 的锁定判定不用它，而用 wikiPublic（Tab 2 当前开关状态）——
 * 用户关闭开关后（即使尚未保存），Tab 1 应立即恢复可编辑的页面分享开关，符合直觉
 */
const wikiSavedPublic = computed(() => config.value?.shareStatus === 'public')

/**
 * 文档分享链接：docId 段使用 documents.id（documents 表主键）
 * 统一携带 /view 模式后缀（访客只读语义）；documentId 缺失（文档尚未创建）时为空串，模板中隐藏链接区
 */
const docLink = computed(() =>
  props.documentId ? `${window.location.origin}/wiki/${props.wikiId}/${props.documentId}/view` : ''
)

/**
 * 知识库链接：与知识库浏览页 URL 一致（/wiki/{wikiId}），不引入新路径
 * 无 docId 段无法携带 /view 后缀（会被 :docId? 参数吞掉）；访客打开后自动选中首篇，
 * URL 由访客编排器（wiki/index.vue）同步为 /wiki/{wikiId}/{nodeId}/view
 */
const wikiLink = computed(() => `${window.location.origin}/wiki/${props.wikiId}`)

// ==================== 数据加载 ====================

/**
 * 打开弹窗：拉取库级分享配置（含页面分享行列表）并回填两个 Tab
 * GET 无库级配置行时返回 null：视为默认 private、无密码、nodes 为空数组
 */
async function loadConfig() {
  loading.value = true
  try {
    const result = await getWikiShareConfig(props.wikiId).send()
    config.value = result

    // 库级回填（Tab 2）
    wikiPublic.value = result?.shareStatus === 'public'
    origWikiPassword.value = result?.password ?? null
    wikiPassword.value = result?.password ?? ''

    // 页级回填（Tab 1）：nodes 为稀疏分享行列表（仅单独开启过页面分享的节点才有行），
    // 当前节点不在列表 = 未单独分享，开关置 off。
    // 库分享开启时此回填不参与渲染（Tab 1 走锁定态），保留回填以保证关闭库分享后数据正确
    const row = result?.nodes.find((n) => n.nodeId === props.nodeId)
    pagePublic.value = row?.shareStatus === 'public'
    origPagePassword.value = row?.password ?? null
    // 已设密码明文回显（产品决策：owner 可查看/找回，类似网盘提取码）
    pagePassword.value = row?.password ?? ''

    // 每次打开都回到主路径 Tab：full 模式主路径是页级分享；
    // wiki-only 模式只有知识库可见性配置，固定定位到 wiki Tab
    activeTab.value = props.mode === 'wiki-only' ? 'wiki' : 'page'
  } catch (error) {
    console.error('[share-dialog] 加载分享配置失败:', error)
    toast.error('分享配置加载失败')
  } finally {
    loading.value = false
  }
}

/**
 * 监听 visible 变化：每次打开弹窗都重新拉取最新配置（API 层已禁用 GET 缓存）
 */
watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      loadConfig()
    }
  }
)

// ==================== 保存 ====================

/**
 * 统一保存：一次提交两个 Tab 的配置（用户心智：弹窗内所有更改「一起更新」）
 *
 * 提交顺序固定「先库级、后页级」：
 * 1. 库级（POST /wiki/:wikiId/share）：公开开关 + 密码，总是提交；
 * 2. 页级（POST /wiki/node/:nodeId/share）：仅当库开关关闭且 nodeId 存在时提交——
 *    库开关开启时页面分享锁定（锁定态无表单，跳过）；且先提交库级关闭后，
 *    后端页级守卫（读库里已保存的库级状态）即放行，
 *    避免「关闭库分享 + 开启页面分享」在一次保存中误撞 70008
 *
 * 校验规则：
 * - 库密码：有输入时校验长度 6-32 位
 * - 页面密码（仅库开关关闭时可编辑）：可选（免密分享），有输入时校验长度 6-32 位
 * 保存成功后统一回填表单并广播 wiki-share-updated 事件
 */
async function onSave() {
  // ---- 前端校验：库级密码（有输入时才校验）----
  if (wikiPassword.value && (wikiPassword.value.length < 6 || wikiPassword.value.length > 32)) {
    toast.error('知识库密码长度需为 6-32 位')
    return
  }
  // ---- 前端校验：页级（仅库开关关闭且有 nodeId 时表单可编辑）----
  if (!wikiPublic.value && props.nodeId) {
    // 页面密码长度（可选，有输入时才校验；无输入 = 保持已有密码或免密分享）
    if (pagePassword.value && (pagePassword.value.length < 6 || pagePassword.value.length > 32)) {
      toast.error('页面密码长度需为 6-32 位')
      return
    }
  }

  saving.value = true
  try {
    // ---- 1. 库级保存 ----
    // password 语义（UpsertWikiShareParams）：输入有值 → string（设置/更新）；
    // 输入为空但原本有密码（明文回显被清空）→ null（清除）；输入为空且原本无 → 不传（保持不变）
    let wikiPasswordParam: string | null | undefined
    if (wikiPassword.value) {
      wikiPasswordParam = wikiPassword.value
    } else if (origWikiPassword.value) {
      wikiPasswordParam = null
    } else {
      wikiPasswordParam = undefined
    }

    const wikiResult = await upsertWikiShare(props.wikiId, {
      shareStatus: wikiPublic.value ? 'public' : 'private',
      password: wikiPasswordParam,
      mode: 'view',
      // 不传 publishType 等发布设置：站点形态不归分享弹窗管理（由发布入口经 publish
      // 模块决定），后端保持原值
    }).send()

    config.value = { ...wikiResult, nodes: wikiResult.nodes ?? [] }
    // 库级回填
    wikiPublic.value = wikiResult.shareStatus === 'public'
    origWikiPassword.value = wikiResult.password
    wikiPassword.value = wikiResult.password ?? ''

    // ---- 2. 页级保存（仅库开关关闭时；库开启 = 页面分享锁定，跳过）----
    if (!wikiPublic.value && props.nodeId) {
      if (pagePublic.value) {
        // 开关 on：单独公开此页（密码可选，支持免密分享）。
        // password 三态语义（UpsertNodeShareParams）：输入有值 → string（设置/更新）；
        // 输入为空但原本有密码（明文回显被清空）→ null（清除，变为免密访问）；
        // 输入为空且原本无 → 不传（保持不变，首次公开即免密）
        const params: UpsertNodeShareParams = { shareStatus: 'public' }
        if (pagePassword.value) {
          params.password = pagePassword.value
        } else if (origPagePassword.value) {
          params.password = null
        }
        const nodeResult = await upsertNodeShare(props.nodeId, params).send()
        applyNodeShareResult(nodeResult)
      } else {
        // 开关 off：inherit 关闭页面分享（后端删除配置行，页面密码随之删除）
        const nodeResult = await upsertNodeShare(props.nodeId, { shareStatus: 'inherit' }).send()
        applyNodeShareResult(nodeResult)
      }
    }

    toast.success(wikiPublic.value ? '知识库已公开' : '分享设置已保存')
    // 广播分享配置变更事件：左侧文档树监听后刷新分享状态 icon
    notifyShareUpdated()
  } catch (error) {
    // ApiError = 后端业务校验失败，直接透出后端 message 兜底
    if (error instanceof ApiError) {
      toast.error(error.message)
    } else {
      console.error('[share-dialog] 保存分享设置失败:', error)
      toast.error('保存失败，请重试')
    }
  } finally {
    saving.value = false
  }
}

/**
 * 将 upsertNodeShare 返回的节点配置同步进本地缓存与表单回显
 * @param result 接口返回的节点分享配置（inherit 时为合成行，分享行已被后端删除）
 */
function applyNodeShareResult(result: NodeShareConfig) {
  // nodes 兜底空数组：防御本地缓存缺失 nodes 字段（如残缺响应）导致展开报错
  const nodes = [...(config.value?.nodes ?? [])]
  const idx = nodes.findIndex((n) => n.nodeId === result.nodeId)
  if (result.shareStatus === 'inherit') {
    // inherit：分享行已删除，从缓存列表移除；表单回退为未公开、无密码
    if (idx >= 0) nodes.splice(idx, 1)
    pagePublic.value = false
    origPagePassword.value = null
    pagePassword.value = ''
  } else {
    // public：更新或插入缓存行；表单按返回值回显（password 明文）
    // 注：TS 对单一 interface 无法通过 if 分支窄化整个对象，需显式构造
    // 与 WikiShareConfig['nodes'] 元素对齐（shareStatus 仅 'public'）的行对象
    const row = {
      nodeId: result.nodeId,
      shareStatus: result.shareStatus,
      password: result.password,
    }
    if (idx >= 0) nodes[idx] = row
    else nodes.push(row)
    pagePublic.value = result.shareStatus === 'public'
    origPagePassword.value = result.password
    pagePassword.value = result.password ?? ''
  }
  if (config.value) {
    config.value = { ...config.value, nodes }
  }
}

/**
 * 广播分享配置变更事件（事件名与 layout-left 的监听约定一致，一字不差）
 * 供左侧文档树刷新各节点的分享状态 icon
 */
function notifyShareUpdated() {
  window.dispatchEvent(new CustomEvent('wiki-share-updated'))
}

// ==================== 通用交互 ====================

/**
 * 复制任意文本到剪贴板（链接/密码共用）
 * 内部走 copyTextToClipboard：安全上下文用 Clipboard API，非安全上下文
 * （如 http://yokimind.local 本地域名）自动降级 execCommand，避免"复制失败"
 */
async function copyText(text: string, tip = '已复制') {
  if (!text) return
  if (await copyTextToClipboard(text)) {
    toast.success(tip)
  } else {
    toast.error('复制失败，请手动复制')
  }
}

/**
 * 处理弹窗显示状态变化（仅 Dialog 内部触发的关闭等走这里）
 */
function onOpenChange(open: boolean) {
  emit('update:visible', open)
}
</script>
