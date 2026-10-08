/**
 * 文档 local-first 持久化模块
 *
 * 核心设计（修复「编辑后立即切换文档/标签页，改动丢失」的保存 BUG）：
 * - 第一落点是浏览器本地：编辑器每次 onUpdate 都立即推送快照，
 *   先写内存缓存（同步、零延迟），再异步镜像到 IndexedDB（无防抖，每次都落盘），
 *   数据在浏览器侧即刻安全，切文档/切标签页/刷新/关页都不会丢
 * - 服务端同步是异步延迟的：模块级串行同步队列负责把最新快照推给服务器，
 *   3s 节流（连续编辑期间至多 3s 一次）+ 失败退避重试（2s/4s ×2）+
 *   限流专用 2s 退避（后端保存限流窗口 2s，撞闸后必过），
 *   单例与定时器全部挂在模块层，编辑器组件卸载不影响同步推进
 * - 快照引用比较清 dirty：同步起飞时捕获快照引用，成功时若「最新快照 === 起飞快照」
 *   则清 dirty 并把 savedAt 基线对齐服务端返回值（供调和时间戳比较）；
 *   同步期间又有新编辑则保持 dirty，由队列继续推进
 * - 读取调和（loadDocContent 调用）：本地 dirty → 本地赢（队列稍后推送服务端）；
 *   本地干净且服务端 updatedAt 更新 → 服务端赢（整文档替换）
 *
 * 使用方式：
 * ```ts
 * // 编辑器内（每次 onUpdate）
 * const persistence = getDocPersistence(documentId)
 * persistence.pushSnapshot(editor.getJSON(), wordCount)
 * persistence.onStatus((status, lastSavedAt) => emit('save:status', status, lastSavedAt))
 * // 页面编排层（加载文档）
 * const local = await readLocalSnapshot(documentId) // 内存 → IndexedDB 兜底
 * const dirty = getDocPersistence(documentId).isDirty()
 * ```
 */
import { saveDocument } from '@/api/modules/wiki'
import { ERROR_CODES } from '@/api/constants'
import { ApiError } from '@/api/request'

/**
 * 保存状态枚举（与顶栏「已保存 · X 前」指示器语义对齐）
 * - idle：尚未有任何本地写入（理论上一经挂载即为 saved，保留枚举兜底）
 * - saving：服务端同步进行中 / 退避重试中
 * - saved：本地已落盘且服务端无落后（或刚完成同步）
 * - error：服务端同步重试耗尽（本地数据仍安全，下次编辑或 flush 自动恢复）
 */
export type AutoSaveStatus = 'idle' | 'saving' | 'saved' | 'error'

/**
 * 文档快照：local-first 的最小持久化单元
 * 只含 content JSON + wordCount（不用 contentHtml 与 plainText：
 * plainText 由服务端 saveDocument 从 content 提取兜底生成）
 */
export interface DocSnapshot {
  /** Tiptap JSON 内容 */
  content: unknown
  /** 字数（编辑器纯文本长度） */
  wordCount: number
  /** 快照时间基线：本地写入时刻 / 服务端同步成功后对齐为服务端 updatedAt（ISO 字符串） */
  savedAt: string
  /**
   * 脏标记（持久化字段，随快照写入 IndexedDB）：
   * true = 该快照尚未成功同步到服务端。
   *
   * 必须持久化的原因（修复「删除图片后刷新又回来」的保存 BUG）：
   * dirty 此前只存在于内存（DocPersistence 实例字段），页面刷新后实例重建、
   * dirty 归零——而「服务端最后一次保存」完全可能是更旧的内容（在途请求晚于
   * 本地新快照落库，落库时间戳反而更新），此时调和的时间戳比较会判「服务端赢」，
   * 把用户未同步的本地修改（如删除图片）整体回滚且无任何自愈路径。
   * 持久化后：重载时从快照恢复 dirty → 调和判定本地赢 + 同步队列自动重推，
   * 「未上服务端的修改永不丢失」这一 local-first 不变量在刷新后依然成立。
   */
  dirty?: boolean
}

/** IndexedDB 库名 / 对象仓 / key 前缀（key = `doc:{documentId}`） */
const DB_NAME = 'yokimind-doc-cache'
const STORE_NAME = 'docs'
const KEY_PREFIX = 'doc:'

