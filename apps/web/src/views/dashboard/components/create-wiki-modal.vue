<template>
  <!--
    知识库弹窗（支持 新建 / 编辑 两种模式）
    - 新建模式：editData 为空 → 空表单 + 默认 icon/color → 调用 createWiki
    - 编辑模式：editData 传入 WikiItem → 回填数据 → 调用 updateWiki
  -->
  <Dialog :open="visible" @update:open="onOpenChange">
    <DialogContent class="sm:max-w-[480px]">
      <DialogHeader>
        <DialogTitle>{{ isEditMode ? '编辑知识库' : '新建知识库' }}</DialogTitle>
      </DialogHeader>

      <div class="flex flex-col gap-4 mt-2">
        <!-- Icon 选择器 + 知识库名称（并排） -->
        <div class="flex flex-col gap-2">
          <label class="text-md font-medium text-foreground">知识库名称</label>
          <div class="flex items-center gap-2">
            <IconPicker class="h-7" v-model:icon="form.icon" v-model:color="form.color" />
            <Input
              v-model="form.name"
              placeholder="请输入 2-50 位知识库名称"
              :maxlength="50"
              :aria-invalid="!!errors.name"
              class="flex-1 h-9"
              @input="errors.name = ''"
            />
          </div>
          <p v-if="errors.name" class="text-xs text-destructive">{{ errors.name }}</p>
        </div>

        <!-- 知识库描述 -->
        <div class="flex flex-col gap-1.5">
          <label class="text-md font-medium text-foreground">描述</label>
          <Textarea
            v-model="form.description"
            placeholder="简单描述这个知识库的用途（可选）"
            :maxlength="500"
            class="min-h-[80px]"
            :aria-invalid="!!errors.description"
            @input="errors.description = ''"
          />
          <p v-if="errors.description" class="text-xs text-destructive">{{ errors.description }}</p>
        </div>

        <!-- AI 索引设置（新建/编辑均展示；新建时随创建参数一并提交，默认关闭） -->
        <div class="flex flex-col gap-1.5">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <label class="text-md font-medium text-foreground">AI 索引（RAG）</label>
              <!-- 向量模型未配置：标签旁红字提示不可用（与底部「重建索引」提示同一数据源 embeddingReady） -->
              <span v-if="!embeddingReady" class="text-xs text-destructive">未配置，不可用</span>
            </div>
            <!-- 自动索引开关：开启后文档保存即自动切片向量化；关闭动作需二次确认（见 onRagSwitchChange） -->
            <Switch :model-value="form.ragEnabled" @update:model-value="onRagSwitchChange" />
          </div>
          <p class="text-xs text-muted-foreground leading-5">
            开启后，保存文档会自动切片并向量化，供 AI
            问答与语义搜索使用；关闭后已入库内容仍可检索，但不再随编辑更新。
          </p>
        </div>
      </div>

      <DialogFooter>
        <!-- 重建索引：手动触发全库重新入队（自动索引关闭时的唯一手动索引入口）
             未配置向量模型（embeddingReady=false）时禁用：任务入队也会因 embedding 未就绪而挂起 -->

        <div class="flex items-center justify-between w-full">
          <Button
            variant="outline"
            :loading="reindexing"
            :disabled="!embeddingReady"
            @click="handleReindex"
          >
            重建索引
          </Button>
          <div class="flex items-center gap-2">
            <Button variant="outline" @click="close">取消</Button>
            <Button :loading="submitting" @click="handleSubmit">
              {{ isEditMode ? '保存' : '确定' }}
            </Button>
          </div>
        </div>
      </DialogFooter>
    </DialogContent>
  </Dialog>

  <!-- 关闭 AI 索引二次确认弹窗（开关 true→false 时拦截确认，取消则保持开启） -->
  <AlertDialog v-model:open="ragDisableConfirmOpen">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>关闭 AI 索引？</AlertDialogTitle>
        <AlertDialogDescription>
          关闭后，文档编辑不再自动更新索引，已入库内容仍可被检索；重新开启后，新保存的文档会继续自动入队。
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>取消</AlertDialogCancel>
        <AlertDialogAction @click="confirmRagDisable">确认关闭</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>

