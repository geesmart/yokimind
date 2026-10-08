import { and, eq, getTableColumns, inArray } from 'drizzle-orm'
import { getDb } from '~/core/helper/db.helper.js'
import { wiki, wikiShares, documents, wikiNodes, wikiPublish } from '~/db/schema.js'
import { BizException } from '~/core/lib/biz.exception.js'
import { ErrorCode } from '~/config/error-code.js'
import { listWikiNodesFlat } from '~/modules/wiki/wiki.service.js'
import { signShareToken } from './share.util.js'
import { flattenPublishSettings } from '~/modules/publish/publish.util.js'

// ============ 内部帮助函数 ============

/**
 * 查询知识库的「库级」分享权限行（node_id = ''，每库固定一行）
 * 库级行承载整库可见性：shareStatus = 'private' | 'public'，以及库密码
 *
 * 回收站联动：innerJoin wiki 且要求 is_deleted = false —— 知识库被软删除（移入回收站）后，
 * 本查询查不到库级行，等同于「分享不存在」：shareAuthMiddleware / getShareMeta /
 * verifySharePassword / 访客 AI 问答 / publish 访客搜索全部即时 SHARE_NOT_FOUND
 * （每次请求实时复核，不依赖访客令牌过期）；恢复后无需重建配置即自动恢复访问。
 * getTableColumns 保证返回结构仍是 wiki_shares 单表列（消费方零改动）。
 *
 * @param wikiId 知识库 ID
 * @returns 库级行；未配置过分享或知识库在回收站中时返回 null
 */
export async function getWikiLevelShare(wikiId: string) {
  const db = getDb()

  const [share] = await db
    .select(getTableColumns(wikiShares))
    .from(wikiShares)
    .innerJoin(wiki, eq(wiki.id, wikiShares.wikiId))
    .where(and(eq(wikiShares.wikiId, wikiId), eq(wikiShares.nodeId, ''), eq(wiki.isDeleted, false)))
    .limit(1)

  return share ?? null
}

/**
 * 查询「页面级」覆盖行（node_id = <nodeId>，稀疏：仅页面单独配置过覆盖时才存在）
 * 页级行语义：'public' = 私密库中单页公开（可带页密码）；'private' = 从公开库中隐藏
 * @param wikiId 知识库 ID
 * @param nodeId 节点 ID（wikiNodes.id）
 * @returns 页级覆盖行；未配置覆盖时返回 null（等价于 'inherit'）
 */
export async function getNodeLevelShare(wikiId: string, nodeId: string) {
  const db = getDb()

  const [share] = await db
    .select()
    .from(wikiShares)
    .where(and(eq(wikiShares.wikiId, wikiId), eq(wikiShares.nodeId, nodeId)))
    .limit(1)

  return share ?? null
}

/**
 * 按文档 ID 解析其分享作用域（所属节点）
 * 防跨库越权：documents 的 id + wikiId 联合过滤 —— 文档不属于该分享库时查不到，
 * 统一抛 SHARE_NOT_FOUND（不泄露其他库中文档的存在性）
 *
 * 双 ID 兼容：URL docId 段存在两种历史约定 ——
 * - 分享链接（share-dialog 复制）：documents.id（文档主键）
 * - owner 视图 URL / 访客整库树导航（onSelectNode）：wikiNodes.id（节点主键）
 * 先按 documents.id 查；未命中时回退按 wikiNodes.id 定位节点再取其文档，
 * 保证访客在树内点选后刷新、或直接打开含 nodeId 的链接时同样可达。
 * 两种解析都必须带 wikiId 联合过滤，越权防护语义不变。
 *
 * 同时选取文档正文相关字段，供 getShareDocument 直接复用（避免二次查询）
 * @param wikiId 分享上下文的知识库 ID
 * @param documentId 目标文档 ID（documents.id 或 wikiNodes.id 均可）
 * @returns 文档记录（含 nodeId —— 页面级覆盖行的寻址键）
 */
