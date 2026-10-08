/**
 * 知识库 Icon 与 Color 映射配置
 *
 * 用途：
 * - 为「新建知识库」弹窗提供 18 个 lucide 图标 + 12 种颜色方案
 * - 为知识库卡片渲染提供 icon 组件查找和颜色样式转换
 *
 * 设计：
 * - ICON_OPTIONS: 图标配置数组（key + 组件引用）
 * - COLOR_OPTIONS: 颜色配置数组（key + tailwind 类名 + HEX/RGB 值）
 * - 工具函数: getIconComponent / getColorClasses / getColorStyle
 */
import {
  BookOpen,
  Briefcase,
  Code,
  Cpu,
  Database,
  FileText,
  Film,
  FlaskConical,
  FolderOpen,
  Globe,
  GraduationCap,
  Lightbulb,
  Megaphone,
  Music,
  Palette,
  PenTool,
  Rocket,
  Stethoscope,
} from '@lucide/vue'
import type { Component } from 'vue'

/**
 * 图标配置项
 */
export interface IconOption {
  /** 图标唯一 key，存入数据库 wiki.icon 字段 */
  key: string
  /** lucide vue 组件引用 */
  component: Component
}

/**
 * 颜色配置项
 */
export interface ColorOption {
  /** 颜色唯一 key，存入数据库 wiki.color 字段 */
  key: string
  /** 背景色 Tailwind 类名（用于 picker 组件的模板渲染） */
  bgClass: string
  /** 图标前景色 Tailwind 类名（用于 picker 组件的模板渲染） */
  colorClass: string
  /** 背景色 CSS 值（用于卡片 inline style 渲染） */
  bgStyle: string
  /** 图标前景色 CSS 值（用于卡片 inline style 渲染） */
  colorStyle: string
}

/**
 * 18 个知识库图标（按使用场景分类）
 */
export const ICON_OPTIONS: IconOption[] = [
  { key: 'BookOpen', component: BookOpen },
  { key: 'FileText', component: FileText },
  { key: 'FolderOpen', component: FolderOpen },
  { key: 'Database', component: Database },
  { key: 'Code', component: Code },
  { key: 'Globe', component: Globe },
  { key: 'FlaskConical', component: FlaskConical },
  { key: 'Cpu', component: Cpu },
  { key: 'PenTool', component: PenTool },
  { key: 'Megaphone', component: Megaphone },
  { key: 'Briefcase', component: Briefcase },
  { key: 'GraduationCap', component: GraduationCap },
  { key: 'Stethoscope', component: Stethoscope },
  { key: 'Palette', component: Palette },
  { key: 'Music', component: Music },
  { key: 'Film', component: Film },
  { key: 'Rocket', component: Rocket },
  { key: 'Lightbulb', component: Lightbulb },
]

/**
 * 8 种主题色方案（简化版）
 * 背景使用 Tailwind 100/200 级别浅色（低饱和度），前景使用 600/700 级别饱和色
 */
export const COLOR_OPTIONS: ColorOption[] = [
  { key: 'blue', bgClass: 'bg-blue-100', colorClass: 'text-blue-600', bgStyle: '#DBEAFE', colorStyle: '#2563EB' },
  { key: 'indigo', bgClass: 'bg-indigo-100', colorClass: 'text-indigo-600', bgStyle: '#E0E7FF', colorStyle: '#4F46E5' },
  { key: 'violet', bgClass: 'bg-violet-100', colorClass: 'text-violet-600', bgStyle: '#EDE9FE', colorStyle: '#7C3AED' },
  { key: 'pink', bgClass: 'bg-pink-100', colorClass: 'text-pink-600', bgStyle: '#FCE7F3', colorStyle: '#DB2777' },
  { key: 'orange', bgClass: 'bg-orange-100', colorClass: 'text-orange-600', bgStyle: '#FFEDD5', colorStyle: '#EA580C' },
  { key: 'amber', bgClass: 'bg-amber-100', colorClass: 'text-amber-600', bgStyle: '#FEF3C7', colorStyle: '#D97706' },
  { key: 'green', bgClass: 'bg-green-100', colorClass: 'text-green-600', bgStyle: '#DCFCE7', colorStyle: '#16A34A' },
  { key: 'slate', bgClass: 'bg-slate-200', colorClass: 'text-slate-700', bgStyle: '#E2E8F0', colorStyle: '#334155' },
]

/**
 * 默认颜色配置项（首个；常量数组恒非空，! 断言绕过 noUncheckedIndexedAccess）
 */
const DEFAULT_COLOR_OPTION = COLOR_OPTIONS[0]!

/**
 * 默认图标 key（第一个）
 */
export const DEFAULT_ICON = ICON_OPTIONS[0]!.key

/**
 * 默认颜色 key（第一个）
 */
export const DEFAULT_COLOR = DEFAULT_COLOR_OPTION.key

/**
 * 根据 key 查找图标组件
 * @param key 图标 key（如 "BookOpen"）
 * @returns lucide vue 组件，未找到返回 undefined
 */
export function getIconComponent(key: string | null | undefined): Component | undefined {
  if (!key) return undefined
  return ICON_OPTIONS.find((item) => item.key === key)?.component
}

/**
 * 根据 key 查找颜色配置（Tailwind 类名）
 * @param key 颜色 key（如 "blue"）
 * @returns 包含 bgClass 和 colorClass 的对象，未找到返回默认值
 */
export function getColorClasses(key: string | null | undefined): { bgClass: string; colorClass: string } {
  const option = COLOR_OPTIONS.find((item) => item.key === key) ?? DEFAULT_COLOR_OPTION
  return { bgClass: option.bgClass, colorClass: option.colorClass }
}

/**
 * 根据 key 生成 inline style 对象（用于知识库卡片渲染）
 * @param key 颜色 key（如 "blue"）
 * @returns 包含 background 和 color 的 CSS style 对象
 */
export function getColorStyle(key: string | null | undefined): { background: string; color: string } {
  const option = COLOR_OPTIONS.find((item) => item.key === key) ?? DEFAULT_COLOR_OPTION
  return { background: option.bgStyle, color: option.colorStyle }
}
