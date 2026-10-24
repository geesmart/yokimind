<template>
  <Popover :open="open" @update:open="onOpenChange">
    <PopoverTrigger as-child>
      <!-- 文字链接模式（trigger="text"） -->
      <button
        v-if="trigger === 'text'"
        class="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors py-1"
      >
        <template v-if="modelValue">
          <span class="text-base leading-none">{{ modelValue }}</span>
          <span>移除图标</span>
        </template>
        <template v-else>
          <Smile :size="16" />
          <span>添加图标</span>
        </template>
      </button>
      <!-- 按钮模式（默认） -->
      <button
        v-else
        class="inline-flex items-center justify-center rounded-lg hover:bg-accent transition-colors shrink-0"
        :style="{ width: buttonSize + 'px', height: buttonSize + 'px' }"
        :title="modelValue ? '移除图标' : '添加图标'"
      >
        <template v-if="modelValue">
          <span :style="{ fontSize: iconSize + 'px', lineHeight: 1 }">{{ modelValue }}</span>
        </template>
        <template v-else>
          <Smile :size="iconSize" class="text-muted-foreground/60" />
        </template>
      </button>
    </PopoverTrigger>
    <!-- 阻止 Popover 打开时自动聚焦首个可聚焦元素（搜索框） -->
    <PopoverContent @open-auto-focus.prevent align="start" :side-offset="8" class="w-[400px] p-0 border shadow-xl">
      <!-- 搜索栏 -->
      <div class="p-3 pb-2">
        <div class="flex items-center gap-1.5 relative">
          <Search class="w-4 h-4 absolute left-3 text-muted-foreground" />
          <Input
            v-model="searchQuery"
            type="text"
            placeholder="请输入关键字"
            class="pl-8 h-8 text-xs"
          />
          <!-- 移除按钮：当已选图标时显示 -->
          <!--          <Button-->
          <!--            v-if="modelValue"-->
          <!--            class="text-muted-foreground hover:text-foreground p-1 rounded transition-colors"-->
          <!--            title="移除图标"-->
          <!--            @click="onRemove"-->
          <!--          >-->
          <!--            <Trash2 class="w-4 h-4" />-->
          <!--          </Button>-->

          <Button @click="onRemove" variant="outline" size="icon" aria-label="Submit">
            <Trash2 class="w-4 h-4" />
          </Button>
        </div>
      </div>

      <!-- 搜索结果 -->
      <div v-if="searchQuery" class="max-h-[300px] overflow-y-auto px-3 pb-2">
        <div class="grid grid-cols-8 gap-1">
          <button
            v-for="emoji in filteredEmojis"
            :key="emoji.char"
            class="flex items-center justify-center w-12 h-12 rounded-lg hover:bg-accent transition-colors"
            :title="emoji.name"
            @click="onSelect(emoji.char)"
          >
            <span style="font-size: 30px; line-height: 1;">{{ emoji.char }}</span>
          </button>
          <div
            v-if="filteredEmojis.length === 0"
            class="col-span-6 text-center text-xs text-muted-foreground/60 py-8"
          >
            无匹配的图标
          </div>
        </div>
      </div>

      <!-- 分类滚动区 -->
      <div
        v-else
        ref="scrollContainerRef"
        class="max-h-[300px] overflow-y-auto px-3 pb-2 scroll-smooth"
        @scroll="onScroll"
      >
        <!-- 最近使用 -->
        <section
          v-if="recentEmojis.length > 0"
          :ref="(el) => setSectionRef('recent', el as HTMLElement)"
          class="mb-2"
        >
          <div class="text-xs text-muted-foreground/60 mb-1.5">最近使用</div>
          <div class="grid grid-cols-8 gap-1">
            <button
              v-for="emoji in recentEmojis"
              :key="'recent-' + emoji"
              class="flex items-center justify-center w-12 h-12 rounded-lg hover:bg-accent transition-colors"
              :title="emoji"
              @click="onSelect(emoji)"
            >
              <span style="font-size: 30px; line-height: 1;">{{ emoji }}</span>
            </button>
          </div>
        </section>

        <!-- 各分类区块 -->
        <section
          v-for="cat in categories"
          :key="cat.key"
          :ref="(el) => setSectionRef(cat.key, el as HTMLElement)"
          class="mb-2"
        >
          <div class="text-xs text-muted-foreground/60 mb-1.5">{{ cat.label }}</div>
          <div class="grid grid-cols-8 gap-1">
            <button
              v-for="emoji in cat.emojis"
              :key="cat.key + '-' + emoji.char"
              class="flex items-center justify-center w-12 h-12 rounded-lg hover:bg-accent transition-colors"
              :title="emoji.name"
              @click="onSelect(emoji.char)"
            >
              <span style="font-size: 30px; line-height: 1;">{{ emoji.char }}</span>
            </button>
          </div>
        </section>
      </div>

      <!-- 底部分类导航 -->
      <div class="flex items-center justify-around border-t border-border py-2 px-3">
        <button
          v-for="cat in allCategoryTabs"
          :key="cat.key"
          class="text-xs px-1 py-0.5 rounded transition-colors"
          :class="
            activeCategory === cat.key
              ? 'text-foreground font-medium'
              : 'text-muted-foreground/60 hover:text-foreground'
          "
          @click="onTabClick(cat.key)"
        >
          {{ cat.label }}
        </button>
      </div>
    </PopoverContent>
  </Popover>
</template>

<script lang="ts" setup>
import { computed, ref } from 'vue'
import { Smile, Search, Trash2 } from '@lucide/vue'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  EMOJI_RECENT_KEY as RECENT_KEY,
  emojiCategories as categories,
  type EmojiCategoryKey as CategoryKey,
  type EmojiItem,
} from './emoji-data.js'

