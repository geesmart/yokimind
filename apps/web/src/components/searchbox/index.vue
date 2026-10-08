<template>
  <!-- 搜索文档弹窗：独立搜索组件，点击触发按钮或按 ⌘J / Ctrl+J 唤起
       交互对齐 Anthropic docs 搜索弹窗：顶部搜索输入 + 空态历史搜索记录 + 结果带面包屑 + 底部快捷键提示条
       自包含实现：本组件自己创建并提供 command 过滤上下文（provideCommandContext），
       复用 ui/command 的展示子组件（CommandInput/CommandList/CommandGroup/CommandItem/CommandEmpty），
       不扩展、不修改 ui/command 的任何文件 -->
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent
      class="top-1/4 translate-y-0 overflow-hidden rounded-xl! p-0 sm:max-w-xl [&_[data-slot=input-group]]:h-10! [&_[data-slot=input-group]]:mb-2!"
      :show-close-button="false"
    >
      <DialogHeader class="sr-only">
        <DialogTitle>搜索文档</DialogTitle>
        <DialogDescription>搜索当前知识库中的文档</DialogDescription>
      </DialogHeader>

      <!-- ListboxRoot：reka-ui 列表框根，为 CommandInput/CommandItem 提供键盘导航上下文
           样式对齐 ui/command/Command.vue 的根节点 -->
      <ListboxRoot
        data-slot="command"
        :highlight-on-hover="true"
        class="bg-popover text-popover-foreground flex size-full flex-col overflow-hidden rounded-xl! p-1"
      >
        <CommandInput placeholder="搜索文档 ..." />

        <CommandList>
          <!-- 空态：最近搜索（仅无搜索词且有历史时显示；输入关键词后整组自动隐藏） -->
          <CommandGroup v-if="!filterState.search && recentSearches.length > 0" class="py-1">
            <div class="px-2 py-1 text-xs font-medium text-muted-foreground">最近搜索</div>

            <!-- 历史关键词项：点击回填搜索框并触发过滤
                 selectHistory 内用 nextTick 延迟回填：CommandItem 内置 @select 会先清空搜索词 -->
            <CommandItem
              v-for="kw in recentSearches"
              :key="kw"
              :value="kw"
              class="py-2 [&>svg:last-child]:hidden"
              @select="selectHistory(kw)"
            >
              <Clock :size="14" class="text-muted-foreground shrink-0" />
              <!-- flex-1 撑开剩余空间：让删除按钮贴到行最右缘。CommandItem 尾部渲染了个隐形
                   CheckIcon（opacity-0 但占 16px 宽），用 [&>svg:last-child]:hidden 隐藏掉，
                   否则 X 按钮右侧会留出一截空隙（此前不能给按钮用 ml-auto 的原因同：
                   两个 auto margin 平分剩余空间会把按钮挤到行中间） -->
              <span class="flex-1 truncate">{{ kw }}</span>
              <!-- 删除单条历史：仅悬停该行时显示（group-hover 命中 CommandItem 根上的 group/command-item）；
                   click.stop 阻断冒泡，避免触发 CommandItem 的 @select（回填搜索词）；
                   tabindex=-1 不进 Tab 焦点链，键盘路径保持「选中回填」语义 -->
              <button
                type="button"
                tabindex="-1"
                :aria-label="`删除搜索历史「${kw}」`"
                class="shrink-0 rounded-sm p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover/command-item:opacity-100"
                @click.stop="removeRecentSearch(kw)"
              >
                <X :size="14" />
              </button>
            </CommandItem>
          </CommandGroup>

          <!-- 输入态：文档结果（标题命中，useFilter 模糊过滤同时匹配标题与祖先路径） -->
          <!-- 行首 FileText 图标标记「标题命中」；emoji（如有）作为标题一部分随后展示 -->
          <CommandGroup v-if="flatDocs.length > 0">
            <div class="px-2 py-1 text-xs font-medium text-muted-foreground">文档</div>
            <CommandItem
              v-for="doc in flatDocs"
              :key="doc.id"
              :value="doc.title"
              class="py-2"
              @select="selectDoc(doc)"
            >
              <FileText :size="14" class="text-muted-foreground shrink-0" />
              <!-- 节点 emoji 图标（可选）：仅在有 icon 时展示 -->
              <span v-if="doc.icon" class="text-base leading-none shrink-0">{{ doc.icon }}</span>
              <!-- 标题首行 + 祖先面包屑次行（灰色小字），flex 子项 min-w-0 保证 truncate 生效 -->
              <div class="flex-1 min-w-0">
                <div class="text-sm truncate">{{ doc.title }}</div>
                <div v-if="doc.pathTitles.length" class="text-xs text-muted-foreground truncate">
                  {{ doc.pathTitles.join(' / ') }}
                </div>
              </div>
            </CommandItem>
          </CommandGroup>

          <!-- 正文搜索进行中：loading 行（普通节点不注册进 command 过滤，不受搜索词过滤影响；
               请求在途时替代「内容」分组占位，结果到达后由 v-if 切换为结果列表） -->
          <div
            v-if="contentLoading"
            class="flex items-center gap-2 px-2 py-1.5 text-sm text-muted-foreground"
          >
            <Spinner class="size-4" />
            <span>正在搜索文档内容…</span>
          </div>

          <!-- 输入态：正文命中（后端关键词检索 POST /wiki/:id/search，防抖 300ms + requestId 竞态防护） -->
          <!-- 行首 Hash(#) 图标标记「内容命中」；首行 emoji + 文档标题 › 命中标题，次行命中片段；点击跳转到文档内对应标题锚点 -->
          <CommandGroup v-if="contentResults.length > 0">
            <div class="px-2 py-1 text-xs font-medium text-muted-foreground">内容</div>
            <template v-for="docRes in contentResults" :key="docRes.nodeId">
              <CommandItem
                v-for="(hit, hitIndex) in docRes.hits"
                :key="`${docRes.nodeId}-${hitIndex}`"
                class="py-2"
                :value="[docRes.title, ...hit.headingPath, hit.snippet].join(' ')"
                @select="selectContentHit(docRes, hit)"
              >
                <Hash :size="14" class="text-muted-foreground shrink-0" />
                <!-- 首行：emoji（如有）+ 文档标题 + 命中所在最深标题（无标题结构的兜底命中省略 › 段） -->
                <div class="flex-1 min-w-0">
                  <div class="text-sm truncate">
                    {{ [docRes.icon, docRes.title].filter(Boolean).join(' ')
                    }}<template v-if="hit.heading"> › {{ hit.heading }}</template>
                  </div>
                  <!-- 次行：命中片段（灰色小字） -->
                  <div class="text-xs text-muted-foreground truncate">{{ hit.snippet }}</div>
                </div>
              </CommandItem>
            </template>
          </CommandGroup>

          <!-- 无结果提示（仅有搜索词且无命中时渲染，isRender 由 command 上下文过滤状态驱动；
               请求在途时先不判空，避免 loading 期间闪现「未找到」） -->
          <CommandEmpty
            v-if="!contentLoading"
            class="py-6 text-center text-sm text-muted-foreground"
            >未找到相关文档</CommandEmpty
          >

          <!-- 全空兜底提示：无搜索词、无历史、无文档时 -->
          <div
            v-if="!filterState.search && recentSearches.length === 0 && flatDocs.length === 0"
            class="py-6 text-center text-sm text-muted-foreground"
          >
            输入关键词搜索文档
          </div>
        </CommandList>

        <!-- 底部快捷键提示条：shadcn Kbd + KbdGroup 组件（方向键/回车用 lucide 图标，ESC 用文字） -->
        <div class="flex items-center gap-4 border-t px-3 py-2 text-xs text-muted-foreground">
          <span class="flex items-center gap-1.5">
            <KbdGroup>
              <Kbd><ArrowUp /></Kbd>
              <Kbd><ArrowDown /></Kbd>
            </KbdGroup>
            选择
          </span>
          <span class="flex items-center gap-1.5">
            <KbdGroup>
              <Kbd><CornerDownLeft /></Kbd>
            </KbdGroup>
            打开
          </span>
          <span class="ml-auto flex items-center gap-1.5">
            <KbdGroup>
              <Kbd>ESC</Kbd>
            </KbdGroup>
            关闭
          </span>
        </div>
      </ListboxRoot>
    </DialogContent>
  </Dialog>
</template>

<script lang="ts" setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { ListboxRoot, useFilter } from 'reka-ui'
import { ArrowUp, ArrowDown, CornerDownLeft, Clock, FileText, Hash, X } from '@lucide/vue'
import {
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  provideCommandContext,
} from '@/components/ui/command'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Kbd, KbdGroup } from '@/components/ui/kbd'
import { Spinner } from '@/components/ui/spinner'
import { useWikiDocStore } from '@/stores/wiki-doc'
import { searchWikiContent } from '@/api/modules/wiki'
import type { WikiContentHit, WikiContentSearchResult } from '@/api/modules/wiki'
import type { WikiDocItem } from '@/types/wiki-doc'

