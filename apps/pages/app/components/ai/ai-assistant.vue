<script setup lang="ts">
/**
 * AI 文档助手浮窗（分享公开页右下角，设计参考 Intercom 风格）
 *
 * 交互形态：
 * - 右下角圆形悬浮按钮（蓝色），点击展开对话面板；展开后按钮变 X（关闭）
 * - 面板边缘可拖拽调整窗口大小（左缘调宽 / 顶缘调高 / 左上角双向，向左上拖变大，锚定右下角）
 * - 面板右上角「放大为独立窗口」按钮：以 shadcn Dialog 弹出更大窗口（与浮动面板共用对话体，
 *   状态互通：Dialog 打开时隐藏浮动面板，关闭后回到面板继续对话）
 * - 欢迎态：问候语 + 「AI 助手在线」卡片 + 历史记录（localStorage 持久化的提问历史，点击重新提问）
 * - 对话态：MessageScroller 消息流（用户右侧蓝泡 / AI 左侧带头像）+
 *   历史记录快捷入口 + 底部问答输入框（Enter 提问 / 流式中可停止）
 *
 * 数据来源：
 * - POST /api/v1/share/wiki/:wikiId/ai-chat（SSE 流式，无需登录），
 *   见 api/ai-chat.ts；后端以 shareAuthMiddleware 实时复核分享可见性
 *
 * 显示范围：
 * - 仅在带 wikiId 路由参数的页面显示（/w/:wikiId、/b/:wikiId 的帮助中心与博客形态），
 *   首页等无知识库上下文的页面不渲染
 */
import { Maximize2, X, MessageCircle } from '@lucide/vue'
import LogoMono from '~/components/brand/LogoMono.vue'
import { streamShareAiChat, type RagHistoryItem } from '~/api/ai-chat'
import type { ChatMessage } from './chat-body.vue'

// ==================== 路由上下文（wikiId 提取） ====================

const route = useRoute()

/**
 * 当前页面的知识库 ID（/w/:wikiId、/b/:wikiId 的 wikiId 段）
 * URL ID 全站统一小写（后端 text 查询大小写敏感，出口规范化防手输大写不命中）
 */
const wikiId = computed(() => {
  const raw = route.params.wikiId
  const id = Array.isArray(raw) ? (raw[0] ?? '') : (raw ?? '')
  return id ? String(id).toLowerCase() : ''
})

/** 仅在有知识库上下文的页面渲染浮窗 */
const visible = computed(() => !!wikiId.value)

// ==================== 面板状态 ====================

/** 面板展开状态（FAB 点击切换；展开后 FAB 变 X 关闭按钮） */
const open = ref(false)

/** Dialog 大窗状态（面板右上角「放大为独立窗口」触发；关闭后回到浮动面板） */
const expanded = ref(false)

/** 输入框内容（受控，浮动面板与 Dialog 共用） */
const input = ref('')

/** 消息自增 ID（用作 MessageScrollerItem 的 messageId 与 v-for key） */
let nextMessageId = 1

/** 对话消息列表（每轮问答追加 user + assistant 两条） */
const messages = ref<ChatMessage[]>([])

/** 是否正在流式接收回答（期间禁用历史记录与输入，发送按钮变停止按钮） */
const streaming = ref(false)

/** 进行中请求的中断控制器（停止生成用） */
let abortController: AbortController | null = null

// 跨库导航（wikiId 变化）时清空对话历史，避免上下文串库；同时重载对应知识库的提问历史
watch(wikiId, () => {
  messages.value = []
  input.value = ''
  loadChatHistory()
})

// ==================== 提问历史记录（localStorage 持久化，按 wikiId 隔离） ====================

/** localStorage key 前缀（完整 key 为 `${前缀}:${wikiId}`，各知识库历史互不串扰） */
const CHAT_HISTORY_KEY_PREFIX = 'yokimind_ai_chat_history'

/** 提问历史条数上限（去重后最新在前，超出截断） */
const MAX_CHAT_HISTORY = 20

/** 提问历史（内存态；挂载 / 切库时从 localStorage 加载，SSR 阶段为空数组） */
const chatHistory = ref<string[]>([])

/**
 * 从 localStorage 读取当前知识库的提问历史
 * 解析失败 / 存储不可用 / SSR 阶段静默降级为空数组（仅客户端有历史）
 */
function loadChatHistory() {
  if (!wikiId.value) {
    chatHistory.value = []
    return
  }
  try {
    const raw = localStorage.getItem(`${CHAT_HISTORY_KEY_PREFIX}:${wikiId.value}`)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    chatHistory.value = Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === 'string').slice(0, MAX_CHAT_HISTORY)
      : []
  } catch {
    chatHistory.value = []
  }
}

