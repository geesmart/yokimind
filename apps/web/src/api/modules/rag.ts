/**
 * RAG AI 知识库模块接口
 *
 * 对接后端 `/api/v1/rag/*` 接口（rag.controller.ts）：
 * - getRagStatus   索引状态统计  POST /rag/status   需鉴权
 * - searchRag      语义搜索      POST /rag/search   需鉴权
 * - reindexRag     全量重建索引  POST /rag/reindex  需鉴权
 * - reindexDocumentRag 单文档立即索引 POST /rag/document-reindex 需鉴权
 * - streamRagChat  AI 问答       POST /rag/chat     需鉴权（SSE 流式）
 *
 * 响应已被 request.ts 的 alova 实例统一解包：
 * - 成功直接返回后端 `data` 字段
 * - 业务失败抛 `ApiError`（如 80001 RAG_NOT_CONFIGURED / 80002 无权限）
 */
import { alova } from '../request'
import { API_BASE_URL, API_PREFIX, API_PATHS } from '../constants'
import { getAccessToken } from '../../utils/token'

// ==================== 类型定义（与后端 rag.service.ts 导出类型对齐） ====================

/** 索引状态统计 */
export interface RagStatus {
  /** 总文档数（有同步状态的） */
  total: number
  /** 已完成索引数 */
  done: number
  /** 待处理数（含 pending + running） */
  pending: number
  /** 失败数 */
  failed: number
  /** 已入库切片总数 */
  chunkCount: number
  /** 全库最新一次成功同步时间（ISO 字符串，从未成功过为 null） */
  lastSyncedAt: string | null
}

/** 单文档索引状态（文档编辑页徽标数据源） */
export interface RagDocumentStatus {
  /**
   * 同步状态：
   * - none：无 rag_sync 行（从未入队索引，或自动索引关闭后从未处理过）
   * - pending / running：队列中 / 处理中
   * - done：索引完成（chunkCount 为已入库切片数，空文档可为 0）
   * - failed：处理失败（error 为最近一次失败原因）
   */
  status: 'none' | 'pending' | 'running' | 'done' | 'failed'
  /** 该文档当前已入库的切片数量 */
  chunkCount: number
  /** 最近一次成功同步时间（ISO 字符串，可能为 null） */
  lastSyncedAt: string | null
  /** 最近一次失败原因（成功后为 null） */
  error: string | null
}

/** 语义搜索单条结果 */
export interface RagSearchResult {
  /** 切片 ID */
  chunkId: string
  /** 文档 ID */
  documentId: string
  /** 节点 ID（可能为 null） */
  nodeId: string | null
  /** 文档标题 */
  title: string | null
  /** 标题路径（"文档标题 > 一级标题"） */
  headingPath: string | null
  /** 切片内容 */
  content: string
  /** 相似度得分（1 - cosine 距离，越大越相似） */
  score: number
}

/** AI 问答引用来源 */
export interface RagChatSource {
  chunkId: string
  documentId: string
  nodeId: string | null
  title: string | null
  headingPath: string | null
  score: number
  /** 前端跳转链接 /w/{wikiId}/{nodeId}（nodeId 缺失时为 null） */
  url: string | null
}

/** AI 问答对话历史条目（多轮追问上下文，前端内存维护，服务端不落库） */
export interface RagHistoryItem {
  /** 该轮用户提问 */
  question: string
  /** 该轮 AI 回答 */
  answer: string
}

// ==================== 普通请求 ====================

/**
 * 查询知识库索引状态统计
 * POST /rag/status（需鉴权）
 *
 * @param wikiId 知识库 ID
 * @returns alova Method，send 后得到 { total, done, pending, failed, chunkCount }
 */
export function getRagStatus(wikiId: string) {
  return alova.Post<RagStatus>(API_PATHS.RAG.STATUS, { wikiId })
}

/** 批量状态查询返回条目（wikiId + 各状态计数） */
export interface RagStatusBatchItem extends RagStatus {
  /** 知识库 ID */
  wikiId: string
}

/**
 * 批量查询多个知识库的索引状态统计
 * POST /rag/status-batch（需鉴权，一次请求替代逐库 N 次）
 *
 * 越权/不存在的 wikiId 会被后端静默过滤（对应条目返回全 0 计数），
 * 无 wiki_rag 快照行的库同样返回全 0（前端灰点），无需判空。
 *
 * @param wikiIds 知识库 ID 列表（1-100 个）
 * @returns alova Method，send 后得到 { items: Array<{ wikiId } & RagStatus> }
 */
export function getRagStatusBatch(wikiIds: string[]) {
  return alova.Post<{ items: RagStatusBatchItem[] }>(API_PATHS.RAG.STATUS_BATCH, { wikiIds })
}

/**
 * 查询单文档索引状态
 * POST /rag/document-status（需鉴权，校验文档所属知识库归属）
 *
 * 纯 DB 读（rag_sync 表），不依赖 embedding 服务就绪
 *
 * @param documentId 文档 ID（documents.id）
 * @returns alova Method，send 后得到 { status, chunkCount, lastSyncedAt, error }
 */
export function getDocumentRagStatus(documentId: string) {
  return alova.Post<RagDocumentStatus>(API_PATHS.RAG.DOCUMENT_STATUS, { documentId })
}

/**
 * 语义搜索：查询文本向量化后召回 top-K 切片
 * POST /rag/search（需鉴权）
 *
 * embedding 服务未配置时后端抛 80001 RAG_NOT_CONFIGURED（ApiError）
 *
 * @param wikiId 知识库 ID（检索边界）
 * @param query 查询文本
 * @param topK 返回条数（可选，默认后端 RAG_TOP_K）
 * @returns alova Method，send 后得到结果数组（score 降序）
 */