/**
 * 搜索结果条目：文档树扁平化后的单条文档
 * - id：节点 ID（跳转 /wiki/{wikiId}/{id}）
 * - icon：节点 emoji 图标（可空）
 * - title：文档标题
 * - pathTitles：祖先标题链（不含自身），用于面包屑展示 + 参与模糊匹配
 *   （搜索父文档名也能命中其子文档，对齐参考稿面包屑检索体验）
 */
interface SearchDoc {
  id: string
  icon?: string | null
  title: string
  pathTitles: string[]
}

/** 弹窗显隐（v-model:open） */
const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
}>()

// ============ command 过滤上下文（自包含，模式复制自 ui/command/Command.vue） ============

/**
 * 过滤状态：search 为搜索词（本组件可直接读写，实现历史回填 / 空态判断），
 * filtered 为按搜索词过滤后的可见项集合（CommandItem/CommandGroup/CommandEmpty 据此显隐）
 */
const allItems = ref<Map<string, string>>(new Map())
const allGroups = ref<Map<string, Set<string>>>(new Map())

/** reka-ui 模糊匹配函数（sensitivity: base 忽略大小写与音调） */
const { contains } = useFilter({ sensitivity: 'base' })

const filterState = reactive({
  search: '',
  filtered: {
    /** 可见项总数 */
    count: 0,
    /** 可见项 id → 匹配得分 */
    items: new Map<string, number>(),
    /** 至少含一个可见项的分组 id 集合 */
    groups: new Set<string>(),
  },
})

