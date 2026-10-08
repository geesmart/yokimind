<script setup lang="ts">
/**
 * 「问问 YOKI AI」对话弹窗（知识库侧边栏搜索框下方的入口条触发）
 *
 * 形态对齐 apps/pages 的 AI 文档助手 Dialog 大窗（shadcn Dialog，720×760 居中）：
 * - 欢迎态：问候语 + 「AI 助手在线」卡片（开始提问 → 聚焦输入框）+ 历史记录卡片
 * - 对话态：MessageScroller 消息流（用户右侧蓝泡 / AI 左侧白泡）+
 *   底部问答输入框（Enter 提问 / 流式中可停止）
 * - 对话可恢复：关闭弹窗或清空对话时消息留存为快照（原常见问题 chips 已移除），
 *   欢迎态输入框上方显示「重新打开对话」按钮，点击恢复上次对话
 *
 * 数据来源：
 * - POST /api/v1/rag/chat（streamRagChat，SSE 流式，需登录鉴权），
 *   与 pages 访客浮窗的 /share/wiki/:wikiId/ai-chat 相比无 stage 事件，
 *   等待首帧增量期间统一展示「思考中…」shimmer
 *
 * 入口行为（在 layout-left/index.vue）：
 * - 仅 owner 可见（访客无登录态，接口会 401）
 * - 知识库未开启 RAG（wiki.ragEnabled 非 true）时点击弹 RAG 提示，不打开本弹窗
 */
import { onUnmounted, ref, useTemplateRef, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { ArrowUp, ChevronRight, Eraser, FileText, MessageSquare, Square } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Message, MessageContent } from '@/components/ui/message'
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from '@/components/ui/message-scroller'
import LogoMono from '@/components/brand-logo/LogoMono.vue'
import { streamRagChat, type RagChatSource, type RagHistoryItem } from '@/api/modules/rag'
import { renderChatMarkdown } from '@/utils/chat-markdown'

// ==================== Props / Emits ====================

const props = defineProps<{
  /** 当前知识库 ID（RAG 检索边界；路由 /wiki/:wikiId 的 wikiId 段） */
  wikiId: string
  /** 弹窗显隐（v-model:open，由入口条控制） */
  open: boolean
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
}>()

// ==================== 对话状态 ====================

/** 对话消息（与后端 rag.service 的 sources 结构对齐） */
interface ChatMessage {
  id: number
  role: 'user' | 'assistant'
  /** 回答文本（SSE delta 顺序拼接；用户消息即原文） */
  content: string
  /** 回答结束后的引用来源（sources 事件推送） */
  sources?: RagChatSource[]
  /** 流内 / 请求异常信息（有值时气泡下方展示错误提示） */
  error?: string
}

// ==================== 提问历史（localStorage 按知识库持久化） ====================

/** 历史记录最大保留条数（最新优先，超出截断） */
const MAX_HISTORY = 10

/** 历史记录 localStorage 键（按知识库隔离，避免多库之间串记录） */
function historyKey(wikiId: string) {
  return `yoki-ai:history:${wikiId}`
}

/**
 * 当前知识库的提问历史（最新在前，欢迎态「历史记录」卡片数据源）
 * 仅为本地便捷入口（点击再次提问），与对话消息互不相干
 */
const history = ref<string[]>([])

