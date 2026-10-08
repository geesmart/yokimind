<script setup lang="ts">
/**
 * RAG 全流程测试页（开发调试用，路由 /rag-test）
 *
 * 在一个页面内闭环验证 RAG 索引链路（BullMQ / Redis 队列）：
 * 1. 准备：一键创建测试知识库与文档（保存即触发入队索引）
 * 2. 状态：轮询 /rag/status，观察 pending → done 的队列消费过程
 * 3. 编辑：修改文档内容保存 → 重新入队索引（内容指纹比对，无变化则跳过向量化）
 * 4. 检索：语义搜索，命中切片返回得分与标题路径
 * 5. 问答：AI 问答 SSE 流式输出 + 引用来源
 * 6. 重建：全量重置 pending 并重新消费
 *
 * 降级观察点：AI_EMBEDDING_API_KEY 未配置时，任务保持 pending（Redis 中 delayed
 * 循环），检索/问答返回 80001 RAG_NOT_CONFIGURED —— 本页直接展示错误信息，
 * 便于验证降级行为。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import { Database, FileText, LoaderCircle, LogIn, MessageCircleQuestion, RefreshCw, Save, Search, Sparkles } from '@lucide/vue'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

import { isLoggedIn } from '@/utils/token'
import {
  createWiki,
  createWikiNode,
  getDocument,
  listWikiNodes,
  listWikis,
  saveDocument,
  type WikiItem,
  type WikiNodeItem,
} from '@/api/modules/wiki'
import {
  getRagStatus,
  reindexRag,
  searchRag,
  streamRagChat,
  type RagChatSource,
  type RagHistoryItem,
  type RagSearchResult,
  type RagStatus,
} from '@/api/modules/rag'

const router = useRouter()

// ==================== 登录态 ====================

/** 测试页不设路由守卫，页面内检测登录态（RAG 接口均需 token） */
const loggedIn = ref(isLoggedIn())

// ==================== 知识库与文档 ====================

const wikis = ref<WikiItem[]>([])
const nodes = ref<WikiNodeItem[]>([])
const selectedWikiId = ref('')
const selectedNodeId = ref('')

/** 当前选中文档的文档 ID（索引/保存的目标） */
const currentDocumentId = computed(() => nodes.value.find((n) => n.id === selectedNodeId.value)?.documentId ?? '')

/** 加载知识库列表（首个自动选中） */
async function loadWikis() {
  try {
    wikis.value = await listWikis().send()
    if (wikis.value.length > 0 && !selectedWikiId.value) {
      selectedWikiId.value = wikis.value[0].id
    }
  } catch (e) {
    toast.error((e as Error).message)
  }
}

/** 加载选中知识库的文档节点列表 */
async function loadNodes() {
  if (!selectedWikiId.value) return
  try {
    nodes.value = await listWikiNodes(selectedWikiId.value).send()
    // 当前选中节点不在列表中（切换知识库）时自动选首个
    if (nodes.value.length > 0 && !nodes.value.some((n) => n.id === selectedNodeId.value)) {
      selectedNodeId.value = nodes.value[0].id
    } else if (nodes.value.length === 0) {
      selectedNodeId.value = ''
    }
  } catch (e) {
    toast.error((e as Error).message)
  }
}

watch(selectedWikiId, () => {
  draft.value = ''
  void loadNodes()
})

// ==================== 索引状态（轮询） ====================

const status = ref<RagStatus | null>(null)
const statusLoading = ref(false)

/** 拉取索引状态统计 */
async function loadStatus() {
  if (!selectedWikiId.value || statusLoading.value) return
  statusLoading.value = true
  try {
    status.value = await getRagStatus(selectedWikiId.value).send()
  } catch (e) {
    // 状态轮询失败静默（如切库瞬间 401），不打断操作
    console.warn('[rag-test] status failed:', (e as Error).message)
  } finally {
    statusLoading.value = false
  }
}

/**
 * 定时轮询（2s）：仅在仍有待处理任务（pending > 0）时真正请求，
 * 队列空闲（done 状态）时跳过请求，减少无效轮询
 */
let pollTimer: number | null = null
onMounted(() => {
  if (loggedIn.value) void loadWikis()
  pollTimer = window.setInterval(() => {
    // 未加载过状态 或 仍有 pending 时拉取（切库/保存后自动进入轮询窗口）
    if (!status.value || status.value.pending > 0) void loadStatus()
  }, 2000)
})
onBeforeUnmount(() => {
  if (pollTimer) window.clearInterval(pollTimer)
  abortChat()
})

