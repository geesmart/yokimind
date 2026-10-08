/**
 * Token 管理工具
 * 统一封装访问令牌、刷新令牌、过期时间、用户信息在 localStorage 的读写
 */
import { TOKEN_STORAGE_KEYS } from '../api/constants'
import type { TokenInfo, UserInfo } from '../api/types'

/** 获取访问令牌 */
export function getAccessToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEYS.ACCESS_TOKEN)
  } catch {
    return null
  }
}

/** 获取刷新令牌 */
export function getRefreshToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEYS.REFRESH_TOKEN)
  } catch {
    return null
  }
}

/** 获取 Token 过期时间（Unix 秒） */
export function getTokenExpiresAt(): number | null {
  try {
    const value = localStorage.getItem(TOKEN_STORAGE_KEYS.EXPIRES_AT)
    return value ? Number(value) : null
  } catch {
    return null
  }
}

/** 保存 Token 信息 */
export function saveToken(tokenInfo: TokenInfo): void {
  try {
    localStorage.setItem(TOKEN_STORAGE_KEYS.ACCESS_TOKEN, tokenInfo.accessToken)
    if (tokenInfo.refreshToken) {
      localStorage.setItem(TOKEN_STORAGE_KEYS.REFRESH_TOKEN, tokenInfo.refreshToken)
    }
    if (tokenInfo.expiresAt) {
      localStorage.setItem(TOKEN_STORAGE_KEYS.EXPIRES_AT, String(tokenInfo.expiresAt))
    }
  } catch (error) {
    console.error('保存 Token 失败:', error)
  }
}

/** 更新访问令牌 */
export function updateAccessToken(accessToken: string, expiresAt?: number): void {
  try {
    localStorage.setItem(TOKEN_STORAGE_KEYS.ACCESS_TOKEN, accessToken)
    if (expiresAt) {
      localStorage.setItem(TOKEN_STORAGE_KEYS.EXPIRES_AT, String(expiresAt))
    }
  } catch (error) {
    console.error('更新 Token 失败:', error)
  }
}

/** 清除所有 Token 信息 */
export function clearToken(): void {
  try {
    localStorage.removeItem(TOKEN_STORAGE_KEYS.ACCESS_TOKEN)
    localStorage.removeItem(TOKEN_STORAGE_KEYS.REFRESH_TOKEN)
    localStorage.removeItem(TOKEN_STORAGE_KEYS.EXPIRES_AT)
  } catch (error) {
    console.error('清除 Token 失败:', error)
  }
}

/** 检查 Token 是否已过期或即将过期（提前 5 分钟） */
export function isTokenExpired(): boolean {
  const expiresAt = getTokenExpiresAt()
  if (!expiresAt) return true
  const now = Math.floor(Date.now() / 1000)
  return now >= expiresAt - 300
}

/** 检查是否已登录 */
export function isLoggedIn(): boolean {
  const token = getAccessToken()
  return !!token && !isTokenExpired()
}

/** 获取缓存的用户信息 */
export function getUserInfo(): UserInfo | null {
  try {
    const value = localStorage.getItem(TOKEN_STORAGE_KEYS.USER_INFO)
    return value ? JSON.parse(value) : null
  } catch {
    return null
  }
}

/** 保存用户信息 */
export function saveUserInfo(userInfo: UserInfo): void {
  try {
    localStorage.setItem(TOKEN_STORAGE_KEYS.USER_INFO, JSON.stringify(userInfo))
  } catch (error) {
    console.error('保存用户信息失败:', error)
  }
}

/** 清除用户信息 */
export function clearUserInfo(): void {
  try {
    localStorage.removeItem(TOKEN_STORAGE_KEYS.USER_INFO)
  } catch (error) {
    console.error('清除用户信息失败:', error)
  }
}

/** 清除所有认证信息（登出时调用） */
export function clearAuth(): void {
  clearToken()
  clearUserInfo()
}