/**
 * 知识库 meta 图标 SVG 烘焙（server 侧）
 *
 * 背景：wiki.icon 支持两种取值——
 * - legacy：lucide 图标 key（如 'BookOpen'，历史数据），访客端由各端 icon-meta 映射组件渲染；
 * - 统一：Solar outline 图标 id（如 'book'，与编辑器 editorIcon 节点同一图库）。
 * Solar 图标数据（3.7M body 表）无法内置进 pages 公开站，故在 meta 接口响应时把
 * id + 色值烘焙成完整 SVG 字符串下发（wikiIconSvg），pages 端 v-html 直出即可。
 *
 * 烘焙方式（纯字符串操作，无 XML 解析）：
 * - Solar body 是 `<g fill="currentColor">…</g>` 片段，把 currentColor 替换为具体色值，
 *   再包一层 `<svg xmlns viewBox>`——与编辑器 editor-icon.ts 的「颜色烘焙进 SVG、
 *   不依赖 CSS 变量」渲染哲学一致，pages 端渲染与选择器预览永不漂移；
 * - 色板单一来源：EDITOR_ICON_COLORS（web editor-icon.ts，无 Vue/无浏览器 API，
 *   已被服务端渲染链路共享）；legacy 色 key 走映射表兜底。
 * 输入只有 icon id 与色板 key（枚举），不接收任何客户端 HTML，无存储型 XSS 面。
 */
import { EDITOR_ICON_COLORS } from '../../../../web/src/components/notion-editor/extensions/editor-icon-palette.js'
import { SOLAR_BODIES } from '../../../../web/src/components/notion-editor/utils/solar-bodies.js'

/** Solar id → body 表（模块级懒构建；key 去 -outline 后缀，与 web solar-library.ts 一致） */
let bodyMap: Map<string, string> | null = null

function getBodyMap(): Map<string, string> {
  bodyMap ??= new Map(
    Object.entries(SOLAR_BODIES).map(([name, body]) => [name.replace(/-outline$/, ''), body])
  )
  return bodyMap
}

/**
 * legacy 色 key（web icon-meta.ts 旧 8 色板）→ 统一色板 key 映射。
 * 与 web wiki-icon-meta.ts 的 LEGACY_COLOR_TO_UNIFIED 保持一致（跨包无法共享 Vue 侧模块，重复声明）。
 */
const LEGACY_COLOR_TO_UNIFIED: Record<string, string> = {
  blue: 'blue',
  indigo: 'blue',
  violet: 'purple',
  pink: 'red',
  orange: 'orange',
  amber: 'orange',
  green: 'green',
  slate: 'gray',
}

/** rainbow 渐变描边（与 editor-icon.ts 的 RAINBOW_STOPS 一致） */
const RAINBOW_STOPS = ['#f87171', '#fb923c', '#facc15', '#34d399', '#38bdf8', '#a78bfa']

/** 色板 key → 具体色值（rainbow 返回 null，由渐变处理；legacy key 先映射） */
function resolveColorValue(color: string): string | null {
  const unified = LEGACY_COLOR_TO_UNIFIED[color] ?? color
  if (unified === 'rainbow') return null
  return EDITOR_ICON_COLORS.find((c) => c.key === unified)?.value ?? EDITOR_ICON_COLORS[0].value
}

/**
 * 烘焙知识库图标 SVG
 * @param icon wiki.icon（Solar id 或 legacy lucide key）
 * @param color wiki.color（统一色板 key / legacy 色 key）
 * @returns { svg, colorValue } | null：icon 非 Solar id（legacy key 或空）返回 null，
 *          由调用方下发给前端走 legacy 渲染路径；colorValue 为解析后的 hex（rainbow 为 null）
 */
export function bakeWikiIconSvg(
  icon: string | null | undefined,
  color: string | null | undefined
): { svg: string; colorValue: string | null } | null {
  if (!icon) return null
  const body = getBodyMap().get(icon)
  if (!body) return null

  const colorValue = resolveColorValue(color ?? 'gray')
  const isRainbow = colorValue === null
  const paint = colorValue ?? 'url(#wiki-icon-rainbow)'
  const defs = isRainbow
    ? `<defs><linearGradient id="wiki-icon-rainbow" x1="0" y1="0" x2="1" y2="1">` +
      RAINBOW_STOPS.map((stop, i) => `<stop offset="${i / (RAINBOW_STOPS.length - 1)}" stop-color="${stop}"/>`).join('') +
      `</linearGradient></defs>`
    : ''

  // body 由构建期从 @iconify-json/solar 提取（可信来源），currentColor 整串替换为烘焙色
  const baked = body.replaceAll('currentColor', paint)
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">` + defs + baked + `</svg>`
  return { svg, colorValue }
}

/**
 * meta 接口响应字段组装：spread 进 share/publish 的 wiki meta 返回对象
 * - icon 为 Solar id → wikiIconSvg 为烘好的完整 SVG、wikiIconColor 为 hex（rainbow 为 null）
 * - icon 为 legacy key → 双 null，前端走 icon-meta lucide 渲染路径
 */
export function buildWikiIconFields(
  icon: string | null | undefined,
  color: string | null | undefined
): { wikiIconSvg: string | null; wikiIconColor: string | null } {
  const baked = bakeWikiIconSvg(icon, color)
  return { wikiIconSvg: baked?.svg ?? null, wikiIconColor: baked?.colorValue ?? null }
}