/** 服务端同步节流间隔：连续编辑期间至多 3s 推送一次（配合后端 2s 限流窗口正常不触闸） */
const SYNC_THROTTLE_MS = 3000
/** 失败退避重试序列（网络错误 / 5xx）：最多 2 次 */
const RETRY_BACKOFF_MS = [2000, 4000]
/** 限流专用退避：后端保存限流窗口 2s，等 2s 重试必过闸 */
const RATE_LIMIT_RETRY_MS = 2000

// ============ IndexedDB 基础设施（模块级单例连接） ============

/** 惰性缓存的 IndexedDB 连接 Promise（多实例共享同一连接） */
let dbPromise: Promise<IDBDatabase | null> | null = null

/**
 * 打开（或复用）IndexedDB 连接
 * 浏览器不支持 / 打开失败时返回 null，调用方降级为纯内存缓存
 */
function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)
  const cached = dbPromise
  if (cached) return cached
  const opened = new Promise<IDBDatabase | null>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    // 首次打开：创建对象仓（keyPath 主键即我们拼好的 `doc:{id}` 字符串）
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE_NAME)) {
        req.result.createObjectStore(STORE_NAME)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  }).catch((err) => {
    console.warn('[doc-persistence] IndexedDB 打开失败，降级为纯内存缓存:', err)
    return null
  })
  dbPromise = opened
  return opened
}

/**
 * 写入一条快照到 IndexedDB（fire-and-forget，失败仅告警不影响主流程）
 */
function idbPut(key: string, snapshot: DocSnapshot): void {
  void openDb().then((db) => {
    if (!db) return
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).put(snapshot, key)
      tx.onabort = () => console.warn('[doc-persistence] IDB 写入中止:', tx.error)
    } catch (err) {
      // put() 在入队时会同步做 structured clone：若 content 里混入了不可克隆的对象
      //（典型：Vue 深层 ref 读出的 reactive Proxy），会抛 DataCloneError。
      // 兜底：用 JSON 深拷贝把内容转成纯对象重试一次（JSON 序列化对 Proxy 透明），
      // 保证「第一落点」不静默失效 —— IDB 是刷新/重开页面后的唯一数据来源
      try {
        const tx = db.transaction(STORE_NAME, 'readwrite')
        tx.objectStore(STORE_NAME).put(JSON.parse(JSON.stringify(snapshot)) as DocSnapshot, key)
        tx.onabort = () => console.warn('[doc-persistence] IDB 写入中止:', tx.error)
      } catch {
        console.warn('[doc-persistence] IDB 写入异常:', err)
      }
    }
  })
}

/**
 * 从 IndexedDB 读取一条快照（未命中返回 null）
 */
async function idbGet(key: string): Promise<DocSnapshot | null> {
  const db = await openDb()
  if (!db) return null
  return new Promise((resolve) => {
    try {
      const req = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(key)
      req.onsuccess = () => resolve((req.result as DocSnapshot | undefined) ?? null)
      req.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

// ============ 模块级缓存与单例注册表（跨组件卸载存活） ============

/**
 * 内存快照缓存：documentId → 最新快照
 * SPA 会话内的一级读取源（同步零延迟），IndexedDB 是刷新/重开后的二级兜底
 */
const memoryCache = new Map<string, DocSnapshot>()

/**
 * 持久化单例注册表：documentId → DocPersistence
 * 同一文档跨编辑器挂载/卸载复用同一实例，同步定时器随实例存活于模块层
 */
const persistenceMap = new Map<string, DocPersistence>()

// ============ 本地读取 / 写入（供页面编排层调和使用） ============

/**
 * 读取文档本地快照：内存缓存优先（同步命中），未命中回源 IndexedDB 并回填内存
 * @param documentId 文档 ID（documents.id）
 */
export async function readLocalSnapshot(documentId: string): Promise<DocSnapshot | null> {
  const hit = memoryCache.get(documentId)
  if (hit) return hit
  const stored = await idbGet(KEY_PREFIX + documentId)
  if (stored) memoryCache.set(documentId, stored)
  return stored
}

/**
 * 把服务端权威数据写入本地缓存（服务端赢 / 首次加载时调用，建立 savedAt 时间基线）
 */
export async function writeLocalSnapshot(
  documentId: string,
  snapshot: DocSnapshot
): Promise<void> {
  memoryCache.set(documentId, snapshot)
  idbPut(KEY_PREFIX + documentId, snapshot)
}

// ============ 全局兜底：切后台 / 关页时推进同步 ============

/** 全局事件是否已注册（模块级只注册一次） */
let globalListenersBound = false

/**
 * 注册全局兜底事件（首次 getDocPersistence 时惰性执行）
 * - visibilitychange hidden（切浏览器标签页/最小化）：flush 所有脏文档，模块级定时器继续推进
 * - beforeunload（刷新/关页）：对脏文档逐个发 keepalive fetch（绕过 alova 防止被中断），
 *   本地 IndexedDB 在每次 pushSnapshot 时已即时落盘，此处只是顺手把服务端也推一把
 */
function bindGlobalListeners() {
  if (globalListenersBound) return
  globalListenersBound = true

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden') return
    for (const p of persistenceMap.values()) p.flush()
  })

  window.addEventListener('beforeunload', () => {
    const token = localStorage.getItem('yokimind_access_token') ?? ''
    const baseURL = `${window.location.origin}/api/v1`
    for (const [documentId, p] of persistenceMap.entries()) {
      const snap = p.peekSnapshot()
      if (!snap || !p.isDirty()) continue
      // keepalive 保证请求在页面卸载后仍能发出；失败无妨（本地已落盘，下次打开调和续传）
      fetch(`${baseURL}/wiki/document/${documentId}/save`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          content: snap.content,
          updatedAt: new Date().toISOString(),
          wordCount: snap.wordCount,
        }),
        keepalive: true,
      }).catch(() => {})
    }
  })
}

