<script setup lang="ts">
/**
 * 帮助中心左栏：arco a-tree 分组文档树
 *
 * 搜索框已上移至全局页头（layouts/default.vue，/w/ 页面居中显示），
 * 关键词经 useState('help-search-keyword') 跨组件共享，本组件只读：
 * 页头输入 → filteredTree 实时过滤树节点（路由切换时布局侧负责清空）。
 *
 * 与 apps/web/src/views/share/share-guest.vue 的侧栏树同构（同组件、同插槽结构、
 * 同样式覆盖类 .yokimind-tree），差异仅在于导航方式：帮助中心走 NuxtLink 路由
 * （navigateTo /w/:wikiId/:docId），share-guest 为组件内切换单页。
 *
 * - 数据：filteredTree（搜索过滤，filterTree 保留命中项祖先链）→ toTreeData
 *   转为 a-tree 数据结构（key = wikiNodes.id，与 owner 侧树一致）；
 * - 选中：selectedKeys 由 activeDocId 派生（documents.id 反查树节点 id，单向控制）；
 * - 展开：a-tree 白名单模型（expanded-keys），托管在 useState 的 Set 中——
 *   跨页面重建保留（支持多个分组同时展开不丢失）；当前文档祖先链自动并入
 *   （只展开、不收起）；搜索态强制全展开，避免命中项藏在收起的父级里；
 * - 交互：点行 = 文档节点路由跳转 / 纯分组节点切换展开收起；
 * - 外观：title 插槽自绘（emoji 图标 + 标题 + 行尾展开箭头 + 高亮行），展开/收起
 *   箭头渲染在行内右缘（同参考帮助中心），arco 默认行首开关经样式覆盖隐藏
 *   （display: none），层级缩进由 indent 列承担；arco 默认标题背景/内边距在文件底部
 *   样式覆盖中关闭，高亮与悬停全部由插槽内联类控制。
 */
import { ChevronDown } from '@lucide/vue'
import Tree from '@arco-design/web-vue/es/tree'
import { filterTree, findNodePath, type HelpNode } from '~/utils/help-tree'

const props = defineProps<{
  /** 知识库 ID（树节点跳转拼链接用） */
  wikiId: string
  /** 文档树（已 buildTree） */
  tree: HelpNode[]
  /** 当前文档 ID（documents.id，用于选中高亮与祖先链展开） */
  activeDocId?: string | null
  /**
   * 预览模式（owner 专属预览页使用）：
   * true = 点击文档节点不走路由跳转（公开站路由对未发布库 404），
   * 改为 emit('select', documentId) 由预览页在组件内拉取正文渲染
   */
  preview?: boolean
}>()

/** 预览模式下的文档切换事件（携带 documents.id） */
const emit = defineEmits<{
  select: [documentId: string]
}>()

// ============ 搜索（关键词由页头写入，本组件只读过滤） ============

/** 搜索关键词（与 layouts/default.vue 页头搜索框共享的 useState 状态） */
const keyword = useState('help-search-keyword', () => '')

/** 过滤后的树：按标题匹配，保留命中节点的祖先链 */
const filteredTree = computed(() => filterTree(props.tree, keyword.value))

/** 是否处于搜索过滤中（决定展开态是否强制全展开） */
const filtering = computed(() => keyword.value.trim().length > 0)

// ============ a-tree 数据 ============

/**
 * a-tree 数据节点结构（与 apps/web share-guest / owner layout-left 本地定义一致）
 */
interface TreeDataNode {
  /** 节点唯一 key（wikiNodes.id） */
  key: string
  /** 节点标题 */
  title: string
  /** 是否叶子节点（无子节点，决定是否渲染展开开关） */
  isLeaf: boolean
  /** 子节点 */
  children?: TreeDataNode[]
}

/**
 * 帮助中心树节点 → a-tree 数据结构（同 share-guest 的 toTreeData）
 */
function toTreeData(node: HelpNode): TreeDataNode {
  return {
    key: node.id,
    title: node.title,
    isLeaf: node.children.length === 0,
    children: node.children.length > 0 ? node.children.map(toTreeData) : undefined,
  }
}

/** 侧栏 a-tree 的数据：搜索态展示过滤结果，否则展示完整树 */
const sidebarTreeData = computed<TreeDataNode[]>(() => filteredTree.value.map(toTreeData))

/**
 * 按 key 反查树节点（title 插槽渲染 emoji / select 回调查 documentId）
 */
function findNodeById(id: string): HelpNode | undefined {
  return findNodePath(props.tree, (n) => n.id === id)?.at(-1) ?? undefined
}

