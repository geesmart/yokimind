/**
 * API 常量定义（apps/pages 公开内容站）
 *
 * 与 apps/server 的路由版本号、错误码保持一致；
 * 错误码完整表见 apps/web/src/api/constants.ts，此处仅收录公开内容站会用到的子集，
 * 后续新增内容类型（blog / 日志）时按需补充对应错误码与接口路径。
 */

/**
 * API 版本号（与后端 routes.ts 的版本号保持一致）
 */
export const API_VERSION = 'v1'

/**
 * API 基础路径
 */
export const API_BASE_PATH = '/api'

/**
 * 完整 API 前缀路径（浏览器端同源请求使用）
 */
export const API_PREFIX = `${API_BASE_PATH}/${API_VERSION}`

/**
 * 业务错误码（子集，与后端 error-code.ts 对齐）
 */
export const ERROR_CODES = {
  // 系统错误 (1xxxx)
  SERVER_ERROR: 10000,
  INVALID_REQUEST: 10001,
  FORBIDDEN: 10002,
  UNAUTHORIZED: 10003,

  // 知识库分享错误 (7xxxx)：访客端公开内容相关
  SHARE_NOT_FOUND: 70001, // 分享不存在或已关闭
  SHARE_PASSWORD_REQUIRED: 70002, // 该分享需要访问密码
  SHARE_PASSWORD_INVALID: 70003, // 访问密码错误
  SHARE_TOKEN_INVALID: 70004, // 访问凭证无效或已过期
  SHARE_VERIFY_RATE_LIMITED: 70005, // 密码校验过于频繁
  SHARE_PAGE_LOCKED_BY_WIKI: 70008, // 库分享开启时页面分享被锁定
  PREVIEW_TOKEN_INVALID: 70010, // 预览凭证无效或已过期（owner 专属预览模式）
  SHARE_AI_DISABLED: 70011, // 站点未开放 AI 助手（owner 关闭了 AI 助手开关）

  // 资源错误 (404xx)
  NOT_FOUND: 40400,
} as const

/**
 * 接口路径常量（baseURL 已含 /api/v1 前缀，此处仅写模块路径）
 * 收录公开内容站会用到的两组接口（share/publish 语义拆分）：
 * - SHARE：访客端分享接口（帮助中心 / 博客两种公开形态共用，无需登录）
 * - PUBLISH：owner 发布/预览接口（预览站预览面板用，预览令牌鉴权）
 */
export const API_PATHS = {
  /** 知识库分享模块（share.controller.ts，公开接口无需登录） */
  SHARE: {
    /** 分享元信息：GET /share/wiki/:wikiId（?docId= 可选） */
    META: '/share/wiki',
    /** 密码校验：POST /share/wiki/:wikiId/verify */
    VERIFY: '/share/wiki',
    /** 访客文档树：GET /share/wiki/:wikiId/nodes */
    NODES: '/share/wiki',
    /** 访客文档正文：GET /share/wiki/:wikiId/document/:documentId */
    DOCUMENT: '/share/wiki',
    /** 博客文章列表：GET /share/wiki/:wikiId/blog */
    BLOG: '/share/wiki',
    /** 访客 AI 问答（SSE 流式）：POST /share/wiki/:wikiId/ai-chat */
    AI_CHAT: '/share/wiki',
  },
  /** 知识库发布模块（publish.controller.ts，owner 发布/预览语义，预览令牌鉴权） */
  PUBLISH: {
    /** 发布设置读取/保存：GET/PUT /publish/wiki/:wikiId/settings（预览面板保存走预览令牌） */
    SETTINGS: '/publish/wiki',
    /** 预览聚合 / 预览正文 / 预览图片上传：前缀 /publish/wiki/:wikiId */
    PREVIEW: '/publish/wiki',
  },
} as const
