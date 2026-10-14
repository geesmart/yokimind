import path from 'node:path'
import { createHash } from 'node:crypto'
import { ulid } from 'ulid'
import { mediaAssets } from '~/db/schema.js'
import { BizException } from '~/core/lib/biz.exception.js'
import { ErrorCode } from '~/config/error-code.js'
import { getDb } from '~/core/helper/db.helper.js'
import { usePino } from '~/core/plugins/pino.js'
import { putObject, deleteObject, buildObjectUrl, buildObjectKey } from '~/core/lib/storage.js'
import type { UploadImageResult } from './media.schema.js'

const logger = usePino()

// ============ 上传配置常量 ============

/**
 * 单文件最大字节数：5MB
 * 与前端 image-upload.ts 中 MAX_FILE_SIZE 保持一致
 */
const MAX_FILE_SIZE = 5 * 1024 * 1024

/**
 * 允许的图片 MIME 类型白名单
 * - 前端 ACCEPT_TYPES = 'image/*' 允许所有图片，这里再做服务端强校验
 * - 不允许 image/svg+xml（存在 XSS 风险，可后续按需放开）
 */
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
])

/**
 * MIME 类型到扩展名映射
 * 不在映射中的 MIME 直接用 mime 主类型后缀兜底
 */
const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
}

/**
 * 上传入参
 * - file: Hono parseBody 返回的 File 对象（web 标准 File，Node 环境下被 @hono/node-server 适配）
 * - userId: 当前登录用户 ID（ULID）
 * - wikiId / documentId: 可选的归属绑定（软关联，便于后续按文档清理无引用图片）
 */
export interface UploadImageParams {
  file: File
  userId: string
  wikiId?: string
  documentId?: string
}

/**
 * 上传图片
 *
 * 流程：
 * 1. 校验文件类型与大小；
 * 2. 生成小写 ULID 文件名，对象键为 img/{ulid}.{ext}（键生成收敛在 storage.buildObjectKey）；
 * 3. 上传到 S3 兼容对象存储（RustFS），附带 immutable 缓存头（键不可变可永久缓存）；
 * 4. 写入 media_assets 表记录元信息（kind/status/contentHash 一并落库）；
 * 5. 返回对外可用的 URL 与元数据。
 *
 * 失败时抛出 BizException，由全局 errorHandler 统一处理。
 *
 * @returns 上传成功后的 URL + 元数据
 */
export async function uploadImage(params: UploadImageParams): Promise<UploadImageResult> {
  const { file, userId, wikiId, documentId } = params

  // ============ 1. 校验 ============
  if (!file || typeof file === 'string' || !('size' in file)) {
    throw new BizException(ErrorCode.MEDIA_FILE_REQUIRED)
  }

  // 文件大小校验（File.size 在某些环境下可能为 0，需同时校验）
  if (file.size === 0) {
    throw new BizException(ErrorCode.MEDIA_FILE_REQUIRED, '图片内容为空')
  }
  if (file.size > MAX_FILE_SIZE) {
    throw new BizException(ErrorCode.MEDIA_FILE_TOO_LARGE)
  }

  // MIME 类型校验：优先用 file.type，缺失时按 originalName 兜底
  let mimeType = file.type
  if (!mimeType) {
    mimeType = guessMimeFromName(file.name || '')
  }
  if (!mimeType || !ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new BizException(ErrorCode.MEDIA_INVALID_TYPE)
  }

  // ============ 2. 生成对象 key ============
  // 单机版键方案：{kind}/{ulid}.{ext}，无时间分区（时间由 media_assets.createdAt 承载，
  // ULID 本身时间有序）；键生成收敛在 storage.buildObjectKey
  const ext = MIME_TO_EXT[mimeType] || mimeType.split('/')[1] || 'bin'
  // 统一转小写：网站全站 ID 均使用小写
  const fileName = `${ulid().toLowerCase()}.${ext}`
  const objectKey = buildObjectKey('img', fileName)

  // ============ 3. 上传到对象存储 ============
  let contentHash: string
  try {
    // File.arrayBuffer() 是 web 标准 API，@hono/node-server 在 Node 环境下也支持
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    // 内容 SHA-256：用于备份完整性巡检（buffer 已在内存，顺手计算）
    contentHash = createHash('sha256').update(buffer).digest('hex')
    await putObject(objectKey, buffer, mimeType)
  } catch (err) {
    logger?.error({ err }, '[media] 对象存储上传失败')
    throw new BizException(ErrorCode.MEDIA_UPLOAD_FAILED)
  }

  // ============ 4. 写入数据库 ============
  // 对外 URL：恒为相对路径 /media/{bucket}/{key}（浏览器按当前 origin 解析，经 Caddy /media 路由加载），
  // 换域名/上 HTTPS 零成本；见 storage.buildObjectUrl
  let url: string
  try {
    url = buildObjectUrl(objectKey)
  } catch (err) {
    logger?.error({ err }, '[media] 生成对象访问 URL 失败')
    await deleteObject(objectKey)
    throw new BizException(ErrorCode.MEDIA_UPLOAD_FAILED)
  }

  const db = getDb()
  let saved
  try {
    ;[saved] = await db
      .insert(mediaAssets)
      .values({
        userId,
        wikiId: wikiId ?? null,
        documentId: documentId ?? null,
        fileName,
        filePath: objectKey,
        originalName: file.name || null,
        mimeType,
        size: file.size,
        // width / height 暂不解析，前端加载后可通过 naturalWidth 获取
        width: null,
        height: null,
        url,
        // 媒体类别与生命周期（单机版定稿方案，见 docs/产品设计/媒体文件存储设计.md）：
        // 当前上传接口仅收图片 → kind 恒为 img
        kind: 'img',
        // 已绑定文档即 attached；未关联为 orphan（P1 清理 job 按 status+createdAt 捞 48h 超时候选）
        status: documentId ? 'attached' : 'orphan',
        contentHash,
      })
      .returning({
        id: mediaAssets.id,
        url: mediaAssets.url,
        fileName: mediaAssets.fileName,
        originalName: mediaAssets.originalName,
        mimeType: mediaAssets.mimeType,
        size: mediaAssets.size,
        width: mediaAssets.width,
        height: mediaAssets.height,
      })
  } catch (err) {
    logger?.error({ err }, '[media] 数据库写入失败，尝试回滚已上传对象')
    // 数据库写入失败时同步删除对象存储文件，避免脏数据
    await deleteObject(objectKey)
    throw new BizException(ErrorCode.MEDIA_UPLOAD_FAILED)
  }

  if (!saved) {
    // 兜底：returning 返回空数组，理论上不会发生
    await deleteObject(objectKey)
    throw new BizException(ErrorCode.MEDIA_UPLOAD_FAILED)
  }

  return saved
}