// 选中知识库变化：立即拉一次状态，并清空问答历史（历史按知识库隔离，防跨库上下文串扰）
watch(selectedWikiId, () => {
  status.value = null
  chatHistory.value = []
  void loadStatus()
})

/** 重新索引（全量重置 pending + 重新入队 BullMQ） */
const reindexing = ref(false)
async function doReindex() {
  if (!selectedWikiId.value) return
  reindexing.value = true
  try {
    const result = await reindexRag(selectedWikiId.value).send()
    toast.success(`已重置 ${result.marked} 个任务，队列重新消费中`)
    await loadStatus()
  } catch (e) {
    toast.error((e as Error).message)
  } finally {
    reindexing.value = false
  }
}

// ==================== 测试数据准备 ====================

/** 预置测试内容：# / ## 前缀的行保存时转 heading，便于检索命中标题路径 */
const PRESET_TEXT = [
  '# 产品概述',
  '墨刻文档是一款面向团队的知识库产品，支持多人实时协作编辑与 AI 智能问答。',
  '# 核心功能',
  '内置富文本编辑器，支持表格、代码块、图片上传与文档树管理。',
  '提供 RAG 人工智能检索能力，可以基于知识库内容进行语义搜索与回答问题。',
  '# 快速开始',
  '注册账号后创建知识库，即可开始编写第一篇文档并体验 AI 问答。',
].join('\n')

/** 预置内容转 Tiptap JSON：# → h1、## → h2、其余 → paragraph */
function buildTiptapDoc(text: string) {
  const lines = text.split('\n').filter((l) => l.trim())
  return {
    type: 'doc',
    content: lines.map((line) => {
      if (line.startsWith('## ')) {
        return { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: line.slice(3) }] }
      }
      if (line.startsWith('# ')) {
        return { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: line.slice(2) }] }
      }
      return { type: 'paragraph', content: [{ type: 'text', text: line }] }
    }),
  }
}

const creating = ref(false)

/**
 * 一键创建测试库 + 文档 + 预置内容
 * 创建即触发 RAG 入队（wiki.service.saveDocument 挂钩 enqueueDocument → BullMQ）
 */
async function createTestData() {
  creating.value = true
  try {
    const wiki = await createWiki({ name: `RAG 测试库 ${new Date().toLocaleTimeString()}` }).send()
    selectedWikiId.value = wiki.id
    await loadWikis()

    const node = await createWikiNode(wiki.id, { title: '产品手册' }).send()
    await loadNodes()
    selectedNodeId.value = node.id

    // 写入预置内容（先取最新 updatedAt 防乐观锁冲突）
    const doc = await getDocument(node.documentId).send()
    await saveDocument(node.documentId, {
      content: buildTiptapDoc(PRESET_TEXT),
      plainText: PRESET_TEXT,
      wordCount: PRESET_TEXT.length,
      updatedAt: doc.updatedAt,
    }).send()

    toast.success('测试库与文档已创建，内容已入队索引队列')
    await loadStatus()
  } catch (e) {
    toast.error((e as Error).message)
  } finally {
    creating.value = false
  }
}

// ==================== 文档编辑保存 ====================

const draft = ref('')
const saving = ref(false)

/** 选中节点后回填正文（plainText 展示为纯文本编辑） */
watch(selectedNodeId, async () => {
  if (!currentDocumentId.value) {
    draft.value = ''
    return
  }
  try {
    const doc = await getDocument(currentDocumentId.value).send()
    draft.value = doc.plainText ?? ''
  } catch (e) {
    toast.error((e as Error).message)
  }
})

/**
 * 保存文档内容 → 触发重新入队索引
 * 注意：后端有 10s 同文档频控（50010），连续保存会被限流
 */
async function saveDoc() {
  if (!currentDocumentId.value || !draft.value.trim()) return
  saving.value = true
  try {
    // 先取最新 updatedAt（乐观锁），再保存
    const doc = await getDocument(currentDocumentId.value).send()
    await saveDocument(currentDocumentId.value, {
      content: buildTiptapDoc(draft.value),
      plainText: draft.value,
      wordCount: draft.value.length,
      updatedAt: doc.updatedAt,
    }).send()
    toast.success('已保存，文档已重新入队索引')
    await loadStatus()
  } catch (e) {
    toast.error((e as Error).message)
  } finally {
    saving.value = false
  }
}

