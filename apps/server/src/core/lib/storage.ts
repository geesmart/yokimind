/**
 * S3 兼容对象存储客户端（对接 RustFS / MinIO / AWS S3 等任何 S3 API 实现）
 *
 * 设计要点：
 * - 惰性单例：首次调用 getS3Client() 时按环境变量创建客户端，进程内复用；
 *   不依赖 Hono 上下文，脚本 / worker 等非请求场景同样可用（与 postgres.ts 的 usePostgres 模式一致）。
 * - 完全替换本地磁盘存储：media.service 的上传 / 回滚全部走这里，不再有 fs.writeFile。
 * - 桶策略为公开读（anonymous read）：文档正文 img src 直连对象存储 URL，
 *   ULID + 日期的 key 不可枚举，与原 serveStatic 无鉴权行为一致，不引入额外暴露面。
 *
 * 环境变量：
 * - S3_ENDPOINT   必填，S3 API 地址（容器内如 http://rustfs:9000，宿主开发如 http://localhost:9000）
 * - S3_BUCKET     必填，桶名（如 yokimind-media）
 * - S3_ACCESS_KEY 必填，访问密钥
 * - S3_SECRET_KEY 必填，秘密密钥
 * - 对外基址（浏览器可达，四级优先级，见 resolvePublicUrl）：
 *   1. S3_PUBLIC_URL 显式覆盖
 *   2. 请求派生（X-Forwarded-Proto/Host，即浏览器地址栏 origin——换域名零配置）
 *   3. PUBLIC_ORIGIN 显式配置的入口 origin
 *   4. 默认 `${S3_ENDPOINT}/${S3_BUCKET}`（同机直连 / 无反代场景）
 *   反代 / 跨机部署时 endpoint（服务端内网）与 public URL（浏览器外网）往往不同
 */
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketPolicyCommand,
} from '@aws-sdk/client-s3'
import { usePino } from '~/core/plugins/pino.js'

const logger = usePino()

/** 进程内单例（惰性创建） */
let s3Client: S3Client | null = null

/**
 * 媒体类别（对象键一级前缀，固定枚举）
 * 前缀即权限/生命周期分界：img/avatar 公开直连；file/video/audio/export 私有（预签名下载）；
 * export 为可再生派生物，可整体清空重建。新增类别 = 追加常量 + kind 枚举值。
 * 详见 docs/产品设计/媒体文件存储设计.md
 */
export const MEDIA_KINDS = ['img', 'file', 'video', 'audio', 'avatar', 'export'] as const

export type MediaKind = (typeof MEDIA_KINDS)[number]

/**
 * 生成对象 key：{kind}/{ulid}.{ext}（单机版无时间分区）
 * 键生成收敛在此一处：未来需要物理分区（时间/哈希桶）时只改这里，旧键不动
 * @param kind 媒体类别（MEDIA_KINDS 之一）
 * @param fileName 存储文件名（小写 ULID + 小写扩展名，如 01j8z3f9k2.png）
 */
export function buildObjectKey(kind: MediaKind, fileName: string): string {
  return `${kind}/${fileName}`
}

/** 键不可变（ULID 唯一永不覆盖），浏览器/代理可永久缓存 */
const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable'

/** 存储配置（从环境变量解析，lazy 缓存） */
let storageConfig: {
  endpoint: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
} | null = null

/**
 * 解析并缓存 S3 配置
 * 四个必填变量任一缺失时返回 null（未配置 = 功能整体不可用，由调用方决定报错行为）
 */
function resolveConfig() {
  if (storageConfig) return storageConfig

  const endpoint = process.env.S3_ENDPOINT
  const bucket = process.env.S3_BUCKET
  const accessKeyId = process.env.S3_ACCESS_KEY
  const secretAccessKey = process.env.S3_SECRET_KEY

  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    return null
  }

  storageConfig = { endpoint, bucket, accessKeyId, secretAccessKey }
  return storageConfig
}

/** 去除末尾斜杠（origin / endpoint 拼接前统一处理） */
function stripTrailingSlash(url: string): string {
  return url.replace(/\/$/, '')
}

/**
 * 解析对象存储的对外访问基址（浏览器可达），按优先级取第一个命中：
 * 1. S3_PUBLIC_URL        显式覆盖（对象存储走独立域名/CDN 等特殊部署时用）
 * 2. entryOrigin 请求派生 反代/统一入口场景：Caddy 会带 X-Forwarded-Proto/Host，
 *    值即浏览器地址栏的 origin——换域名、换端口自动跟随，零配置
 * 3. PUBLIC_ORIGIN        显式配置的入口 origin（直连 server 无 X-Forwarded-* 头时的兜底）
 * 4. endpoint + bucket    同机直连兜底（无反代时与对外地址一致）
 *
 * 2/3 都拼 /media/{bucket} 前缀：与 Caddy 的 handle_path /media/* 剥前缀转发
 * （rustfs:9000/{bucket}/...）精确对齐
 */
export function resolvePublicUrl(entryOrigin?: string): string {
  const cfg = resolveConfig()
  if (!cfg) {
    throw new Error('S3 存储未配置，无法生成对外访问基址')
  }
  if (process.env.S3_PUBLIC_URL) return stripTrailingSlash(process.env.S3_PUBLIC_URL)
  if (entryOrigin) return `${stripTrailingSlash(entryOrigin)}/media/${cfg.bucket}`
  if (process.env.PUBLIC_ORIGIN) return `${stripTrailingSlash(process.env.PUBLIC_ORIGIN)}/media/${cfg.bucket}`
  return `${stripTrailingSlash(cfg.endpoint)}/${cfg.bucket}`
}

