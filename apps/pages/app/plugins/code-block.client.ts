/**
 * 代码块增强交互（发布态）
 *
 * 服务端 code-html-enhancer.ts 烘进 contentHtml 的静态按钮（.code-copy）没有
 * 内联脚本 —— 本插件以 document 级事件委托激活点击行为，一次注册覆盖全部
 * 文档页（w/ /b/ /preview）与未来新增页面，无需逐页挂载。
 *
 * 无 JS 时按钮纯展示（渐进降级），有 JS 时：
 * - .code-copy → 复制代码文本，按钮切 is-copied 显示打勾（2s 回落）
 * - .code-fullscreen → 切换 pre.is-fullscreen（样式 markdown.css 14.4b），Esc 退出
 */
export default defineNuxtPlugin(() => {
  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null
    if (!target) return

    const copyBtn = target.closest<HTMLButtonElement>('.code-copy')
    if (copyBtn) {
      const code = copyBtn.closest('pre[data-code-block]')?.querySelector('.code-block-scroll code')
      // 行号拆行后 span.line 为 display:block，textContent 串联会丢换行 —— 按行拼接补偿
      const lineEls = code?.querySelectorAll('span.line')
      const text = lineEls?.length
        ? Array.from(lineEls, (line) => line.textContent ?? '').join('\n')
        : (code?.textContent ?? '')
      navigator.clipboard
        ?.writeText(text)
        .then(() => {
          copyBtn.classList.add('is-copied')
          setTimeout(() => copyBtn.classList.remove('is-copied'), 2000)
        })
        .catch(() => {})
      return
    }

    // 全屏切换：同一时刻至多一个块处于全屏（先关掉已有，再切当前）
    const fsBtn = target.closest<HTMLButtonElement>('.code-fullscreen')
    if (fsBtn) {
      const pre = fsBtn.closest('pre[data-code-block]')
      const opened = document.querySelector('pre[data-code-block].is-fullscreen')
      if (opened && opened !== pre) opened.classList.remove('is-fullscreen')
      pre?.classList.toggle('is-fullscreen')
    }
  })

  // Esc 退出全屏
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      document.querySelector('pre[data-code-block].is-fullscreen')?.classList.remove('is-fullscreen')
    }
  })
})
