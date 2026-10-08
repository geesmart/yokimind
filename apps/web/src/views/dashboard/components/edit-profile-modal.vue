<template>
  <!--
    修改用户信息弹窗
    - 字段：昵称（2-50 字符，必填）、头像 URL（可选，空串清空）
    - 对接后端 POST /user/profile（updateProfile）
    - 成功后 emit success，由父组件同步顶栏展示与 localStorage
  -->
  <Dialog :open="visible" @update:open="onOpenChange">
    <DialogContent class="sm:max-w-[425px]">
      <DialogHeader>
        <DialogTitle>修改用户信息</DialogTitle>
      </DialogHeader>

      <div class="flex flex-col gap-4 mt-2">
        <!-- 昵称 -->
        <div class="flex flex-col gap-1.5">
          <label class="text-xs font-medium text-foreground">昵称</label>
          <Input
            v-model="form.nickname"
            placeholder="请输入 2-50 位昵称"
            :maxlength="50"
            :aria-invalid="!!errors.nickname"
            @input="errors.nickname = ''"
          />
          <p v-if="errors.nickname" class="text-xs text-destructive">{{ errors.nickname }}</p>
        </div>

        <!-- 头像 URL -->
        <div class="flex flex-col gap-1.5">
          <label class="text-xs font-medium text-foreground">头像 URL</label>
          <Input
            v-model="form.avatar"
            placeholder="头像 URL（可选，留空则清空）"
            :aria-invalid="!!errors.avatar"
            @input="errors.avatar = ''"
          />
          <p v-if="errors.avatar" class="text-xs text-destructive">{{ errors.avatar }}</p>
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" @click="close">取消</Button>
        <Button :loading="submitting" @click="handleSubmit">确定</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script lang="ts" setup>
import { reactive, ref, watch } from 'vue'
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
import { updateProfile } from '@/api/modules/user'
import type { UserProfile } from '@/api/modules/user'
import { ApiError } from '@/api/request'
import type { UserInfo } from '@/api/types'

/**
 * Props
 * - visible：弹窗显隐（v-model:visible）
 * - userInfo：当前用户信息，打开时用于回填表单
 */
const props = defineProps<{
  visible: boolean
  userInfo: UserInfo | null
}>()

/**
 * Emits
 * - update:visible：关闭弹窗
 * - success：资料更新成功，回传最新用户信息
 */
const emit = defineEmits<{
  (e: 'update:visible', v: boolean): void
  (e: 'success', userInfo: UserInfo): void
}>()

/** 提交中状态（驱动按钮 loading） */
const submitting = ref(false)

/** 表单数据 */
const form = reactive({
  nickname: '',
  avatar: '',
})

/** 表单错误信息 */
const errors = reactive({
  nickname: '',
  avatar: '',
})

/**
 * 打开弹窗时回填当前用户信息
 * avatar 为 null/undefined 时统一回填为空串
 */
watch(
  () => props.visible,
  (v) => {
    if (v) {
      form.nickname = props.userInfo?.nickname ?? ''
      form.avatar = props.userInfo?.avatar ?? ''
      errors.nickname = ''
      errors.avatar = ''
    }
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
  errors.nickname = ''
  errors.avatar = ''

  if (!form.nickname.trim()) {
    errors.nickname = '请输入昵称'
    ok = false
  } else if (form.nickname.trim().length < 2) {
    errors.nickname = '昵称至少 2 位'
    ok = false
  } else if (form.nickname.trim().length > 50) {
    errors.nickname = '昵称最多 50 位'
    ok = false
  }

  return ok
}

/**
 * 提交修改
 * 1. 表单校验 → 2. 调 updateProfile → 3. 组装 UserInfo 并 emit success
 */
async function handleSubmit() {
  if (!validate()) return

  submitting.value = true
  try {
    // updateProfile 返回更新后的完整 UserProfile
    const result: UserProfile = await updateProfile({
      nickname: form.nickname.trim(),
      avatar: form.avatar,
    })

    // 组装为共享 UserInfo，便于父组件直接写回 localStorage
    const updated: UserInfo = {
      id: result.id,
      nickname: result.nickname,
      email: result.email,
      avatar: result.avatar ?? null,
    }

    emit('success', updated)
    close()
  } catch (error) {
    if (error instanceof ApiError) {
      // 后端业务错误（如校验失败），直接展示 message
      toast.error(error.message)
    } else {
      console.error('[EditProfile]', error)
      toast.error('更新失败，请稍后重试')
    }
  } finally {
    submitting.value = false
  }
}
</script>
