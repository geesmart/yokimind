<template>
  <!--
    统一访客/owner 渲染编排（三态）：
    1. 探测未完成（guestResolved=false）→ 短暂空白，避免登录态探测完成前闪现错误视图
    2. 访客密码/失效 → ShareGate 卡片（密码输入 / 分享不存在），密码校验成功切入浏览态
    3. 浏览态：访客与 owner 共用同一套布局组件（代码复用与体验一致性）
       - LayoutLeft：guest 模式注入访客树数据（单页形态整栏隐藏，无文档树）
       - LayoutMain：guest 模式强制只读（编辑/保存/发布/分享等 owner 操作全部隐藏）
       访客数据源全部来自 /share/* 公开接口，owner 数据源来自登录接口，互不交叉
  -->
  <ShareGate
    v-if="guestResolved && guestMode && (invalidMode || guestPhase === 'password')"
    :state="invalidMode ? 'invalid' : 'password'"
    :wiki-id="wikiId"
    :wiki-name="shareMeta?.wikiName ?? ''"
    :doc-title="shareMeta?.docTitle ?? null"
    :is-page-mode="guestAccessType === 'page'"
    :page-doc-id="docId"
    @verified="onGateVerified"
  />

  <ResizablePanelGroup
    v-else-if="guestResolved && (guestPhase === 'ready' || !guestMode)"
    direction="horizontal"
    class="h-screen min-h-170 bg-muted"
  >
    <!-- 左侧栏：文档树（可拖拽调宽，min 14% / max 28%；可折叠至 0 宽度）
         owner 恒显示；guest 仅整库形态显示（单页形态无文档树，整栏隐藏） -->
    <ResizablePanel
      v-if="!guestMode || guestAccessType === 'wiki'"
      ref="leftPanelRef"
      :default-size="20"
      :min-size="14"
      :max-size="28"
      :collapsible="true"
      :collapsed-size="0"
      @collapse="isLeftCollapsed = true"
      @expand="isLeftCollapsed = false"
    >
      <LayoutLeft
        :wiki="wikiData"
        :guest="guestMode"
        :guest-wiki="guestWikiInfo"
        :guest-tree="guestTree"
        :guest-selected-key="selectedGuestNodeId"
        :guest-loading="guestLoading"
        class="h-full w-full"
        @update-wiki="onWikiUpdated"
        @guest-select="onGuestSelect"
      />
    </ResizablePanel>

    <!-- 左↔中分隔手柄：拖拽调整左侧栏宽度（guest 单页形态隐藏） -->
    <ResizableHandle v-if="!guestMode || guestAccessType === 'wiki'" />

    <!-- 有 docId：编辑器（owner 另含右侧备用面板） -->
    <template v-if="docId">
      <!-- 中间栏：文档编辑器（自适应剩余空间，min 40% 保证可读性） -->
      <ResizablePanel :min-size="40" :default-size="80">
        <LayoutMain
          class="h-full w-full bg-background"
          :guest="guestMode"
          :show-left-toggle="guestMode ? guestAccessType === 'wiki' : true"
          :content="currentContent"
          :doc-id="docId"
          :content-loading="contentLoading"
          :wiki-name="guestMode ? (shareMeta?.wikiName ?? '') : wikiName"
          :doc-path="guestMode ? guestDocPath : docPath"
          :doc-title="guestMode ? guestDocTitle : activeDocTitle"
          :icon="guestMode ? guestDocIcon : activeDocIcon"
          :document-id="currentDocumentId"
          :node-id="docId"
          :in-trash="inTrash"
          :left-collapsed="isLeftCollapsed"
          :right-collapsed="isRightCollapsed"
          :show-right-toggle="true"
          @update:doc-title="onDocTitleUpdate"
          @update:doc-icon="onDocIconUpdate"
          @toggle:left="toggleLeftPanel"
          @toggle:right="toggleRightPanel"
        />
      </ResizablePanel>

      <!-- 中↔右分隔手柄 + 右侧备用面板（默认折叠）：仅 owner 渲染（guest 无右栏） -->
      <template v-if="!guestMode">
        <ResizableHandle />

        <ResizablePanel
          ref="rightPanelRef"
          :default-size="0"
          :min-size="8"
          :max-size="25"
          :collapsible="true"
          :collapsed-size="0"
          :collapsed="true"
          @collapse="isRightCollapsed = true"
          @expand="isRightCollapsed = false"
        >
          <div class="h-full w-full bg-muted"></div>
        </ResizablePanel>
      </template>
    </template>

    <!-- 无 docId：空库兜底空态（正常情况树就绪后会自动 replace 到第一篇文档，不会停留在此） -->
    <ResizablePanel v-else :min-size="40" :default-size="80">
      <div class="h-full flex flex-col items-center justify-center gap-2 text-muted-foreground">
        <FileText :size="32" class="text-muted-foreground/50" />
        <p class="text-sm">暂无文档</p>
        <!-- 空态文案按模式区分：owner 提示创建，guest 提示无可浏览内容 -->
        <p v-if="!guestMode" class="text-xs text-muted-foreground/70">
          点击左侧「+」按钮创建第一篇文档
        </p>
        <p v-else class="text-xs text-muted-foreground/70">该知识库暂无可浏览的文档</p>
      </div>
    </ResizablePanel>
  </ResizablePanelGroup>
</template>

<script lang="ts" setup>
import { ref, watch, computed, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import { FileText } from '@lucide/vue'
import type { Content } from '@tiptap/vue-3'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import LayoutLeft from '@/views/wiki/layout-left/index.vue'
import LayoutMain from '@/views/wiki/layout-main.vue'
import ShareGate from '@/views/share/share-gate.vue'
import { getWiki, getDocument } from '@/api/modules/wiki'
import type { WikiItem } from '@/api/modules/wiki'
import {
  readLocalSnapshot,
  writeLocalSnapshot,
  getDocPersistence,
  type DocSnapshot,
} from '@/composables/document-persistence'
import {
  getShareMeta,
  listShareNodes,
  getShareDocument,
  getShareToken,
  clearShareToken,
  SHARE_ERROR_CODES,
} from '@/api/modules/share'
import type { ShareMeta } from '@/api/modules/share'
import type { GuestTreeItem } from '@/views/share/guest-tree'
import {
  buildGuestTree,
  findGuestNode,
  findGuestNodePath,
  firstGuestNode,
} from '@/views/share/guest-tree'
import { ApiError } from '@/api/request'
import { useWikiDocStore } from '@/stores/wiki-doc'
import type { WikiDocItem } from '@/types/wiki-doc'
import { isLoggedIn } from '@/utils/token'
import { openAuthDialog } from '@/composables/use-auth-dialog'

/**
 * 路由参数
 * - wikiId：知识库 ID
 * - docId：选中文档树节点 ID（可选）
 * 全站统一小写 ID，toLowerCase() 兜底：
 * 防止 URL 中带大写 ID（手输/旧链接）导致大小写混用、PostgreSQL 大小写敏感查询不命中
 */