// ============ 选中态 ============

/**
 * 当前文档对应的树节点 id：路由 docId 是 documents.id，
 * 树节点 key 是 wikiNodes.id，两者通过 node.documentId 关联
 */
const activeNodeId = computed(() =>
  props.activeDocId
    ? (findNodePath(props.tree, (n) => n.documentId === props.activeDocId)?.at(-1)?.id ?? null)
    : null
)

/** a-tree 选中的 key（单向控制；落地页无选中文档时为空） */
const selectedKeys = computed(() => (activeNodeId.value ? [activeNodeId.value] : []))

// ============ 展开态（白名单模型） ============

/**
 * 手动/自动展开的分组节点 id 集合（useState 共享状态，浏览器 tab 内跨路由保留）：
 * 切换文档时页面组件强制重建，ref 类状态会丢失，useState 使展开集合持久，
 * 多个分组可同时保持展开。
 */
const expandedIds = useState<Set<string>>('help-tree-expanded', () => new Set<string>())

/**
 * 当前文档变化：祖先链上的分组并入已展开集合（只展开、不收起）。
 * immediate：组件挂载即按当前文档展开所在分组链。
 */
watch(
  () => props.activeDocId,
  (id) => {
    if (!id) return
    const path = findNodePath(props.tree, (n) => n.documentId === id)
    const folders = (path ?? []).filter((n) => n.children.length > 0).map((n) => n.id)
    if (folders.length === 0) return
    const next = new Set(expandedIds.value)
    folders.forEach((fid) => next.add(fid))
    expandedIds.value = next
  },
  { immediate: true }
)

/** 全部含子级的分组节点 id（搜索态强制全展开用） */
const allFolderIds = computed(() => {
  const acc: string[] = []
  const walk = (list: HelpNode[]) => {
    for (const node of list) {
      if (node.children.length > 0) {
        acc.push(node.id)
        walk(node.children)
      }
    }
  }
  walk(props.tree)
  return acc
})

/**
 * 实际生效的展开 keys：搜索态强制全展开（命中项不被收起的父级藏住），
 * 否则取托管集合
 */
const effectiveExpandedKeys = computed(() =>
  filtering.value ? allFolderIds.value : [...expandedIds.value]
)

/**
 * a-tree 展开/收起变化回调：整体回写托管集合（Set 不可变替换保证响应）
 */
function onExpandedKeysChange(keys: (string | number)[]) {
  expandedIds.value = new Set(keys.map(String))
}

/**
 * 切换某分组展开/收起（纯分组节点点行时用）
 */