/** 读取指定知识库的提问历史（脏数据 / JSON 损坏时容错为空列表） */
function loadHistory(wikiId: string): string[] {
  try {
    const raw = localStorage.getItem(historyKey(wikiId))
    const list: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

/** 历史落盘（隐私模式 / 配额满等存储异常静默降级，不影响问答主流程） */
function saveHistory(wikiId: string, list: string[]) {
  try {
    localStorage.setItem(historyKey(wikiId), JSON.stringify(list))
  } catch {
    /* 忽略存储异常 */
  }
}

/** 记录一次提问：去重后置顶，超出上限截断并立即落盘 */
function recordHistory(question: string) {
  const list = [question, ...history.value.filter((q) => q !== question)].slice(0, MAX_HISTORY)
  history.value = list
  saveHistory(props.wikiId, list)
}

/** 消息自增 ID（用作 MessageScrollerItem 的 messageId 与 v-for key） */
let nextMessageId = 1

/** 对话消息列表（每轮问答追加 user + assistant 两条；切换知识库清空防串库） */
const messages = ref<ChatMessage[]>([])

/**
 * 上次对话的消息快照（关闭弹窗 / 清空对话时留存）
 * 供欢迎态输入框上方「重新打开对话」按钮一键恢复；切换知识库时丢弃，避免跨库恢复串库
 */
const lastConversation = ref<ChatMessage[]>([])

/** 重新打开对话：用快照恢复消息列表回到对话态（快照转移，按钮随之隐藏） */
function restoreConversation() {
  if (lastConversation.value.length === 0) return
  messages.value = lastConversation.value
  lastConversation.value = []
}

/** 输入框内容（受控） */
const input = ref('')

/** 是否正在流式接收回答（期间禁用输入，发送按钮变停止按钮） */
const streaming = ref(false)

/** 进行中请求的中断控制器（停止生成 / 关闭弹窗中断用） */
let abortController: AbortController | null = null

// 切换知识库时清空对话历史与输入，避免上下文串库；进行中的请求一并中断；
// 上次对话快照一并丢弃（快照属于旧知识库，恢复会串库）；
// 同时重新加载新知识库的提问历史（immediate 保证组件首次挂载也加载一次）
watch(
  () => props.wikiId,
  () => {
    stopStreaming()
    messages.value = []
    lastConversation.value = []
    input.value = ''
    history.value = loadHistory(props.wikiId)
  },
  { immediate: true }
)

// 弹窗关闭时中断进行中的流式请求（避免后台继续消耗 token）；
// 对话收起为快照：下次打开回到欢迎态，可经「重新打开对话」一键恢复上次对话
watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) return
    if (streaming.value) stopStreaming()
    if (messages.value.length > 0) {
      lastConversation.value = messages.value
      messages.value = []
    }
  }
)

// ==================== 问答流程 ====================

/**
 * 发起提问（历史记录 / 常见问题 chips 点击与输入框提交共用入口）
 *
 * 流程：追加 user 消息 + 空的 assistant 占位消息 → SSE 流式接收 delta
 * 逐段拼进占位消息 → sources 事件挂引用来源 → done 结束。
 * 流前业务异常（AI 未配置 80001 / 无权限等）抛 ApiError；
 * 流内异常走 onError 回调 —— 两者都落到 assistant 消息的 error 字段展示。
 */