const route = useRoute()
const router = useRouter()
const wikiId = computed(() => ((route.params.wikiId as string) || '').toLowerCase())
const docId = computed(() => ((route.params.docId as string) || '').toLowerCase())

// ============ 访客模式探测（分享链接与 owner 完全一致：/wiki/{wikiId}/{docId?}） ============

/**
 * 登录态 + 分享元信息是否已探测完成
 * 完成前渲染空白，避免未登录访客闪现 owner 视图（owner 接口会 401 报错）
 */
const guestResolved = ref(false)

/**
 * 访客模式：未登录 且 该知识库存在生效分享
 * true 时走访客数据链路（/share/* 公开接口），渲染 owner 布局的 guest 模式（只读）
 */
const guestMode = ref(false)

/**
 * 分享失效态：未登录 且 该知识库无生效分享（从未分享 / 已撤销 / 库已删除）
 * true 时 ShareGate 渲染「分享不存在或已关闭」失效卡片（内含「去登录」入口，
 * 兼顾私有库 owner 自查场景），不再直接跳转登录页
 */
const invalidMode = ref(false)

/**
 * 分享元信息（wikiName + accessType + needsPassword），由 getShareMeta 探测获得：
 * - accessType='wiki'：整库公开 → 左树 + 文档浏览形态（令牌 scope = 库级）
 * - accessType='page'：私密库单页公开 → 无左树仅正文形态（令牌 scope = 页级，按 docId 隔离）
 */
const shareMeta = ref<ShareMeta | null>(null)

/**
 * 文档树 Store（按 wikiId 动态拉取）
 */
const wikiDocStore = useWikiDocStore()

/**
 * 知识库详情（完整 WikiItem），LayoutLeft 顶栏 + 编辑弹窗使用
 */
const wikiData = ref<WikiItem | null>(null)

/**
 * 知识库名称（顶栏/面包屑用），从 wikiData 派生
 */
const wikiName = computed(() => wikiData.value?.name ?? '')