export async function resolveDocumentScope(wikiId: string, documentId: string) {
  const db = getDb()

  // 第一优先：按 documents.id（documents 表主键）解析
  const [found] = await db
    .select({
      id: documents.id,
      wikiId: documents.wikiId,
      nodeId: documents.nodeId,
      content: documents.content,
      contentHtml: documents.contentHtml,
      plainText: documents.plainText,
      wordCount: documents.wordCount,
      status: documents.status,
      updatedAt: documents.updatedAt,
    })
    .from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.wikiId, wikiId)))
    .limit(1)

  if (found) {
    return found
  }

  // 回退：按 wikiNodes.id（节点主键）解析 —— 取该节点关联文档的正文字段
  const [byNode] = await db
    .select({
      id: documents.id,
      wikiId: documents.wikiId,
      nodeId: documents.nodeId,
      content: documents.content,
      contentHtml: documents.contentHtml,
      plainText: documents.plainText,
      wordCount: documents.wordCount,
      status: documents.status,
      updatedAt: documents.updatedAt,
    })
    .from(wikiNodes)
    .innerJoin(documents, eq(documents.id, wikiNodes.documentId))
    .where(and(eq(wikiNodes.id, documentId), eq(wikiNodes.wikiId, wikiId)))
    .limit(1)

  if (!byNode) {
    throw new BizException(ErrorCode.SHARE_NOT_FOUND)
  }

  return byNode
}

// ============ 访客接口实现 ============

/**
 * 获取分享元信息（访客打开链接时的首个探测接口）
 * 仅返回 wikiName、访问类型与是否需要密码，不涉及内容访问
 *
 * 有效可见性判定路径（库级主开关模型）：
 * - 无 docId（整库浏览意图）：仅库级 'public' 可访问，needsPassword = 库密码是否存在
 * - 有 docId（单页访问意图）：
 *   - 库级 'public'：全部文档跟随库开放，页级分享行不参与判定，
 *     needsPassword = 库密码是否存在（文档密码继承库密码）
 *   - 库级 'private'：页级行必须存在且为 'public'（页面独立分享），needsPassword = 页密码是否存在
 * 任一步不满足 → SHARE_NOT_FOUND（不泄露 wiki / 页面的存在性）
 *
 * @param wikiId 知识库 ID（公开链接中的路径参数）
 * @param docId 可选文档 ID：访客直达某页面时传入
 * @returns { wikiName, wikiIcon, accessType: 'wiki' | 'page', needsPassword, docTitle }
 *   docTitle：链接带 docId 时返回目标文档节点标题（密码卡片解锁前展示），整库浏览意图为 null
 */
