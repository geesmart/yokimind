/**
 * 知识库分享模块接口（share 语义："分享给别人看/编辑"）
 *
 * 对接后端 `/api/v1/share/*` 与 `/api/v1/wiki/*` 分享接口（share.controller.ts），分为两类：
 * - owner 端（需登录）：
 *   - 整库分享配置：GET/POST `/wiki/:id/share`（shareStatus: private/public + 密码明文回显）
 *   - 单页（节点）分享：POST `/wiki/node/:nodeId/share`（仅库分享关闭时可配置：
 *     public=单页公开、inherit=关闭页面分享并删除配置行）
 *
 * 权限模型（两级独立，v2 重设计）：
 * - 库分享开启：全部文档跟随库开放（密码继承库密码），页级分享配置锁定不可修改；
 * - 库分享关闭：页级分享可独立开关，密码由页级自行管理。
 *
 * - 访客端（无需登录，走 /share/wiki/:wikiId）：分享元信息探测、密码校验、
 *   访客文档树与文档正文读取
 *
 * 与 publish 模块的职责边界（share/publish 语义拆分）：
 * - 本模块只管访问控制（shareStatus/password，wiki_shares 表）；
 *   站点形态（publishType）与站点外观见 ./publish.ts（/publish/* 接口，wiki_publish 表）
 *
 * 访客令牌（scope 隔离，关键设计）：
 * - 设置了密码的分享，访客输密码校验通过后获得 shareToken（HMAC，12h 有效），
 *   后续内容接口通过请求头 `X-Share-Token` 携带（见 guestTokenHeaders 帮助函数）
 * - 服务端令牌签名 scope：整库 = wikiId；单页 = wikiId:nodeId 维度
 * - 前端 sessionStorage 按 scope 隔离存储：
 *   - 库级 key：`share-token:${wikiId}`（整库分享 verify 时不带 docId）
 *   - 页级 key：`share-token:${wikiId}:${docId}`（单页分享 verify 时带 docId）
 *
 * 密码明文回显说明：分享密码的设计定位类似网盘「提取码」，非高敏感凭据
 * （泄露的后果仅是访客可读已主动公开的内容），owner 弹窗需要回显明文便于告知协作者，
 * 因此后端直接返回 password 明文（null = 未设置），不做 hasPassword 布尔转换。
 *
 * 响应已被 request.ts 的 alova 实例统一解包：
 * - 成功直接返回后端 `data` 字段
 * - 业务失败抛 `ApiError`（含 code/httpStatus）
 */
import { alova } from '../request'
import { API_PATHS, ERROR_CODES } from '../constants'

// ==================== 类型定义 ====================

/**
 * 整库分享配置（owner 弹窗回填 / 保存返回）
 * 密码以明文回显（设计定位类似网盘提取码，非敏感，见文件头说明）
 */
export interface WikiShareConfig {
  /** 分享配置 ID（内部标识，公开链接不使用） */
  shareId: string
  /** 被分享的知识库 ID */
  wikiId: string
  /** 分享状态：private - 私密（未开启整库分享）；public - 公开（可按链接访问） */
  shareStatus: 'private' | 'public'
  /** 访问密码明文（6-32 位；null = 未设置，公开库可不设密码） */
  password: string | null
  /** 分享模式：view - 浏览（v1 仅此值） */
  mode: 'view'
  /** 配置最后更新时间（ISO 字符串） */
  updatedAt: string
  /**
   * 页面级分享行列表（稀疏存储 —— 仅单独开启过页面分享的节点才出现在列表中，
   * 不在列表中的节点为未分享）
   * 用途：owner 分享弹窗回填各页面状态、文档树上分享 icon 的展示
   */
  nodes: Array<{
    /** 被单独分享的文档节点 ID（wikiNodes.id） */
    nodeId: string
    /**
     * 页面分享状态：仅 'public'（单独公开此页）。
     * 新模型下页级 'private' 已废弃（迁移 0006 已清理存量行）
     */
    shareStatus: 'public'
    /** 该页独立的访问密码明文（null = 未单独设置密码） */
    password: string | null
  }>
}

/**
 * 创建/更新整库分享配置入参
 * 与后端 UpsertWikiShareSchema 对齐：
 * - password 传 string = 设置/更新密码；传 null = 清除密码；不传（undefined）= 保持不变
 */
export interface UpsertWikiShareParams {
  /** 分享状态：private / public */
  shareStatus: 'private' | 'public'
  /** 访问密码（6-32 位），可选，语义见接口注释 */
  password?: string | null
  /** 分享模式，v1 固定 'view' */
  mode?: 'view'
}

