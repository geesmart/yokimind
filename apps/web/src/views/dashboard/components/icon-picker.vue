<template>
  <!--
    知识库 Icon + 颜色选择器（浮窗形式）
    - Trigger：紧凑预览按钮，显示当前选中的 icon + color
    - PopoverContent：浮窗内排列颜色选择 + 图标网格
    - 保持原有 18 个图标 + 12 种颜色不变
  -->
  <Popover v-model:open="popoverOpen">
    <!-- 触发按钮：显示当前 icon + color 预览 -->
    <PopoverTrigger as-child>
      <!-- 触发按钮：正方形（size-9），长宽一致 -->
      <button
        type="button"
        class="inline-flex items-center justify-center size-9 rounded-md transition-colors cursor-pointer"
        :style="{ background: currentColor.bgStyle }"
      >
        <component :is="currentIcon" class="size-4" :style="{ color: currentColor.colorStyle }" />
      </button>
    </PopoverTrigger>

    <!-- 浮窗内容 -->
    <PopoverContent align="start" :side-offset="8" class="w-[360px] p-0 shadow-lg border-border">
      <div class="p-4 space-y-4 flex flex-col">
        <!-- 选择颜色区 -->
        <div class="flex flex-col gap-y-2">
          <label class="text-xs font-medium text-foreground">选择颜色</label>
          <div class="flex items-center gap-2 flex-wrap">
            <button
              v-for="item in COLOR_OPTIONS"
              :key="item.key"
              type="button"
              class="w-8 h-8 rounded-lg transition-all cursor-pointer flex-shrink-0 flex items-center justify-center"
              :class="selectedColor === item.key ? '' : 'hover:scale-105'"
              :style="{ background: item.bgStyle }"
              :title="item.key"
              @click="updateColor(item.key)"
            >
              <!-- 选中态：中心显示 Check 打钩图标，颜色用对应色系深色 -->
              <Check
                v-if="selectedColor === item.key"
                class="w-4 h-4"
                :style="{ color: item.colorStyle }"
              />
            </button>
          </div>
        </div>

        <!-- 选择图标区 -->
        <div class="flex flex-col gap-y-2">
          <label class="text-xs font-medium text-foreground">选择图标</label>
          <div class="grid grid-cols-6 gap-1">
            <button
              v-for="item in ICON_OPTIONS"
              :key="item.key"
              type="button"
              class="flex items-center justify-center w-9 h-9 rounded-lg transition-all cursor-pointer"
              :class="[selectedIcon === item.key ? '' : 'hover:bg-accent/50']"
              :style="selectedIcon === item.key ? { background: currentColor.bgStyle } : {}"
              :title="item.key"
              @click="updateIcon(item.key)"
            >
              <component
                :is="item.component"
                class="w-4 h-4"
                :style="
                  selectedIcon === item.key
                    ? { color: currentColor.colorStyle }
                    : { color: 'hsl(var(--foreground))' }
                "
              />
            </button>
          </div>
        </div>
      </div>
    </PopoverContent>
  </Popover>
</template>

<script lang="ts" setup>
import { computed, ref } from 'vue'
import { Check } from '@lucide/vue'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { ICON_OPTIONS, COLOR_OPTIONS, DEFAULT_ICON, DEFAULT_COLOR } from './icon-meta'
import type { IconOption, ColorOption } from './icon-meta'

/**
 * Props
 * - icon: 当前选中的图标 key
 * - color: 当前选中的颜色 key
 */
const props = withDefaults(
  defineProps<{
    /** 当前选中的图标 key */
    icon?: string
    /** 当前选中的颜色 key */
    color?: string
  }>(),
  {
    icon: DEFAULT_ICON,
    color: DEFAULT_COLOR,
  }
)

/**
 * Emits
 * - update:icon: 图标 key 变化
 * - update:color: 颜色 key 变化
 */
const emit = defineEmits<{
  (e: 'update:icon', key: string): void
  (e: 'update:color', key: string): void
}>()

/** 浮窗开闭状态 */
const popoverOpen = ref(false)

/** 当前选中的图标 key（内部状态） */
const selectedIcon = computed({
  get: () => props.icon ?? DEFAULT_ICON,
  set: (v) => emit('update:icon', v),
})

/** 当前选中的颜色 key（内部状态） */
const selectedColor = computed({
  get: () => props.color ?? DEFAULT_COLOR,
  set: (v) => emit('update:color', v),
})

/**
 * 当前选中的图标配置（含组件引用）
 */
const currentIcon = computed(() => {
  const found: IconOption | undefined = ICON_OPTIONS.find((item) => item.key === selectedIcon.value)
  return found?.component ?? ICON_OPTIONS[0].component
})

/**
 * 当前选中的颜色配置
 */
const currentColor = computed(() => {
  const found: ColorOption | undefined = COLOR_OPTIONS.find(
    (item) => item.key === selectedColor.value
  )
  return found ?? COLOR_OPTIONS[0]
})

/**
 * 更新选中图标
 */
function updateIcon(key: string) {
  selectedIcon.value = key
}

/**
 * 更新选中颜色
 */
function updateColor(key: string) {
  selectedColor.value = key
}
</script>
