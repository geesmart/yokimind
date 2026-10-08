import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * 合并 Tailwind class（clsx 条件组合 + tailwind-merge 去重）
 * 与 apps/web/src/lib/utils.ts 保持一致
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