/** 按搜索词重算可见项与可见分组（无搜索词时全部可见） */
function filterItems() {
  if (!filterState.search) {
    filterState.filtered.count = allItems.value.size
    return
  }

  filterState.filtered.groups = new Set()
  let itemCount = 0

  // 逐项计算是否命中搜索词
  for (const [id, value] of allItems.value) {
    const score = contains(value, filterState.search)
    filterState.filtered.items.set(id, score ? 1 : 0)
    if (score) itemCount++
  }

  // 剔除没有任何可见项的分组
  for (const [groupId, group] of allGroups.value) {
    for (const itemId of group) {
      if (filterState.filtered.items.get(itemId)! > 0) {
        filterState.filtered.groups.add(groupId)
        break
      }
    }
  }

  filterState.filtered.count = itemCount
}

// 搜索词变化 → 重算过滤（CommandItem 的显隐据此响应）
watch(
  () => filterState.search,
  () => {
    filterItems()
  }
)

/**
 * 条目/分组注册变化 → 重算过滤。
 * filterItems 只在搜索词变化时同步执行，但此时刚渲染的条目尚未在 onMounted 里注册进
 * allItems/allGroups（filtered 是旧快照），导致：首次进入过滤态的「文档」分组、
 * 防抖后异步到达的「内容」分组都会被 filtered.groups 旧快照隐藏且永不恢复。
 * 监听两侧 Map 的尺寸（ref 深层响应式，set/delete 均会触发），
 * flush:'post' 保证在挂载注册完成后重算；filterItems 只写 filtered，不会形成循环。
 */