/**
 * 当前文档正文（Tiptap JSON），null 表示未加载或空
 */
const currentContent = ref<Content | null>(null)

/**
 * 当前文档 ID（documents.id，对应 wikiNodes.documentId）
 * 下发给 LayoutRight 用于读写文档标签；无文档 / 文件夹节点时为空串
 */
const currentDocumentId = ref('')

/**
 * 文档正文加载状态
 */
const contentLoading = ref(false)

/**
 * 左右侧栏折叠状态
 * - isLeftCollapsed：左侧文档树栏是否折叠（由 ResizablePanel 的 @collapse/@expand 事件同步）
 * - isRightCollapsed：右侧大纲栏是否折叠
 * 由 LayoutMain 顶栏的 PanelLeft/PanelRight 按钮触发 toggle，再通过模板 ref 调命令式 collapse()/expand()
 */
const isLeftCollapsed = ref(false)
const isRightCollapsed = ref(false)

/**
 * 左右 ResizablePanel 模板引用
 * reka-ui SplitterPanel 经 useForwardExpose 透传了 collapse()/expand() 命令式方法
 */
const leftPanelRef = ref<{ collapse: () => void; expand: () => void } | null>(null)
const rightPanelRef = ref<{ collapse: () => void; expand: () => void } | null>(null)

/**
 * 切换左侧栏折叠/展开
 * 折叠态调 expand()，展开态调 collapse()
 */
function toggleLeftPanel() {
  if (isLeftCollapsed.value) {
    leftPanelRef.value?.expand()
  } else {
    leftPanelRef.value?.collapse()
  }
}

/**
 * 切换右侧栏折叠/展开
 */
function toggleRightPanel() {
  if (isRightCollapsed.value) {
    rightPanelRef.value?.expand()
  } else {
    rightPanelRef.value?.collapse()
  }
}

/**
 * 当前文档标题（面包屑用）
 */
const activeDocTitle = ref('')

/**
 * 当前文档图标（emoji）
 */
const activeDocIcon = ref<string | null>(null)

/**
 * 当前文档的父级路径（从根到直接父节点）
 * 用于渲染面包屑导航中的中间层级
 */
const docPath = computed(() => {
  if (!docId.value) return []
  return wikiDocStore.getNodePath(docId.value)
})

/**
 * 当前打开文档是否位于回收站：路由 docId 命中回收站顶层条目
 * 驱动 LayoutMain：只读展示 + 隐藏分享/发布/编辑切换 + 右上角「恢复」按钮
 * 数据源 trashItems 由侧栏切入回收站视图 / 回收站兜底解析 / 删除后刷新维持最新
 */
const inTrash = computed(
  () => !!docId.value && wikiDocStore.trashItems.some((item) => item.id === docId.value)
)

/**
 * 监听 inTrash 变化：当前文档从回收站恢复时（true → false），把只读 /view URL 切回 /edit
 * （侧栏恢复与顶栏右上角恢复共用：store.restoreDoc 成功移除回收站条目后自动触发）
 */
watch(inTrash, (now, prev) => {
  if (prev && !now && docId.value && route.params.mode === 'view') {
    router.replace({
      name: 'wiki',
      params: { wikiId: wikiId.value, docId: docId.value, mode: 'edit' },
    })
  }
})

/**
 * 处理标题保存成功事件：更新本地标题 + 文档树中的标题
 */
function onDocTitleUpdate(title: string) {
  activeDocTitle.value = title
  // 同步更新文档树中的节点标题，避免切换回来时仍显示旧标题
  const node = wikiDocStore.findNode(docId.value)
  if (node) {
    node.title = title
  }
}

/**
 * 处理图标保存成功事件：更新本地图标 + 文档树中的图标
 */
function onDocIconUpdate(icon: string) {
  activeDocIcon.value = icon || null
  // 同步更新文档树中的节点图标
  const node = wikiDocStore.findNode(docId.value)
  if (node) {
    node.icon = icon || null
  }
}

// ============ 数据拉取 ============

/**
 * 空文档兜底内容：新建文档 content 为 null 时让编辑器正常挂载（显示空段落）
 */
const EMPTY_DOC_CONTENT = { type: 'doc', content: [{ type: 'paragraph' }] } as Content