/** 存储是否已配置（供启动日志与测试环境判断使用） */
export function isStorageConfigured(): boolean {
  return resolveConfig() !== null
}

/**
 * 获取 S3 客户端单例
 * 未配置或未初始化时抛错：媒体上传是硬依赖，缺配置应显式失败而非静默降级
 */
export function getS3Client(): S3Client {
  const cfg = resolveConfig()
  if (!cfg) {
    throw new Error('S3 存储未配置，请设置 S3_ENDPOINT / S3_BUCKET / S3_ACCESS_KEY / S3_SECRET_KEY')
  }
  if (!s3Client) {
    s3Client = new S3Client({
      endpoint: cfg.endpoint,
      region: process.env.S3_REGION || 'us-east-1', // RustFS / MinIO 不校验 region，占位即可
      credentials: {
        accessKeyId: cfg.accessKeyId,
        secretAccessKey: cfg.secretAccessKey,
      },
      // RustFS 等 S3 兼容实现用 path-style 寻址（endpoint/bucket/key），
      // AWS 官方默认的 virtual-host style（bucket.endpoint）不适用
      forcePathStyle: true,
    })
  }
  return s3Client
}

/**
 * 拼接对象 key 的对外访问 URL
 * @param key 对象 key（如 uploads/2026-09-29/xxx.jpg）
 * @param entryOrigin 请求派生的入口 origin（反代场景从 X-Forwarded-* 取，见 media.controller）；
 *                    缺省时按 PUBLIC_ORIGIN / endpoint 兜底链解析
 */
export function buildObjectUrl(key: string, entryOrigin?: string): string {
  return `${resolvePublicUrl(entryOrigin)}/${key}`
}

/**
 * 启动时确保桶存在且公开可读（幂等，可重复调用）
 * 失败仅 warn 不抛：让服务能带着「存储暂不可用」的状态启动（与向量清理容错风格一致），
 * 首次上传时会因桶缺失再次失败并暴露在错误日志里
 */
export async function ensureBucket(): Promise<void> {
  if (!isStorageConfigured()) {
    logger.warn('S3 storage not configured, skip ensureBucket')
    return
  }
  const cfg = resolveConfig()!
  const client = getS3Client()

  try {
    // 桶已存在则跳过创建（HeadBucket 404 时才 Create）
    try {
      await client.send(new HeadBucketCommand({ Bucket: cfg.bucket }))
    } catch {
      await client.send(new CreateBucketCommand({ Bucket: cfg.bucket }))
      logger.info({ bucket: cfg.bucket }, 'S3 bucket created')
    }

    // 公开读策略：文档正文 img 直连 URL，无需签名
    const policy = {
      Version: '2012-10-17',
      Statement: [
        {
          Sid: 'PublicReadGetObject',
          Effect: 'Allow',
          Principal: { AWS: ['*'] },
          Action: ['s3:GetObject'],
          Resource: [`arn:aws:s3:::${cfg.bucket}/*`],
        },
      ],
    }
    await client.send(
      new PutBucketPolicyCommand({ Bucket: cfg.bucket, Policy: JSON.stringify(policy) })
    )
    logger.info({ bucket: cfg.bucket }, 'S3 bucket ready (public-read)')
  } catch (err) {
    logger.warn({ err }, 'S3 ensureBucket failed, storage may be unavailable')
  }
}

/**
 * 上传对象
 * @param key 对象 key（如 img/01j8z3f9k2.png）
 * @param body 文件内容
 * @param contentType MIME 类型
 */
export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  const cfg = resolveConfig()
  if (!cfg) {
    throw new Error('S3 存储未配置，无法上传对象')
  }
  await getS3Client().send(
    new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      // ULID 键不可变（永不覆盖），允许浏览器/CDN 长缓存，重复访问零回源
      CacheControl: IMMUTABLE_CACHE_CONTROL,
    })
  )
}

/**
 * 读取对象内容（返回字节流 Buffer 与 MIME 类型）
 * 供需要回源校验的场景使用（如集成测试比对上传字节）
 */
export async function getObject(key: string): Promise<{ body: Buffer; contentType?: string }> {
  const cfg = resolveConfig()
  if (!cfg) {
    throw new Error('S3 存储未配置，无法读取对象')
  }
  const resp = await getS3Client().send(
    new GetObjectCommand({ Bucket: cfg.bucket, Key: key })
  )
  const bytes = await resp.Body?.transformToByteArray()
  return {
    body: Buffer.from(bytes ?? []),
    contentType: resp.ContentType,
  }
}

/**
 * 删除对象（幂等：对象不存在时不报错）
 * 用于数据库写入失败时回滚已上传的文件，避免产生孤儿对象
 */
export async function deleteObject(key: string): Promise<void> {
  const cfg = resolveConfig()
  if (!cfg) {
    throw new Error('S3 存储未配置，无法删除对象')
  }
  try {
    await getS3Client().send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key }))
  } catch (err) {
    // 回滚失败不应掩盖主流程错误：仅记录，留给对象存储生命周期策略 / 手工清理
    logger.warn({ err, key }, 'S3 deleteObject failed during rollback')
  }
}
