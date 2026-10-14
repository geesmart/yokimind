import { Hono } from 'hono'
import { authMiddleware, getCurrentUserId } from '~/core/middleware/auth.middleware.js'
import { BizException } from '~/core/lib/biz.exception.js'
import { ErrorCode } from '~/config/error-code.js'
import { vJson } from '~/core/helper/zod.helper.js'
import { uploadImage, transferRemoteImages } from './media.service.js'
import { TransferRemoteSchema } from './media.schema.js'

/**
 * 媒体资产控制器
 * 提供图片上传与外链图片转存接口，均需登录
 *
 * - POST /media/upload          上传图片（multipart/form-data，字段名 file）
 * - POST /media/transfer-remote 批量转存外链图片到对象存储（Markdown 导入场景）
 *
 * 注：图片访问走统一入口 `/media/*` 路由直连对象存储，不需要 controller 转发
 */
const mediaController = new Hono()
  // 上传图片（需鉴权）
  // 表单字段：file（必填，单个文件） + wikiId（可选） + documentId（可选）
  .post('/upload', authMiddleware, async (c) => {
    const userId = getCurrentUserId(c)!
    const contentType = c.req.header('content-type') || ''

    // 校验 Content-Type 必须为 multipart/form-data
    if (!contentType.includes('multipart/form-data')) {
      throw new BizException(ErrorCode.INVALID_REQUEST, '请使用 multipart/form-data 提交')
    }

    // 解析 multipart body
    // - all: false 表示只取字段第一个值（避免同名多文件场景）
    // - 大文件场景下，parseBody 内部会流式读取，不会一次性占满内存
    let body: Record<string, unknown>
    try {
      body = (await c.req.parseBody({ all: false })) as Record<string, unknown>
    } catch {
      throw new BizException(ErrorCode.MEDIA_FILE_REQUIRED)
    }

    // 校验 file 字段存在且为 File 类型
    const file = body['file']
    if (!file || typeof file === 'string' || !(file instanceof File)) {
      throw new BizException(ErrorCode.MEDIA_FILE_REQUIRED)
    }

    // 可选的归属绑定字段
    const wikiId = typeof body['wikiId'] === 'string' ? (body['wikiId'] as string) : undefined
    const documentId =
      typeof body['documentId'] === 'string' ? (body['documentId'] as string) : undefined

    // 调用 service 完成落盘 + 入库（对外 URL 恒为相对路径 /media/{bucket}/{key}，见 storage.buildObjectUrl）
    const result = await uploadImage({ file, userId, wikiId, documentId })

    return c.success(result)
  })
  // 批量转存外链图片（需鉴权，Markdown 导入场景）
  // body: { urls: string[], wikiId?, documentId? }，逐张独立容错（部分成功允许）
  .post('/transfer-remote', authMiddleware, vJson(TransferRemoteSchema), async (c) => {
    const userId = getCurrentUserId(c)!
    const { urls, wikiId, documentId } = c.req.valid('json')

    const result = await transferRemoteImages({ urls, userId, wikiId, documentId })

    return c.success(result)
  })

export default mediaController
