/**
 * 分享模块类型定义（访客端，字段对齐 apps/web/src/api/modules/share.ts）
 *
 * 数据来源（后端 share.controller.ts，无需登录）：
 * - wikis 表 → ShareMeta（库名/图标/颜色/分享形态）
 * - wiki_nodes 表 → ShareNodeItem（扁平文档树节点）
 * - documents 表 → ShareDocument（文档正文，含预渲染 contentHtml —— SSR/SEO 的数据源）
 */

/**
 * 页头导航按钮（owner 在预览面板配置，存 wiki_publish.settings jsonb 数组）
 * 公开站 / 预览站页头右侧渲染，点击跳转：
 * href 以 http(s):// 开头新标签打开，以 / 开头站内当前页跳转
 */
export interface ShareNavButton {
  /** 按钮文案 */
  title: string
  /** 跳转链接（http(s):// 外链或 / 开头站内路径） */
  href: string
}

/**
 * 分享元信息（访客打开链接时首个探测接口返回）
 */
export interface ShareMeta {
  /** 知识库名称 */
  wikiName: string
  /** 知识库图标（Solar 图标 id 或 legacy lucide key 如 BookOpen，可空） */
  wikiIcon?: string | null
  /** 知识库颜色 key（统一色板或 legacy icon-meta 色板，如 blue，可空） */
  wikiColor?: string | null
  /** Solar 图标烘焙的完整 SVG 字符串（icon 为 Solar id 时下发；legacy key 为 null，走 icon-meta 渲染） */
  wikiIconSvg?: string | null
  /** 烘焙色值 hex（rainbow 为 null；仅 wikiIconSvg 非空时有意义，底色淡化用） */
  wikiIconColor?: string | null
  /** 知识库描述（博客形态首页副标题数据源，可空） */
  wikiDescription?: string | null
  /**
   * 访问类型（决定访客端形态）：
   * - wiki：整库公开（可浏览全库文档树）
   * - page：仅单页公开（只能访问链接指向的那一页）
   */
  accessType: 'wiki' | 'page'
  /**
   * 公开站点形态（owner 在发布设置中配置，存 wiki_publish.publish_type）：
   * - help：帮助中心（默认，/w/:wikiId）
   * - blog：博客（/b/:wikiId 卡片列表）
   */
  publishType?: 'help' | 'blog'
  /** 是否需要密码（true = 需输密码校验后才能访问内容） */
  needsPassword: boolean
  /** 文档名称（链接带 docId 时后端随元信息返回，可空） */
  docTitle?: string | null
  // ===== 站点外观设置（owner 在预览面板配置，存 wiki_publish.settings jsonb；null = 未自定义回退默认） =====
  /** 站点标题（null = 回退 wikiName） */
  siteTitle?: string | null
  /** 站点 Logo 图片 URL（null = 回退默认品牌图） */
  siteLogo?: string | null
  /** 站点主题色 hex（如 '#2563eb'，null = 回退默认主题色） */
  siteColor?: string | null
  /** AI 助手开关（false = 公开站隐藏 AI 浮窗，后端 ai-chat 接口也拒绝） */
  aiEnabled?: boolean
  /** 页头导航按钮数组（null / 空数组 = 未配置不渲染） */
  navButtons?: ShareNavButton[] | null
  /** 站点 SEO 描述（null = 公开站回退页面默认摘要，输出 meta description） */
  seoDescription?: string | null
  /** SEO 关键词（逗号分隔自由文本，null = 不输出 meta keywords） */
  seoKeywords?: string | null
}

/**
 * 站点展示配置（预览聚合接口 GET /publish/wiki/:wikiId/preview 返回的 site 字段）
 * wiki_publish 发布行 + wiki_shares 库级行 + wiki 兜底字段合并，前端无需二次拼接
 */
