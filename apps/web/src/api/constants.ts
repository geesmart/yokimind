/**
 * API 常量定义
 * 包含 API 版本号、基础路径、错误码映射等
 */

/**
 * API 版本号
 * 与后端 routes.ts 中的版本号保持一致
 */
export const API_VERSION = 'v1'

/**
 * API 基础路径
 * 开发环境通过 Vite 代理转发，生产环境直接请求
 */
export const API_BASE_PATH = '/api'

/**
 * 完整 API 前缀路径
 */
export const API_PREFIX = `${API_BASE_PATH}/${API_VERSION}`

/**
 * API 基础 URL
 * 根据环境自动配置
 */
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || ''

/**
 * 默认请求超时时间（毫秒）
 */
export const DEFAULT_TIMEOUT = 30000

/**
 * Token 存储键名
 */
export const TOKEN_STORAGE_KEYS = {
  ACCESS_TOKEN: 'yokimind_access_token',
  REFRESH_TOKEN: 'yokimind_refresh_token',
  EXPIRES_AT: 'yokimind_token_expires_at',
  USER_INFO: 'yokimind_user_info',
} as const

/**
 * HTTP 请求头
 */
export const HEADERS = {
  /** 内容类型 */
  CONTENT_TYPE: 'Content-Type',
  /** 认证令牌 */
  AUTHORIZATION: 'Authorization',
  /** 接受内容类型 */
  ACCEPT: 'Accept',
  /** JSON 内容类型 */
  JSON: 'application/json',
  /** 表单内容类型 */
  FORM_URLENCODED: 'application/x-www-form-urlencoded',
  /** 多部分内容类型（文件上传） */
  MULTIPART: 'multipart/form-data',
} as const

/**
 * 业务错误码映射
 * 与后端 error-code.ts 保持一致
 */
export const ERROR_CODES = {
  // 系统错误 (1xxxx)
  SERVER_ERROR: 10000,
  INVALID_REQUEST: 10001,
  FORBIDDEN: 10002,
  UNAUTHORIZED: 10003,

  // 用户错误 (2xxxx)
  USER_NOT_FOUND: 20001,
  USER_ALREADY_EXISTS: 20002,
  INVALID_PASSWORD: 20003,
  INVALID_OLD_PASSWORD: 20004, // 当前密码错误（修改密码时）
  SAME_PASSWORD: 20005, // 新密码与原密码相同

  // 智能体接入令牌错误 (21xxx)
  PAT_INVALID: 21001, // 令牌无效（格式错误 / 不存在）
  PAT_REVOKED: 21002, // 令牌已吊销
  PAT_EXPIRED: 21003, // 令牌已过期

  // 设备错误 (3xxxx)
  DEVICE_REGISTER_FAILED: 30001,
  DEVICE_NOT_FOUND: 30002,
  HEARTBEAT_INVALID_DEVICE: 31001,
  HEARTBEAT_FAILED: 31002,
  FEEDBACK_CREATE_FAILED: 32001,
  FEEDBACK_INVALID_TYPE: 32002,
  VERSION_NOT_FOUND: 33001,

  // AI 服务错误 (4xxxx)
  AI_SERVICE_ERROR: 40001,
  AI_RESPONSE_PARSE_ERROR: 40002,
  AI_RATE_LIMIT: 40003,
  INSUFFICIENT_CREDITS: 40004,

  // 知识库错误 (5xxxx)
  WIKI_NOT_FOUND: 50001, // 知识库不存在
  WIKI_CREATE_FAILED: 50002, // 创建知识库失败
  ACTIVITY_FETCH_FAILED: 50003, // 操作动态查询失败
  RECENT_VISIT_FETCH_FAILED: 50004, // 最近访问查询失败
  WIKI_NODE_CREATE_FAILED: 50005, // 创建文档节点失败
  TAG_NOT_FOUND: 50006, // 标签不存在 / 未关联该文档
  TAG_CREATE_FAILED: 50007, // 创建标签失败
  DOCUMENT_SAVE_FAILED: 50008, // 保存文档失败
  DOCUMENT_VERSION_CONFLICT: 50009, // 乐观锁冲突
  DOCUMENT_SAVE_RATE_LIMITED: 50010, // 保存频率超限
  WIKI_NODE_DELETE_FAILED: 50011, // 删除文档节点失败
  WIKI_NODE_NOT_IN_TRASH: 50013, // 节点不在回收站中
  WIKI_NODE_RESTORE_FAILED: 50014, // 恢复回收站节点失败

  // 媒体资产错误 (6xxxx)
  MEDIA_INVALID_TYPE: 60001, // 不支持的图片类型
  MEDIA_FILE_TOO_LARGE: 60002, // 图片大小超出限制
  MEDIA_UPLOAD_FAILED: 60003, // 图片上传失败
  MEDIA_FILE_REQUIRED: 60004, // 请选择要上传的图片
  MEDIA_NOT_FOUND: 60005, // 媒体资源不存在

  // 知识库分享错误 (7xxxx)
  SHARE_NOT_FOUND: 70001, // 分享不存在或已关闭
  SHARE_PASSWORD_REQUIRED: 70002, // 该分享需要访问密码
  SHARE_PASSWORD_INVALID: 70003, // 访问密码错误
  SHARE_TOKEN_INVALID: 70004, // 访问凭证无效或已过期
  SHARE_VERIFY_RATE_LIMITED: 70005, // 密码校验过于频繁

  // 资源错误 (404xx)
  NOT_FOUND: 40400,

  // 管理后台错误 (9xxxx)
  ADMIN_FORBIDDEN: 90001, // 无管理员权限（admins 白名单未命中）
  AI_TEST_FAILED: 90002, // AI 连接测试失败
} as const