async function ask(question: string) {
  const q = question.trim()
  if (!q || streaming.value || !props.wikiId) return

  input.value = ''
  messages.value.push({ id: nextMessageId++, role: 'user', content: q })
  // 写入提问历史（去重置顶 + 落盘），供欢迎态「历史记录」卡片展示与再次提问
  recordHistory(q)
  // assistant 占位消息：content 为空且无 error 时展示「思考中…」动画
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
    await streamRagChat(
      props.wikiId,
      q,
      {
        onDelta: (text) => {
          const m = last()
          if (m && m.id === assistantId) m.content += text
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

/**
 * 清空对话：中断进行中的流式请求并清空全部消息与输入，回到欢迎态
 *
 * 细节说明：
 * - 流式中点击允许：先 abort 再清消息，ask() 的 catch 对 AbortError 静默、
 *   finally 兜底复位 streaming，不会残留半截状态
 * - onDelta/onSources/onError 回调均以 assistantId 匹配占位消息，
 *   消息被清后匹配落空自然变 no-op，无需额外防御
 * - 清空前的消息留存为快照：清空后可经输入框上方「重新打开对话」一键找回
 */
function clearChat() {
  stopStreaming()
  if (messages.value.length > 0) {
    lastConversation.value = messages.value
  }
  messages.value = []
  input.value = ''
}

/** 输入框提交（表单 submit / Enter 触发） */
function onSubmit() {
  void ask(input.value)
}

// ==================== 输入框聚焦（"开始提问"入口） ====================

/** 输入框组件 ref（Input 根元素即原生 input，$el 可聚焦） */
const inputRef = useTemplateRef<{ $el?: HTMLInputElement }>('inputRef')

/** 聚焦输入框（欢迎态"开始提问"点击后调用） */
function focusInput() {
  inputRef.value?.$el?.focus()
}

// ==================== 回答正文 Markdown 渲染（tiptap 管线，见 utils/chat-markdown.ts） ====================

/**
 * 已完成消息的渲染缓存（key = 消息全文）：
 * 组件任一响应式变化都会整体重渲，缓存避免对历史消息重复 parse + render
 * （流式中的消息走下方节流路径，不进缓存，避免每个 delta 污染缓存键）
 */
const htmlCache = new Map<string, string>()

/** 渲染消息正文为 HTML（带缓存；解析异常由 renderChatMarkdown 内部降级为转义纯文本） */
function renderedHtml(content: string): string {
  const hit = htmlCache.get(content)
  if (hit !== undefined) return hit
  const html = renderChatMarkdown(content)
  htmlCache.set(content, html)
  // 防膨胀兜底：超过 200 条整体清空（对话场景实际远达不到）
  if (htmlCache.size > 200) htmlCache.clear()
  return html
}

// ---- 流式中的最后一条回答：200ms 节流渲染（leading + trailing） ----

/** 节流间隔（ms）：delta 到达频率远高于人眼可感知的刷新收益，限频执行全量 parse + render */
const STREAM_RENDER_INTERVAL = 200

/** 流式消息的节流渲染产物（流式结束后模板切回 renderedHtml 直渲路径） */
const streamedHtml = ref('')

/** 待触发的 trailing 渲染定时器 */
let renderTimer: ReturnType<typeof setTimeout> | null = null

/** 上次实际渲染时刻（leading 判定用；0 = 尚未渲染过，首个 delta 立即渲染） */
let lastRenderAt = 0

/** 组件卸载时清理定时器与进行中的请求 */
onUnmounted(() => {
  if (renderTimer) clearTimeout(renderTimer)
  stopStreaming()
})

/** 当前最后一条消息若为 assistant 则取其正文，否则返回空串 */
function lastAssistantContent(): string {
  const m = messages.value[messages.value.length - 1]
  return m?.role === 'assistant' ? m.content : ''
}

/**
 * 流式节流渲染：距上次渲染超过间隔立即渲染（leading，首帧不延迟）；
 * 间隔内持续到达则只安排一次尾部补渲染（trailing），保证停更后内容最终完整
 */
function scheduleStreamRender() {
  const elapsed = Date.now() - lastRenderAt
  if (elapsed >= STREAM_RENDER_INTERVAL) {
    lastRenderAt = Date.now()
    streamedHtml.value = renderChatMarkdown(lastAssistantContent())
  } else if (!renderTimer) {
    renderTimer = setTimeout(() => {
      renderTimer = null
      lastRenderAt = Date.now()
      streamedHtml.value = renderChatMarkdown(lastAssistantContent())
    }, STREAM_RENDER_INTERVAL - elapsed)
  }
}

// 仅监听「流式中的最后一条 assistant 消息」的正文变化；
// 返回 null 表示当前不在流式态（或最后一条不是 assistant），模板走 renderedHtml 直渲路径
watch(
  () => {
    const m = messages.value[messages.value.length - 1]
    return streaming.value && m?.role === 'assistant' ? m.content : null
  },
  (content) => {
    // 源值变化即作废待触发的 trailing 任务（触发时重新调度，内容以最新为准）
    if (renderTimer) {
      clearTimeout(renderTimer)
      renderTimer = null
    }
    if (content === null) return
    if (!content) {
      // 新一轮回答占位（content 尚空）：清空上一轮的节流产物
      streamedHtml.value = ''
      return
    }
    scheduleStreamRender()
  }
)

/** 引用来源跳转链接：nodeId 存在时跳 web 端文档路由 /wiki/{wikiId}/{nodeId} */
function sourceUrl(s: RagChatSource): string | null {
  return s.nodeId ? `/wiki/${props.wikiId}/${s.nodeId}` : null
}
</script>

<template>
  <Dialog :open="open" @update:open="(v: boolean) => emit('update:open', v)">
    <DialogContent
      class="flex h-[min(760px,calc(100dvh-4rem))] w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:w-[720px] sm:max-w-[720px] sm:h-[min(760px,85dvh)]"
    >
      <!-- 头部：助手标识 + 标题 + 说明（Dialog 自带右上角 X 关闭）
           标题行用 flex 两端布局挂「清空对话」按钮，pr-8 为右上角自带的 X 让位避免重叠 -->
      <DialogHeader class="gap-1 border-b px-5 py-4 text-left">
        <div class="flex items-center justify-between gap-2 pr-8">
          <DialogTitle class="flex items-center gap-2 text-base font-semibold">
            <span class="relative">
              <!-- 品牌图标统一用 LogoMono（黑白 logo 卡），在线状态点挂在卡片右下角 -->
              <LogoMono :size="22" />
              <span
                class="absolute -right-0.5 -bottom-0.5 size-2 rounded-full bg-emerald-500 ring-2 ring-background"
              />
            </span>
            问问 YOKI AI
          </DialogTitle>

          <!-- 清空对话：仅对话态展示（欢迎态无内容可清）；流式中点击同样允许，
               内部会先中断请求再清空，回到欢迎态 -->
          <Button
            v-if="messages.length > 0"
            variant="ghost"
            size="icon-sm"
            class="text-muted-foreground hover:text-foreground"
            aria-label="清空对话"
            title="清空对话"
            @click="clearChat"
          >
            <Eraser class="size-4" />
          </Button>
        </div>
        <DialogDescription class="text-sm text-muted-foreground">
          基于知识库内容回答问题，支持引用跳转原文
        </DialogDescription>
      </DialogHeader>

      <!-- 对话体：欢迎态（问候 + 历史记录）/ 消息流 + 常见问题 chips / 输入框 -->
      <div class="flex min-h-0 flex-1 flex-col">
        <!-- ============ 欢迎态（无对话消息） ============ -->
        <div v-if="messages.length === 0" class="flex-1 space-y-4 overflow-y-auto p-5">
          <!-- 问候语 + 说明 -->
          <div class="pt-4">
            <h2 class="text-2xl font-bold tracking-tight">Hi，我是 AI 助手 👋</h2>
            <p class="mt-2 text-base leading-7 text-muted-foreground">
              基于当前知识库的文档内容回答问题，欢迎随时提问。
            </p>
          </div>

          <!-- 在线状态卡片 -->
          <div class="rounded-2xl border p-4">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <p class="font-semibold">AI 助手在线</p>
                <p class="mt-0.5 text-sm text-muted-foreground">通常立即回复</p>
              </div>
              <LogoMono :size="26" />
            </div>
            <button
              type="button"
              class="mt-2 inline-flex cursor-pointer items-center gap-0.5 font-medium text-blue-600 hover:underline dark:text-blue-400"
              @click="focusInput"
            >
              开始提问
              <ChevronRight class="size-4" />
            </button>
          </div>

          <!-- 历史记录卡片（localStorage 按库持久化的提问历史，点击再次提问；暂无历史时隐藏整卡） -->
          <div v-if="history.length > 0" class="rounded-2xl border p-4">
            <p class="mb-2 text-sm font-medium text-muted-foreground">历史记录</p>
            <div class="flex flex-col items-stretch gap-1">
              <button
                v-for="q in history"
                :key="q"
                type="button"
                class="cursor-pointer rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
                @click="ask(q)"
              >
                {{ q }}
              </button>
            </div>
          </div>
        </div>

        <!-- ============ 对话态（有消息）：消息流 + 常见问题 chips ============ -->
        <template v-else>
          <!-- 消息流（MessageScroller 自动跟随底部，流式增量时持续滚动） -->
          <MessageScrollerProvider :auto-scroll="true">
            <MessageScroller class="min-h-0 flex-1">
              <MessageScrollerViewport class="bg-muted/30">
                <MessageScrollerContent class="gap-5 p-4">
                  <MessageScrollerItem
                    v-for="m in messages"
                    :key="m.id"
                    :message-id="String(m.id)"
                    :scroll-anchor="m === messages[messages.length - 1]"
                  >
                    <Message :align="m.role === 'user' ? 'end' : 'start'">
                      <MessageContent>
                        <!-- 用户消息：右侧蓝色气泡 -->
                        <div
                          v-if="m.role === 'user'"
                          class="max-w-[90%] self-end rounded-2xl bg-blue-500 px-3.5 py-2 leading-6 whitespace-pre-wrap text-white"
                        >
                          {{ m.content }}
                        </div>

                        <!-- AI 回答：左侧气泡（等待首帧时展示思考中动画） -->
                        <div
                          v-else
                          class="max-w-[90%] self-start rounded-2xl bg-background px-3.5 py-2 border"
                        >
                          <!-- 等待首帧增量的 shimmer 文案（web /rag/chat 无 stage 事件，固定文案） -->
                          <div v-if="!m.content && !m.error" class="py-1">
                            <span class="stage-shimmer text-sm">思考中…</span>
                          </div>

                          <!-- 回答正文：tiptap 管线渲染 markdown（粗体/列表/表格/代码块等，
                               见 utils/chat-markdown.ts），[n] 引用标注渲染为蓝色上标 sup；
                               流式中的最后一条用节流产物 streamedHtml，其余走带缓存直渲 -->
                          <template v-if="m.content">
                            <div
                              class="ai-md min-w-0 text-sm leading-6"
                              :class="{
                                'is-streaming': streaming && m === messages[messages.length - 1],
                              }"
                              v-html="
                                streaming && m === messages[messages.length - 1]
                                  ? streamedHtml
                                  : renderedHtml(m.content)
                              "
                            />

                            <!-- 引用来源卡片（sources 事件推送，可跳转原文档） -->
                            <div v-if="m.sources?.length" class="mt-2 flex flex-wrap gap-1.5">
                              <!-- nodeId 存在：跳转 web 文档路由；否则渲染不可点击 chip -->
                              <template v-for="s in m.sources" :key="s.chunkId">
                                <RouterLink
                                  v-if="sourceUrl(s)"
                                  :to="sourceUrl(s)!"
                                  class="inline-flex max-w-full cursor-pointer items-center gap-1 rounded-full border bg-muted/50 px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                                  :title="s.headingPath || s.title || '来源文档'"
                                >
                                  <FileText class="size-3 shrink-0" />
                                  <span class="truncate">{{
                                    s.headingPath || s.title || '来源文档'
                                  }}</span>
                                </RouterLink>
                                <span
                                  v-else
                                  class="inline-flex max-w-full items-center gap-1 rounded-full border bg-muted/50 px-2 py-0.5 text-xs text-muted-foreground"
                                  :title="s.headingPath || s.title || '来源文档'"
                                >
                                  <FileText class="size-3 shrink-0" />
                                  <span class="truncate">{{
                                    s.headingPath || s.title || '来源文档'
                                  }}</span>
                                </span>
                              </template>
                            </div>
                          </template>

                          <!-- 错误提示（流内 error 事件 / 请求异常） -->
                          <p v-if="m.error" class="mt-1 text-sm text-destructive">
                            {{ m.error }}
                          </p>
                        </div>
                      </MessageContent>
                    </Message>
                  </MessageScrollerItem>
                </MessageScrollerContent>
              </MessageScrollerViewport>

              <!-- 回到底部悬浮按钮（向上翻阅历史时出现） -->
              <MessageScrollerButton />
            </MessageScroller>
          </MessageScrollerProvider>
        </template>

        <!-- 重新打开对话：欢迎态且存在上次收起 / 清空前的对话快照时显示，
             点击恢复快照回到对话态（位置即原常见问题 chips 区域，输入框上方） -->
        <div
          v-if="messages.length === 0 && lastConversation.length > 0"
          class="flex justify-center px-3 pt-2.5"
        >
          <Button
            variant="outline"
            size="sm"
            class="cursor-pointer rounded-full px-4"
            aria-label="重新打开对话"
            @click="restoreConversation"
          >
            <MessageSquare class="size-3.5" />
            重新打开对话
          </Button>
        </div>

        <!-- ============ 底部问答输入框（两种状态共用） ============ -->
        <form class="flex items-center gap-2 p-3" @submit.prevent="onSubmit">
          <Input
            ref="inputRef"
            v-model="input"
            :disabled="streaming"
            placeholder="输入你的问题…"
            class="h-10 flex-1 rounded-lg bg-muted/50 px-4"
            aria-label="输入你的问题"
          />
          <!-- 发送按钮（流式中切换为停止按钮） -->
          <Button
            v-if="!streaming"
            type="submit"
            size="icon"
            :disabled="!input.trim()"
            class="size-10 shrink-0 cursor-pointer rounded-full bg-blue-600 text-white shadow-lg shadow-blue-600/30 hover:bg-blue-700 disabled:opacity-40"
            aria-label="发送问题"
          >
            <ArrowUp class="size-5" />
          </Button>
          <Button
            v-else
            type="button"
            size="icon"
            class="size-10 shrink-0 cursor-pointer rounded-full bg-blue-600 text-white shadow-lg shadow-blue-600/30 hover:bg-blue-700"
            aria-label="停止生成"
            @click="stopStreaming"
          >
            <Square class="size-3.5 fill-current" />
          </Button>
        </form>
      </div>
    </DialogContent>
  </Dialog>
</template>

<style scoped>
/* ============================================================
 * 回答正文 markdown 排版（.ai-md 容器）
 * v-html 注入的 DOM 不带 scoped 属性，一律用 :deep 穿透；
 * 色彩全部走语义 token（自动适配暗色），蓝色强调用调色板变量 + .dark 覆盖
 * ============================================================ */

/* 思考中文案 shimmer 动效：高光渐变周期性扫过文字（语义 token 自动适配暗色）；
 * background-clip: text + text-fill-color 透明，底色由渐变的 muted 段承担 */
.stage-shimmer {
  background: linear-gradient(
    90deg,
    var(--muted-foreground) 40%,
    var(--foreground) 50%,
    var(--muted-foreground) 60%
  );
  background-size: 200% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  -webkit-text-fill-color: transparent;
  animation: stage-shimmer 1.6s linear infinite;
}
@keyframes stage-shimmer {
  from { background-position: 200% 0; }
  to { background-position: -200% 0; }
}
@media (prefers-reduced-motion: reduce) {
  .stage-shimmer { animation: none; }
}

/* 垂直节奏：首尾元素贴气泡内边距，块与块之间统一 0.5em */
.ai-md :deep(> :first-child) { margin-top: 0; }
.ai-md :deep(> :last-child) { margin-bottom: 0; }
.ai-md :deep(p) { margin: 0; }
.ai-md :deep(p + p),
.ai-md :deep(p + ul),
.ai-md :deep(p + ol),
.ai-md :deep(p + pre),
.ai-md :deep(p + blockquote),
.ai-md :deep(p + table),
.ai-md :deep(p + hr) { margin-top: 0.5em; }

/* 标题：气泡内压缩字号（正文是 text-sm，标题最大 1.125em ≈ 15.75px） */
.ai-md :deep(h1),
.ai-md :deep(h2),
.ai-md :deep(h3),
.ai-md :deep(h4),
.ai-md :deep(h5),
.ai-md :deep(h6) {
  margin: 0.75em 0 0.25em;
  font-weight: 600;
  line-height: 1.4;
}
.ai-md :deep(h1) { font-size: 1.125em; }
.ai-md :deep(h2) { font-size: 1.0625em; }
.ai-md :deep(h3),
.ai-md :deep(h4),
.ai-md :deep(h5),
.ai-md :deep(h6) { font-size: 1em; }

/* 列表：紧凑行距，嵌套段落不额外撑高 */
.ai-md :deep(ul),
.ai-md :deep(ol) {
  margin: 0.25em 0;
  padding-left: 1.25em;
}
.ai-md :deep(li) { margin: 0.125em 0; }
.ai-md :deep(li > p) { margin: 0; }

/* 行内代码 / 代码块 */
.ai-md :deep(code) {
  padding: 0.1em 0.35em;
  border-radius: 0.25rem;
  background: var(--muted);
  font-size: 0.875em;
}
.ai-md :deep(pre) {
  margin: 0.5em 0;
  padding: 0.625em 0.75em;
  overflow-x: auto;
  border-radius: 0.5rem;
  background: var(--muted);
}
.ai-md :deep(pre code) {
  padding: 0;
  background: transparent;
  font-size: 0.8125em;
}

/* 引用块 */
.ai-md :deep(blockquote) {
  margin: 0.5em 0;
  padding-left: 0.75em;
  border-left: 3px solid var(--border);
  color: var(--muted-foreground);
}

/* 表格（GFM）：窄面板内横向滚动，不撑破气泡 */
.ai-md :deep(table) {
  display: block;
  max-width: 100%;
  margin: 0.5em 0;
  overflow-x: auto;
  border-collapse: collapse;
  font-size: 0.875em;
}
.ai-md :deep(th),
.ai-md :deep(td) {
  padding: 0.25em 0.625em;
  border: 1px solid var(--border);
  text-align: left;
}
.ai-md :deep(th) {
  background: var(--muted);
  font-weight: 600;
}

/* 分割线 */
.ai-md :deep(hr) {
  margin: 0.75em 0;
  border: 0;
  border-top: 1px solid var(--border);
}

/* 链接与 [n] 引用角标（Citation mark 渲染的 sup[data-citation]）：蓝色强调，暗色提亮 */
.ai-md :deep(a) {
  color: var(--color-blue-600);
  text-underline-offset: 2px;
}
.ai-md :deep(a:hover) { text-decoration: underline; }
.ai-md :deep(sup[data-citation]) {
  color: var(--color-blue-600);
  font-weight: 500;
}
:global(.dark) .ai-md :deep(a),
:global(.dark) .ai-md :deep(sup[data-citation]) { color: var(--color-blue-400); }

/* 流式接收光标：最后一个块级元素尾部闪烁竖条（替代旧的内联 ▍ span） */
.ai-md.is-streaming :deep(> :last-child)::after {
  content: '▍';
  display: inline-block;
  margin-left: 1px;
  color: var(--color-blue-600);
  animation: ai-md-cursor 1s steps(2, start) infinite;
}
@keyframes ai-md-cursor {
  to { visibility: hidden; }
}
</style>