/**
 * 单页（节点）分享配置（owner 弹窗保存 / 回填返回）
 * 仅库分享关闭时可配置；库分享开启时页面分享锁定（后端守卫拒绝修改）
 */
export interface NodeShareConfig {
  /** 文档节点 ID（wikiNodes.id） */
  nodeId: string
  /**
   * 节点分享状态：
   * - public：单独公开此页（密码可选，由页级自行管理）
   * - inherit：关闭页面分享（后端删除配置行，等价于未分享）
   */
  shareStatus: 'public' | 'inherit'
  /** 该页独立的访问密码明文（null = 未设置；inherit 时恒为 null） */
  password: string | null
}

/**
 * 创建/更新单页分享配置入参
 * 与后端 UpsertWikiNodeShareSchema 对齐：
 * - shareStatus = 'public'：单独公开此页，password 可选（支持免密分享）
 * - shareStatus = 'inherit'：关闭页面分享（后端删除配置行），password 不参与
 * - password 传 string = 设置/更新密码；传 null = 清除密码（免密访问）；不传（undefined）= 保持不变
 */
export interface UpsertNodeShareParams {
  /** 节点分享状态：public（单独公开）/ inherit（关闭页面分享） */
  shareStatus: 'public' | 'inherit'
  /** 访问密码（6-32 位），可选：string = 设置/更新；null = 清除（免密分享）；不传 = 保持不变 */
  password?: string | null
}

/**
 * 分享元信息（访客打开链接时首个探测接口返回）
 */
export interface ShareMeta {
  /** 知识库名称（密码卡片/浏览页顶栏展示） */
  wikiName: string
  /** 知识库图标（Solar 图标 id 或 legacy lucide key 如 Lightbulb，可空） */
  wikiIcon?: string | null
  /** 知识库颜色 key（统一色板或 legacy icon-meta 色板，如 blue，访客侧图标底色渲染用，可空） */
  wikiColor?: string | null
  /** Solar 图标烘焙的完整 SVG 字符串（icon 为 Solar id 时下发；legacy key 为 null，走 icon-meta 渲染） */
  wikiIconSvg?: string | null
  /** 烘焙色值 hex（rainbow 为 null；仅 wikiIconSvg 非空时有意义，底色淡化用） */
  wikiIconColor?: string | null
  /**
   * 访问类型（决定访客端令牌 scope 与路由形态）：
   * - wiki：整库公开（可浏览全库文档树）
   * - page：仅单页公开（只能访问链接指向的那一页）
   */
  accessType: 'wiki' | 'page'
  /** 是否需要密码（true = 需输密码校验后才能访问内容） */
  needsPassword: boolean
  /**
   * 文档名称（可空；链接带 docId 时后端随元信息一并返回，
   * 供密码卡片在解锁前展示「知识库名字 + 文档名称」；整库浏览意图无文档名）
   */
  docTitle?: string | null
}

/**
 * 密码校验返回（含访客令牌）
 */
export interface ShareTokenResult {
  /** 访客令牌（HMAC 签名，请求头 X-Share-Token 携带） */
  token: string
  /** 令牌过期时间戳（毫秒） */
  expiresAt: number
}

/**
 * 分享访客视角的文档树节点（扁平结构，与 owner 侧 WikiNodeItem 对齐）
 */
export interface ShareNodeItem {
  /** 节点 ID（wikiNodes.id，对应路由 docId） */
  id: string
  /** 节点标题 */
  title: string
  /** 父节点 ID（null = 根层级） */
  parentId: string | null
  /** 同层级排序序号 */
  sortOrder: number
  /** 节点内容格式：'md' 为默认富文本文档；'pdf'/'docx' 等文件型节点为预留扩展值 */
  docFormat: string
  /** 关联文档 ID（documents.id） */
  documentId: string | null
  /** 关联文件 ID：仅文件型节点（doc_format != 'md'）有值（指向 files 表行），'md' 节点为 null */
  fileId: string | null
  /** 节点图标（emoji，可空） */
  icon: string | null
  /** 是否可见 */
  isVisible: boolean | null
  /** 创建时间（ISO 字符串） */
  createdAt: string
  /** 更新时间（ISO 字符串） */
  updatedAt: string
}

/**
 * 访客视角的文档正文（与 owner 侧 getDocument 返回结构对齐，不含标签等 owner 字段）
 */