/** 持久化提问历史到 localStorage（失败静默忽略） */
function persistChatHistory() {
  try {
    localStorage.setItem(
      `${CHAT_HISTORY_KEY_PREFIX}:${wikiId.value}`,
      JSON.stringify(chatHistory.value)
    )
  } catch {
    // localStorage 不可用则静默忽略
  }
}

/**
 * 记录一次提问：去重后最新在前，超出上限截断
 * @param q 提问文本（空串 / 纯空白忽略）
 */
function recordChatHistory(q: string) {
  const question = q.trim()
  if (!question) return
  chatHistory.value = [question, ...chatHistory.value.filter((v) => v !== question)].slice(
    0,
    MAX_CHAT_HISTORY
  )
  persistChatHistory()
}

// 挂载时加载历史（SSR 阶段 localStorage 不存在，静默降级为空）
onMounted(loadChatHistory)

// ==================== 问答流程 ====================

/**
 * 发起提问（历史记录点击 / 输入框提交共用入口）
 *
 * 流程：记录提问历史 → 追加 user 消息 + 空的 assistant 占位消息 →
 * SSE 流式接收 delta 逐段拼进占位消息 → sources 事件挂引用来源 → done 结束。
 * 流前业务异常（分享关闭 / 需要密码 / 限流 / AI 未配置）抛 ApiError；
 * 流内异常走 onError 回调 —— 两者都落到 assistant 消息的 error 字段展示。
 */
async function ask(question: string) {
  const q = question.trim()
  if (!q || streaming.value || !wikiId.value) return

  // 记录提问历史（localStorage 持久化，供欢迎态/对话态的历史记录展示与重新提问）
  recordChatHistory(q)

  input.value = ''
  messages.value.push({ id: nextMessageId++, role: 'user', content: q })
  // assistant 占位消息：content 为空且非 streaming 时展示"输入中"动画
  const assistantId = nextMessageId++
  messages.value.push({ id: assistantId, role: 'assistant', content: '' })

  streaming.value = true
  abortController = new AbortController()

  /** 取当前最后一条消息（即本次回答的占位消息） */
  const last = () => messages.value[messages.value.length - 1]

  // 从消息列表提取最近 10 轮完整问答作为历史（unshift 保持时间正序）：
  // 仅取 content 非空且无 error 的 assistant 轮次，并配对其前一条 user 提问；
  // 本轮刚 push 的 user 与 assistant 占位（content 为空）天然不满足条件，不会入历史
  const history: RagHistoryItem[] = []
  for (let i = messages.value.length - 1; i >= 1 && history.length < 10; i--) {
    const m = messages.value[i]!
    if (m.role === 'assistant' && m.content && !m.error) {
      const prev = messages.value[i - 1]!
      if (prev.role === 'user' && prev.content) {
        history.unshift({ question: prev.content, answer: m.content })
      }
    }
  }

  try {
    await streamShareAiChat(
      wikiId.value,
      q,
      {
        onStage: (stage) => {
          const m = last()
          if (m && m.id === assistantId) m.stage = stage
        },
        onDelta: (text) => {
          const m = last()
          if (m && m.id === assistantId) {
            // 首帧增量到达：撤下阶段指示（此后由正文渲染接管气泡内容）
            if (!m.content) m.stage = undefined
            m.content += text
          }
        },
        onSources: (sources) => {
          const m = last()
          if (m && m.id === assistantId) m.sources = sources
        },
        onError: (message) => {
          const m = last()
          if (m && m.id === assistantId) m.error = message
        },
      },
      abortController.signal,
      history
    )
  } catch (e) {
    const err = e as Error
    // 用户主动停止：保留已生成内容，不按错误处理
    if (err.name !== 'AbortError') {
      const m = last()
      if (m && m.id === assistantId) m.error = err.message || '请求失败，请稍后重试'
    }
  } finally {
    streaming.value = false
    abortController = null
  }
}

/** 停止生成：中断 SSE 请求，已生成的回答保留 */
function stopStreaming() {
  abortController?.abort()
}

/** 输入框提交（chat-body 表单 submit / Enter 触发） */
function onSubmit() {
  void ask(input.value)
}

// ==================== 面板拖拽缩放（边缘拖拽，向左上拖变大） ====================

/** 面板尺寸（px），默认对齐参考设计 380×620 */
const panelWidth = ref(380)
const panelHeight = ref(620)
const MIN_W = 320
const MIN_H = 420
const MAX_W = 640
const MAX_H = 840

