/**
 * Agent HTTP API 客户端
 * - 端点：<url>/api/v1/agent/*（POST，Bearer PAT 认证）与 /api/v1/skills*（GET）
 * - 响应约定：成功 { status: 1, data }；业务失败 { status: <错误码>, info }（HTTP 200）
 * - Skills 的 SKILL.md 走原始 markdown 文本（非 JSON 包装），单独处理
 */
import { loadConfig } from './config.mjs'

/** 业务错误（携带后端错误码，如 50001 知识库不存在） */
export class ApiError extends Error {
  /**
   * @param {number} code 后端业务错误码
   * @param {string} info 错误描述
   */
  constructor(code, info) {
    super(info || `请求失败（错误码 ${code}）`)
    this.name = 'ApiError'
    this.code = code
  }
}

/**
 * 统一 JSON 请求（POST 优先；GET 用于 skills 列表）
 * @param {string} pathname /api/v1 之后的路径（如 /agent/wikis）
 * @param {{ body?: unknown, method?: 'GET'|'POST' }} [opts]
 * @returns {Promise<any>} 后端 data 字段
 */
export async function request(pathname, opts = {}) {
  const { url, token } = await loadConfig()
  if (!token) {
    throw new Error('未配置访问令牌：先运行 yokimind login，或设置环境变量 YOKIMIND_TOKEN')
  }
  return requestRaw(url, token, pathname, opts)
}

/**
 * 带显式 url/token 的请求（login 校验阶段配置尚未落盘时使用）
 */
export async function requestRaw(url, token, pathname, opts = {}) {
  const method = opts.method ?? (opts.body !== undefined ? 'POST' : 'GET')
  const res = await fetch(`${url}/api/v1${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(opts.body !== undefined && { 'Content-Type': 'application/json' }),
    },
    ...(opts.body !== undefined && { body: JSON.stringify(opts.body) }),
  })
  if (res.status === 401) {
    throw new ApiError(10003, '认证失败：令牌无效或已吊销')
  }
  if (!res.ok) {
    throw new Error(`服务异常：HTTP ${res.status}`)
  }
  const json = await res.json()
  // 全局响应中间件包装：成功 status=1，失败 status=错误码 + info
  if (json.status !== 1) {
    throw new ApiError(json.status, json.info)
  }
  return json.data
}

// ==================== Agent API（POST /agent/*） ====================

/** @returns {Promise<Array>} 知识库列表 */
export function listWikis() {
  return request('/agent/wikis', { body: {} })
}

/** @returns {Promise<{ wikiId: string, nodes: Array }>} 文档树 */
export function getWikiTree(wikiId) {
  return request('/agent/wiki/tree', { body: { wikiId } })
}

/**
 * 检索
 * @param {{ wikiId?: string, q: string, mode?: 'keyword'|'semantic'|'auto', limit?: number }} params
 * @returns {Promise<{ usedMode: string, items: Array }>}
 */
export function search(params) {
  return request('/agent/search', { body: params })
}

/**
 * 读取文档
 * @param {{ nodeId?: string, documentId?: string, wikiId?: string }} params
 */
export function getDocument(params) {
  return request('/agent/document/get', { body: params })
}

/** 创建文档 @param {{ wikiId: string, title?: string, parentId?: string, markdown: string }} params */
export function createDocument(params) {
  return request('/agent/document/create', { body: params })
}

/** 更新文档 @param {{ nodeId?: string, documentId?: string, title?: string, markdown: string }} params */
export function updateDocument(params) {
  return request('/agent/document/update', { body: params })
}

// ==================== Skills API（GET /skills*） ====================

/** @returns {Promise<Array<{ name: string, description: string, wikiId: string }>>} 技能列表 */
export function listSkills() {
  return request('/skills', { method: 'GET' })
}

/**
 * 下载指定知识库的 SKILL.md（原始 markdown 文本）
 * @returns {Promise<string>}
 */
export async function fetchSkillMd(wikiId) {
  const { url, token } = await loadConfig()
  if (!token) {
    throw new Error('未配置访问令牌：先运行 yokimind login，或设置环境变量 YOKIMIND_TOKEN')
  }
  const res = await fetch(`${url}/api/v1/skills/${wikiId}/SKILL.md`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (res.status === 401) {
    throw new ApiError(10003, '认证失败：令牌无效或已吊销')
  }
  if (!res.ok) {
    const json = await res.json().catch(() => null)
    throw new ApiError(json?.status ?? res.status, json?.info)
  }
  return res.text()
}

/**
 * 生成 MCP 客户端配置片段（含真实令牌，供 Claude / Cursor / Trae 等配置文件粘贴）
 */
export async function renderMcpJson() {
  const { url, token } = await loadConfig()
  if (!token) {
    throw new Error('未配置访问令牌：先运行 yokimind login，或设置环境变量 YOKIMIND_TOKEN')
  }
  return JSON.stringify(
    {
      mcpServers: {
        yokimind: {
          url: `${url}/api/v1/mcp`,
          headers: { Authorization: `Bearer ${token}` },
        },
      },
    },
    null,
    2,
  )
}