/**
 * 回收站条目兜底解析：节点不在可见树中时，尝试从回收站列表还原节点信息
 * 场景：点击侧栏回收站条目 / 直接打开被删文档的链接（刷新、分享的历史链接）
 * 回收站列表未包含该节点时先拉取一次（owner 打开链接直达场景侧栏可能尚未加载回收站），
 * 解析失败（不在回收站）返回 null，由调用方按「节点不存在」处理
 * @param nodeId 节点 ID（wikiNodes.id）
 * @returns WikiDocItem 形状的节点信息（供 loadDocContent 复用正文加载逻辑）；不在回收站返回 null
 */
async function resolveTrashNode(nodeId: string): Promise<WikiDocItem | null> {
  if (!wikiId.value) return null
  // 回收站列表可能尚未加载（侧栏仅在切入回收站视图时拉取），先拉取一次保证数据可用
  if (!wikiDocStore.trashItems.some((item) => item.id === nodeId)) {
    try {
      await wikiDocStore.loadTrash(wikiId.value)
    } catch (error) {
      // 拉取失败按「不在回收站」处理（正文走下方清空逻辑），不阻断主流程
      console.warn('[wiki/index] 回收站兜底拉取失败:', error)
    }
  }
  const item = wikiDocStore.trashItems.find((i) => i.id === nodeId)
  if (!item) return null
  // 合成与文档树节点同构的对象：title/icon 用于面包屑，documentId 供正文加载
  return {
    id: item.id,
    title: item.title,
    icon: item.icon ?? undefined,
    visible: true,
    documentId: item.documentId,
    children: [],
  }
}

/**
 * 加载指定文档节点的正文内容（local-first 读取）
 * 1. 内存/IndexedDB 缓存命中 → 立即渲染（不等服务端），后台与服务端调和
 * 2. 缓存未命中 → 走服务端，成功后写入本地缓存建立 savedAt 时间基线
 * 节点不在可见树中时按回收站条目兜底（点回收站条目 / 直接打开被删文档链接）：
 * 回收站内容同样可查看（只读），只是不可分享/编辑，右上角提供「恢复」
 * 过期响应丢弃：期间用户已切换其他文档时，不回写 currentContent
 */
async function loadDocContent(nodeId: string) {
  let node = wikiDocStore.findNode(nodeId)
  if (!node) {
    // 分享链接兼容：URL docId 段为 documents.id（share-dialog 复制的链接）时，
    // 树按节点 ID（wikiNodes.id）无法命中 → 按关联文档 ID 反查节点，
    // 并把 URL 归一化为节点 ID 后直接返回（watch(docId) 会以归一化后的 docId 重新编排加载，
    // 避免同一文档双重加载；面包屑 / 标题同步 / 回收站判定等下游逻辑均按节点 ID 工作不受影响）
    const byDocId = wikiDocStore.findNodeByDocumentId(nodeId)
    if (byDocId) {
      router.replace({
        name: 'wiki',
        params: {
          wikiId: wikiId.value,
          docId: byDocId.id,
          // mode 缺省（瞬态无后缀 URL）按编辑态归一，与 owner 无后缀旧链接的兼容口径一致
          mode: (route.params.mode as 'edit' | 'view') || 'edit',
        },
      })
      return
    }
    node = await resolveTrashNode(nodeId)
  }
  if (!node) {
    // 节点不在树中且不在回收站（可能树未就绪或链接失效），清空内容
    currentContent.value = null
    currentDocumentId.value = ''
    return
  }
  activeDocTitle.value = node.title
  activeDocIcon.value = node.icon ?? null
  if (!node.documentId) {
    // 无关联文档（异常数据）：无正文，无标签读写
    // 注：Notion 风格模型下每个节点都应有 documentId，此处仅作空值保护
    currentContent.value = null
    currentDocumentId.value = ''
    return
  }
  // 记录当前文档 ID，供 LayoutRight 读写标签 + 过期响应丢弃判据
  currentDocumentId.value = node.documentId
  contentLoading.value = true
  currentContent.value = null
  try {
    // ===== local-first：本地缓存（内存 → IndexedDB 兜底）命中即渲染 =====
    const local = await readLocalSnapshot(node.documentId)
    if (currentDocumentId.value !== node.documentId) return // 期间已切换文档
    if (local?.content) {
      currentContent.value = local.content as Content
      contentLoading.value = false
      // 后台调和：本地脏 → 本地赢；本地干净且服务端更新 → 服务端赢（整文档替换）
      void reconcileDocContent(node.documentId, local)
      return
    }
    // ===== 缓存未命中：走服务端，成功后写本地缓存建立 savedAt 基线 =====
    const doc = await getDocument(node.documentId).send()
    if (currentDocumentId.value !== node.documentId) return // 过期响应丢弃
    // 先落纯对象变量再进 ref：currentContent 是深层 ref，读 .value 会返回 reactive Proxy，
    // 直接把 Proxy 写入 IndexedDB 会因 structured clone 失败抛 DataCloneError（本地缓存静默失效）
    const serverContent = (doc.content as Content | null) ?? EMPTY_DOC_CONTENT
    currentContent.value = serverContent
    void writeLocalSnapshot(node.documentId, {
      content: serverContent,
      wordCount: doc.wordCount ?? 0,
      savedAt: doc.updatedAt,
    })
  } catch (error) {
    if (error instanceof ApiError) {
      toast.error(error.message)
    } else {
      console.error('[wiki/index] loadDocContent error:', error)
      toast.error('文档加载失败')
    }
    currentContent.value = null
  } finally {
    // 仅在仍停留在本文档时清除加载态，避免快速切换文档时过期请求过早关闭新请求的加载态
    if (currentDocumentId.value === node.documentId) {
      contentLoading.value = false
    }
  }
}

