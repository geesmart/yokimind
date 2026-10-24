/**
 * CLI 配置读写
 * - 持久化位置：~/.yokimind/config.json（chmod 0600，含令牌明文，仅当前用户可读）
 * - 环境变量优先：YOKIMIND_URL / YOKIMIND_TOKEN > 配置文件 > 默认值
 */
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** 默认服务地址（本地单机部署统一入口） */
export const DEFAULT_URL = 'http://localhost:6001'

const CONFIG_DIR = join(homedir(), '.yokimind')
const CONFIG_FILE = join(CONFIG_DIR, 'config.json')

/** 运行时配置（url 已去尾斜杠）@typedef {{ url: string, token: string }} CliConfig */

/**
 * 读取生效配置（env 优先于配置文件；文件不存在/损坏时静默降级为空）
 * @returns {Promise<CliConfig>}
 */
export async function loadConfig() {
  let file = {}
  try {
    file = JSON.parse(await readFile(CONFIG_FILE, 'utf8'))
  } catch {
    // 无配置文件或 JSON 损坏：视为未登录（login 与 env 用法不受影响）
  }
  const url = process.env.YOKIMIND_URL || file.url || DEFAULT_URL
  return { url: url.replace(/\/+$/, ''), token: process.env.YOKIMIND_TOKEN || file.token || '' }
}

/**
 * 保存配置（合并已有字段；文件与目录均 0600/0700 收紧权限）
 * @param {{ url?: string, token?: string }} patch
 */
export async function saveConfig(patch) {
  let existing = {}
  try {
    existing = JSON.parse(await readFile(CONFIG_FILE, 'utf8'))
  } catch {
    // 首次登录：无已有配置
  }
  const next = { ...existing, ...(patch.url !== undefined && { url: patch.url.replace(/\/+$/, '') }), ...(patch.token !== undefined && { token: patch.token }) }
  await mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 })
  await writeFile(CONFIG_FILE, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 })
  // macOS/部分平台 writeFile 的 mode 仅作用于新建文件：对已存在文件显式 chmod 兜底
  await chmod(CONFIG_FILE, 0o600).catch(() => {})
}

/** 配置文件路径（login 成功提示用） */
export const configFileLabel = CONFIG_FILE