/**
 * 通过文件名兜底猜测 MIME 类型
 * 仅用于 file.type 缺失的极端情况，主流程仍以 file.type 为准
 */
function guessMimeFromName(name: string): string {
  const ext = path.extname(name).slice(1).toLowerCase()
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'png':
      return 'image/png'
    case 'gif':
      return 'image/gif'
    case 'webp':
      return 'image/webp'
    default:
      return ''
  }
}

// ============ 外链图片转存（Markdown 导入场景） ============

/**
 * 转存单张外链图的结果（逐条返回，允许部分成功）
 */
export interface TransferRemoteItem {
  /** 原始外链 URL（请求方用于映射改写正文） */
  sourceUrl: string
  /** 转存成功后的相对 URL（/media/{bucket}/{key}）；失败时为 null */
  url: string | null
  /** 失败原因（人类可读，用于前端聚合提示）；成功时为 null */
  error: string | null
}

/** 单张外链图下载超时（秒）：慢速图床不应拖死整个导入流程 */
const TRANSFER_TIMEOUT_MS = 15_000

/**
 * 下载一张外链图片并返回（buffer, mimeType）
 *
 * 校验链：协议白名单 → Content-Type / URL 扩展名推断 → 实际字节数上限。
 * 安全说明：本项目为单机自部署形态（服务跑在用户自己的机器/内网），
 * 不做私网地址拦截 —— 用户从内网图床（NAS / 内网 Wiki）导入属于合法场景，
 * 防护收敛在协议白名单 + 类型白名单 + 5MB 上限。
 */
async function downloadRemoteImage(sourceUrl: string): Promise<{ buffer: Buffer; mimeType: string }> {
  // 协议白名单：只允许 http/https（禁 file:/data:/ftp: 等）
  let parsed: URL
  try {
    parsed = new URL(sourceUrl)
  } catch {
    throw new Error('URL 格式非法')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('仅支持 http/https 链接')
  }

  // 带超时下载（AbortSignal.timeout 到点自动中断请求）
  let resp: Response
  try {
    resp = await fetch(sourceUrl, {
      redirect: 'follow',
      signal: AbortSignal.timeout(TRANSFER_TIMEOUT_MS),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; yokimind-media-transfer)' },
    })
  } catch {
    throw new Error('下载失败或超时')
  }
  if (!resp.ok) {
    throw new Error(`下载失败（HTTP ${resp.status}）`)
  }

  // MIME 判定：响应头优先；缺失或泛型（application/octet-stream）时按 URL 扩展名兜底
  let mimeType = resp.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? ''
  if (!mimeType || !ALLOWED_MIME_TYPES.has(mimeType)) {
    mimeType = guessMimeFromName(parsed.pathname)
  }
  if (!mimeType || !ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new Error('不支持的图片类型')
  }

  // 大小上限：content-length 预检 + 实际字节数兜底（防 chunked 响应漏判）
  const contentLength = Number(resp.headers.get('content-length') ?? 0)
  if (contentLength > MAX_FILE_SIZE) {
    throw new Error('图片大小超出限制')
  }
  const buffer = Buffer.from(await resp.arrayBuffer())
  if (buffer.length === 0) {
    throw new Error('图片内容为空')
  }
  if (buffer.length > MAX_FILE_SIZE) {
    throw new Error('图片大小超出限制')
  }

  return { buffer, mimeType }
}