export async function getShareMeta(wikiId: string, docId?: string) {
  const db = getDb()

  // 库级行不存在 → 分享未开启或已撤销
  const wikiShare = await getWikiLevelShare(wikiId)
  if (!wikiShare) {
    throw new BizException(ErrorCode.SHARE_NOT_FOUND)
  }

  // wiki 本身不存在（如已被删除）→ SHARE_NOT_FOUND
  const [w] = await db
    .select({ name: wiki.name, icon: wiki.icon, color: wiki.color, description: wiki.description })
    .from(wiki)
    .where(eq(wiki.id, wikiId))
    .limit(1)

  if (!w) {
    throw new BizException(ErrorCode.SHARE_NOT_FOUND)
  }

  // 站点外观与发布形态（wiki_publish 行；share/publish 拆表后发布配置归 publish 表，
  // 访客 meta 只读回显给公开站渲染用）
  const [publishRow] = await db
    .select()
    .from(wikiPublish)
    .where(eq(wikiPublish.wikiId, wikiId))
    .limit(1)

  const publishFields = {
    // 站点形态：help 帮助中心（默认）/ blog 博客（公开站路由前缀 /w 或 /b 的判定依据）
    publishType: publishRow?.publishType ?? 'help',
    // 外观设置（settings jsonb 兜底；null = 未自定义，前端回退 wiki 默认值）
    ...flattenPublishSettings(publishRow?.settings),
  }

  // ---- 整库浏览意图：只看库级可见性 ----
  if (!docId) {
    // 私密库没有整库浏览入口
    if (wikiShare.shareStatus !== 'public') {
      throw new BizException(ErrorCode.SHARE_NOT_FOUND)
    }
    return {
      wikiName: w.name,
      wikiIcon: w.icon,
      // 库描述（博客形态首页副标题数据源，帮助中心形态暂未使用）
      wikiDescription: w.description,
      ...publishFields,
      accessType: 'wiki' as const,
      // 库密码存在 = 访客需先输密码换整库令牌
      needsPassword: !!wikiShare.password,
      // 整库浏览意图不带 docId，无文档名可返回
      docTitle: null,
    }
  }

  // ---- 单页访问意图 ----
  // 先解析文档归属（防跨库越权，不属于该库的文档直接 SHARE_NOT_FOUND）
  const doc = await resolveDocumentScope(wikiId, docId)

  // 取文档节点标题/图标（密码卡片在解锁前就要展示「知识库名字 + 文档名称」）
  const [nodeRow] = await db
    .select({ title: wikiNodes.title, icon: wikiNodes.icon })
    .from(wikiNodes)
    .where(eq(wikiNodes.id, doc.nodeId))
    .limit(1)

  if (wikiShare.shareStatus === 'public') {
    // 库分享开启：全部文档跟随库开放，页级分享行不参与判定（数据保留但不生效）
    return {
      wikiName: w.name,
      wikiIcon: w.icon,
      wikiColor: w.color,
      wikiDescription: w.description,
      ...publishFields,
      accessType: 'wiki' as const,
      needsPassword: !!wikiShare.password,
      docTitle: nodeRow?.title ?? null,
    }
  }

  // 库分享关闭：仅页面独立分享行为 'public' 的页面可访问（无行 = 未分享）
  const nodeShare = await getNodeLevelShare(wikiId, doc.nodeId)
  if (!nodeShare || nodeShare.shareStatus !== 'public') {
    throw new BizException(ErrorCode.SHARE_NOT_FOUND)
  }
  return {
    wikiName: w.name,
    wikiIcon: w.icon,
    wikiColor: w.color,
    wikiDescription: w.description,
    ...publishFields,
    accessType: 'page' as const,
    // 页密码存在 = 访客需输页密码换单页令牌
    needsPassword: !!nodeShare.password,
    docTitle: nodeRow?.title ?? null,
  }
}

/**
 * 校验访客密码并签发访问令牌
 *
 * 判定路径与 getShareMeta 完全一致（保证"探测到的可访问性"与"密码校验"不出现偏差）：
 * - 整库访问意图（无 docId）：库级必须 'public'，校验库密码，签 scope = `${wikiId}` 的整库令牌
 * - 库分享开启的单页访问：全部文档跟随库开放（页级分享行不参与判定），
 *   校验库密码（文档密码继承库密码），签 scope = `${wikiId}` 的整库令牌
 * - 库分享关闭的单页访问：页级行必须 'public'；校验页密码，签 scope = `${wikiId}:${nodeId}` 的单页令牌
 *
 * 密码为明文存储（定位类似网盘提取码，非登录凭证），服务端直接 `===` 字符串比较：
 * - 明文比较非常数时间，抗爆破依赖 controller 层限流（60 秒 / 5 次，按 wiki + doc 维度隔离）
 * - 不使用 bcrypt：本模块已移除 bcryptjs 依赖（登录模块仍在使用，依赖保留）
 *
 * @param wikiId 知识库 ID
 * @param password 访客输入的密码
 * @param docId 可选文档 ID：单页访问意图
 * @returns 访客令牌与过期时间戳（毫秒）
 */