/**
 * 后台调和：本地缓存命中渲染后，与服务端比对决定最终内容
 * 调和规则（local-first）：
 * - 本地 dirty（同步队列还有未推送的修改）→ 本地赢：保持本地内容，队列稍后把服务端追平
 * - 本地干净且服务端 updatedAt 更新（其他端/窗口改过）→ 服务端赢：
 *   置空 currentContent 触发编辑器重挂载载入服务端内容，并回写本地缓存建立新基线
 * - 否则保持本地渲染（通常两者一致，避免无谓重挂载）
 * 任何失败都不影响本地已渲染内容（数据已安全，下次编辑会重新推送服务端）
 */
async function reconcileDocContent(documentId: string, local: DocSnapshot) {
  try {
    const persistence = getDocPersistence(documentId)
    // 本地有未同步修改 → 本地赢：除实例内存 dirty 外，同时检查快照持久化的 dirty
    // （双保险：实例若在 readLocalSnapshot 之前创建，内存 dirty 仍是初始值 false，
    // 只有快照里的 dirty 能证明「这条本地快照从未成功上过服务端」；
    // 此时服务端即使 updatedAt 更新，也可能是旧内容在途请求晚落库造成的时间戳反超，
    // 判服务端赢会把用户未同步的修改整体回滚——必须保本地并等待队列重推）
    if (persistence.isDirty() || local.dirty) return
    const doc = await getDocument(documentId).send()
    // 期间已切换文档 / 本地又产生了新编辑（变脏）→ 以本地为准，丢弃调和
    if (currentDocumentId.value !== documentId || persistence.isDirty()) return
    if (new Date(doc.updatedAt) > new Date(local.savedAt)) {
      // 服务端赢：先置空触发 v-if 卸载编辑器，下一帧再赋新内容触发重挂载
      currentContent.value = null
      await nextTick()
      if (currentDocumentId.value !== documentId) return
      // 同 loadDocContent：先落纯对象变量再进 ref，避免 reactive Proxy 混入 IDB 写入
      const serverContent = (doc.content as Content | null) ?? EMPTY_DOC_CONTENT
      currentContent.value = serverContent
      void writeLocalSnapshot(documentId, {
        content: serverContent,
        wordCount: doc.wordCount ?? 0,
        savedAt: doc.updatedAt,
      })
    }
  } catch (err) {
    console.warn('[wiki/index] 文档调和失败（保持本地内容）:', err)
  }
}

// ============ 访客浏览态（guest）：复用 owner 布局的数据编排 ============
// 访客与 owner 共用 LayoutLeft/LayoutMain 渲染，数据链路分离：
// - owner：wikiDocStore + 登录接口 + IndexedDB local-first（访客只读，不走持久化）
// - guest：/share/* 公开接口实时拉取，选中态由本组件持有注入子组件

/** 访客访问形态（shareMeta.accessType 派生；'wiki' 整库 / 'page' 单页） */
const guestAccessType = computed<'wiki' | 'page'>(() => shareMeta.value?.accessType ?? 'wiki')

/**
 * 访客浏览阶段：
 * - password：等待密码校验（invalidMode=true 时 ShareGate 渲染失效卡片）
 * - ready：浏览态（渲染 owner 布局的 guest 模式）
 */
const guestPhase = ref<'password' | 'ready'>('password')

/**
 * 访客文档树（仅整库形态）：listShareNodes 扁平数据 → buildGuestTree 嵌套树，
 * 注入 LayoutLeft guest 模式渲染；单页形态无树，恒为空数组
 */