/**
 * EmojiPicker：文档图标选择器
 * 基于 Popover 的 emoji 选择器组件，支持搜索、下滑切换分类、最近使用
 *
 * 使用方式：
 *   <EmojiPicker v-model="icon" @change="onIconChange" />
 *
 * 特点：
 *  - 空状态显示 Smile 图标 + "添加图标"
 *  - 有图标时显示当前 emoji + "移除图标"
 *  - 下滑滚动自动切换分类区块
 *  - 底部 tab 点击滚动到对应分类
 *  - 支持搜索过滤
 */

// ============ Props & Emits ============

const props = withDefaults(
  defineProps<{
    /** 当前图标值（emoji 字符串） */
    modelValue?: string | null
    /** 触发器样式模式：'button'（默认方块按钮） | 'text'（文字链接） */
    trigger?: 'button' | 'text'
    /** 触发器按钮尺寸（px），仅 trigger="button" 时生效 */
    buttonSize?: number
    /** 触发器内 emoji 图标尺寸（px），仅 trigger="button" 时生效 */
    iconSize?: number
  }>(),
  {
    trigger: 'button',
    buttonSize: 40,
    iconSize: 24,
  }
)

const emit = defineEmits<{
  /** 选中图标或清除图标时触发 */
  (e: 'update:modelValue', value: string): void
  /** 选择图标后关闭弹出层 */
  (e: 'change', value: string): void
  /** Popover 打开状态变化 */
  (e: 'open-change', open: boolean): void
}>()

// ============ 状态 ============

/** Popover 开关状态 */
const open = ref(false)

/** 当前搜索关键字 */
const searchQuery = ref('')

/** 当前选中的分类（高亮底部 tab） */
const activeCategory = ref<CategoryKey>('recent')

/** 最近使用的 emoji（持久化到 localStorage） */
const recentEmojis = ref<string[]>([])

/** 滚动容器 ref */
const scrollContainerRef = ref<HTMLElement | null>(null)

/** 各分类区块 ref 存储 */
const sectionRefs = new Map<CategoryKey, HTMLElement>()

/** 正在通过 tab 点击滚动的标志（避免滚动事件和点击事件冲突） */
let isTabScrolling = false

// ============ Emoji 数据 ============

/** 所有分类 tab（含最近） */
const allCategoryTabs = computed(() => [
  { key: 'recent' as const, label: '最近' },
  ...categories.map((c) => ({ key: c.key, label: c.label })),
])

/** 所有 emoji 平铺（用于搜索，元素为 EmojiItem） */
const allEmojis = computed(() => categories.flatMap((c) => c.emojis))

/** 搜索过滤后的 emoji：匹配中文名或英文/中文标签 */
const filteredEmojis = computed(() => {
  const kw = searchQuery.value.trim().toLowerCase()
  if (!kw) return []
  return allEmojis.value.filter((item) => {
    const target = `${item.name} ${item.keywords}`.toLowerCase()
    return target.includes(kw)
  })
})

// ============ 方法 ============

/** 设置分类区块 ref */
function setSectionRef(key: CategoryKey, el: HTMLElement) {
  if (el) {
    sectionRefs.set(key, el)
  } else {
    sectionRefs.delete(key)
  }
}

/** 打开/关闭弹层时重置状态 */
function onOpenChange(val: boolean) {
  open.value = val
  emit('open-change', val)
  if (!val) {
    searchQuery.value = ''
    activeCategory.value = 'recent'
  }
}

/** 选择 emoji */
function onSelect(emoji: string) {
  emit('update:modelValue', emoji)
  emit('change', emoji)
  addToRecent(emoji)
  open.value = false
}

/** 移除当前图标 */
function onRemove() {
  emit('update:modelValue', '')
  emit('change', '')
  open.value = false
}

/** 添加到最近使用（最多 12 个） */
function addToRecent(emoji: string) {
  const recent = [...recentEmojis.value.filter((e) => e !== emoji)]
  recent.unshift(emoji)
  recentEmojis.value = recent.slice(0, 12)
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(recentEmojis.value))
  } catch {
    // localStorage 不可用则静默忽略
  }
}

/**
 * 底部 tab 点击：滚动到对应分类
 */
function onTabClick(key: CategoryKey) {
  activeCategory.value = key
  const container = scrollContainerRef.value
  const section = sectionRefs.get(key)
  if (container && section) {
    isTabScrolling = true
    container.scrollTo({ top: section.offsetTop - 8, behavior: 'smooth' })
    // 延时解除锁定，让滚动事件自然触发
    setTimeout(() => {
      isTabScrolling = false
    }, 400)
  }
}

/**
 * 滚动事件：根据滚动位置自动更新激活分类
 */
function onScroll() {
  if (isTabScrolling) return
  const container = scrollContainerRef.value
  if (!container) return

  const scrollTop = container.scrollTop
  // 从后往前找第一个 offsetTop <= scrollTop + 10 的区块
  // +10 是容差，避免边界处判断不准
  let currentKey: CategoryKey = 'recent'
  for (const [key, section] of sectionRefs) {
    if (section.offsetTop <= scrollTop + 10) {
      currentKey = key
    }
  }
  // 如果滚到顶部以上，保持第一个（最近）；滚到底部以下，保持最后一个
  activeCategory.value = currentKey
}

// ============ 初始化 ============

/** 从 localStorage 加载最近使用 */
function loadRecent() {
  try {
    const saved = localStorage.getItem(RECENT_KEY)
    if (saved) {
      recentEmojis.value = JSON.parse(saved)
    }
  } catch {
    // 静默忽略
  }
}

loadRecent()
</script>