watch(
  [() => allItems.value.size, () => allGroups.value.size],
  () => {
    if (!filterState.search) return
    filterItems()
  },
  { flush: 'post' }
)

// 向 ui/command 展示子组件注入过滤上下文（key 同 Command，子组件 inject 后正常工作）
provideCommandContext({
  allItems,
  allGroups,
  filterState,
})

// ============ 路由 / 文档树 store ============

const route = useRoute()
const router = useRouter()
const wikiDocStore = useWikiDocStore()
const { sortedDisplayDocs } = storeToRefs(wikiDocStore)

// ============ 历史搜索记录（localStorage 持久化） ============

/** localStorage key（浏览器本地存储，不区分用户） */
const RECENT_SEARCHES_KEY = 'yokimind_recent_searches'

/** 历史记录上限（去重后最新在前，超出截断） */
const MAX_RECENT_SEARCHES = 8

/** 历史搜索关键词（内存态，弹窗打开时从 localStorage 加载） */
const recentSearches = ref<string[]>([])

/**
 * 从 localStorage 读取历史记录
 * 解析失败 / 存储不可用时静默降级为空数组（同 emoji-picker 最近使用的处理方式）
 */
function loadRecentSearches(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_SEARCHES_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((v): v is string => typeof v === 'string').slice(0, MAX_RECENT_SEARCHES)
  } catch {
    return []
  }
}

/** 持久化历史记录到 localStorage（失败静默忽略） */
function persistRecentSearches() {
  try {
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(recentSearches.value))
  } catch {
    // localStorage 不可用则静默忽略
  }
}

/**
 * 记录一次搜索关键词：去重后最新在前，超出上限截断
 * @param keyword 搜索关键词（空串 / 纯空白忽略）
 */
function recordRecentSearch(keyword: string) {
  const kw = keyword.trim()
  if (!kw) return
  recentSearches.value = [kw, ...recentSearches.value.filter((v) => v !== kw)].slice(
    0,
    MAX_RECENT_SEARCHES
  )
  persistRecentSearches()
}

/**
 * 删除单条历史关键词：内存 + localStorage 同步更新
 * 删除按钮已用 click.stop 阻断冒泡，不会触发 CommandItem 的 @select（回填搜索词）
 * @param keyword 要删除的关键词（与 recentSearches 内的原始字符串全等匹配）
 */
function removeRecentSearch(keyword: string) {
  recentSearches.value = recentSearches.value.filter((v) => v !== keyword)
  persistRecentSearches()
}

// ============ 文档树扁平化 ============

/**
 * 当前知识库文档树 → 扁平搜索条目列表（DFS，携带祖先标题链）
 * 数据源复用侧栏同一份 sortedDisplayDocs，树变化时自动重算
 */
const flatDocs = computed<SearchDoc[]>(() => {
  const result: SearchDoc[] = []
  const walk = (nodes: WikiDocItem[], parents: string[]) => {
    for (const node of nodes) {
      result.push({
        id: node.id,
        icon: node.icon,
        title: node.title,
        pathTitles: parents,
      })
      if (node.children && node.children.length > 0) {
        walk(node.children, [...parents, node.title])
      }
    }
  }
  walk(sortedDisplayDocs.value, [])
  return result
})

// ============ 正文命中搜索（后端关键词检索） ============

/** 正文命中结果（按文档分组：nodeId/icon/title + hits 列表），search 为空时清空 */
const contentResults = ref<WikiContentSearchResult[]>([])

/** 正文搜索请求是否在途（防抖触发后置 true，响应/失败/被新请求取代时复位），驱动 loading 行显隐 */
const contentLoading = ref(false)

/** 正文搜索防抖定时器句柄（300ms 内连续输入只发最后一次请求） */
let contentSearchTimer: ReturnType<typeof setTimeout> | undefined

/** 请求序号（竞态防护：仅采纳最后一次请求的响应，防止慢响应覆盖新结果） */
let contentSearchRequestId = 0

/**
 * 搜索词变化 → 防抖请求后端正文检索
 * - 空词（含纯空白）直接清空结果不发请求；
 * - 失败静默降级为空数组（正文命中是增量能力，失败不影响标题命中）；
 * - 非 owner / 401 等业务异常同样静默。
 */