<script lang="ts" setup>
import { computed, reactive, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { createWiki, updateWiki } from '@/api/modules/wiki'
import { reindexRag } from '@/api/modules/rag'
import { getAiStatus } from '@/api/modules/ai'
import type { WikiItem } from '@/api/modules/wiki'
import { ApiError } from '@/api/request'
import IconPicker from './icon-picker.vue'
import { DEFAULT_ICON, DEFAULT_COLOR } from './icon-meta'

/**
 * Props
 * - visible：弹窗显隐（v-model:visible）
 * - editData：编辑模式下要编辑的知识库数据（有值 = 编辑模式，无值 = 新建模式）
 */
const props = defineProps<{
  visible: boolean
  editData?: WikiItem | null
}>()

/**
 * Emits
 * - update:visible：关闭弹窗
 * - success：操作成功，回传最新的知识库信息
 */
const emit = defineEmits<{
  (e: 'update:visible', v: boolean): void
  (e: 'success', wiki: WikiItem): void
}>()

/** 是否为编辑模式 */
const isEditMode = computed(() => !!props.editData?.id)

/** 提交中状态（驱动按钮 loading） */
const submitting = ref(false)

/** 重建索引进行中状态（驱动「重建索引」按钮 loading） */
const reindexing = ref(false)

/**
 * 向量服务（embedding）是否就绪
 * - 弹窗打开时经 /ai/status 查询（仅需登录，普通用户可调）
 * - 默认 true 避免查询返回前的闪烁；查询失败保持原值不阻断弹窗
 * - false 时：「重建索引」禁用 + 按钮下方红字提示 RAG 不可用
 *   （此时即便触发重建，任务也会因 embedding 未就绪在队列中挂起，无实际意义）
 */
const embeddingReady = ref(true)

/** 查询 AI 配置状态，刷新向量服务就绪标记（失败静默，不影响弹窗其余功能） */
async function refreshAiStatus() {
  try {
    const view = await getAiStatus().send()
    embeddingReady.value = view.embeddingReady
  } catch (error) {
    console.error('[WikiModal getAiStatus]', error)
  }
}

/** 表单数据 */
const form = reactive({
  name: '',
  description: '',
  icon: DEFAULT_ICON,
  color: DEFAULT_COLOR,
  // 是否自动 RAG 索引（新建/编辑均可设置；编辑模式用 editData 回填）
  ragEnabled: false,
})

/** 表单错误信息 */
const errors = reactive({
  name: '',
  description: '',
})

/**
 * 打开弹窗时根据模式填充表单：
 * - 编辑模式：用 editData 回填
 * - 新建模式：重置默认值
 */
watch(
  () => props.visible,
  (v) => {
    if (!v) return

    // 打开即查询 AI 配置状态：向量模型未配置时「重建索引」禁用并提示 RAG 不可用
    void refreshAiStatus()

    if (isEditMode.value && props.editData) {
      form.name = props.editData.name
      form.description = props.editData.description ?? ''
      form.icon = props.editData.icon ?? DEFAULT_ICON
      form.color = props.editData.color ?? DEFAULT_COLOR
      // 回填自动 RAG 索引开关（后端未返回/历史数据兜底为 false）
      form.ragEnabled = props.editData.ragEnabled ?? false
    } else {
      form.name = ''
      form.description = ''
      form.icon = DEFAULT_ICON
      form.color = DEFAULT_COLOR
      form.ragEnabled = false
    }

    errors.name = ''
    errors.description = ''
  }
)

/** 处理 Dialog open 状态变化 */
function onOpenChange(open: boolean) {
  if (!open) close()
}

/** 关闭弹窗 */
function close() {
  emit('update:visible', false)
}

/**
 * 手动校验表单
 */
function validate(): boolean {
  let ok = true
  errors.name = ''
  errors.description = ''

  if (!form.name.trim()) {
    errors.name = '请输入知识库名称'
    ok = false
  } else if (form.name.trim().length < 2) {
    errors.name = '知识库名称至少 2 位'
    ok = false
  } else if (form.name.trim().length > 50) {
    errors.name = '知识库名称最多 50 位'
    ok = false
  }

  if (form.description.trim().length > 500) {
    errors.description = '描述最长 500 位'
    ok = false
  }

  return ok
}

/**
 * 提交（根据模式走新建 / 更新分支）
 */
async function handleSubmit() {
  if (!validate()) return

  submitting.value = true
  try {
    const name = form.name.trim()
    const description = form.description.trim() || undefined

    if (isEditMode.value && props.editData) {
      // 编辑模式：调用 updateWiki（ragEnabled 一并提交，开关关闭时传 false 显式关闭）
      const result: WikiItem = await updateWiki(props.editData.id, {
        name,
        description,
        icon: form.icon,
        color: form.color,
        ragEnabled: form.ragEnabled,
      }).send()

      emit('success', result)
      close()
    } else {
      // 新建模式：调用 createWiki（ragEnabled 随创建参数一并提交，由用户在表单中选择）
      const result: WikiItem = await createWiki({
        name,
        description,
        icon: form.icon,
        color: form.color,
        ragEnabled: form.ragEnabled,
      }).send()

      emit('success', result)
      close()
    }
  } catch (error) {
    if (error instanceof ApiError) {
      toast.error(error.message)
    } else {
      console.error('[WikiModal submit]', error)
      toast.error(isEditMode.value ? '保存失败，请稍后重试' : '创建失败，请稍后重试')
    }
  } finally {
    submitting.value = false
  }
}

/**
 * 重建索引：将当前知识库全部文档重置为待索引并重新入队
 * 场景：开启自动索引后回溯存量文档 / 修复失败任务 / 切换 embedding 模型后全量重建
 */
async function handleReindex() {
  if (!props.editData?.id) return
  // 向量模型未配置时禁止触发（按钮已禁用，此处兜底防止状态返回前的边缘点击）
  if (!embeddingReady.value) return

  reindexing.value = true
  try {
    const result = await reindexRag(props.editData.id).send()
    toast.success(`已触发 ${result.marked} 篇文档重建索引`)
  } catch (error) {
    if (error instanceof ApiError) {
      toast.error(error.message)
    } else {
      console.error('[WikiModal reindex]', error)
      toast.error('重建索引失败，请稍后重试')
    }
  } finally {
    reindexing.value = false
  }
}

// ==================== AI 索引开关（关闭二次确认） ====================

/**
 * 关闭 AI 索引二次确认弹窗显隐
 * 开关点击切到 false 时不立即生效，先弹此弹窗；取消则开关保持开启
 */
const ragDisableConfirmOpen = ref(false)

/**
 * 开关切换拦截：
 * - 切到 true（开启）：无风险动作，直接生效
 * - 切到 false（关闭）：存在已索引数据时属于易误触的破坏性变化，弹窗二次确认，
 *   确认后才真正落 form（提交时随 updateWiki 提交 false）
 *   注：仅在当前为 true 时拦截；新建模式表单初始即为 false，从 false 出发的切换不受影响
 */
function onRagSwitchChange(next: boolean | 'indeterminate') {
  if (next) {
    form.ragEnabled = true
    return
  }
  if (form.ragEnabled) {
    // 当前开启 → 点关闭：拦截并弹出二次确认（不立即改 form）
    ragDisableConfirmOpen.value = true
  }
}

/** 确认关闭 AI 索引（AlertDialogAction 点击自带关闭弹窗） */
function confirmRagDisable() {
  form.ragEnabled = false
}
</script>