// ==================== 语义搜索 ====================

const searchQuery = ref('')
const searchTopK = ref(5)
const searchResults = ref<RagSearchResult[]>([])
const searching = ref(false)

/** 执行语义搜索（embedding 未就绪时后端返回 80001，toast 展示即降级观察点） */
async function doSearch() {
  if (!selectedWikiId.value || !searchQuery.value.trim()) return
  searching.value = true
  try {
    searchResults.value = await searchRag(selectedWikiId.value, searchQuery.value, searchTopK.value).send()
    if (searchResults.value.length === 0) toast.info('没有命中的切片（索引未完成或内容不相关）')
  } catch (e) {
    toast.error((e as Error).message)
  } finally {
    searching.value = false
  }
}

// ==================== AI 问答（SSE 流式） ====================

const question = ref('')
const answer = ref('')
const chatSources = ref<RagChatSource[]>([])
const chatError = ref('')
const chatting = ref(false)
let chatAbort: AbortController | null = null

/** 对话历史（多轮追问上下文，仅内存维护；上限 10 条与后端 schema 对齐） */
const chatHistory = ref<RagHistoryItem[]>([])

/** 中断进行中的问答 */
function abortChat() {
  chatAbort?.abort()
  chatAbort = null
}

/**
 * 发起 AI 问答：SSE 流式接收回答增量，结束后展示引用来源
 * - 携带对话历史（最多 10 条）：后端做问题改写 + 多轮上下文，追问无需重复背景
 * - 流前业务异常（80001 未配置 / 80002 越权）抛 ApiError
 * - 流内异常（AI 上游 429/503 等）走 onError 回调（error 事件）
 */
async function ask() {
  if (!selectedWikiId.value || !question.value.trim() || chatting.value) return
  // 提问即锁定本轮输入（历史入队用），避免流式过程中输入框变动影响上下文
  const asked = question.value.trim()
  chatting.value = true
  answer.value = ''
  chatSources.value = []
  chatError.value = ''
  chatAbort = new AbortController()
  try {
    await streamRagChat(
      selectedWikiId.value,
      asked,
      {
        onDelta: (text) => {
          answer.value += text
        },
        onSources: (sources) => {
          chatSources.value = sources
        },
        onError: (message) => {
          chatError.value = message
        },
      },
      chatAbort.signal,
      // 传最近 10 轮历史（时间正序），后端再截取最近 5 轮进 prompt
      chatHistory.value.slice(-10),
    )
    // 完整成功才计入历史（中断/出错轮次的残缺回答不入上下文）
    if (!chatError.value && answer.value) {
      chatHistory.value.push({ question: asked, answer: answer.value })
      // 超限裁剪：仅保留最近 10 轮（与后端 RagChatSchema.history 上限对齐）
      if (chatHistory.value.length > 10) chatHistory.value = chatHistory.value.slice(-10)
    }
  } catch (e) {
    const err = e as Error
    // 用户主动中断静默；其余（含流前业务异常）内联展示
    if (err.name !== 'AbortError') chatError.value = err.message
  } finally {
    chatting.value = false
    chatAbort = null
  }
}
</script>