export function searchRag(wikiId: string, query: string, topK?: number) {
  return alova.Post<RagSearchResult[]>(API_PATHS.RAG.SEARCH, { wikiId, query, topK })
}

/**
 * 全量重建知识库索引
 * POST /rag/reindex（需鉴权）
 *
 * 将该库全部文档任务重置为 pending 并重新入队 BullMQ（清空指纹强制重建切片）
 *
 * @param wikiId 知识库 ID
 * @returns alova Method，send 后得到 { marked: 重置的任务数 }
 */
export function reindexRag(wikiId: string) {
  return alova.Post<{ marked: number }>(API_PATHS.RAG.REINDEX, { wikiId })
}

/**
 * 单文档立即索引（重索引）
 * POST /rag/document-reindex（需鉴权，校验文档所属知识库归属）
 *
 * 只重置并重跑当前文档的索引任务：清空指纹强制重建切片后重新入队 BullMQ，
 * 文档编辑页「RAG 标签弹层」的立即索引按钮调用
 *
 * @param documentId 文档 ID（documents.id）
 * @returns alova Method，send 后得到 { marked: 1 }
 */
export function reindexDocumentRag(documentId: string) {
  return alova.Post<{ marked: number }>(API_PATHS.RAG.DOCUMENT_REINDEX, { documentId })
}

// ==================== AI 问答（SSE 流式） ====================

/** AI 问答 SSE 事件回调集合 */
export interface RagChatHandlers {
  /** 收到回答增量文本（多次回调，顺序拼接即为完整回答） */
  onDelta: (text: string) => void
  /** 回答结束：推送引用来源列表 */
  onSources?: (sources: RagChatSource[]) => void
  /** 流内异常（AI 上游失败等，error 事件） */
  onError?: (message: string) => void
  /** 正常结束（done 事件） */
  onDone?: () => void
}

/**
 * 解析一行 SSE 文本到事件缓冲（内部辅助）
 * SSE 事件格式：`event: <name>\n data: <payload>\n\n`，空行表示事件结束
 */
function feedSseLine(
  line: string,
  state: { event: string; data: string; hasData: boolean }
): { event: string; data: string } | null {
  // 空行：一个事件结束，返回缓冲的完整事件。
  // 用 hasData 标记判断「是否收到过 data 行」而非 data 非空：data 可能为空串，不能据此丢弃
  if (line === '' || line === '\r') {
    if (!state.hasData) return null
    const evt = { event: state.event || 'message', data: state.data }
    state.event = ''
    state.data = ''
    state.hasData = false
    return evt
  }
  if (line.startsWith('event:')) {
    state.event = line.slice(6).trim()
  } else if (line.startsWith('data:')) {
    // 多行 data 以换行拼接（本项目 payload 均为单行 JSON）；
    // 拼接换行用 hasData 标记而非 data 非空判断，避免空 data 行丢失换行（与 ai.ts 同款修复）
    if (state.hasData) state.data += '\n'
    state.hasData = true
    state.data += line.slice(5).trim()
  }
  return null
}

/**
 * AI 问答（RAG）：基于检索上下文流式生成回答
 * POST /rag/chat（需鉴权，SSE 流式）
 *
 * 实现说明：
 * - POST 无法用 EventSource，用原生 fetch + ReadableStream 逐块解析
 * - 业务异常（权限/检索失败，如 80001）在流开始前抛出：响应为 JSON 而非 SSE，
 *   解析后抛 ApiError 由调用方捕获
 * - 需要中断时由调用方传入 AbortSignal
 *
 * @param wikiId 知识库 ID
 * @param question 用户问题
 * @param handlers SSE 事件回调
 * @param signal 可选中断信号（AbortController.signal）
 * @param history 可选对话历史（最多 10 条，时间正序；用于问题改写与多轮上下文）
 */
export async function streamRagChat(
  wikiId: string,
  question: string,
  handlers: RagChatHandlers,
  signal?: AbortSignal,
  history?: RagHistoryItem[],
): Promise<void> {
  // 不走 alova（不支持流式回调），原生 fetch 并手动注入 token
  const token = getAccessToken()
  const resp = await fetch(`${API_BASE_URL}${API_PREFIX}${API_PATHS.RAG.CHAT}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ wikiId, question, history }),
    signal,
  })

  // 非流式响应：业务异常以 JSON 返回（HTTP 200 + { status: 错误码, info }），
  // 与 request.ts 解包逻辑对齐，抛 ApiError
  const contentType = resp.headers.get('content-type') || ''
  if (!contentType.includes('text/event-stream')) {
    const result = await resp.json().catch(() => ({}))
    if (result.status !== 1) {
      const { ApiError } = await import('../request')
      throw new ApiError(result.info || '请求失败', result.status, resp.status, result)
    }
    return
  }

  // 逐行解析 SSE 事件流
  const reader = resp.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const state = { event: '', data: '', hasData: false }

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    // 按换行拆分；最后一段可能不完整，留在 buffer 等下一块
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const evt = feedSseLine(line, state)
      if (!evt) continue
      // 按事件类型分发（payload 均为 JSON）
      if (evt.event === 'delta') {
        handlers.onDelta(JSON.parse(evt.data).text)
      } else if (evt.event === 'sources') {
        handlers.onSources?.(JSON.parse(evt.data))
      } else if (evt.event === 'error') {
        handlers.onError?.(JSON.parse(evt.data).message)
      } else if (evt.event === 'done') {
        handlers.onDone?.()
      }
    }
  }
}
