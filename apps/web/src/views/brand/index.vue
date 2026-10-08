<template>
  <!--
    品牌素材页（/brand，无需登录）：
    用网格「格子」管理 logo 素材——每个格子 = 预览区 + 名称 + 下载按钮，
    预览区渲染的是独立组件（src/components/brand-logo/），组件名标注在下载按钮左侧。
    未来新增素材：新建组件 → 往 grid 里加一个格子（ref id + 组件 + 文件名）。
  -->
  <div class="min-h-screen w-full flex flex-col items-center px-4 py-16 bg-white">
    <!-- 页面标题区 -->
    <h1 class="text-2xl font-semibold text-foreground text-center">品牌素材</h1>
    <p class="text-sm text-muted-foreground text-center mt-2 mb-12">
      YOKI 文档官方 Logo 素材，支持下载图片，组件名标注在下载按钮左侧
    </p>

    <!-- 素材网格：小屏单列 / 大屏双列 -->
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-6 w-full max-w-3xl">
      <!-- ========== 格子：彩色玻璃 ========== -->
      <div class="flex flex-col border border-neutral-200 rounded-2xl overflow-hidden bg-white">
        <!-- 预览区：ref 挂在预览框上，导出时实际截取框内的 logo 组件根元素（见 downloadAsset） -->
        <div
          :ref="setPreviewRef('glass')"
          class="relative h-44 flex items-center justify-center overflow-hidden bg-white"
        >
          <LogoGlass />
        </div>
        <!-- 格子底栏：名称 + 操作按钮 -->
        <div
          class="flex items-center justify-between border-t border-neutral-200 px-3 h-11 shrink-0"
        >
          <span class="text-xs text-muted-foreground">彩色玻璃</span>
          <div class="flex items-center gap-2">
            <!-- 组件名：放在下载按钮左边，方便取用 -->
            <span class="text-xs text-neutral-400">LogoGlass</span>
            <button
              type="button"
              class="inline-flex cursor-pointer items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              :disabled="downloadingId === 'glass'"
              @click="downloadAsset('glass', 'yoki-logo-glass.png')"
            >
              <Download class="size-3.5" />
              <span>{{ downloadingId === 'glass' ? '生成中…' : '下载' }}</span>
            </button>
          </div>
        </div>
      </div>

      <!-- ========== 格子：蓝色玻璃 ========== -->
      <div class="flex flex-col border border-neutral-200 rounded-2xl overflow-hidden bg-white">
        <div
          :ref="setPreviewRef('blue')"
          class="relative h-44 flex items-center justify-center overflow-hidden bg-white"
        >
          <LogoGlassBlue />
        </div>
        <div
          class="flex items-center justify-between border-t border-neutral-200 px-3 h-11 shrink-0"
        >
          <span class="text-xs text-muted-foreground">蓝色玻璃</span>
          <div class="flex items-center gap-2">
            <!-- 组件名：放在下载按钮左边，方便取用 -->
            <span class="text-xs text-neutral-400">LogoGlassBlue</span>
            <button
              type="button"
              class="inline-flex cursor-pointer items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              :disabled="downloadingId === 'blue'"
              @click="downloadAsset('blue', 'yoki-logo-blue.png')"
            >
              <Download class="size-3.5" />
              <span>{{ downloadingId === 'blue' ? '生成中…' : '下载' }}</span>
            </button>
          </div>
        </div>
      </div>

      <!-- ========== 格子：黑白配色 ========== -->
      <div class="flex flex-col border border-neutral-200 rounded-2xl overflow-hidden bg-white">
        <div
          :ref="setPreviewRef('mono')"
          class="relative h-44 flex items-center justify-center overflow-hidden bg-white"
        >
          <LogoMono />
        </div>
        <div
          class="flex items-center justify-between border-t border-neutral-200 px-3 h-11 shrink-0"
        >
          <span class="text-xs text-muted-foreground">黑白配色</span>
          <div class="flex items-center gap-2">
            <!-- 组件名：放在下载按钮左边，方便取用 -->
            <span class="text-xs text-neutral-400">LogoMono</span>
            <button
              type="button"
              class="inline-flex cursor-pointer items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              :disabled="downloadingId === 'mono'"
              @click="downloadAsset('mono', 'yoki-logo-mono.png')"
            >
              <Download class="size-3.5" />
              <span>{{ downloadingId === 'mono' ? '生成中…' : '下载' }}</span>
            </button>
          </div>
        </div>
      </div>

      <!-- ========== 格子：横向组合 ========== -->
      <div class="flex flex-col border border-neutral-200 rounded-2xl overflow-hidden bg-white">
        <div
          :ref="setPreviewRef('lockup')"
          class="relative h-44 flex items-center justify-center overflow-hidden bg-white"
        >
          <LogoLockup />
        </div>
        <div
          class="flex items-center justify-between border-t border-neutral-200 px-3 h-11 shrink-0"
        >
          <span class="text-xs text-muted-foreground">横向组合</span>
          <div class="flex items-center gap-2">
            <!-- 组件名：放在下载按钮左边，方便取用 -->
            <span class="text-xs text-neutral-400">LogoLockup</span>
            <button
              type="button"
              class="inline-flex cursor-pointer items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              :disabled="downloadingId === 'lockup'"
              @click="downloadAsset('lockup', 'yoki-logo-lockup.png')"
            >
              <Download class="size-3.5" />
              <span>{{ downloadingId === 'lockup' ? '生成中…' : '下载' }}</span>
            </button>
          </div>
        </div>
      </div>

      <!-- ========== 格子：品牌字标 ========== -->
      <div class="flex flex-col border border-neutral-200 rounded-2xl overflow-hidden bg-white">
        <div
          :ref="setPreviewRef('wordmark')"
          class="relative h-44 flex items-center justify-center overflow-hidden bg-white"
        >
          <LogoWordmark />
        </div>
        <div
          class="flex items-center justify-between border-t border-neutral-200 px-3 h-11 shrink-0"
        >
          <span class="text-xs text-muted-foreground">品牌字标</span>
          <div class="flex items-center gap-2">
            <!-- 组件名：放在下载按钮左边，方便取用 -->
            <span class="text-xs text-neutral-400">LogoWordmark</span>
            <button
              type="button"
              class="inline-flex cursor-pointer items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              :disabled="downloadingId === 'wordmark'"
              @click="downloadAsset('wordmark', 'yoki-wordmark.png')"
            >
              <Download class="size-3.5" />
              <span>{{ downloadingId === 'wordmark' ? '生成中…' : '下载' }}</span>
            </button>
          </div>
        </div>
      </div>

      <!-- ========== 格子：品牌字标 ========== -->
      <div class="flex flex-col border border-neutral-200 rounded-2xl overflow-hidden bg-white">
        <div
          :ref="setPreviewRef('wordmark2')"
          class="relative h-44 flex items-center justify-center overflow-hidden bg-white"
        >
          <LogoWordmark2 />
        </div>
        <div
          class="flex items-center justify-between border-t border-neutral-200 px-3 h-11 shrink-0"
        >
          <span class="text-xs text-muted-foreground">品牌字标</span>
          <div class="flex items-center gap-2">
            <!-- 组件名：放在下载按钮左边，方便取用 -->
            <span class="text-xs text-neutral-400">LogoWordmark</span>
            <button
              type="button"
              class="inline-flex cursor-pointer items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              :disabled="downloadingId === 'wordmark'"
              @click="downloadAsset('wordmark2', 'yoki-wordmark2.png')"
            >
              <Download class="size-3.5" />
              <span>{{ downloadingId === 'wordmark' ? '生成中…' : '下载' }}</span>
            </button>
          </div>
        </div>
      </div>

      <div class="flex flex-col border border-neutral-200 rounded-2xl overflow-hidden bg-white">
        <div
          :ref="setPreviewRef('wordmark3')"
          class="relative h-44 flex items-center justify-center overflow-hidden bg-white"
        >
          <LogoWordmark3 />
        </div>
        <div
          class="flex items-center justify-between border-t border-neutral-200 px-3 h-11 shrink-0"
        >
          <span class="text-xs text-muted-foreground">品牌字标</span>
          <div class="flex items-center gap-2">
            <!-- 组件名：放在下载按钮左边，方便取用 -->
            <span class="text-xs text-neutral-400">LogoWordmark</span>
            <button
              type="button"
              class="inline-flex cursor-pointer items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              :disabled="downloadingId === 'wordmark'"
              @click="downloadAsset('wordmark', 'yoki-wordmark.png')"
            >
              <Download class="size-3.5" />
              <span>{{ downloadingId === 'wordmark' ? '生成中…' : '下载' }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ref } from 'vue'
