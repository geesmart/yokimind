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
 * - entryOrigin: 请求派生的入口 origin（controller 从 X-Forwarded-* 取，见 media.controller），
 *   用于生成跟随访问域名的对外 URL；缺省走 storage 兜底链
 */
export interface UploadImageParams {
  file: File
  userId: string
  wikiId?: string
  documentId?: string
  entryOrigin?: string
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
  const { file, userId, wikiId, documentId, entryOrigin } = params

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
  // 对外 URL：自动跟随访问域名（controller 从 X-Forwarded-* 派生入口 origin 传入，
  // 见 storage.resolvePublicUrl 的优先级链），换域名/端口零配置
  let url: string
  try {
    url = buildObjectUrl(objectKey, entryOrigin)
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