const guestTree = ref<GuestTreeItem[]>([])

/** 访客树加载中（LayoutLeft guest 模式加载态） */
const guestLoading = ref(false)

/**
 * 访客当前选中节点 ID（选中态由本组件持有，注入 LayoutLeft 高亮）：
 * - 整库形态 = 树节点 ID（wikiNodes.id，即路由 docId）
 * - 单页形态 = URL docId（documents.id）
 */
const selectedGuestNodeId = ref('')

/** 访客当前文档标题/图标（面包屑 + 顶栏；整库形态取树节点，单页形态由正文接口回填） */
const guestDocTitle = ref('')
const guestDocIcon = ref<string | null>(null)

/**
 * 访客面包屑父级路径（根 → 直接父节点，不含自身）
 * findGuestNodePath 含自身节点，去掉最后一项与 owner docPath 语义对齐
 */
const guestDocPath = computed(() =>
  findGuestNodePath(guestTree.value, selectedGuestNodeId.value).slice(0, -1)
)

/** 访客态侧栏库信息（分享元信息合成，LayoutLeft guest 模式顶栏渲染） */
const guestWikiInfo = computed(() => {
  const meta = shareMeta.value
  if (!meta) return null
  return {
    name: meta.wikiName,
    icon: meta.wikiIcon ?? null,
    color: meta.wikiColor ?? null,
  }
})

/**
 * 访客正文请求序号（过期响应丢弃）：快速切换文档时旧响应不回写 currentContent
 */
let guestDocReqSeq = 0

/**
 * 处理访客接口错误（迁移自原 share-guest handleShareError）：
 * - SHARE_NOT_FOUND：分享不存在/已关闭 → 失效卡片
 * - SHARE_PASSWORD_REQUIRED / SHARE_TOKEN_INVALID：令牌缺失/过期 → 清令牌回密码态
 * - 其他：toast 提示（保持当前态）
 */
function handleGuestError(error: unknown) {
  if (error instanceof ApiError) {
    const code = (error as { code?: number }).code
    if (code === SHARE_ERROR_CODES.NOT_FOUND) {
      invalidMode.value = true
      return
    }
    if (code === SHARE_ERROR_CODES.PASSWORD_REQUIRED || code === SHARE_ERROR_CODES.TOKEN_INVALID) {
      // 令牌按 scope 清理：单页形态清页级令牌，整库形态清库级令牌
      if (guestAccessType.value === 'page') {
        clearShareToken(wikiId.value, docId.value || undefined)
      } else {
        clearShareToken(wikiId.value)
      }
      guestPhase.value = 'password'
      return
    }
  }
  console.warn('[wiki/index] 访客内容加载失败:', error)
  toast.error('内容加载失败，请稍后重试')
}

/**
 * 加载访客文档正文（getShareDocument 公开接口）
 * 访客只读不走 IndexedDB local-first（持久化是 owner 编辑链路专属），每次实时拉取
 * @param documentId 文档 ID（documents.id）
 * @param tokenDocId 令牌 scope 维度 ID：单页形态传 URL docId（页级令牌）；
 *        整库形态不传，guestTokenHeaders 内部按「页级缺失回退库级」取令牌
 */
async function loadGuestDocContent(documentId: string, tokenDocId?: string) {
  if (!documentId) {
    currentContent.value = null
    return
  }
  const seq = ++guestDocReqSeq
  contentLoading.value = true
  currentContent.value = null
  try {
    const doc = await getShareDocument(wikiId.value, documentId, tokenDocId).send()
    if (seq !== guestDocReqSeq) return // 过期响应丢弃
    // 正文接口回填标题/图标（来自 wiki_nodes 行）：单页形态唯一标题来源，
    // 整库形态与树节点一致（幂等覆盖）
    guestDocTitle.value = doc.title ?? ''
    guestDocIcon.value = doc.icon ?? null
    currentContent.value = (doc.content as Content | null) ?? EMPTY_DOC_CONTENT
  } catch (error) {
    if (seq !== guestDocReqSeq) return // 过期响应丢弃
    currentContent.value = null
    handleGuestError(error)
  } finally {
    if (seq === guestDocReqSeq) {
      contentLoading.value = false
    }
  }
}

/**
 * 选中并加载访客节点（整库形态树点击 / 初始定位共用）：
 * 同步选中态与标题 → 加载正文（URL 由 onGuestSelect/handleGuestDocChange 维护）
 */
async function activateGuestNode(node: GuestTreeItem) {
  selectedGuestNodeId.value = node.id
  guestDocTitle.value = node.title
  guestDocIcon.value = node.icon
  await loadGuestDocContent(node.documentId ?? '')
}

