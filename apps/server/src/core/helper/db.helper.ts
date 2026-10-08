import { BizException } from '~/core/lib/biz.exception.js'
import { ErrorCode } from '~/config/error-code.js'
import { getContext } from 'hono/context-storage'

/**
 * 获取数据库实例
 */
export function getDb() {
  const c = getContext()
  const db = c.get('db')
  if (!db) {
    throw new BizException(ErrorCode.SERVER_ERROR)
  }
  return db
}
