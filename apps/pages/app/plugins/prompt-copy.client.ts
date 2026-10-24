/**
 * Prompt 提示词块「复制提示词」按钮行为（发布态）
 *
 * 服务端 static-renderer 烘进 contentHtml 的静态按钮（.md-prompt-copy-btn，
 * data-prompt-copy）没有内联脚本 —— 本插件以 document 级事件委托激活点击
 * 行为，一次注册覆盖全部文档页（w/ /b/ /preview），同 code-block.client.ts
 * 模式，无需逐页挂载。
 *
 * 复制源：卡片内隐藏的指令盒 [data-prompt-instr]（CSS display:none，仅作
 * 复制载体保留在 DOM）的 textContent。无 JS 时按钮纯展示（渐进降级）；
 * 复制成功后按钮切 is-copied class（copy 图标换成 check，CSS 显隐），
 * 1.5s 复原（WeakMap 存计时器，多按钮互不干扰、连点重置计时）。
 */
export default defineNuxtPlugin(() => {
  const restoreTimers = new WeakMap<HTMLButtonElement, ReturnType<typeof setTimeout>>()

  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null

    // 「展开」按钮：切 md-prompt--expanded（CSS 显示指令盒为限高滚动区），
    // 箭头方向由该 class 的 transform 切换（收起‹ / 展开∨），aria-expanded 同步可及性状态
    const toggleBtn = target?.closest<HTMLButtonElement>('.md-prompt-toggle-btn[data-prompt-toggle]')
    if (toggleBtn) {
      const card = toggleBtn.closest('.md-prompt')
      if (card) {
        const expanded = card.classList.toggle('md-prompt--expanded')
        toggleBtn.setAttribute('aria-expanded', String(expanded))
      }
      return
    }

    const btn = target?.closest<HTMLButtonElement>('.md-prompt-copy-btn[data-prompt-copy]')
    if (!btn) return

    const text =
      btn.closest('[data-prompt]')?.querySelector('[data-prompt-instr]')?.textContent ?? ''
    navigator.clipboard
      ?.writeText(text)
      .then(() => {
        // 复制成功反馈：copy 图标切 check（is-copied class 控制显隐），1.5s 复原
        btn.classList.add('is-copied')
        const prev = restoreTimers.get(btn)
        if (prev) clearTimeout(prev)
        restoreTimers.set(btn, setTimeout(() => btn.classList.remove('is-copied'), 1500))
      })
      .catch(() => {})
  })
})