/**
 * LayoutLeft guest 模式树点击回调：replace URL（/view 后缀），正文加载由 watch(docId) 编排
 */
function onGuestSelect(nodeId: string) {
  if (nodeId && nodeId !== docId.value) {
    router.replace(`/wiki/${wikiId.value}/${nodeId}/view`)
  }
}

/**
 * 加载访客文档树（仅整库形态）：建树 → 初始定位（同原 share-guest loadTree 规则）
 * - URL 带 docId 且命中树节点 → 直接加载该节点（docId 不变 watch 不触发，需显式加载）
 * - URL 无 docId / docId 失效 → replace 到第一篇（深度优先第一篇，watch(docId) 接管加载）
 * - 空树 → 停留空态
 */
async function loadGuestTree(initialDocId: string) {
  guestLoading.value = true
  try {
    const flat = await listShareNodes(wikiId.value).send()
    guestTree.value = buildGuestTree(flat)
    const initial = initialDocId ? findGuestNode(guestTree.value, initialDocId) : null
    if (initial) {
      await activateGuestNode(initial)
      return
    }
    const first = firstGuestNode(guestTree.value)
    if (first) {
      router.replace(`/wiki/${wikiId.value}/${first.id}/view`)
    }
  } catch (error) {
    handleGuestError(error)
  } finally {
    guestLoading.value = false
  }
}

/**
 * 切入访客浏览态：按访问形态加载数据
 * - 整库（accessType='wiki'）：拉树 + 初始定位 + 正文
 * - 单页（accessType='page'）：无树，URL docId（documents.id）即正文，令牌 scope = 页级
 * 入口两处：探测完成持有效令牌 / ShareGate 密码校验成功
 */
async function enterGuestReady() {
  guestPhase.value = 'ready'
  guestTree.value = []
  selectedGuestNodeId.value = ''
  guestDocTitle.value = ''
  guestDocIcon.value = null
  currentContent.value = null
  if (guestAccessType.value === 'page') {
    if (!docId.value) return // 异常保护：单页分享链接必带文档 ID
    selectedGuestNodeId.value = docId.value
    await loadGuestDocContent(docId.value, docId.value)
  } else {
    await loadGuestTree(docId.value)
  }
}

/**
 * ShareGate 密码校验成功回调：令牌已入 sessionStorage，切入浏览态
 */
function onGateVerified() {
  void enterGuestReady()
}

/**
 * 访客 docId 变化处理（watch(docId) guest 分支）：
 * - 整库形态：docId = 树节点 ID → 命中则加载；失效（已隐藏/已删除/旧链接）→ 兜底第一篇
 * - 单页形态：docId = 文档 ID（documents.id）→ 直接加载
 * selectedGuestNodeId 去重：初始定位已显式加载的场景，URL replace 触发的 watch 不重复请求
 */
async function handleGuestDocChange(id: string) {
  if (selectedGuestNodeId.value === id) return
  if (guestAccessType.value === 'page') {
    selectedGuestNodeId.value = id
    await loadGuestDocContent(id, id)
    return
  }
  const node = findGuestNode(guestTree.value, id)
  if (!node) {
    const first = firstGuestNode(guestTree.value)
    if (first && first.id !== id) {
      router.replace(`/wiki/${wikiId.value}/${first.id}/view`)
    }
    return
  }
  await activateGuestNode(node)
}

/**
 * wikiId 变化：拉取知识库详情 + 文档树
 * 树就绪后 URL 无 docId：自动 replace 到第一篇可见文档（知识库首页已移除）；
 * 空库（树中无可选文档）则停留当前 URL，显示「暂无文档」空态
 */