export interface ShareDocument {
  /** 文档 ID */
  id: string
  /** 所属知识库 ID */
  wikiId: string
  /** 关联节点 ID */
  nodeId: string
  /** 文档标题，来自 wiki_nodes 表（documents 不含标题字段），单页分享视图展示用；节点缺失时为 null */
  title: string | null
  /** 文档图标（emoji），来自 wiki_nodes 表，单页分享视图标题区展示用；节点缺失/未设置时为 null */
  icon: string | null
  /** Tiptap JSON 内容（新建文档为 null） */
  content: unknown
  /** 渲染后的 HTML 内容 */
  contentHtml: string | null
  /** 纯文本内容 */
  plainText: string | null
  /** 字数 */
  wordCount: number
  /** 状态：draft / published */
  status: string
  /** 最后更新时间（ISO 字符串） */
  updatedAt: string
}

// ==================== 内部帮助 ====================

/**
 * sessionStorage 键名：访客令牌按 scope 隔离存储
 * - docId 不传 → 库级 key `share-token:${wikiId}`（整库分享）
 * - docId 有值 → 页级 key `share-token:${wikiId}:${docId}`（单页分享）
 */
function shareTokenKey(wikiId: string, docId?: string): string {
  return docId ? `share-token:${wikiId}:${docId}` : `share-token:${wikiId}`
}

/**
 * 读取访客令牌（存在且未过期时返回，否则清除并返回 null）
 * @param wikiId 知识库 ID
 * @param docId 文档节点 ID（可选）：传则读页级令牌，不传读库级令牌
 */
export function getShareToken(wikiId: string, docId?: string): string | null {
  const key = shareTokenKey(wikiId, docId)
  const raw = sessionStorage.getItem(key)
  if (!raw) return null
  try {
    const { token, expiresAt } = JSON.parse(raw) as { token: string; expiresAt: number }
    // 已过期：清除并返回 null（需重新输密码）
    if (!token || !expiresAt || expiresAt < Date.now()) {
      sessionStorage.removeItem(key)
      return null
    }
    return token
  } catch {
    sessionStorage.removeItem(key)
    return null
  }
}

/**
 * 保存访客令牌到 sessionStorage（标签页关闭即失效）
 * @param wikiId 知识库 ID
 * @param result verify 接口返回的令牌与过期时间
 * @param docId 文档节点 ID（可选）：传则存页级（单页分享），不传存库级（整库分享）
 */
export function setShareToken(wikiId: string, result: ShareTokenResult, docId?: string): void {
  sessionStorage.setItem(shareTokenKey(wikiId, docId), JSON.stringify(result))
}

/**
 * 清除访客令牌（校验失败 / 令牌过期 / 访客主动退出时调用）
 * @param wikiId 知识库 ID
 * @param docId 文档节点 ID（可选）：传则只清页级令牌，不传清库级令牌
 */
export function clearShareToken(wikiId: string, docId?: string): void {
  sessionStorage.removeItem(shareTokenKey(wikiId, docId))
}

/**
 * 构建携带访客令牌的请求头（按 scope 取令牌）
 * - docId 有值：优先取页级令牌（单页公开场景）；页级无令牌时回退库级令牌
 *   （整库公开 + 密码场景：verify 未带 docId，令牌存于库级，访问该库任一文档时
 *   库级令牌对全部文档有效，回退保证内容接口不因 scope 查找落空而丢请求头）
 * - 两级都无令牌：返回空对象不带头（公开库无需密码，后端自然放行，兼容）
 * @param wikiId 知识库 ID
 * @param docId 文档节点 ID（可选），决定令牌 scope 优先级
 */
function guestTokenHeaders(wikiId: string, docId?: string): Record<string, string> {
  const token = (docId ? getShareToken(wikiId, docId) : null) ?? getShareToken(wikiId)
  return token ? { 'X-Share-Token': token } : {}
}

// ==================== owner 端接口（需登录） ====================

/**
 * 查询整库分享配置（分享弹窗回填）
 * 未创建过分享时返回 null
 * cacheFor: null 禁用 alova GET 默认的 5 分钟内存缓存：
 * 保存配置后再次打开弹窗必须拿到最新值，否则命中旧缓存（如首次的 null）导致配置不回显
 */
export function getWikiShareConfig(wikiId: string) {
  return alova.Get<WikiShareConfig | null>(`${API_PATHS.WIKI.DETAIL}/${wikiId}/share`, {
    cacheFor: null,
  })
}

/**
 * 创建/更新整库分享配置（upsert，每个知识库最多一条）
 * 成功返回配置（含 shareId，用于拼分享链接；password 明文回显）
 */
export function upsertWikiShare(wikiId: string, data: UpsertWikiShareParams) {
  return alova.Post<WikiShareConfig>(`${API_PATHS.WIKI.DETAIL}/${wikiId}/share`, data)
}