export interface ShareSiteConfig {
  /** 知识库名称（站点标题回退数据源） */
  wikiName: string
  /** 知识库图标（Solar 图标 id 或 legacy lucide key，可空） */
  wikiIcon?: string | null
  /** 知识库颜色 key（统一色板或 legacy icon-meta 色板，可空） */
  wikiColor?: string | null
  /** Solar 图标烘焙的完整 SVG 字符串（icon 为 Solar id 时下发；legacy key 为 null） */
  wikiIconSvg?: string | null
  /** 烘焙色值 hex（rainbow 为 null；仅 wikiIconSvg 非空时有意义） */
  wikiIconColor?: string | null
  /** 知识库描述（可空） */
  wikiDescription?: string | null
  /** 分享状态：'private'（未发布）| 'public'（已发布），预览条提示用 */
  shareStatus: string
  /** 公开站点形态：help | blog */
  publishType?: 'help' | 'blog'
  /** 站点标题（null = 回退 wikiName） */
  siteTitle: string | null
  /** 站点 Logo 图片 URL（null = 回退默认品牌图） */
  siteLogo: string | null
  /** 站点主题色 hex（null = 回退默认主题色） */
  siteColor: string | null
  /** AI 助手开关 */
  aiEnabled: boolean
  /** 页头导航按钮数组（null = 未配置；空数组渲染等价 null） */
  navButtons: ShareNavButton[] | null
  /** 站点 SEO 描述（null = 公开站回退页面默认摘要，输出 meta description） */
  seoDescription: string | null
  /** SEO 关键词（逗号分隔自由文本，null = 不输出 meta keywords） */
  seoKeywords: string | null
}

/**
 * 预览聚合数据（GET /publish/wiki/:wikiId/preview 返回）
 * 一次请求携带预览页首屏全部数据：站点配置 + 完整文档树 + 可选首屏正文
 */
export interface PreviewAggregate {
  /** 站点展示配置 */
  site: ShareSiteConfig
  /** 完整文档树（owner 视角扁平节点数组，未发布库同样返回） */
  nodes: ShareNodeItem[]
  /** 首屏正文（URL 带 ?docId= 时返回，缺省 null） */
  doc: ShareDocument | null
}

/**
 * 发布设置保存结果（PUT /publish/wiki/:wikiId/settings 返回，与后端扁平结构对齐）
 */
export interface PublishSettingsResult {
  /** 公开站点形态：help | blog */
  publishType: 'help' | 'blog'
  siteTitle: string | null
  siteLogo: string | null
  siteColor: string | null
  aiEnabled: boolean
  /** 页头导航按钮数组（null = 未配置；[] = 已清空，渲染等价） */
  navButtons: ShareNavButton[] | null
  /** 站点 SEO 描述（null = 公开站回退页面默认摘要） */
  seoDescription: string | null
  /** SEO 关键词（逗号分隔自由文本，null = 不输出 meta keywords） */
  seoKeywords: string | null
  /** 保存时间（ISO 字符串） */
  updatedAt: string
}

/**
 * 发布设置保存参数（字段均可选：undefined = 保持不变，null/空串 = 清除回退默认；
 * navButtons：undefined = 保持不变，null / [] = 清空隐藏；publishType 仅显式传入时更新）
 */
export interface UpdatePublishSettingsParams {
  publishType?: 'help' | 'blog'
  siteTitle?: string | null
  siteLogo?: string | null
  siteColor?: string | null
  aiEnabled?: boolean
  navButtons?: ShareNavButton[] | null
  /** 站点 SEO 描述（undefined = 保持不变，空串 = 清除回退默认） */
  seoDescription?: string | null
  /** SEO 关键词（undefined = 保持不变，空串 = 清除） */
  seoKeywords?: string | null
}

/**
 * 发布站点结果（POST /publish/wiki/:wikiId/publish 返回）
 */
export interface PublishSiteResult {
  /** 发布后的分享状态（恒为 'public'） */
  shareStatus: string
  /** 发布开关行更新时间（ISO 字符串） */
  updatedAt: string
}

