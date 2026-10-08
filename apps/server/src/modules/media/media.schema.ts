/**
 * 媒体资产模块 Schema / 类型定义
 *
 * 说明：
 * - 上传接口走 multipart/form-data，文件字段不做 Zod 校验（Hono parseBody 返回 File 后由 service 层校验）
 * - 本文件仅定义上传成功响应的 DTO 类型，供 controller 与 service 共享
 */

/**
 * 上传图片成功响应
 * 与前端 api/modules/media.ts 的 UploadImageResult 对齐
 */
export interface UploadImageResult {
  /** 媒体资产 ID（ULID） */
  id: string
  /** 对外访问 URL（对象存储绝对地址，如 http://host:9000/bucket/uploads/2026-08-25/01HXXX.jpg，前端直接用作 <img src>） */
  url: string
  /** 存储后的文件名（含扩展名） */
  fileName: string
  /** 用户上传时的原始文件名（可能为 null） */
  originalName: string | null
  /** MIME 类型（如 image/jpeg） */
  mimeType: string
  /** 文件大小（字节） */
  size: number
  /** 图片宽度（像素，未读取时为 null） */
  width: number | null
  /** 图片高度（像素，未读取时为 null） */
  height: number | null
}