/**
 * 创建/更新单页（节点）分享配置（upsert，仅库分享关闭时可调用）
 * 语义：
 * - public：单独公开此页，密码由页级自行管理（可选）
 * - inherit：关闭页面分享（后端删除配置行）
 * 库分享开启时后端守卫拒绝（错误码 SHARE_PAGE_LOCKED_BY_WIKI），前端应提前锁定 UI
 * 成功返回节点分享配置（password 明文回显）
 */
export function upsertNodeShare(nodeId: string, data: UpsertNodeShareParams) {
  return alova.Post<NodeShareConfig>(
    `${API_PATHS.WIKI.NODE_SHARE}/${nodeId}/share`,
    data
  )
}

// ==================== 访客端接口（无需登录） ====================

/**
 * 获取分享元信息（wikiName + accessType + 是否需要密码）
 * @param wikiId 知识库 ID
 * @param docId 文档节点 ID（可选）：有值时拼 query 传给后端，
 *              后端据此判定单页分享的 accessType / needsPassword
 * 无生效分享时抛 ApiError（code = SHARE_NOT_FOUND）
 * cacheFor: null 禁用缓存：owner 随时可能开关分享/改密码，必须实时探测
 */
export function getShareMeta(wikiId: string, docId?: string) {
  const query = docId ? `?docId=${encodeURIComponent(docId)}` : ''
  return alova.Get<ShareMeta>(`${API_PATHS.SHARE.META}/${wikiId}${query}`, { cacheFor: null })
}

/**
 * 校验访问密码，成功返回访客令牌
 * @param wikiId 知识库 ID
 * @param password 访客输入的密码
 * @param docId 文档节点 ID（可选）：单页分享校验时必传，
 *              服务端用 wikiId:nodeId 维度签名令牌（前端对应存页级 key）
 * 密码错误抛 ApiError（code = SHARE_PASSWORD_INVALID）
 */
export function verifySharePassword(wikiId: string, password: string, docId?: string) {
  // docId 为 undefined 时不会被 JSON 序列化，body 自然不含该字段（整库分享场景）
  return alova.Post<ShareTokenResult>(`${API_PATHS.SHARE.VERIFY}/${wikiId}/verify`, {
    password,
    docId,
  })
}

/**
 * 获取访客文档树（扁平节点数组）
 * 文档树是库级资源，只用库级令牌（整库分享 verify 时不带 docId，令牌存库级 key）
 * 设置了密码的分享需要先 verify 拿到令牌（getShareToken 自动注入请求头）
 * 令牌缺失/无效时抛 ApiError（code = SHARE_PASSWORD_REQUIRED / SHARE_TOKEN_INVALID）
 */
export function listShareNodes(wikiId: string) {
  return alova.Get<ShareNodeItem[]>(
    `${API_PATHS.SHARE.NODES}/${wikiId}/nodes`,
    { headers: guestTokenHeaders(wikiId), cacheFor: null }
  )
}

/**
 * 获取访客文档正文
 * @param wikiId 知识库 ID
 * @param documentId 文档节点 ID（即路由 docId，对应 ShareNodeItem.id）
 * @param docId 令牌 scope 维度的节点 ID（可选）：documentId 本身就是路由 docId，
 *              故一般无需传；缺省时内部以 documentId 作为 docId 取页级令牌
 *              （页级令牌按 documentId 维度取用；两级都无令牌则不带请求头，公开库自然兼容）
 * 后端校验 document.wikiId 与分享上下文一致（防跨库越权），不一致抛 SHARE_NOT_FOUND
 */
export function getShareDocument(wikiId: string, documentId: string, docId?: string) {
  return alova.Get<ShareDocument>(
    `${API_PATHS.SHARE.DOCUMENT}/${wikiId}/document/${documentId}`,
    { headers: guestTokenHeaders(wikiId, docId ?? documentId), cacheFor: null }
  )
}

// ==================== 错误码导出（组件内判断用） ====================

/** 分享相关错误码集合，组件内按 code 分支处理 */
export const SHARE_ERROR_CODES = {
  /** 分享不存在或已关闭 */
  NOT_FOUND: ERROR_CODES.SHARE_NOT_FOUND,
  /** 需要访问密码（未携带令牌） */
  PASSWORD_REQUIRED: ERROR_CODES.SHARE_PASSWORD_REQUIRED,
  /** 密码错误 */
  PASSWORD_INVALID: ERROR_CODES.SHARE_PASSWORD_INVALID,
  /** 令牌无效或已过期 */
  TOKEN_INVALID: ERROR_CODES.SHARE_TOKEN_INVALID,
} as const
