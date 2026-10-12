/**
 * 媒体资产模块接口
 *
 * 对接后端 `/api/v1/media/*` 接口（media.controller.ts）：
 * - uploadImage  上传图片  POST /media/upload  multipart/form-data  需鉴权
 *
 * 设计说明：
 * - alova 的 fetch adapter 不支持上传进度回调（fetch API 本身不支持上传进度）
 * - 文件上传需要展示真实进度，因此这里改用 XMLHttpRequest 直接封装
 * - 内部仍走 alova 的统一规范：
 *   1) 复用 getAccessToken 注入 Authorization Bearer
 *   2) 复用 alova baseURL `/api/v1` + API_PATHS 路径常量
 *   3) 复用统一响应解包 `{ status, data, info }`，成功返回 data
 *   4) 复用 clearAuth 处理 401
 */
import { API_BASE_URL, API_PREFIX, API_PATHS } from '../constants'
import { getAccessToken, clearAuth } from '../../utils/token'
import { ApiError } from '../request'

// ==================== 类型定义 ====================

/**
 * 上传图片成功响应
 * 与后端 modules/media/media.schema.ts 的 UploadImageResult 对齐
 */
export interface UploadImageResult {
  /** 媒体资产 ID（ULID） */
  id: string
  /** 对外访问 URL（相对路径 /media/{bucket}/{key}，浏览器按当前 origin 解析，前端直接用作 <img src>） */
  url: string
  /** 存储后的文件名（含扩展名） */
  fileName: string
  /** 原始文件名（可能为 null） */
  originalName: string | null
  /** MIME 类型（如 image/jpeg） */
  mimeType: string
  /** 文件大小（字节） */
  size: number
  /** 图片宽度（像素，未解析时为 null） */
  width: number | null
  /** 图片高度（像素，未解析时为 null） */
  height: number | null
}

/**
 * 上传入参
 * - file: 用户选择的图片文件
 * - wikiId / documentId: 可选归属绑定（与后端 mediaAssets 表的软关联字段对齐）
 */
export interface UploadImageParams {
  /** 待上传图片文件 */
  file: File
  /** 所属知识库 ID（可选，软关联） */
  wikiId?: string
  /** 所属文档 ID（可选，软关联） */
  documentId?: string
}

/**
 * 上传配置
 * - onProgress: 上传进度回调（0-100 整数）
 * - signal: AbortSignal，用于取消上传
 */
export interface UploadImageConfig {
  /** 上传进度回调（0-100） */
  onProgress?: (percent: number) => void
  /** 取消信号（调用 abort 后会触发 onerror） */
  signal?: AbortSignal
}

// ==================== 接口函数 ====================

/**
 * 上传图片
 * POST /media/upload（multipart/form-data，需鉴权）
 *
 * 实现要点：
 * - 使用 XMLHttpRequest 以支持上传进度
 * - 自动注入 Authorization Bearer token
 * - 响应统一按 `{ status, data, info }` 解包
 * - 401 自动清空本地认证信息
 * - 失败抛 ApiError，与 alova 链路对齐
 *
 * @param params 上传参数（file 必填，wikiId/documentId 可选）
 * @param config 上传配置（进度回调 / 取消信号）
 * @returns 上传成功后的资产信息（含可用的 URL）
 */
export function uploadImage(
  params: UploadImageParams,
  config: UploadImageConfig = {}
): Promise<UploadImageResult> {
  const { file, wikiId, documentId } = params
  const { onProgress, signal } = config

  return new Promise<UploadImageResult>((resolve, reject) => {
    // 构造 FormData
    const formData = new FormData()
    formData.append('file', file)
    if (wikiId) formData.append('wikiId', wikiId)
    if (documentId) formData.append('documentId', documentId)

    // 拼接完整 URL：baseURL + /api/v1 + /media/upload
    const url = `${API_BASE_URL}${API_PREFIX}${API_PATHS.MEDIA.UPLOAD}`

    const xhr = new XMLHttpRequest()
    xhr.open('POST', url)

    // 注入 Token（与 alova beforeRequest 一致）
    const token = getAccessToken()
    if (token) {
      xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    }

    // 上传进度回调（只在能计算出进度时触发）
    // - xhr.upload.onprogress 在支持上传进度事件的浏览器中触发
    // - lengthComputable 为 false 时（如 chunked encoding）跳过
    if (onProgress && xhr.upload) {
      xhr.upload.onprogress = (e: ProgressEvent) => {
        if (e.lengthComputable) {
          const percent = Math.round((e.loaded / e.total) * 100)
          onProgress(percent)
        }
      }
    }

    // 加载完成：解析响应
    xhr.onload = () => {
      // HTTP 401：与 alova 链路一致，清空本地认证
      if (xhr.status === 401) {
        clearAuth()
        reject(new ApiError('登录已过期，请重新登录', 10003, 401))
        return
      }

      // 解析后端统一响应格式
      let result: { status: number; data?: UploadImageResult; info?: string }
      try {
        result = JSON.parse(xhr.responseText || '{}')
      } catch {
        reject(new ApiError('响应解析失败', 10000, xhr.status))
        return
      }

      // 业务失败：status !== 1
      if (result.status !== 1) {
        reject(
          new ApiError(result.info || '上传失败', result.status || 0, xhr.status, result)
        )
        return
      }

      // 成功：返回 data
      if (!result.data) {
        reject(new ApiError('响应缺少 data 字段', 10000, xhr.status, result))
        return
      }
      resolve(result.data)
    }

    // 网络错误 / 请求被中断
    xhr.onerror = () => {
      reject(new ApiError('网络错误，请稍后重试', 10000))
    }
    xhr.onabort = () => {
      reject(new ApiError('上传已取消', 10001))
    }

    // 取消信号支持
    if (signal) {
      // 若 signal 已经 aborted，直接 abort xhr
      if (signal.aborted) {
        xhr.abort()
      } else {
        signal.addEventListener('abort', () => xhr.abort(), { once: true })
      }
    }

    // 发送请求
    xhr.send(formData)
  })
}