import { Download } from '@lucide/vue'
import { toPng } from 'html-to-image'
import LogoGlass from '@/components/brand-logo/LogoGlass.vue'
import LogoGlassBlue from '@/components/brand-logo/LogoGlassBlue.vue'
import LogoMono from '@/components/brand-logo/LogoMono.vue'
import LogoLockup from '@/components/brand-logo/LogoLockup.vue'
import LogoWordmark from '@/components/brand-logo/LogoWordmark.vue'
import LogoWordmark2 from '@/components/brand-logo/LogoWordmark2.vue'
import LogoWordmark3 from '@/components/brand-logo/LogoWordmark3.vue'

/**
 * 各素材预览区的 DOM 引用表：key 对应素材 id，
 * 模板里通过 :ref="setPreviewRef(id)" 注册，导出时按 id 取节点。
 */
const previewRefs = ref<Record<string, HTMLElement | null>>({})

/** 生成模板 ref 注册函数（闭包绑定素材 id） */
function setPreviewRef(id: string) {
  return (el: unknown) => {
    previewRefs.value[id] = (el as HTMLElement | null) ?? null
  }
}

/** 当前正在导出的素材 id（同一时刻只允许一个导出任务，按钮显示「生成中…」并禁用） */
const downloadingId = ref<string | null>(null)