/**
 * 拖拽方向模式：
 * - left：拖左缘，只改宽度
 * - top：拖顶缘，只改高度
 * - corner：拖左上角，宽高同时改
 */
type ResizeMode = 'left' | 'top' | 'corner'

/** 当前拖拽方向（null = 未在拖拽；拖拽期间禁用文本选中） */
const resizeMode = ref<ResizeMode | null>(null)

/** 是否正在拖拽缩放 */
const resizing = computed(() => resizeMode.value !== null)

/** 拖拽起点快照（指针按下时的坐标与面板尺寸） */
let resizeStart: { x: number; y: number; w: number; h: number } | null = null

/** 边缘按下：记录起点与方向，并捕获指针（拖出元素/窗口仍持续收到 move 事件） */
function onResizeStart(e: PointerEvent, mode: ResizeMode) {
  e.preventDefault()
  resizeStart = { x: e.clientX, y: e.clientY, w: panelWidth.value, h: panelHeight.value }
  resizeMode.value = mode
  // 合成事件 / 指针已释放等场景捕获会抛 NotFoundError，不影响拖拽主流程，吞掉即可
  try {
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  } catch {}
}

/**
 * 拖拽中：面板锚定右下角，向左/向上拖动 = 变宽/变高（delta 取反），并钳制在最小/最大尺寸内。
 * 按方向只更新对应维度（corner 双向都更新）
 */
function onResizeMove(e: PointerEvent) {
  if (!resizeStart || !resizeMode.value) return
  const dx = resizeStart.x - e.clientX
  const dy = resizeStart.y - e.clientY
  if (resizeMode.value !== 'top')
    panelWidth.value = Math.min(MAX_W, Math.max(MIN_W, resizeStart.w + dx))
  if (resizeMode.value !== 'left')
    panelHeight.value = Math.min(MAX_H, Math.max(MIN_H, resizeStart.h + dy))
}

/** 拖拽结束（松开 / 取消）：清理状态并释放指针捕获 */
function onResizeEnd(e: PointerEvent) {
  resizeStart = null
  resizeMode.value = null
  try {
    ;(e.currentTarget as HTMLElement)?.releasePointerCapture?.(e.pointerId)
  } catch {}
}

// ==================== 窗体关闭与流式请求的生命周期协调 ====================

/**
 * 关闭浮动面板时同步中断进行中的请求（避免后台继续消耗 token）。
 * 注意 Dialog 大窗打开时面板只是隐藏（open 仍为 true），不在此列；
 * Dialog 关闭后回到面板，流式回答继续展示。
 */
watch(open, (isOpen) => {
  if (!isOpen && !expanded.value && streaming.value) stopStreaming()
})
</script>