watch(
  wikiId,
  async (id) => {
    if (!id) return

    // ===== 访客分支：未登录时先探测分享元信息 =====
    if (!isLoggedIn()) {
      // /edit 是 owner 编辑态 URL：未登录 = 无编辑权限 → 弹出全局登录弹窗引导就地登录
      // （登录成功后弹窗回调整页刷新，原 URL 重进，按新登录态重新判定视图）
      // 弹窗可关闭：关闭后仍走下方探测流程，有生效分享时可继续只读浏览公开内容
      if (route.params.mode === 'edit') {
        openAuthDialog('请先登录后再编辑文档')
      }
      guestResolved.value = false
      invalidMode.value = false
      guestPhase.value = 'password'
      try {
        // 探测该知识库是否有生效分享（公开接口，无需登录）
        // 路由带 docId 时一并传给后端：按「库可见性 ⊕ 页面覆盖」判定
        // - 整库公开（或公开库内未被隐藏的页面）→ accessType='wiki'
        // - 私密库单页公开 → accessType='page'（单页分享链接必带文档 ID）
        // docId 为空串时归一为 undefined（整库浏览意图，不拼 query）
        shareMeta.value = await getShareMeta(id, docId.value || undefined).send()
        guestMode.value = true
        guestResolved.value = true
        // 旧分享链接兼容：访客打开无后缀的 /wiki/{wikiId}/{docId} → 统一补 /view 后缀
        // （与分享链接格式 /wiki/{wikiId}/{docId}/view 对齐；docId 值不变，watch 不重复触发；
        //   无 docId 的整库浏览 URL 无法携带后缀——'view' 会被 :docId? 参数吞掉——保持原样）
        if (docId.value && !route.params.mode) {
          router.replace({
            name: 'wiki',
            params: { wikiId: id, docId: docId.value, mode: 'view' },
          })
        }
        // 密码闸门判定：无需密码，或已持有未过期的访客令牌（sessionStorage）→ 直接进入浏览态；
        // 否则停在密码卡片（ShareGate 校验成功后经 onGateVerified 进入浏览态）
        const token =
          guestAccessType.value === 'page'
            ? (getShareToken(id, docId.value || undefined) ?? getShareToken(id))
            : getShareToken(id)
        if (!shareMeta.value.needsPassword || token) {
          void enterGuestReady()
        }
        return // 访客模式：不加载任何 owner 数据
      } catch {
        guestMode.value = true
        invalidMode.value = true
        guestResolved.value = true
        // 无分享（或分享已关闭）→ 渲染「分享不存在或已关闭」失效卡片
        // （不直接跳登录：避免向访客暴露登录入口造成困惑；卡片内「去登录」
        // 按钮已覆盖私有库 owner 自查场景，且统一失效文案不泄露库存在性）
        return
      }
    }

    // ===== Owner 分支：已登录，拉取知识库详情 + 文档树 =====
    guestMode.value = false
    guestResolved.value = true
    // 旧链接兼容：owner 打开无后缀的 /wiki/{wikiId}/{docId} → 统一补 /edit 后缀
    // （wikiId/docId 值不变，watch(wikiId)/watch(docId) 不会重复触发，无循环；
    //   未登录访客分支不重定向，访客 URL 保持无后缀原样）
    if (docId.value && !route.params.mode) {
      router.replace({
        name: 'wiki',
        params: { wikiId: id, docId: docId.value, mode: 'edit' },
      })
    }
    // 重置状态
    currentContent.value = null
    activeDocTitle.value = ''
    activeDocIcon.value = null
    currentDocumentId.value = ''
    // 拉取知识库详情（保存完整对象，供顶栏渲染 + 编辑弹窗回填）
    try {
      const w = await getWiki(id).send()
      wikiData.value = w
    } catch (error) {
      wikiData.value = null
      if (error instanceof ApiError) {
        toast.error(error.message)
      }
    }
    // 拉取文档树
    await wikiDocStore.loadDocs(id)
    // 树就绪后：有 docId 则加载内容；无 docId 则自动 replace 到第一篇可见文档（docId watch 会触发内容加载）
    if (docId.value) {
      loadDocContent(docId.value)
    } else {
      // 统一节点模型下每个节点均有 documentId，第一个可见节点即第一篇文档；空树为 undefined → 停留显示空态
      const first = wikiDocStore.sortedDisplayDocs[0]
      if (first) {
        // 走到这里 URL 必为瞬态的 /wiki/{wikiId}（无 docId、无 mode 后缀），固定补 /edit
        // （面包屑点知识库名等回根操作会重置为编辑模式）
        router.replace(`/wiki/${id}/${first.id}/edit`)
      }
    }
  },
  { immediate: true }
)

/**
 * docId 变化：加载该文档正文
 * - owner：点击树中文档 → local-first 加载
 * - 访客：初始定位 replace / 树点击 replace → handleGuestDocChange 编排（含失效兜底）
 */
watch(docId, (id) => {
  if (!id) return
  if (guestMode.value) {
    void handleGuestDocChange(id)
    return
  }
  loadDocContent(id)
})

/**
 * 左侧栏编辑知识库成功回调：更新 wikiData，派生的 wikiName 等自动刷新
 */
function onWikiUpdated(updated: WikiItem) {
  wikiData.value = updated
}
</script>