function toggleExpanded(id: string) {
  const next = new Set(expandedIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expandedIds.value = next
}

// ============ 交互 ============

/**
 * a-tree 选中回调：点击节点行
 * - 文档节点（documentId 非空）→ 路由跳转对应文档；
 * - 纯分组节点 → 切换展开/收起（对齐参考帮助中心「点分组行即折叠」体验）。
 * 注：node 信息取第二参 data.node（与 selectedKeys 无关，避免取消选中态时拿不到目标）。
 */
function onTreeSelect(_keys: (string | number)[], data: { node?: { key?: string | number } }) {
  const key = data?.node?.key
  if (key == null) return
  const node = findNodeById(String(key))
  if (!node) return
  if (node.documentId) {
    // 预览模式：emit 给预览页组件内切换文档（不走公开站路由，未发布库会 404）
    if (props.preview) {
      emit('select', node.documentId)
      return
    }
    navigateTo(`/w/${props.wikiId}/${node.documentId}`)
  } else if (node.children.length > 0) {
    toggleExpanded(node.id)
  }
}

/**
 * 按 key 查节点 emoji 图标，供 title 插槽渲染（无 icon 返回 undefined 不渲染）
 */
function nodeIcon(key: string): string | undefined {
  return findNodeById(key)?.icon ?? undefined
}

/**
 * 是否分组节点（含子级）：决定行尾是否渲染展开箭头
 */
function isGroupNode(key: string): boolean {
  return (findNodeById(key)?.children.length ?? 0) > 0
}

/**
 * 分组节点当前是否展开：与 effectiveExpandedKeys 口径一致——
 * 搜索态强制全展开；否则取托管集合
 */
function isNodeExpanded(key: string): boolean {
  return filtering.value || expandedIds.value.has(key)
}
</script>

<template>
  <!-- min-h-0 flex-1：作为父级 sticky（max-h + flex-col）容器的 flex 子项——
       内容少时按内容高度（不把页面撑出一屏），父级被 max-h 封顶时允许收缩，
       把高度让给内部 ScrollArea 触发树内滚动 -->
  <div class="flex min-h-0 flex-1 flex-col mt-2">
    <!-- 文档树：arco a-tree（搜索框在页头，树区顶部留白与正文 py-8 对齐） -->
    <ScrollArea class="min-h-0 flex-1">
      <div class="px-2 pb-6 pt-4">
        <p
          v-if="filteredTree.length === 0"
          class="px-2 py-6 text-center text-sm text-muted-foreground"
        >
          未找到相关内容
        </p>
        <Tree
          v-else
          block-node
          class="yokimind-tree"
          :data="sidebarTreeData"
          :draggable="false"
          :selected-keys="selectedKeys"
          :expanded-keys="effectiveExpandedKeys"
          @update:expanded-keys="onExpandedKeysChange"
          @select="onTreeSelect"
        >
          <!-- 自定义节点标题：emoji 图标 + 标题 + 行尾展开箭头（仅分组节点），当前文档高亮 -->
          <template #title="{ key, title }">
            <div
              class="group flex h-9 w-full cursor-pointer items-center rounded-md px-2.5 transition-colors"
              :class="
                key === activeNodeId
                  ? 'bg-primary/5 font-medium text-primary'
                  : 'text-primary hover:bg-accent hover:text-foreground'
              "
            >
              <span
                v-if="nodeIcon(String(key))"
                class="mr-1.5 flex shrink-0 items-center justify-center"
                >{{ nodeIcon(String(key)) }}</span
              >
              <!-- 单行省略号截断 + 原生 title 悬停提示完整标题（与编辑器左树行为一致） -->
              <span :title="title" class="min-w-0 flex-1 truncate text-sm">{{ title }}</span>
              <!-- 行尾展开/收起箭头（同参考帮助中心：箭头在行内右缘）：
                   收起时旋转 -90° 呈向右；@click.stop 阻断冒泡，
                   避免触发 arco 行选中回调（onTreeSelect）导致路由跳转 -->
              <ChevronDown
                v-if="isGroupNode(String(key))"
                class="size-3.5 shrink-0 cursor-pointer text-muted-foreground/60 transition-transform duration-150 hover:text-foreground"
                :class="isNodeExpanded(String(key)) ? 'rotate-0' : '-rotate-90'"
                @click.stop="toggleExpanded(String(key))"
              />
            </div>
          </template>
        </Tree>
      </div>
    </ScrollArea>
  </div>
</template>

<style scoped>
/* ===== yokimind-tree：arco Tree 覆盖样式（从 apps/web share-guest 复制） =====
   高亮/悬停背景由 title 插槽内联类控制，这里关掉 arco 默认的节点标题背景与内边距 */
.yokimind-tree :deep(.arco-tree-node-title),
.yokimind-tree :deep(.arco-tree-node-title:hover),
.yokimind-tree :deep(.arco-tree-node-selected > .arco-tree-node-title) {
  background: transparent;
}

/* 隐藏 arco 默认行首展开开关：展开箭头已自绘在行尾（title 插槽内），
   层级缩进由 indent 列承担 */
.yokimind-tree :deep(.arco-tree-node-switcher) {
  display: none;
}

/* 行条目之间的垂直间隔：每行下方留 4px，避免相邻行的悬停/选中背景粘连 */
.yokimind-tree :deep(.arco-tree-node) {
  margin-bottom: 4px;
}

.yokimind-tree :deep(.arco-tree-node-title) {
  padding: 0;
  transition: none;
}

/* 让节点文字容器占满整行（行内高亮随容器宽度） */
.yokimind-tree :deep(.arco-tree-node-title-text) {
  width: 100%;
}

/* 长标题省略号（修复标题溢出侧栏，同 apps/web layout-left 的同名修复）：
   arco 在 blockNode 模式下给 title 元素追加了 title-block 类（flex: 1 的弹性子项），
   自定义节点内容又包在 title-text 里（它也是 .arco-tree-node-title 弹性容器的子项）。
   CSS 规范中弹性子项默认 min-width: auto —— 不允许收缩到「不可断行内容的最小宽度」
   以下，而 truncate 依赖 white-space: nowrap，其 min-content 恰好等于整行文字宽度，
   于是这两层都拒绝收缩，整行被长标题撑出侧栏（文字溢出行背景、无省略号），
   内部 span 的 truncate 永远不生效。给这两层显式设置 min-width: 0 放开收缩限制，
   省略号才能正常截断 */
.yokimind-tree :deep(.arco-tree-node-title-block),
.yokimind-tree :deep(.arco-tree-node-title-text) {
  min-width: 0;
}
</style>
