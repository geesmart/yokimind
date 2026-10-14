/**
 * 文档导出为 Markdown 文件（浏览器端打包下载）
 *
 * 链路（顶栏「导出」dropdown 触发，正文来自编辑器 getMarkdown() 实时内容）：
 * 1. 收集正文里的本站媒体引用（/media/{bucket}/{key} 相对路径）→ 逐张 fetch 下载
 *    （对象桶公开读，与编辑器内图片加载同源同权限）；单张失败不阻断，保留原引用
 * 2. 引用改写为 assets/ 相对路径 → fflate zipSync 打包 → 浏览器下载 zip
 *    或跳过打包直接下载 .md 纯文本
 *
 * 产物结构（压缩包形态）：
 *   {文档标题}.zip
 *   ├── {文档标题}.md        （首行为 # 文档标题，标题存于节点表不在正文内）
 *   └── assets/              （有本站媒体时才存在）
 *       └── {ulid}.{ext}
 *
 * 外链图片（http/https 非本站媒体）不下载，原样保留引用 —— 与导入侧
 * transferRemoteImages「能转存的转存，不能转存的原样保留」哲学一致；
 * base64 内联图（data: URI）本身自包含，无需处理。
 */
import { strToU8, zipSync } from 'fflate'

// ==================== 本站媒体引用收集与改写 ====================

/**
 * 匹配正文中的本站媒体相对引用：/media/{bucket}/{key}
 * 终止于空白 / 闭括号 / 引号 / 反斜杠（markdown 链接与图片语法的边界字符）
 */
const MEDIA_URL_RE = /\/media\/[^\s)"'\\]+/g

/**
 * 从 Markdown 文本收集全部本站媒体 URL（去重，保持首次出现顺序）
 */
function collectMediaUrls(markdown: string): string[] {
  return [...new Set(markdown.match(MEDIA_URL_RE) ?? [])]
}

/** 单文件大小上限：与上传接口 MAX_FILE_SIZE 对齐（防异常大响应拖爆内存） */
const MAX_ASSET_SIZE = 20 * 1024 * 1024

/**
 * 下载单张本站媒体资源
 * @returns 资源字节；失败返回 null（调用方保留原引用）
 */
async function fetchAsset(url: string): Promise<Uint8Array | null> {
  try {
    const resp = await fetch(url)
    if (!resp.ok) return null
    const buffer = await resp.arrayBuffer()
    if (buffer.byteLength === 0 || buffer.byteLength > MAX_ASSET_SIZE) return null
    return new Uint8Array(buffer)
  } catch {
    return null
  }
}

/**
 * URL → assets 文件名：取路径末段（img/{ulid}.{ext} 的 ulid 段全局唯一，天然不冲突）；
 * 极端重名（同段不同桶）追加序号兜底
 */
function buildAssetNames(urls: string[]): Map<string, string> {
  const nameMap = new Map<string, string>()
  const used = new Set<string>()
  for (const url of urls) {
    const base = url.split('/').pop() || 'asset'
    let name = decodeURIComponent(base)
    if (used.has(name)) {
      const dot = name.lastIndexOf('.')
      const stem = dot > 0 ? name.slice(0, dot) : name
      const ext = dot > 0 ? name.slice(dot) : ''
      let i = 2
      while (used.has(`${stem}-${i}${ext}`)) i++
      name = `${stem}-${i}${ext}`
    }
    used.add(name)
    nameMap.set(url, name)
  }
  return nameMap
}

// ==================== 打包与下载 ====================

/** 文件名非法字符（跨平台保守集合，Windows 保留字符 + 控制符） */
const UNSAFE_FILENAME_RE = /[\\/:*?"<>|\u0000-\u001f]/g

/**
 * 标题 → 安全文件名：非法字符替换为下划线，空白裁剪，空标题兜底
 */
function safeFilename(title: string): string {
  const name = title.replace(UNSAFE_FILENAME_RE, '_').trim()
  return name || 'document'
}

/**
 * 标题 + 正文 → 完整 markdown 文本（首行 H1：标题存于节点表、不在正文内，导出时补写）
 */
function withTitleHeading(title: string, markdown: string): string {
  return `# ${title.trim()}\n\n${markdown}`
}

/**
 * 触发浏览器下载（Blob → objectURL → a[download] 一次性点击）
 */
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  // revoke 延迟到下一轮宏任务：部分浏览器（旧 Safari）在 click 同步回收会导致下载中断
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

// ==================== 对外入口 ====================

export interface ExportMarkdownResult {
  /** 导出文件名（.zip 或 .md） */
  fileName: string
  /** 成功打包进 assets/ 的资源数（仅压缩包形态） */
  assetCount: number
  /** 下载失败、保留原引用的资源 URL 数（仅压缩包形态） */
  failedAssetCount: number
}

/**
 * 导出文档为 Markdown 压缩包（正文 .md + assets/ 图片资源 → zip 下载）
 *
 * @param title 文档标题（zip/md 文件名与首行 H1 来源）
 * @param markdown 正文 Markdown 文本（编辑器 getMarkdown() 产物）
 * @returns 导出摘要；空正文返回 null 由调用方提示
 */
export async function exportMarkdownZip(
  title: string,
  markdown: string
): Promise<ExportMarkdownResult | null> {
  if (!markdown.trim()) return null
  const safeTitle = safeFilename(title)

  // 1. 收集本站媒体并逐张下载（单张失败保留原引用，不阻断）
  const urls = collectMediaUrls(markdown)
  const nameMap = buildAssetNames(urls)
  const assets = new Map<string, Uint8Array>()
  let failedAssetCount = 0
  await Promise.all(
    urls.map(async (url) => {
      const bytes = await fetchAsset(url)
      if (bytes) {
        assets.set(url, bytes)
      } else {
        failedAssetCount++
      }
    })
  )

  // 2. 引用改写：下载成功的 → assets/{name}；失败的保持原样
  let finalMarkdown = withTitleHeading(title, markdown)
  for (const [url, name] of nameMap) {
    if (assets.has(url)) {
      finalMarkdown = finalMarkdown.split(url).join(`assets/${name}`)
    }
  }

  // 3. zip 打包（fflate strToU8 默认 UTF-8 编码文本）
  const files: Record<string, Uint8Array> = {
    [`${safeTitle}.md`]: strToU8(finalMarkdown),
  }
  for (const [url, bytes] of assets) {
    files[`assets/${nameMap.get(url)}`] = bytes
  }
  const zipped = zipSync(files)

  // 4. 下载
  const fileName = `${safeTitle}.zip`
  downloadBlob(new Blob([zipped as BlobPart], { type: 'application/zip' }), fileName)

  return { fileName, assetCount: assets.size, failedAssetCount }
}

/**
 * 导出文档为单个 Markdown 文件（仅正文 .md，图片保留原始链接，直接下载不打包）
 *
 * @param title 文档标题（文件名与首行 H1 来源）
 * @param markdown 正文 Markdown 文本（编辑器 getMarkdown() 产物）
 * @returns 导出摘要；空正文返回 null 由调用方提示
 */
export function exportMarkdownFile(title: string, markdown: string): ExportMarkdownResult | null {
  if (!markdown.trim()) return null
  const fileName = `${safeFilename(title)}.md`
  downloadBlob(new Blob([strToU8(withTitleHeading(title, markdown)) as BlobPart]), fileName)
  return { fileName, assetCount: 0, failedAssetCount: 0 }
}