/**
 * 把指定素材的 logo 组件（预览框里「中间那个图片」）导出为 PNG 并触发浏览器下载：
 * 1. ref 挂在预览框上，真正导出的是框内唯一的元素子节点——logo 组件根元素
 *    （如 LogoMono 上带 hover:scale 的那层卡片），预览框的白底和留白不进导出图；
 * 2. 画布尺寸 = 组件矩形 ∪ 非装饰后代矩形，且只向右/向下扩展：
 *    - 字标右上角外挂的「文档」角标是内容、故意溢出组件右缘，必须包进画布；
 *    - 玻璃/黑白卡的氛围光斑是 aria-hidden 纯装饰层，跳过后导出图不带外围光晕，
 *      也不会出现右/下有光斑、左/上没有的不对称留边；
 * 3. pixelRatio: 3 提高导出分辨率（默认 1 会导致图片偏糊）；
 * 4. 生成 dataURL 后创建临时 <a> 触发下载，用完即弃。
 */
async function downloadAsset(id: string, filename: string) {
  const preview = previewRefs.value[id]
  const node = (preview?.firstElementChild ?? null) as HTMLElement | null
  if (!node || downloadingId.value) return

  downloadingId.value = id
  try {
    // 以组件自身矩形为基准，向右/下扩展到非装饰后代的最远边界（覆盖角标等溢出内容）
    const rect = node.getBoundingClientRect()
    let width = rect.width
    let height = rect.height
    for (const el of node.querySelectorAll('*')) {
      // 光斑等装饰层带 aria-hidden 标记，整棵子树跳过
      if (el.closest('[aria-hidden="true"]')) continue
      const r = el.getBoundingClientRect()
      if (!r.width && !r.height) continue
      width = Math.max(width, r.right - rect.left)
      height = Math.max(height, r.bottom - rect.top)
    }
    const dataUrl = await toPng(node, {
      pixelRatio: 3,
      width: Math.ceil(width),
      height: Math.ceil(height),
    })
    const link = document.createElement('a')
    link.download = filename
    link.href = dataUrl
    link.click()
  } catch (err) {
    console.warn('导出素材图片失败:', err)
  } finally {
    downloadingId.value = null
  }
}
</script>
