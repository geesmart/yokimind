/**
 * 知识库图标渲染元数据（web 端，纯函数无 Vue）
 *
 * wiki.icon/color 有两代取值，本文件负责归一化：
 * - legacy：lucide 图标 key + 旧 8 色板（icon-meta.ts）——历史数据，渲染视觉保持零回归；
 * - 统一：Solar 图标 id（与编辑器同一图库）+ EDITOR_ICON_COLORS 统一色板（含 'rainbow'）。
 *
 * 判别方式：icon 能在 ICON_OPTIONS（lucide 表）命中即 legacy，否则视为 Solar id。
 * 渲染细节见 wiki-icon.vue；server 侧同名映射在 wiki-icon-svg.ts
 * （跨包无法共享 Vue 侧模块，映射表重复声明，改动需两边同步）。
 */
import { EDITOR_ICON_COLORS } from '@/components/notion-editor/extensions/editor-icon-palette.js'
import { COLOR_OPTIONS, getIconComponent, ICON_OPTIONS } from './icon-meta'

/** 新建知识库的默认图标（Solar id）与颜色（统一色板 key） */
export const DEFAULT_WIKI_ICON = 'book'
export const DEFAULT_WIKI_COLOR = 'blue'

/** legacy 旧 8 色 key → 统一色板 key（indigo/violet/pink/amber/slate 无同名统一色） */
export const LEGACY_COLOR_TO_UNIFIED: Record<string, string> = {
  blue: 'blue',
  indigo: 'blue',
  violet: 'purple',
  pink: 'red',
  orange: 'orange',
  amber: 'orange',
  green: 'green',
  slate: 'gray',
}

export interface WikiIconVisual {
  /** 归一化后的统一色板 key（'rainbow' 或 EDITOR_ICON_COLORS key）——Solar SVG 烘焙用 */
  key: string
  /** 前景色 CSS 值：legacy key 用旧色板 hex（视觉零回归），统一 key 用色板 hex；rainbow 回退 gray */
  fg: string
  /** 包裹层底色 CSS 值：legacy 用旧浅底，统一用 color-mix 淡化，rainbow 用中性底 */
  bg: string
  /** 是否 rainbow 渐变 */
  rainbow: boolean
}

/**
 * 颜色 key → 渲染色值（fg/bg）。未知 key 回退 gray（统一色板第一项）。
 * 注意 'blue'/'green'/'orange' 两代表里同名：命中 legacy 表则按旧色渲染（历史数据零回归）。
 */
export function resolveWikiIconColor(color: string | null | undefined): WikiIconVisual {
  const raw = color ?? DEFAULT_WIKI_COLOR

  if (raw === 'rainbow') {
    const gray = EDITOR_ICON_COLORS[0].value
    return { key: 'rainbow', fg: gray, bg: 'hsl(var(--muted))', rainbow: true }
  }

  const legacy = COLOR_OPTIONS.find((c) => c.key === raw)
  if (legacy) {
    return { key: LEGACY_COLOR_TO_UNIFIED[raw] ?? raw, fg: legacy.colorStyle, bg: legacy.bgStyle, rainbow: false }
  }

  const unified = EDITOR_ICON_COLORS.find((c) => c.key === raw)
  if (unified) {
    return {
      key: unified.key,
      fg: unified.value,
      bg: `color-mix(in srgb, ${unified.value} 12%, white)`,
      rainbow: false,
    }
  }

  // 未知 key 回退 gray
  const gray = EDITOR_ICON_COLORS[0]
  return { key: gray.key, fg: gray.value, bg: `color-mix(in srgb, ${gray.value} 12%, white)`, rainbow: false }
}

/** icon 是否为 legacy lucide key（能命中 ICON_OPTIONS 即旧格式；空值按 legacy 默认处理） */
export function isLegacyIconKey(icon: string | null | undefined): boolean {
  if (!icon) return true
  return ICON_OPTIONS.some((item) => item.key === icon)
}

/** legacy 图标组件（含 BookOpen 兜底），仅 legacy 格式使用 */
export function getWikiLegacyIconComponent(icon: string | null | undefined) {
  return getIconComponent(icon) ?? getIconComponent('BookOpen')
}
