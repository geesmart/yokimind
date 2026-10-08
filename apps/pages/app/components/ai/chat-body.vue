<script lang="ts">
/**
 * AI 对话体（欢迎态 + 消息流 + 历史记录 + 底部输入框）
 *
 * 被 ai-assistant.vue 的两种窗体复用（状态由父组件持有，本组件只做展示与交互转发）：
 * - 右下角浮动面板（可拖拽缩放）
 * - 右上角「放大为独立窗口」弹出的 shadcn Dialog
 *
 * 使用 shadcn-vue 的 Message / MessageScroller 组件渲染消息流：
 * - MessageScrollerProvider auto-scroll 引擎负责流式增量时的自动跟随底部
 * - MessageScrollerButton 在向上翻阅历史时提供"回到底部"悬浮按钮
 */
import type { ChatStage } from '~/api/ai-chat'
import { ArrowUp, ChevronRight, FileText, Square } from '@lucide/vue'
import LogoMono from '~/components/brand/LogoMono.vue'
import { CHAT_STAGE_LABELS } from '~/api/ai-chat'
import { renderChatMarkdown } from './chat-markdown'

/** 对话消息（与后端 rag.service 的 sources 结构对齐） */
export interface ChatMessage {
  id: number
  role: 'user' | 'assistant'
  /** 回答文本（SSE delta 顺序拼接；用户消息即原文） */
  content: string
  /** 问答阶段（stage 事件推送；content 为空时气泡内展示对应阶段文案） */
  stage?: ChatStage
  /** 回答结束后的引用来源（sources 事件推送） */
  sources?: RagChatSource[]
  /** 流内 / 请求异常信息（有值时气泡下方展示错误提示） */
  error?: string
}

/** 引用来源（api/ai-chat.ts 的 RagChatSource，此处结构化复用避免循环依赖） */
interface RagChatSource {
  chunkId: string
  documentId: string
  nodeId: string | null
  title: string | null
  headingPath: string | null
  score: number
  url: string | null
}

export default {}
</script>

<script setup lang="ts">
// ==================== Props / Emits ====================

/** 对话消息列表（状态在父组件，流式增量直接改父组件数据） */
const props = defineProps<{
  messages: ChatMessage[]
  /** 是否正在流式接收回答（期间禁用输入与历史记录重新提问，发送按钮变停止按钮） */
  streaming: boolean
  /**
   * 提问历史记录（localStorage 持久化，按 wikiId 隔离，最新在前；
   * 状态在父组件 ai-assistant.vue 持有，欢迎态卡片与对话态 chips 共用）
   */
  history: string[]
}>()

const emit = defineEmits<{
  /** 点击历史记录直接重新提问（q 为历史问题文本） */
  ask: [q: string]
  /** 输入框提交（表单 submit / Enter） */
  submit: []
  /** 停止生成（中断 SSE 请求） */
  stop: []
}>()

/** 输入框内容（v-model 双向绑定到父组件） */
const input = defineModel<string>({ required: true })

// ==================== 输入框聚焦（"开始提问"入口） ====================

/** 输入框组件 ref（shadcn Input 根元素即原生 input，$el 可聚焦） */
const inputRef = useTemplateRef<{ $el?: HTMLInputElement }>('inputRef')

/** 聚焦输入框（欢迎态"开始提问"点击后调用） */
function focusInput() {
  inputRef.value?.$el?.focus()
}

defineExpose({ focusInput })

// ==================== 回答正文 Markdown 渲染（tiptap 管线，见 chat-markdown.ts） ====================

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

/** 组件卸载时清理定时器（面板/Dialog 共用本组件，切换时防泄漏） */
onUnmounted(() => {
  if (renderTimer) clearTimeout(renderTimer)
})