/**
 * HTTP 状态码
 */
export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INTERNAL_ERROR: 500,
} as const

/**
 * HTTP 状态码对应的友好提示信息
 */
export const HTTP_STATUS_MESSAGES: Record<number, string> = {
  [HTTP_STATUS.OK]: '请求成功',
  [HTTP_STATUS.CREATED]: '创建成功',
  [HTTP_STATUS.NO_CONTENT]: '无内容',
  [HTTP_STATUS.BAD_REQUEST]: '请求参数错误',
  [HTTP_STATUS.UNAUTHORIZED]: '未授权，请登录',
  [HTTP_STATUS.FORBIDDEN]: '无访问权限',
  [HTTP_STATUS.NOT_FOUND]: '资源不存在',
  [HTTP_STATUS.INTERNAL_ERROR]: '服务器内部错误',
}

/**
 * 业务错误码对应的友好提示信息
 */
export const ERROR_MESSAGES: Record<number, string> = {
  [ERROR_CODES.SERVER_ERROR]: '服务器错误，请稍后重试',
  [ERROR_CODES.INVALID_REQUEST]: '请求参数无效',
  [ERROR_CODES.FORBIDDEN]: '无访问权限',
  [ERROR_CODES.UNAUTHORIZED]: '登录已过期，请重新登录',
  [ERROR_CODES.USER_NOT_FOUND]: '用户不存在',
  [ERROR_CODES.USER_ALREADY_EXISTS]: '用户已存在',
  [ERROR_CODES.INVALID_PASSWORD]: '密码错误',
  [ERROR_CODES.INVALID_OLD_PASSWORD]: '当前密码错误',
  [ERROR_CODES.SAME_PASSWORD]: '新密码不能与原密码相同',
  [ERROR_CODES.PAT_INVALID]: '访问令牌无效',
  [ERROR_CODES.PAT_REVOKED]: '访问令牌已吊销',
  [ERROR_CODES.PAT_EXPIRED]: '访问令牌已过期',
  [ERROR_CODES.DEVICE_REGISTER_FAILED]: '设备注册失败',
  [ERROR_CODES.DEVICE_NOT_FOUND]: '设备不存在',
  [ERROR_CODES.HEARTBEAT_INVALID_DEVICE]: '无效的设备 ID',
  [ERROR_CODES.HEARTBEAT_FAILED]: '心跳失败',
  [ERROR_CODES.FEEDBACK_CREATE_FAILED]: '反馈创建失败',
  [ERROR_CODES.FEEDBACK_INVALID_TYPE]: '无效的反馈类型',
  [ERROR_CODES.VERSION_NOT_FOUND]: '版本不存在',
  [ERROR_CODES.AI_SERVICE_ERROR]: 'AI 服务错误',
  [ERROR_CODES.AI_RESPONSE_PARSE_ERROR]: 'AI 响应解析失败',
  [ERROR_CODES.AI_RATE_LIMIT]: 'AI 调用次数已达上限',
  [ERROR_CODES.INSUFFICIENT_CREDITS]: '积分不足',
  [ERROR_CODES.WIKI_NOT_FOUND]: '知识库不存在',
  [ERROR_CODES.WIKI_CREATE_FAILED]: '创建知识库失败',
  [ERROR_CODES.ACTIVITY_FETCH_FAILED]: '操作动态获取失败',
  [ERROR_CODES.RECENT_VISIT_FETCH_FAILED]: '最近访问获取失败',
  [ERROR_CODES.WIKI_NODE_CREATE_FAILED]: '创建文档失败',
  [ERROR_CODES.TAG_NOT_FOUND]: '标签不存在',
  [ERROR_CODES.TAG_CREATE_FAILED]: '创建标签失败',
  [ERROR_CODES.DOCUMENT_SAVE_FAILED]: '保存文档失败',
  [ERROR_CODES.DOCUMENT_VERSION_CONFLICT]: '文档已被其他人修改，请刷新后重试',
  [ERROR_CODES.DOCUMENT_SAVE_RATE_LIMITED]: '保存过于频繁，请稍后重试',
  [ERROR_CODES.WIKI_NODE_DELETE_FAILED]: '删除节点失败，请稍后重试',
  [ERROR_CODES.WIKI_NODE_NOT_IN_TRASH]: '内容不在回收站中',
  [ERROR_CODES.WIKI_NODE_RESTORE_FAILED]: '恢复失败，请稍后重试',
  [ERROR_CODES.MEDIA_INVALID_TYPE]: '不支持的图片类型',
  [ERROR_CODES.MEDIA_FILE_TOO_LARGE]: '图片大小超出限制',
  [ERROR_CODES.MEDIA_UPLOAD_FAILED]: '图片上传失败',
  [ERROR_CODES.MEDIA_FILE_REQUIRED]: '请选择要上传的图片',
  [ERROR_CODES.MEDIA_NOT_FOUND]: '媒体资源不存在',
  [ERROR_CODES.SHARE_NOT_FOUND]: '分享不存在或已关闭',
  [ERROR_CODES.SHARE_PASSWORD_REQUIRED]: '该分享需要访问密码',
  [ERROR_CODES.SHARE_PASSWORD_INVALID]: '访问密码错误',
  [ERROR_CODES.SHARE_TOKEN_INVALID]: '访问凭证无效或已过期，请重新输入密码',
  [ERROR_CODES.SHARE_VERIFY_RATE_LIMITED]: '尝试次数过多，请稍后再试',
  [ERROR_CODES.NOT_FOUND]: '资源不存在',
  [ERROR_CODES.ADMIN_FORBIDDEN]: '无管理员权限',
  [ERROR_CODES.AI_TEST_FAILED]: 'AI 连接测试失败',
}