export async function verifySharePassword(wikiId: string, password: string, docId?: string) {
  // 库级行不存在 → 分享未开启或已撤销
  const wikiShare = await getWikiLevelShare(wikiId)
  if (!wikiShare) {
    throw new BizException(ErrorCode.SHARE_NOT_FOUND)
  }

  // 本次校验所需比对的密码（null = 无密码，直接放行）与签发令牌的 scope
  let requiredPassword: string | null = null
  let tokenScope: string

  if (!docId) {
    // 整库访问意图：库级必须 'public'
    if (wikiShare.shareStatus !== 'public') {
      throw new BizException(ErrorCode.SHARE_NOT_FOUND)
    }
    requiredPassword = wikiShare.password
    tokenScope = wikiId
  } else if (wikiShare.shareStatus === 'public') {
    // 库分享开启的单页访问：全部文档跟随库开放（页级分享行不参与判定），
    // 仅解析文档防越权；统一继承库密码，签整库令牌（访问树与库内其他页面复用同一令牌）
    await resolveDocumentScope(wikiId, docId)
    requiredPassword = wikiShare.password
    tokenScope = wikiId
  } else {
    // 库分享关闭的单页访问：页级行必须存在且 'public'（页面独立分享）
    const doc = await resolveDocumentScope(wikiId, docId)
    const nodeShare = await getNodeLevelShare(wikiId, doc.nodeId)
    if (!nodeShare || nodeShare.shareStatus !== 'public') {
      throw new BizException(ErrorCode.SHARE_NOT_FOUND)
    }
    // 页级上下文签单页令牌：仅对该页面有效，拿去访问其他页面会因 scope 不匹配被拒
    requiredPassword = nodeShare.password
    tokenScope = `${wikiId}:${doc.nodeId}`
  }

  // 明文密码直接比较；不匹配 → SHARE_PASSWORD_INVALID（无密码分享跳过比较直接签发）
  if (requiredPassword && password !== requiredPassword) {
    throw new BizException(ErrorCode.SHARE_PASSWORD_INVALID)
  }

  // 签发时把当前密码绑定进签名：owner 改密码后旧令牌签名不再匹配（改密码即时失效）
  return signShareToken(tokenScope, requiredPassword)
}

/**
 * 获取分享知识库的文档树（访客视角，仅公开库）
 *
 * 仅服务库级 'public' 的库（库分享开启 = 全部文档跟随开放，页级分享行不参与判定；
 * 库分享关闭时没有整树浏览概念 → SHARE_NOT_FOUND）；
 * 复用 owner 侧 listWikiNodesFlat 的扁平树查询
 *
 * @param wikiId 知识库 ID
 * @returns 节点扁平数组（与 owner 侧 listWikiNodes 返回结构一致）
 */
export async function listShareNodes(wikiId: string) {
  // 仅公开库可浏览整树
  const wikiShare = await getWikiLevelShare(wikiId)
  if (!wikiShare || wikiShare.shareStatus !== 'public') {
    throw new BizException(ErrorCode.SHARE_NOT_FOUND)
  }

  // 复用 owner 侧扁平树查询（调用方自行保证 wikiId 合法性）
  return listWikiNodesFlat(wikiId)
}

/**
 * 获取分享知识库内的文档正文（访客视角）
 *
 * 三步实时复核（每次请求都执行，撤销分享即时失效，令牌有效期不影响权限回收）：
 * 1. 越权防护：resolveDocumentScope 按 id + wikiId 联合过滤，文档不属于该库 → SHARE_NOT_FOUND
 * 2. 库级行必须存在（分享被撤销 → 立即失效）
 * 3. 有效可见性（库级主开关模型）：
 *    - 库级 'public'：全部文档跟随库开放，页级分享行不参与判定
 *    - 库级 'private'：页级行必须存在且 'public'（页面独立分享）
 *
 * @param wikiId 知识库 ID（分享上下文）
 * @param documentId 文档 ID
 * @returns 文档记录（与 owner 侧 getDocumentById 返回结构一致，不含最近访问副作用；
 *          额外携带 title / icon —— 文档标题与图标，来自 wiki_nodes，单页分享视图展示用，
 *          节点缺失时为 null）
 */
