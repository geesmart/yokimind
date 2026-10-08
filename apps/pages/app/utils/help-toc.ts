/**
 * 帮助中心目录（TOC）工具（apps/pages）
 *
 * 从后端预渲染的 contentHtml 中提取 h2/h3 生成「本页目录」：
 * - 按文档顺序抽取标题文本；
 * - 为每个标题生成唯一 id 并注入回 HTML（SSR 阶段完成，锚点必然匹配）；
 * - 不引第三方 HTML 解析库（cheerio 等），用正则处理（标题内不含嵌套标题，安全）。
 */

/** 目录条目 */
export interface TocItem {
  /** 锚点 id（已注入 HTML 对应标题元素上） */
  id: string
  /** 标题纯文本 */
  text: string
  /** 标题级别：2 = h2（一级），3 = h3（二级缩进） */
  level: 2 | 3
}

/** 提取结果：items 用于渲染目录，html 为注入 id 后的正文 HTML */
export interface TocResult {
  items: TocItem[]
  html: string
}

/** HTML 实体反转义（标题文本里最常见的几个，足够展示用） */
function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
}

/**
 * 生成 slug 化的锚点片段：保留中英文/数字，其余转 '-'
 * 中文直接保留（HTML5 id 允许 unicode，getElementById / querySelector 均可用）
 */
function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\p{Letter}\p{Number}-]+/gu, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) // 截断超长标题，控制 id 长度
}

/**
 * 从 contentHtml 提取 h2/h3 目录并注入锚点 id
 *
 * 处理流程（单次正则 replace 完成收集 + 注入，保证顺序一致）：
 * 1. 匹配所有 `<h2|h3 ...>...</h2|h3>` 片段；
 * 2. 剥掉内层标签得到纯文本（目录展示用）；
 * 3. 生成 `toc-{序号}-{slug}` 形式的唯一 id（slug 可能因标题为空而缺失，序号保证唯一）；
 * 4. 清掉原 id 后把新 id 写进开标签属性，重建 HTML。
 *
 * @param contentHtml 后端预渲染的文档 HTML（可能为 null：新建未保存文档）
 */
export function extractToc(contentHtml: string | null | undefined): TocResult {
  if (!contentHtml) return { items: [], html: '' }

  const items: TocItem[] = []
  let index = 0

  const html = contentHtml.replace(
    /<(h[23])([^>]*)>([\s\S]*?)<\/\1>/gi,
    (whole, tag: string, attrs: string, inner: string) => {
      // 剥内层标签 → 标题纯文本
      const text = decodeEntities(inner.replace(/<[^>]+>/g, '')).trim()
      // 序号前置保证唯一性；slug 仅用于可读性
      const id = `toc-${index}-${slugify(text)}`.replace(/-$/, '')
      items.push({ id, text, level: tag.toLowerCase() === 'h2' ? 2 : 3 })

      // 清除原有 id，注入新 id（保持其余属性不动）
      const cleanedAttrs = attrs.replace(/\sid\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      index += 1
      return `<${tag}${cleanedAttrs} id="${id}">${inner}</${tag}>`
    },
  )

  return { items, html }
}

/**
 * 按「标题文本」在正文区定位并滚动到对应标题
 *
 * 搜索弹窗「内容命中」跳转携带 ?h=<标题文本>（见 components/searchbox），
 * TOC 注入的锚点 id 是 toc-{n}-{slug} 形式（非标题文本），无法直接 getElementById，
 * 改为遍历正文标题元素按纯文本匹配（与 extractToc 的 decodeEntities+trim 口径一致）。
 *
 * @param heading 目标标题纯文本（空串直接返回 false）
 * @returns 是否命中并完成滚动（标题不存在 / 正文未渲染返回 false，调用方静默忽略）
 */
export function scrollToHeadingText(heading: string): boolean {
  if (!heading) return false
  // 仅匹配 .help-content 作用域内的标题，避免命中侧栏/TOC 里的同文本链接
  const target = Array.from(
    document.querySelectorAll<HTMLHeadingElement>('.help-content h2, .help-content h3')
  ).find((el) => el.textContent?.trim() === heading)
  if (!target) return false
  // 页头 sticky 高 3.5rem（56px），滚动留 72px 偏移避免标题被页头遮住
  window.scrollTo({ top: target.getBoundingClientRect().top + window.scrollY - 72 })
  return true
}