/**
 * 接口路径常量
 * 与后端 routes.ts / 各模块 controller.ts 保持一致
 * baseURL 已含 `/api/v1` 前缀（见 request.ts），此处仅写模块路径
 */
export const API_PATHS = {
  /** 用户模块接口（user.controller.ts） */
  USER: {
    /** 用户注册：POST，无需鉴权 */
    REGISTER: '/user/register',
    /** 用户登录：POST，无需鉴权 */
    LOGIN: '/user/login',
    /** 退出登录：POST，需鉴权 */
    LOGOUT: '/user/logout',
    /** 当前用户资料：GET 获取 / POST 更新，需鉴权 */
    PROFILE: '/user/profile',
    /** 修改密码：POST，需鉴权 */
    PASSWORD: '/user/password',
  },
  /** 知识库模块接口（wiki.controller.ts） */
  WIKI: {
    /** 知识库列表：GET，需鉴权 */
    LIST: '/wiki',
    /** 创建知识库：POST，需鉴权 */
    CREATE: '/wiki',
    /** 知识库详情：GET /:id，需鉴权（仅 owner） */
    DETAIL: '/wiki',
    /** 更新知识库：PATCH /:id，需鉴权（仅 owner） */
    UPDATE: '/wiki',
    /** 知识库文档树：GET /:id/nodes，需鉴权（仅 owner） */
    NODES: '/wiki',
    /** 创建文档节点：POST /:id/nodes，需鉴权（仅 owner） */
    CREATE_NODE: '/wiki',
    /** 文档正文关键词搜索：POST /:id/search，需鉴权（仅 owner，搜索弹窗「内容命中」） */
    CONTENT_SEARCH: '/wiki',
    /** 文档正文：GET /document/:id，需鉴权（仅 owner） */
    DOCUMENT: '/wiki/document',
    /** 文档保存：POST /document/:id/save，需鉴权（自动保存） */
    DOCUMENT_SAVE: '/wiki/document',
    /** 节点标题保存：POST /:id/save-title，需鉴权 */
    NODE_TITLE_SAVE: '/wiki',
    /** 节点图标保存：POST /:id/save-icon，需鉴权 */
    NODE_ICON_SAVE: '/wiki',
    /** 删除文档节点：POST /:id/delete，需鉴权（软删除进回收站） */
    DELETE_NODE: '/wiki',
    /** 回收站列表：POST /:wikiId/trash，需鉴权（仅 owner） */
    TRASH: '/wiki',
    /** 恢复回收站节点：POST /:id/trash/restore，需鉴权（仅 owner） */
    TRASH_RESTORE: '/wiki',
    /** 彻底删除回收站节点：POST /:id/trash/purge，需鉴权（仅 owner） */
    TRASH_PURGE: '/wiki',
    /** 一键清空回收站：POST /:wikiId/trash/empty，需鉴权（仅 owner） */
    TRASH_EMPTY: '/wiki',
    /** 删除知识库：POST /:id/delete-wiki，需鉴权（软删除移入回收站，仅 owner） */
    DELETE_WIKI: '/wiki',
    /** 知识库回收站列表：POST /trash，需鉴权（软删除的知识库，仅 owner） */
    WIKI_TRASH_LIST: '/wiki/trash',
    /** 从回收站恢复知识库：POST /:id/restore，需鉴权（撤销软删除，仅 owner） */
    WIKI_RESTORE: '/wiki',
    /** 彻底删除回收站中的知识库：POST /:id/purge，需鉴权（硬删除级联清理，仅 owner） */
    WIKI_PURGE: '/wiki',
    /** 节点分享配置：POST /node/:nodeId/share（nodeId 全局唯一，无需 wikiId），需鉴权（仅 owner） */
    NODE_SHARE: '/wiki/node',
    /** 移动文档节点（拖拽排序持久化）：POST /node/:nodeId/move，需鉴权（仅 owner） */
    NODE_MOVE: '/wiki/node',
  },
  /** Dashboard 模块接口（dashboard.controller.ts） */
  DASHBOARD: {
    /** 最近访问列表：GET，需鉴权 */
    RECENT_VISITS: '/dashboard/recent-visits',
    /** 操作动态列表：GET，需鉴权 */
    ACTIVITIES: '/dashboard/activities',
  },
  /** 媒体资产模块接口（media.controller.ts） */
  MEDIA: {
    /** 上传图片：POST multipart/form-data，需鉴权 */
    UPLOAD: '/media/upload',
    /** 批量转存外链图片到对象存储：POST JSON，需鉴权（Markdown 导入场景） */
    TRANSFER_REMOTE: '/media/transfer-remote',
  },
  /** 知识库分享模块接口（share.controller.ts，公开接口无需登录） */
  SHARE: {
    /** 分享元信息：GET /share/wiki/:wikiId，无需登录 */
    META: '/share/wiki',
    /** 密码校验：POST /share/wiki/:wikiId/verify，无需登录 */
    VERIFY: '/share/wiki',
    /** 访客文档树：GET /share/wiki/:wikiId/nodes，需分享令牌（若设密码） */
    NODES: '/share/wiki',
    /** 访客文档正文：GET /share/wiki/:wikiId/document/:documentId，需分享令牌（若设密码） */
    DOCUMENT: '/share/wiki',
  },
  /** 知识库发布模块接口（publish.controller.ts，owner 发布语义） */
  PUBLISH: {
    /** 发布设置：GET /publish/wiki/:wikiId/settings（登录）/ PUT（登录或预览令牌） */
    SETTINGS: '/publish/wiki',
    /** 预览令牌签发：POST /publish/wiki/:wikiId/token，需鉴权（仅 owner） */
    TOKEN: '/publish/wiki',
    /** 发布/取消发布：POST /publish/wiki/:wikiId/publish | /unpublish（预览令牌鉴权） */
    PUBLISH_TOGGLE: '/publish/wiki',
  },
  /** RAG AI 知识库模块接口（rag.controller.ts，需鉴权且校验知识库归属） */
  RAG: {
    /** 语义搜索：POST，返回与查询语义最相近的知识库切片 */
    SEARCH: '/rag/search',
    /** AI 问答：POST SSE 流式（delta/sources/done/error 事件） */
    CHAT: '/rag/chat',
    /** 索引状态统计：POST，各状态文档数与切片总数（读 wiki_rag 快照） */
    STATUS: '/rag/status',
    /** 批量索引状态统计：POST，多库状态一次性拉取（Dashboard 列表四态圆点数据源） */
    STATUS_BATCH: '/rag/status-batch',
    /** 单文档索引状态：POST，文档编辑页徽标数据源（none/pending/running/done/failed） */
    DOCUMENT_STATUS: '/rag/document-status',
    /** 全量重建索引：POST，重置 pending 并重新入队 */
    REINDEX: '/rag/reindex',
    /** 单文档立即索引：POST，重置并重跑指定文档的索引任务（编辑页 RAG 标签弹层按钮） */
    DOCUMENT_REINDEX: '/rag/document-reindex',
  },
  /** AI 写作模块接口（ai.controller.ts，需鉴权） */
  AI: {
    /** 查询 AI 写作服务是否已配置：POST（仅登录，返回 { chatReady }） */
    STATUS: '/ai/status',
    /** AI 写作：POST SSE 流式（message/done/aborted/error 事件，协议见 ai-sse.ts） */
    WRITE: '/ai/write',
    /** 中止指定 AI 请求：POST（前端「停止生成」按钮调用） */
    ABORT: '/ai/abort',
  },
  /** 管理后台模块接口（admin.controller.ts，需鉴权且需管理员权限） */
  ADMIN: {
    /** 查看 AI 配置：POST（apiKey 脱敏为掩码回显） */
    SETTINGS: '/admin/settings',
    /** 保存 AI 配置：POST（字段 undefined=不修改，空串=清除覆盖回退环境变量） */
    SETTINGS_SAVE: '/admin/settings/save',
    /** AI 连接测试：POST（chat / embedding 逐项返回结果，失败不抛错） */
    TEST_AI: '/admin/test-ai',
  },
  /** 智能体接入令牌模块接口（token.controller.ts，需鉴权；PAT 管理页用） */
  TOKEN: {
    /** 令牌列表：POST（脱敏视图，不含哈希与明文） */
    LIST: '/token/list',
    /** 创建令牌：POST（明文仅在本次响应中出现一次） */
    CREATE: '/token/create',
    /** 吊销令牌：POST（幂等不可逆） */
    REVOKE: '/token/revoke',
  },
} as const
