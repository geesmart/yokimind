import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * 复制文本到剪贴板，返回是否成功
 *
 * 注意：navigator.clipboard（Clipboard API）只在安全上下文（HTTPS 或 localhost）下存在，
 * 本地自定义域名（如 http://yokimind.local:6001）属于非安全上下文，navigator.clipboard 为
 * undefined，直接调用会抛错。因此这里做了 execCommand 降级：
 * 1. 安全上下文优先用 Clipboard API（异步、不破坏页面焦点）；
 * 2. 降级方案：临时创建 textarea 选中后执行 document.execCommand('copy')（同步、兼容旧环境）。
 *
 * 焦点陷阱（focus trap）坑：reka-ui 的 Dialog/AlertDialog/DropdownMenu 等弹出组件都开启了
 * FocusScope（trapped），会监听 document 的 focusin 事件——一旦焦点移动到弹层容器之外，
 * 立即把焦点抢回弹层内最后聚焦的元素。若把临时 textarea 挂到 document.body（弹层外部），
 * textarea.focus() 的瞬间焦点就会被抢走，随后 execCommand('copy') 因焦点不在 textarea、
 * 无有效选区而失败（表现为弹层内点复制提示「复制失败」）。因此降级时优先把 textarea 挂到
 * 当前打开的弹层容器（[role="dialog"] / [role="alertdialog"] / [role="menu"]）内部，
 * 让焦点移动仍处于陷阱范围内；非弹层场景回退 document.body，保持原有行为。
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  // 安全上下文下优先走 Clipboard API
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // 失败（如权限被拒）继续尝试降级方案
    }
  }
  // 定位触发元素所在的弹层容器：点击复制按钮时 document.activeElement 是该按钮，
  // 向上找最近的弹层节点。除 Dialog/AlertDialog（role="dialog"/"alertdialog"）外，
  // DropdownMenu/ContextMenu 的内容容器带 role="menu"——同样开启了 trapped FocusScope，
  // 不挂进容器内降级复制会被焦点陷阱抢回焦点导致失败（如顶栏「发布」下拉里的 Wiki 链接复制）
  const triggerElement = document.activeElement as HTMLElement | null
  const popupContainer = triggerElement?.closest?.(
    '[role="dialog"], [role="alertdialog"], [role="menu"]'
  ) as HTMLElement | null
  // 弹层内挂到弹层容器（规避 focus trap 抢焦点）；否则挂 body
  const mountTarget = popupContainer ?? document.body

  // 降级方案：textarea 必须先挂到 DOM 才能 focus/select
  const textarea = document.createElement('textarea')
  textarea.value = text
  // readonly 避免移动端弹出软键盘
  textarea.setAttribute('readonly', '')
  // fixed + 屏幕外隐藏：脱离文档流不影响弹窗布局，且视觉上无闪烁
  textarea.style.position = 'fixed'
  textarea.style.top = '-9999px'
  textarea.style.left = '-9999px'
  textarea.style.opacity = '0'
  mountTarget.appendChild(textarea)
  textarea.focus()
  textarea.select()
  // iOS Safari 需要显式设置选区范围，select() 在部分版本不生效
  textarea.setSelectionRange(0, textarea.value.length)
  let ok = false
  try {
    // execCommand 虽已标记废弃，但非安全上下文下是唯一同步复制手段
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }
  mountTarget.removeChild(textarea)
  return ok
}