<template>
  <!-- 未登录：提示登录（RAG 接口均需鉴权） -->
  <div v-if="!loggedIn" class="flex min-h-screen items-center justify-center p-6">
    <Card class="w-full max-w-md text-center">
      <CardHeader>
        <CardTitle class="flex items-center justify-center gap-2">
          <LogIn class="size-5" />
          需要登录
        </CardTitle>
        <CardDescription>RAG 测试页的接口均需要登录态（仅知识库 owner 可访问）</CardDescription>
      </CardHeader>
      <CardContent>
        <Button class="cursor-pointer" @click="router.push('/login')">前往登录</Button>
      </CardContent>
    </Card>
  </div>

  <!-- 已登录：测试面板 -->
  <div v-else class="mx-auto max-w-5xl space-y-6 p-6">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="flex items-center gap-2 text-xl font-semibold">
          <Sparkles class="size-5 text-primary" />
          RAG 全流程测试台
        </h1>
        <p class="mt-1 text-sm text-muted-foreground">
          创建数据 → 保存入队 → 观察索引状态 → 语义检索 → AI 问答（BullMQ / Redis 队列）
        </p>
      </div>
      <!-- 一键创建测试数据 -->
      <Button class="cursor-pointer" :disabled="creating" @click="createTestData">
        <LoaderCircle v-if="creating" class="size-4 animate-spin" />
        <Database v-else class="size-4" />
        创建测试库和文档
      </Button>
    </div>

    <!-- 区块 1：选择目标 -->
    <Card>
      <CardHeader>
        <CardTitle class="flex items-center gap-2 text-base">
          <FileText class="size-4" />
          测试目标
        </CardTitle>
        <CardDescription>选择知识库与文档；没有数据时点右上角「创建测试库和文档」</CardDescription>
      </CardHeader>
      <CardContent class="flex flex-wrap gap-3">
        <Select v-model="selectedWikiId">
          <SelectTrigger class="w-70 cursor-pointer">
            <SelectValue placeholder="选择知识库" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem v-for="w in wikis" :key="w.id" :value="w.id">{{ w.name }}</SelectItem>
          </SelectContent>
        </Select>
        <Select v-model="selectedNodeId" :disabled="nodes.length === 0">
          <SelectTrigger class="w-70 cursor-pointer">
            <SelectValue placeholder="选择文档节点" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem v-for="n in nodes" :key="n.id" :value="n.id">{{ n.title }}</SelectItem>
          </SelectContent>
        </Select>
      </CardContent>
    </Card>

    <!-- 区块 2：索引状态（轮询） -->
    <Card>
      <CardHeader class="flex flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle class="flex items-center gap-2 text-base">
            <LoaderCircle v-if="status && status.pending > 0" class="size-4 animate-spin text-orange-500" />
            <Database v-else class="size-4" />
            索引状态（自动轮询）
          </CardTitle>
          <CardDescription>保存文档后观察 pending → done 的队列消费过程</CardDescription>
        </div>
        <div class="flex gap-2">
          <Button variant="outline" size="sm" class="cursor-pointer" @click="loadStatus">
            <RefreshCw class="size-3.5" />
            刷新
          </Button>
          <Button variant="outline" size="sm" class="cursor-pointer" :disabled="reindexing" @click="doReindex">
            <LoaderCircle v-if="reindexing" class="size-3.5 animate-spin" />
            <RefreshCw v-else class="size-3.5" />
            重新索引
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div v-if="status" class="grid grid-cols-5 gap-3 text-center">
          <div class="rounded-lg border p-3">
            <div class="text-2xl font-semibold">{{ status.total }}</div>
            <div class="text-xs text-muted-foreground">文档总数</div>
          </div>
          <div class="rounded-lg border p-3">
            <div class="text-2xl font-semibold text-emerald-600">{{ status.done }}</div>
            <div class="text-xs text-muted-foreground">已完成</div>
          </div>
          <div class="rounded-lg border p-3">
            <div class="flex items-center justify-center gap-1 text-2xl font-semibold" :class="status.pending > 0 ? 'text-orange-500' : ''">
              <LoaderCircle v-if="status.pending > 0" class="size-4 animate-spin" />
              {{ status.pending }}
            </div>
            <div class="text-xs text-muted-foreground">待处理</div>
          </div>
          <div class="rounded-lg border p-3">
            <div class="text-2xl font-semibold" :class="status.failed > 0 ? 'text-red-500' : ''">{{ status.failed }}</div>
            <div class="text-xs text-muted-foreground">失败</div>
          </div>
          <div class="rounded-lg border p-3">
            <div class="text-2xl font-semibold">{{ status.chunkCount }}</div>
            <div class="text-xs text-muted-foreground">切片数</div>
          </div>
        </div>
        <p v-else class="text-sm text-muted-foreground">选择知识库后加载状态…</p>
        <p class="mt-3 text-xs text-muted-foreground">
          提示：AI_EMBEDDING_API_KEY 未配置时任务保持「待处理」（Redis 中 60s 延迟循环），检索/问答返回「AI 服务未配置」——即降级场景
        </p>
      </CardContent>
    </Card>

    <!-- 区块 3：文档编辑保存 -->
    <Card>
      <CardHeader class="flex flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle class="text-base">文档内容（触发索引）</CardTitle>
          <CardDescription>
            每行一段；「# 」「## 」前缀转为标题（构造标题路径）。保存即重新入队索引（后端 10s 频控）
          </CardDescription>
        </div>
        <Button size="sm" class="cursor-pointer" :disabled="saving || !currentDocumentId" @click="saveDoc">
          <LoaderCircle v-if="saving" class="size-3.5 animate-spin" />
          <Save v-else class="size-3.5" />
          保存
        </Button>
      </CardHeader>
      <CardContent>
        <textarea
          v-model="draft"
          class="min-h-40 w-full resize-y rounded-md border bg-transparent p-3 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          placeholder="选择文档后加载内容，或先创建测试数据"
        />
      </CardContent>
    </Card>

    <!-- 区块 4：语义搜索 -->
    <Card>
      <CardHeader>
        <CardTitle class="flex items-center gap-2 text-base">
          <Search class="size-4" />
          语义搜索
        </CardTitle>
        <CardDescription>向量化查询后按 cosine 相似度召回切片（score 越大越相似）</CardDescription>
      </CardHeader>
      <CardContent class="space-y-3">
        <div class="flex gap-2">
          <Input v-model="searchQuery" class="cursor-text" placeholder="试试：人工智能检索 / 知识库产品" @keyup.enter="doSearch" />
          <Input v-model.number="searchTopK" type="number" min="1" max="20" class="w-20 shrink-0" />
          <Button class="shrink-0 cursor-pointer" :disabled="searching || !searchQuery.trim()" @click="doSearch">
            <LoaderCircle v-if="searching" class="size-4 animate-spin" />
            <Search v-else class="size-4" />
            搜索
          </Button>
        </div>
        <ScrollArea v-if="searchResults.length" class="max-h-72">
          <div class="space-y-2 pr-3">
            <div v-for="r in searchResults" :key="r.chunkId" class="rounded-lg border p-3">
              <div class="flex items-center justify-between gap-2">
                <span class="truncate text-sm font-medium">{{ r.headingPath || r.title || '未命名' }}</span>
                <Badge variant="secondary" class="shrink-0">score {{ r.score }}</Badge>
              </div>
              <p class="mt-1 line-clamp-3 text-sm text-muted-foreground">{{ r.content }}</p>
            </div>
          </div>
        </ScrollArea>
      </CardContent>
    </Card>

    <!-- 区块 5：AI 问答（SSE） -->
    <Card>
      <CardHeader>
        <CardTitle class="flex items-center gap-2 text-base">
          <MessageCircleQuestion class="size-4" />
          AI 问答（流式）
        </CardTitle>
        <!-- 历史轮次徽标：多轮上下文生效中；清除按钮用于开启新一轮独立话题 -->
        <CardDescription class="flex flex-wrap items-center gap-2">
          <span>基于检索上下文流式回答，结束展示引用来源；支持追问（携带最近 10 轮历史）</span>
          <Badge v-if="chatHistory.length" variant="secondary">已携带 {{ chatHistory.length }} 轮历史</Badge>
          <button
            v-if="chatHistory.length"
            class="cursor-pointer text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
            title="清空对话历史，下一问将作为全新话题（不携带上下文）"
            @click="chatHistory = []"
          >
            清除上下文
          </button>
        </CardDescription>
      </CardHeader>
      <CardContent class="space-y-3">
        <div class="flex gap-2">
          <Input v-model="question" class="cursor-text" placeholder="试试：这个产品有哪些功能？" @keyup.enter="ask" />
          <Button v-if="!chatting" class="shrink-0 cursor-pointer" :disabled="!question.trim()" @click="ask">
            <MessageCircleQuestion class="size-4" />
            提问
          </Button>
          <Button v-else variant="destructive" class="shrink-0 cursor-pointer" @click="abortChat">停止</Button>
        </div>
        <!-- 流式回答 -->
        <div v-if="answer" class="whitespace-pre-wrap rounded-lg border bg-muted/30 p-3 text-sm leading-6">{{ answer }}<span v-if="chatting" class="animate-pulse">▍</span></div>
        <!-- 错误（流前业务异常 / 流内 error 事件） -->
        <div v-if="chatError" class="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
          {{ chatError }}
        </div>
        <!-- 引用来源 -->
        <div v-if="chatSources.length" class="space-y-2">
          <p class="text-sm font-medium">引用来源（{{ chatSources.length }}）</p>
          <div v-for="s in chatSources" :key="s.chunkId" class="flex items-center justify-between gap-2 rounded-lg border p-2 text-sm">
            <span class="truncate">{{ s.headingPath || s.title || '未命名' }}</span>
            <div class="flex shrink-0 items-center gap-2">
              <Badge variant="outline">score {{ s.score }}</Badge>
              <a v-if="s.url" :href="s.url" target="_blank" class="text-xs text-primary underline-offset-2 hover:underline cursor-pointer">查看原文</a>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  </div>
</template>