<template>
  <!-- 仅在有知识库上下文的页面渲染（/w/:wikiId、/b/:wikiId） -->
  <div
    v-if="visible"
    class="fixed right-4 bottom-4 z-50 flex flex-col items-end gap-4 sm:right-6 sm:bottom-6"
  >
    <!-- ============ 对话面板（展开态，FAB 上方；Dialog 打开时隐藏） ============ -->
    <Transition
      enter-active-class="transition duration-200 ease-out origin-bottom-right"
      enter-from-class="opacity-0 scale-90 translate-y-2"
      enter-to-class="opacity-100 scale-100 translate-y-0"
      leave-active-class="transition duration-150 ease-in origin-bottom-right"
      leave-from-class="opacity-100 scale-100 translate-y-0"
      leave-to-class="opacity-0 scale-90 translate-y-2"
    >
      <section
        v-if="open && !expanded"
        role="dialog"
        aria-label="AI 文档助手"
        class="relative flex max-h-[calc(100dvh-7rem)] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-3xl border bg-background shadow-2xl shadow-black/10"
        :class="resizing && 'select-none'"
        :style="{ width: `${panelWidth}px`, height: `${panelHeight}px` }"
      >
        <!-- 边缘拖拽热区：面板锚定右下角，拖左缘调宽 / 拖顶缘调高 / 左上角双向。
             z-10 盖在内容上，指针捕获保证拖出窗口仍生效；hover 淡色提示可拖拽 -->
        <div
          aria-hidden="true"
          class="absolute top-3 bottom-3 left-0 z-10 w-[1px] cursor-ew-resize touch-none transition-colors hover:bg-primary/15"
          @pointerdown="onResizeStart($event, 'left')"
          @pointermove="onResizeMove"
          @pointerup="onResizeEnd"
          @pointercancel="onResizeEnd"
        />
        <div
          aria-hidden="true"
          class="absolute top-0 right-3 left-3 z-10 h-[1px] cursor-ns-resize touch-none transition-colors hover:bg-primary/15"
          @pointerdown="onResizeStart($event, 'top')"
          @pointermove="onResizeMove"
          @pointerup="onResizeEnd"
          @pointercancel="onResizeEnd"
        />
        <div
          aria-hidden="true"
          class="absolute top-0 left-0 z-10 size-1 cursor-nwse-resize touch-none transition-colors hover:bg-primary/15"
          @pointerdown="onResizeStart($event, 'corner')"
          @pointermove="onResizeMove"
          @pointerup="onResizeEnd"
          @pointercancel="onResizeEnd"
        />

        <!-- 右上角：放大为独立 Dialog 窗口（与浮动面板共用对话体与状态） -->
        <button
          type="button"
          aria-label="放大为独立窗口"
          class="absolute top-1.5 right-1.5 z-10 flex size-7 cursor-pointer items-center justify-center rounded-lg text-muted-foreground/50 transition-colors hover:bg-accent/60 hover:text-muted-foreground"
          @click="expanded = true"
        >
          <Maximize2 class="size-3.5" />
        </button>

        <!-- 紧凑头栏（对话态才有）：助手标识 + 在线状态 -->
        <div v-if="messages.length > 0" class="flex items-center gap-2.5 border-b px-4 py-2.5">
          <div class="relative">
            <!-- 品牌图标统一用 LogoMono（黑白 logo 卡），在线状态点挂在卡片右下角 -->
            <LogoMono :size="24" />
            <span
              class="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full bg-emerald-500 ring-2 ring-background"
            />
          </div>
          <div class="min-w-0 leading-tight">
            <p class="text-sm font-semibold">AI 文档助手</p>
            <p class="text-xs text-muted-foreground">基于知识库内容回答</p>
          </div>
        </div>

        <!-- 对话体（欢迎态 / 消息流 / 历史记录 / 输入框，与 Dialog 大窗共用） -->
        <ChatBody
          v-model="input"
          :messages="messages"
          :streaming="streaming"
          :history="chatHistory"
          @ask="ask"
          @submit="onSubmit"
          @stop="stopStreaming"
        />
      </section>
    </Transition>

    <!-- ============ 悬浮按钮（收起 = 唤起；展开 = 关闭），对齐参考图右下角 X ============ -->
    <button
      type="button"
      class="flex size-14 cursor-pointer items-center justify-center rounded-full bg-blue-500 text-white shadow-xl shadow-blue-600/40 transition-transform hover:scale-105 hover:bg-blue-600 active:scale-95"
      :aria-label="open ? '关闭 AI 文档助手' : '打开 AI 文档助手'"
      @click="open = !open"
    >
      <X v-if="open" class="size-6" />

      <MessageCircle v-else class="size-6" />
    </button>

    <!-- ============ Dialog 大窗（面板右上角按钮弹出，居中大尺寸） ============ -->
    <Dialog
      :open="expanded"
      @update:open="
        (v: boolean) => {
          expanded = v
          if (!v) open = true
        }
      "
    >
      <DialogContent
        class="flex h-[min(760px,calc(100dvh-4rem))] w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:w-[720px] sm:max-w-[720px] sm:h-[min(760px,85dvh)]"
      >
        <!-- 头部：标题 + 说明（Dialog 自带右上角 X 关闭） -->
        <DialogHeader class="gap-1 border-b px-5 py-4 text-left">
          <DialogTitle class="flex items-center gap-2 text-base font-semibold">
            <span class="relative">
              <!-- 品牌图标统一用 LogoMono（黑白 logo 卡），在线状态点挂在卡片右下角 -->
              <LogoMono :size="22" />
              <span
                class="absolute -right-0.5 -bottom-0.5 size-2 rounded-full bg-emerald-500 ring-2 ring-background"
              />
            </span>
            AI 文档助手
          </DialogTitle>
          <DialogDescription class="text-sm text-muted-foreground">
            基于知识库内容回答问题，支持引用跳转原文
          </DialogDescription>
        </DialogHeader>

        <!-- 对话体（与浮动面板共用，状态互通） -->
        <ChatBody
          v-model="input"
          :messages="messages"
          :streaming="streaming"
          :history="chatHistory"
          @ask="ask"
          @submit="onSubmit"
          @stop="stopStreaming"
        />
      </DialogContent>
    </Dialog>
  </div>
</template>
