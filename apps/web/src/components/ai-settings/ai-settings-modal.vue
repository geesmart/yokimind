<template>
  <!--
    AI 大模型管理弹窗（用户头像下拉菜单「AI 大模型管理」、AI 写作浮条「去配置」共用）
    - v-model:visible 控制显隐；内容为共享表单 AiSettingsForm（与 /admin 页同一套逻辑）
    - visible 时才 v-if 挂载表单：每次打开都重新拉取最新脱敏配置
    - 布局三行：Header / 内容滚动区 / 固定 Footer（测试连接 + 保存配置按钮常驻底部，
      不随长表单滚动，无需滚到底部即可操作）
    - 表单动作（保存/测试）经 defineExpose 暴露，Footer 按钮通过模板 ref 调用；
      loading 态由弹窗本地镜像（包裹 async 调用），并互斥禁用另一按钮
    - title 可定制：用户菜单传「AI 大模型管理」，写作浮条用默认「AI 配置」
    - saved 事件透传给父级：使用方可据此（如 chatReady）决定是否自动关闭
  -->
  <Dialog :open="visible" @update:open="onOpenChange">
    <DialogContent class="sm:max-w-2xl max-h-[85vh] grid-rows-[auto_minmax(0,1fr)_auto]">
      <DialogHeader class="border-b pb-3">
        <DialogTitle>{{ title }}</DialogTitle>
        <DialogDescription>
          AI 服务商配置（对话 / 向量 / 精排）与检索参数，保存后新配置对全部服务即时生效
        </DialogDescription>
      </DialogHeader>

      <!-- 表单滚动区：shadcn-vue ScrollArea 自定义滚动条替代浏览器原生滚动条；
           min-h-0 保证在 grid 行内能被压缩，滚动条出现在内容区而非整窗 -->
      <ScrollArea class="min-h-0 pe-1">
        <AiSettingsForm v-if="visible" ref="formRef" in-modal @saved="onSaved" @close="close" />
      </ScrollArea>

      <!-- 固定底栏：测试 / 保存常驻可见（表单为加载中或无权限卡片时按钮仅提示不动作）；
           项目 Button 组件无 loading prop，用旋转图标 + 文案变化表达进行中状态 -->
      <DialogFooter class="mt-4 flex-row items-center gap-3 border-t pt-4">
        <p class="mr-auto hidden text-xs text-muted-foreground sm:block">
          保存后新配置即时生效，无需重启服务
        </p>
        <Button
          variant="outline"
          class="cursor-pointer"
          :disabled="testing || saving"
          @click="onTest"
        >
          <Loader2 v-if="testing" class="size-4 animate-spin" />
          <PlugZap v-else class="size-4" />
          {{ testing ? '测试中…' : '测试连接' }}
        </Button>
        <Button class="cursor-pointer" :disabled="saving || testing" @click="onSave">
          <Loader2 v-if="saving" class="size-4 animate-spin" />
          <Save v-else class="size-4" />
          {{ saving ? '保存中…' : '保存配置' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script lang="ts" setup>
import { ref } from 'vue'
import { PlugZap, Save, Loader2 } from '@lucide/vue'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import AiSettingsForm from './ai-settings-form.vue'
import type { AiSettingsView } from '@/api/modules/admin'

/**
 * Props
 * - visible：弹窗显隐（v-model:visible）
 * - title：弹窗标题（默认「AI 配置」；用户菜单入口传「AI 大模型管理」）
 */
withDefaults(
  defineProps<{
    visible: boolean
    title?: string
  }>(),
  { title: 'AI 配置' }
)

/**
 * Emits
 * - update:visible：关闭弹窗
 * - saved：配置保存成功，透传最新视图（父级可据此自动关闭等）
 */
const emit = defineEmits<{
  (e: 'update:visible', v: boolean): void
  (e: 'saved', view: AiSettingsView): void
}>()

/** 共享表单实例：Footer 按钮经此调用表单内部暴露的 save / test 动作 */
const formRef = ref<InstanceType<typeof AiSettingsForm> | null>(null)

/** Footer 按钮本地 loading 镜像（包裹 async 调用计时，与表单内部状态并行不冲突） */
const saving = ref(false)
const testing = ref(false)

/** reka-ui 受控开关：只处理关闭（遮罩点击 / Esc / 右上角 X） */
function onOpenChange(open: boolean) {
  if (!open) close()
}

/** 关闭弹窗 */
function close() {
  emit('update:visible', false)
}

/** 表单保存成功：原样向上透传最新配置视图 */
function onSaved(view: AiSettingsView) {
  emit('saved', view)
}

/** Footer「保存配置」：计时 loading 后委托表单动作（含「没有修改」的 toast 提示） */
async function onSave() {
  saving.value = true
  try {
    await formRef.value?.save()
  } finally {
    saving.value = false
  }
}

/** Footer「测试连接」：计时 loading 后委托表单动作（结果展示在表单滚动区内） */
async function onTest() {
  testing.value = true
  try {
    await formRef.value?.test()
  } finally {
    testing.value = false
  }
}
</script>