// ============ 单文档持久化实例 ============

/**
 * 状态回调签名：状态 + 最近一次「服务端确认」时间（null 表示本会话尚无服务端确认）
 */
export type PersistenceStatusListener = (status: AutoSaveStatus, lastSavedAt: Date | null) => void

/**
 * 单文档持久化实例接口
 */
export interface DocPersistence {
  /** 推送最新快照（编辑器 onUpdate 时调用）：内存 + IndexedDB 即时落盘，并排程服务端同步 */
  pushSnapshot(content: unknown, wordCount: number): void
  /** 是否存在未同步到服务端的本地修改 */
  isDirty(): boolean
  /** 立即推进一次服务端同步（组件卸载 / 切后台时调用，异步不阻塞） */
  flush(): void
  /** 订阅状态变化；注册时立即以当前状态回调一次 */
  onStatus(listener: PersistenceStatusListener): void
  /** 读取当前最新快照（beforeunload keepalive 用；仅模块内部与调试使用） */
  peekSnapshot(): DocSnapshot | null
}

/**
 * 获取（或创建）指定文档的持久化单例
 * 单例挂在模块级注册表：编辑器组件卸载（切文档 / 切路由）后同步队列与定时器继续存活
 */
export function getDocPersistence(documentId: string): DocPersistence {
  const existing = persistenceMap.get(documentId)
  if (existing) return existing

  bindGlobalListeners()

  // ============ 实例内部状态（闭包私有） ============
  /** 最新本地快照（每次 pushSnapshot 替换为新对象，供引用比较） */
  let latestSnapshot: DocSnapshot | null = memoryCache.get(documentId) ?? null
  /**
   * 脏标记：存在未同步到服务端的本地修改。
   * 初始化时从快照恢复持久化的 dirty（修复「刷新后脏快照丢失身份」BUG）：
   * 上个会话同步失败的快照（含 beforeunload keepalive 被限流丢弃的场景），
   * 重载后依然被识别为未同步——调和保本地、队列自动重推，数据不丢。
   * 时序保证：调用方（loadDocContent）总是先 readLocalSnapshot 回填 memoryCache
   * 再触发编辑器挂载 / 调和，因此这里读到的即 IndexedDB 里的最新快照。
   */
  let dirty = latestSnapshot?.dirty === true
  /** 同步请求进行中（串行防并发） */
  let inFlight = false
  /** 完成后需要再推一轮（同步期间有新编辑） */
  let pendingResync = false
  /** 节流定时器句柄 */
  let syncTimer: ReturnType<typeof setTimeout> | null = null
  /** 退避重试索引（成功后归零） */
  let retryIndex = 0
  /** 状态机 */
  let status: AutoSaveStatus = 'saved'
  /** 最近一次服务端确认时间 */
  let lastSavedAt: Date | null = null
  /** 状态监听器集合 */
  const listeners = new Set<PersistenceStatusListener>()

  function setStatus(next: AutoSaveStatus, savedAt?: Date | null) {
    status = next
    if (savedAt !== undefined) lastSavedAt = savedAt
    for (const fn of listeners) fn(status, lastSavedAt)
  }

  /**
   * 排程一次服务端同步
   * 已有排程则跳过（节流语义：连续编辑期间首 keystroke 定时，至多 3s 一推）
   */
  function requestSync(delay: number = SYNC_THROTTLE_MS): void {
    if (syncTimer !== null) return
    syncTimer = setTimeout(() => {
      syncTimer = null
      void syncNow()
    }, delay)
  }

  /**
   * 执行一次服务端同步（串行）
   * - 起飞时捕获最新快照引用，成功后引用比较清 dirty（同步期间的新编辑不会被误清）
   * - 成功且快照仍是最新：savedAt 基线对齐服务端返回值并回写本地缓存（调和时间戳可比）
   * - 限流：2s 后重试（后端保存限流窗口 2s，必过闸），不计入退避次数
   * - 网络错误 / 5xx：按 2s/4s 退避重试，耗尽后置 error 等待下次编辑 / flush 拉起
   */
  async function syncNow(): Promise<void> {
    if (inFlight) {
      pendingResync = true
      return
    }
    const snap = latestSnapshot
    if (!dirty || !snap) return

    inFlight = true
    setStatus('saving')
    try {
      const result = await saveDocument(documentId, {
        content: snap.content,
        // 后端乐观锁已移除（last-write-wins），updatedAt 仅为 schema 兼容字段
        updatedAt: new Date().toISOString(),
        wordCount: snap.wordCount,
      }).send()
      inFlight = false
      retryIndex = 0
      if (latestSnapshot === snap) {
        // 起飞快照仍是最新：清 dirty，savedAt 基线对齐服务端（内存 + IDB 同步回写）
        dirty = false
        // 同步清掉持久化的脏标记：此后刷新重载，调和可正常走时间戳比较
        // （此时本地与服务端内容一致，谁赢都不丢数据）
        snap.dirty = false
        snap.savedAt = result.updatedAt
        memoryCache.set(documentId, snap)
        idbPut(KEY_PREFIX + documentId, snap)
        setStatus('saved', new Date(result.updatedAt))
      } else {
        // 同步期间又有新编辑（已是 dirty，新快照在后续轮次推送）
        setStatus('saved')
      }
      if (pendingResync || dirty) {
        pendingResync = false
        requestSync()
      }
    } catch (error) {
      inFlight = false
      if (error instanceof ApiError && error.code === ERROR_CODES.DOCUMENT_SAVE_RATE_LIMITED) {
        // 限流：静默 2s 退避重试（后端窗口 2s，必过闸），不置 error
        requestSync(RATE_LIMIT_RETRY_MS)
        return
      }
      if (retryIndex < RETRY_BACKOFF_MS.length) {
        // 网络错误 / 5xx：退避重试，期间保持 saving（本地数据已安全）
        requestSync(RETRY_BACKOFF_MS[retryIndex++])
        return
      }
      console.error('[doc-persistence] 服务端同步失败（已停止自动重试）:', error)
      setStatus('error')
    }
  }

  const instance: DocPersistence = {
    pushSnapshot(content, wordCount) {
      // dirty: true 随快照持久化——刷新/崩溃后重载时仍能识别「这条快照未上服务端」，
      // 由调和逻辑保本地 + 同步队列重推（详见 DocSnapshot.dirty 注释）
      const snap: DocSnapshot = { content, wordCount, savedAt: new Date().toISOString(), dirty: true }
      latestSnapshot = snap
      dirty = true
      // 第一落点：内存即时 + IndexedDB 异步镜像（无防抖，每次都落盘）
      memoryCache.set(documentId, snap)
      idbPut(KEY_PREFIX + documentId, snap)
      // 本地已安全，状态即 saved（服务端同步由队列异步推进）
      setStatus('saved')
      requestSync()
    },
    isDirty() {
      return dirty
    },
    flush() {
      if (!dirty) return
      // 清掉节流定时器，立即推进一轮（组件卸载 / 切后台时调用）
      if (syncTimer !== null) {
        clearTimeout(syncTimer)
        syncTimer = null
      }
      void syncNow()
    },
    onStatus(listener) {
      listeners.add(listener)
      // 注册即回调当前状态，宿主无需自行初始化指示器
      listener(status, lastSavedAt)
    },
    peekSnapshot() {
      return latestSnapshot
    },
  }

  persistenceMap.set(documentId, instance)

  // 恢复的脏快照（上个会话未同步成功）排程重推：刷新重载后自动续传服务端，
  // 无需等待用户下一次编辑（走标准 3s 节流，避免与首屏请求争抢）
  if (dirty) requestSync()

  return instance
}