/**
 * 预览图片上传结果（POST /publish/wiki/:wikiId/upload 返回）
 */
export interface PreviewUploadResult {
  /** 对外可访问的图片 URL（/uploads/...，直接用作 siteLogo 与 <img src>） */
  url: string
}

/**
 * 分享访客视角的文档树节点（扁平结构）
 */
export interface ShareNodeItem {
  /** 节点 ID（wikiNodes.id） */
  id: string
  /** 节点标题 */
  title: string
  /** 父节点 ID（null = 根层级） */
  parentId: string | null
  /** 同层级排序序号 */
  sortOrder: number
  /** 关联文档 ID（documents.id，null = 纯分组容器） */
  documentId: string | null
  /** 节点图标（emoji，可空） */
  icon: string | null
  /** 文章封面图 URL（博客列表卡使用，可空） */
  coverUrl?: string | null
  /** 是否可见（隐藏页后端已从访客树剔除，字段保留对齐） */
  isVisible: boolean | null
  /** 创建时间（ISO 字符串） */
  createdAt: string
  /** 更新时间（ISO 字符串） */
  updatedAt: string
}

/**
 * 访客视角的文档正文
 */
export interface ShareDocument {
  /** 文档 ID（documents.id） */
  id: string
  /** 所属知识库 ID */
  wikiId: string
  /** 关联节点 ID */
  nodeId: string
  /** 文档标题（来自 wiki_nodes 表，节点缺失时为 null） */
  title: string | null
  /** 文档图标（emoji，可空） */
  icon: string | null
  /** Tiptap JSON 内容（新建文档为 null） */
  content: unknown
  /** 预渲染 HTML 内容（帮助中心 SSR 渲染的数据源，新建文档为 null） */
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

/**
 * 正文搜索单条命中（GET /publish/wiki/:wikiId/search 返回的 hits 元素，
 * 字段对齐后端 wiki-search.service.ts 的 ContentHit）
 */
export interface ContentHit {
  /** 命中内容所在的标题路径（不含文档标题，如 ['部署指南', '连接池配置']） */
  headingPath: string[]
  /** 命中所在的最深标题文本（前端跳转锚点用；正文无标题结构时为空串） */
  heading: string
  /** 命中片段（关键词前后各约 40 字符窗口，含省略号） */
  snippet: string
}

/**
 * 正文搜索单文档结果（GET /publish/wiki/:wikiId/search 返回，后端 PublishedContentSearchItem）
 * 注意返回的是 documentId（documents.id，对齐 pages 站路由 /w/:wikiId/:docId），
 * 区别于 owner 侧搜索返回的 nodeId
 */
export interface PublishedContentSearchItem {
  /** 文档 ID（documents.id，前端跳转用） */
  documentId: string
  /** 节点 emoji 图标（可空） */
  icon: string | null
  /** 文档标题 */
  title: string
  /** 该文档的正文命中列表 */
  hits: ContentHit[]
}

/**
 * 博客文章列表项（GET /share/wiki/:wikiId/blog 返回，后端 listBlogPosts）
 * 列表排序 = 文档树先序（sortOrder），由后端保证
 */
export interface BlogPost {
  /** 节点 ID（wikiNodes.id） */
  nodeId: string
  /** 文档 ID（documents.id，文章页路由 /b/:wikiId/:docId 的 docId 段） */
  documentId: string
  /** 文章标题 */
  title: string
  /** 标题 emoji 图标（可空） */
  icon: string | null
  /** owner 设置的封面图 URL（可空） */
  cover: string | null
  /** 正文第一图 URL（可空；卡片配图优先级：cover > image > 留空） */
  image: string | null
  /** 摘要（plainText 前 120 字符，可空） */
  excerpt: string | null
  /** 内容最后更新时间（ISO 字符串） */
  updatedAt: string
}