export async function getShareDocument(wikiId: string, documentId: string) {
  // 第一步：解析文档作用域（防跨库越权读取）
  const doc = await resolveDocumentScope(wikiId, documentId)

  // 第二步：库级行必须存在（实时复核，撤销分享即时失效）
  const wikiShare = await getWikiLevelShare(wikiId)
  if (!wikiShare) {
    throw new BizException(ErrorCode.SHARE_NOT_FOUND)
  }

  // 第三步：可见性判定
  if (wikiShare.shareStatus === 'private') {
    // 库分享关闭：仅页面独立分享行为 'public' 的页面可读
    const nodeShare = await getNodeLevelShare(wikiId, doc.nodeId)
    if (!nodeShare || nodeShare.shareStatus !== 'public') {
      throw new BizException(ErrorCode.SHARE_NOT_FOUND)
    }
  }
  // 库分享开启：全部文档跟随库开放（页级分享行数据保留但不参与判定）

  // 第四步：补充文档标题与图标 —— 单页分享视图需要展示文档标题和标题前的 emoji 图标；
  // 标题/图标存于 wiki_nodes 表（documents 表不含这两个字段），按文档关联的 nodeId 查询，
  // 节点不存在（脏数据兜底）时返回 null，不阻塞正文访问
  const db = getDb()
  const [node] = await db
    .select({ title: wikiNodes.title, icon: wikiNodes.icon })
    .from(wikiNodes)
    .where(eq(wikiNodes.id, doc.nodeId))
    .limit(1)

  return { ...doc, title: node?.title ?? null, icon: node?.icon ?? null }
}

// ============ 预览模式函数已迁至 publish 模块（share/publish 语义拆分） ============
// buildSiteConfig / getPreviewData / getPreviewDocument / updatePreviewConfig / uploadPreviewImage
// → ~/modules/publish/publish.service.ts（数据源同步改为 wiki_publish 表 + settings jsonb）

// ============ 博客列表（访客端，/b/:wikiId 数据源） ============

/** 博客文章列表项（listBlogPosts 返回结构，前端 BlogPost 类型与之对齐） */
export interface BlogPostItem {
  /** 节点 ID（wikiNodes.id） */
  nodeId: string
  /** 文档 ID（documents.id，文章页路由 /b/:wikiId/:docId 的 docId 段） */
  documentId: string
  /** 文章标题（节点标题） */
  title: string
  /** 标题 emoji 图标（可空） */
  icon: string | null
  /** owner 设置的封面图 URL（可空） */
  cover: string | null
  /** 正文第一图 URL（可空；卡片配图优先级：cover > image > 留空） */
  image: string | null
  /** 摘要（plainText 去空白后前 120 字符，可空） */
  excerpt: string | null
  /** 内容最后更新时间（ISO 字符串，取 documents.updatedAt） */
  updatedAt: string
}

/**
 * 从 Tiptap JSON 内容中提取第一张图片的 src
 *
 * 递归遍历节点树（节点通过 content 数组嵌套），命中第一个
 * type === 'image' 且 attrs.src 为非空字符串的节点即返回；
 * 内容为空 / 无图片时返回 null（卡片留空）
 *
 * @param content Tiptap JSON（documents.content，新建文档为 null）
 */
export function extractFirstImage(content: unknown): string | null {
  if (!content || typeof content !== 'object') return null
  const node = content as { type?: unknown; attrs?: { src?: unknown }; content?: unknown }
  if (node.type === 'image') {
    const src = node.attrs?.src
    if (typeof src === 'string' && src) return src
  }
  if (Array.isArray(node.content)) {
    for (const child of node.content) {
      const found = extractFirstImage(child)
      if (found) return found
    }
  }
  return null
}