watch(
  () => filterState.search,
  (keyword) => {
    // 上一次未触发的防抖直接作废
    clearTimeout(contentSearchTimer)
    const trimmed = keyword.trim()
    if (!trimmed) {
      contentResults.value = []
      contentLoading.value = false
      return
    }
    contentSearchTimer = setTimeout(async () => {
      const requestId = ++contentSearchRequestId
      const wikiId = route.params.wikiId as string
      // 非知识库路由（无 wikiId）不发请求
      if (!wikiId) return
      contentLoading.value = true
      try {
        const list = await searchWikiContent(wikiId, trimmed).send()
        // 仅采纳最后一次请求的响应
        if (requestId === contentSearchRequestId) {
          contentResults.value = list ?? []
          contentLoading.value = false
        }
      } catch {
        if (requestId === contentSearchRequestId) {
          contentResults.value = []
          contentLoading.value = false
        }
      }
    }, 300)
  }
)

/**
 * 选中正文命中：记录搜索历史 → 关闭弹窗 → 跳转文档并携带标题锚点
 * 锚点用「标题文本」标识（URL query ?h=<标题文本>），NotionEditor 内容就绪后滚动定位
 */
function selectContentHit(doc: WikiContentSearchResult, hit: WikiContentHit) {
  recordRecentSearch(filterState.search)
  emit('update:open', false)
  const wikiId = route.params.wikiId as string
  if (!wikiId) return
  // 携带当前模式后缀：预览态搜索跳转保持预览，编辑态（含瞬态缺省）保持编辑
  const mode = route.params.mode === 'view' ? 'view' : 'edit'
  // 无标题结构的兜底命中（heading 为空串）不带锚点，仅跳文档
  router.push({
    path: `/wiki/${wikiId}/${doc.nodeId}/${mode}`,
    query: hit.heading ? { h: hit.heading } : undefined,
  })
}

// ============ 交互行为 ============

/**
 * 选中历史关键词：回填搜索框触发过滤
 * 用 nextTick 延迟写入：CommandItem 内置 @select 处理器会在本处理器之后
 * 同步清空搜索词，直接赋值会被覆盖；等内置清空执行完再回填
 */
function selectHistory(keyword: string) {
  nextTick(() => {
    filterState.search = keyword
  })
}

/**
 * 选中文档：记录搜索关键词到历史 → 关闭弹窗 → 跳转文档
 * 注意先记录再关闭（关闭触发 CommandItem 内置清空，搜索词会被重置）
 */
function selectDoc(doc: SearchDoc) {
  recordRecentSearch(filterState.search)
  emit('update:open', false)
  const wikiId = route.params.wikiId as string
  if (wikiId) {
    // 携带当前模式后缀：预览态搜索跳转保持预览，编辑态（含瞬态缺省）保持编辑
    const mode = route.params.mode === 'view' ? 'view' : 'edit'
    router.push(`/wiki/${wikiId}/${doc.id}/${mode}`)
  }
}

/**
 * 弹窗每次打开：重置搜索词 + 清空正文命中 + 重新加载历史（保证多标签/外部改动后数据最新）
 */
watch(
  () => props.open,
  (value) => {
    if (value) {
      filterState.search = ''
      // 清空上一轮的正文命中残留（search 置空也会触发 watch 清空，这里显式兜底）
      contentResults.value = []
      recentSearches.value = loadRecentSearches()
    }
  }
)

// ============ ⌘J / Ctrl+J 全局快捷键（内聚在组件内，保持自包含） ============

/**
 * 全局 keydown：⌘J（mac）/ Ctrl+J（其他平台）唤起搜索弹窗
 * 注：block-menu 的 ⌘J 仅为菜单项展示标签、无键盘监听，不存在真实冲突
 */
function onGlobalKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'j') {
    e.preventDefault()
    emit('update:open', true)
  }
}

onMounted(() => {
  window.addEventListener('keydown', onGlobalKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onGlobalKeydown)
})
</script>