/**
 * 有限并发执行（并发度 4）：转存场景图片数通常为个位数到几十张，
 * 全串行太慢、全并发怕打爆图床，取小并发折中
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await fn(items[index])
    }
  })
  await Promise.all(workers)
  return results
}

/**
 * 批量转存外链图片到对象存储（RustFS）
 *
 * 场景：Markdown 导入时正文里的图片多为外链（图床/远端仓库），
 * 外链不可控（防盗链、失效、私有部署不可达），导入时把「能访问到的」
 * 图片下载并转存到本站对象存储，正文 URL 改写为本站相对路径。
 *
 * 逐张独立容错：单张失败（404 / 超时 / 类型不符 / 超限）不影响其他图片，
 * 失败项返回 error 描述，由前端保留原外链并聚合提示 —— 「能转存的转存，
 * 不能转存的原样保留」。
 *
 * @returns 每个源 URL 一条结果（顺序与入参一致，已按 URL 去重）
 */
export async function transferRemoteImages(params: {
  urls: string[]
  userId: string
  wikiId?: string
  documentId?: string
}): Promise<{ items: TransferRemoteItem[]; transferred: number }> {
  const { urls, userId, wikiId, documentId } = params

  // 去重（同一张图在正文引用多次只下载一次），保持首次出现顺序
  const uniqueUrls = [...new Set(urls)]

  const items = await mapWithConcurrency(uniqueUrls, 4, async (sourceUrl): Promise<TransferRemoteItem> => {
    try {
      // 1. 下载 + 校验（协议 / 类型 / 大小，复用上传接口的 5MB 与 MIME 白名单）
      const { buffer, mimeType } = await downloadRemoteImage(sourceUrl)

      // 2. 生成对象 key 并上传：与 uploadImage 同一套键方案与缓存头
      const ext = MIME_TO_EXT[mimeType] || mimeType.split('/')[1] || 'bin'
      const fileName = `${ulid().toLowerCase()}.${ext}`
      const objectKey = buildObjectKey('img', fileName)
      const contentHash = createHash('sha256').update(buffer).digest('hex')
      await putObject(objectKey, buffer, mimeType)

      // 3. 生成对外相对 URL（失败回滚已上传对象，与 uploadImage 容错一致）
      let url: string
      try {
        url = buildObjectUrl(objectKey)
      } catch (err) {
        logger?.error({ err }, '[media] 转存生成对象访问 URL 失败')
        await deleteObject(objectKey)
        throw new Error('生成访问 URL 失败')
      }

      // 4. 落库 media_assets：绑定 documentId 即 attached（与上传接口语义一致）
      const db = getDb()
      try {
        await db.insert(mediaAssets).values({
          userId,
          wikiId: wikiId ?? null,
          documentId: documentId ?? null,
          fileName,
          filePath: objectKey,
          // 原始名记录源 URL：便于后续按文档清理时人工溯源
          originalName: sourceUrl,
          mimeType,
          size: buffer.length,
          width: null,
          height: null,
          url,
          kind: 'img',
          status: documentId ? 'attached' : 'orphan',
          contentHash,
        })
      } catch (err) {
        logger?.error({ err }, '[media] 转存数据库写入失败，尝试回滚已上传对象')
        await deleteObject(objectKey)
        throw new Error('数据库写入失败')
      }

      return { sourceUrl, url, error: null }
    } catch (err) {
      // 单张失败不阻断批次：返回错误描述，前端保留原外链
      const message = err instanceof Error ? err.message : '转存失败'
      logger?.warn({ sourceUrl, message }, '[media] 外链图片转存失败')
      return { sourceUrl, url: null, error: message }
    }
  })

  const transferred = items.filter((item) => item.url !== null).length
  return { items, transferred }
}