/**
 * 获取博客文章列表（访客视角，仅公开库）
 *
 * 排序：文档树先序遍历（父节点在前，同级按 sortOrder 升序）——
 * 与 owner 在知识库内看到的文档树顺序完全一致（产品决策：博客列表跟随树排序）
 *
 * 权限：仅库级 'public' 可访问（同 listShareNodes 口径，私密库无整库入口 → SHARE_NOT_FOUND）；
 * 密码库由 shareAuthMiddleware 先行校验令牌，本函数无需重复处理；
 * 列表口径与 /nodes 访客树完全一致（wikiNodes 全量，isVisible 仅为展示标记，
 * 后端未做剔除——与现有访客树行为一致；单页可见性由文章页 getShareDocument 实时复核兜底）
 *
 * @param wikiId 知识库 ID
 * @returns 博客文章列表项数组（树先序排序）
 */
export async function listBlogPosts(wikiId: string): Promise<BlogPostItem[]> {
  // 仅公开库可访问博客列表（私密库无整库入口）
  const wikiShare = await getWikiLevelShare(wikiId)
  if (!wikiShare || wikiShare.shareStatus !== 'public') {
    throw new BizException(ErrorCode.SHARE_NOT_FOUND)
  }

  // 复用 owner 侧扁平树查询（已含 coverUrl；同级已按 sortOrder 升序）
  const flatNodes = await listWikiNodesFlat(wikiId)

  // 按父节点分组（parentId 指向不存在节点的孤儿节点按根层级处理，与前端 buildTree 口径一致）；
  // 组内保持扁平列表的相对顺序 = sortOrder 升序
  const knownIds = new Set(flatNodes.map((n) => n.id))
  const childrenMap = new Map<string | null, typeof flatNodes>()
  for (const node of flatNodes) {
    const key = node.parentId && knownIds.has(node.parentId) ? node.parentId : null
    const siblings = childrenMap.get(key) ?? []
    siblings.push(node)
    childrenMap.set(key, siblings)
  }

  // 深度优先先序遍历：父节点排在子节点前，顺序与文档树视觉顺序一致
  type FlatNode = (typeof flatNodes)[number]
  const ordered: FlatNode[] = []
  const dfs = (parentId: string | null) => {
    for (const node of childrenMap.get(parentId) ?? []) {
      ordered.push(node)
      dfs(node.id)
    }
  }
  dfs(null)

  // 仅文档节点进博客列表（纯分组容器无正文）
  const docNodes = ordered.filter((n) => n.documentId)
  if (docNodes.length === 0) return []

  // 批量查正文（只取提取第一图 / 摘要 / 时间所需字段，不取 contentHtml 减小体积）
  const db = getDb()
  const documentIds = docNodes.map((n) => n.documentId as string)
  const docs = await db
    .select({
      id: documents.id,
      content: documents.content,
      plainText: documents.plainText,
      updatedAt: documents.updatedAt,
    })
    .from(documents)
    .where(inArray(documents.id, documentIds))
  const docMap = new Map(docs.map((d) => [d.id, d]))

  // 组装列表项：配图优先级 cover > 正文第一图 > 留空；摘要取 plainText 前 120 字符
  return docNodes.map((node) => {
    const doc = docMap.get(node.documentId as string)
    const plain = doc?.plainText?.replace(/\s+/g, ' ').trim() ?? ''
    return {
      nodeId: node.id,
      documentId: node.documentId as string,
      title: node.title,
      icon: node.icon,
      cover: node.coverUrl,
      image: doc ? extractFirstImage(doc.content) : null,
      excerpt: plain ? plain.slice(0, 120) : null,
      updatedAt: (doc?.updatedAt ?? node.updatedAt).toISOString(),
    }
  })
}