/** 当前最后一条消息若为 assistant 则取其正文，否则返回空串 */
function lastAssistantContent(): string {
  const m = props.messages[props.messages.length - 1]
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
    const m = props.messages[props.messages.length - 1]
    return props.streaming && m?.role === 'assistant' ? m.content : null
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
  },
  { immediate: true }
)
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <!-- ============ 欢迎态（无对话消息）：对齐参考设计的问候布局 ============ -->
    <div v-if="messages.length === 0" class="flex-1 space-y-4 overflow-y-auto p-5">
      <!-- 品牌徽标：统一用 LogoMono（黑白 logo 卡），卡片总宽 ≈ size×1.4，34 ≈ 原 size-12 圆标 -->
      <!--      <LogoMono :size="34" />-->

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
          <!-- 品牌图标：统一用 LogoMono（黑白 logo 卡），卡片总宽 ≈ size×1.4，26 ≈ 原 size-9 圆标 -->
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

      <!-- 提问历史记录卡片（localStorage 持久化，点击重新提问；暂无历史时整卡隐藏） -->
      <div v-if="history.length > 0" class="rounded-2xl border p-4">
        <p class="mb-2 text-sm font-medium text-muted-foreground">历史记录</p>
        <div class="flex flex-col items-stretch gap-1">
          <button
            v-for="q in history"
            :key="q"
            type="button"
            class="cursor-pointer rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
            :title="q"
            @click="emit('ask', q)"
          >
            <span class="block truncate">{{ q }}</span>
          </button>
        </div>
      </div>
    </div>

    <!-- ============ 对话态（有消息）：消息流 + 历史记录 chips ============ -->
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
                  <!-- AI 头像（用户消息不带头像，靠右对齐） -->
                  <!--                  <MessageAvatar-->
                  <!--                    v-if="m.role === 'assistant'"-->
                  <!--                    class="size-7 bg-blue-600 text-white"-->
                  <!--                  >-->
                  <!--                    <Bot class="size-3.5" />-->
                  <!--                  </MessageAvatar>-->
                  <MessageContent>
                    <!-- 用户消息：右侧蓝色气泡 -->
                    <div
                      v-if="m.role === 'user'"
                      class="max-w-[90%] self-end rounded-2xl bg-blue-500 px-3.5 py-2 leading-6 whitespace-pre-wrap text-white"
                    >
                      {{ m.content }}
                    </div>

                    <!-- AI 回答：左侧气泡（等待首帧时展示输入中动画） -->
                    <div
                      v-else
                      class="max-w-[90%] self-start rounded-2xl bg-background px-3.5 py-2 border"
                    >
                      <!-- 阶段指示（等待首帧增量）：shimmer 文案
                           （thinking → searching → reranking → generating，随 stage 事件推进；
                            无 stage 值回落 thinking，兼容旧后端） -->
                      <div v-if="!m.content && !m.error" class="py-1">
                        <span class="stage-shimmer text-sm">
                          {{ CHAT_STAGE_LABELS[m.stage ?? 'thinking'] }}
                        </span>
                      </div>

                      <!-- 回答正文：tiptap 管线渲染 markdown（粗体/列表/表格/代码块等，
                           见 chat-markdown.ts），[n] 引用标注渲染为蓝色上标 sup；
                           流式中的最后一条用节流产物 streamedHtml，其余走带缓存直渲 -->
                      <template v-if="m.content">
                        <div
                          class="ai-md min-w-0 text-sm leading-6"
                          :class="{ 'is-streaming': streaming && m === messages[messages.length - 1] }"
                          v-html="
                            streaming && m === messages[messages.length - 1]
                              ? streamedHtml
                              : renderedHtml(m.content)
                          "
                        />

                        <!-- 引用来源卡片（sources 事件推送，可跳转原文） -->
                        <div v-if="m.sources?.length" class="mt-2 flex flex-wrap gap-1.5">
                          <NuxtLink
                            v-for="s in m.sources"
                            :key="s.chunkId"
                            :to="s.url ?? undefined"
                            class="inline-flex max-w-full cursor-pointer items-center gap-1 rounded-full border bg-muted/50 px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                            :title="s.headingPath || s.title || '来源文档'"
                          >
                            <FileText class="size-3 shrink-0" />
                            <span class="truncate">{{
                              s.headingPath || s.title || '来源文档'
                            }}</span>
                          </NuxtLink>
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

      <!-- 提问历史快捷入口（横向滚动 chips，点击重新提问；暂无历史时不渲染） -->
      <div
        v-if="history.length > 0"
        class="flex gap-1.5 overflow-x-auto px-3 pt-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <button
          v-for="q in history"
          :key="q"
          type="button"
          :disabled="streaming"
          class="shrink-0 cursor-pointer rounded-full border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
          @click="emit('ask', q)"
        >
          {{ q }}
        </button>
      </div>
    </template>

    <!-- ============ 底部问答输入框（两种状态共用） ============ -->
    <form class="flex items-center gap-2 p-3" @submit.prevent="emit('submit')">
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
        @click="emit('stop')"
      >
        <Square class="size-3.5 fill-current" />
      </Button>
    </form>
  </div>
</template>

<style scoped>
/* ============================================================
 * 回答正文 markdown 排版（.ai-md 容器）
 * v-html 注入的 DOM 不带 scoped 属性，一律用 :deep 穿透；
 * 色彩全部走语义 token（自动适配暗色），蓝色强调用调色板变量 + .dark 覆盖
 * ============================================================ */

/* 阶段文案 shimmer 动效：高光渐变周期性扫过文字（语义 token 自动适配暗色）；
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
