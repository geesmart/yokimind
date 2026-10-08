<template>
  <!--
    修改密码弹窗
    - 字段：当前密码、新密码（8-20）、确认新密码（需一致）
    - 对接后端 POST /user/password（changePassword）
    - 业务错误码 20004（当前密码错误）→ 定位到 currentPassword 字段
    - 业务错误码 20005（新旧密码相同）→ 定位到 newPassword 字段
    - 成功后由父组件清理登录态并跳转 /login（后端已删除所有 token）
  -->
  <Dialog :open="visible" @update:open="onOpenChange">
    <DialogContent class="sm:max-w-[425px]">
      <DialogHeader>
        <DialogTitle>修改密码</DialogTitle>
      </DialogHeader>

      <div class="flex flex-col gap-4 mt-2">
        <!-- 当前密码 -->
        <div class="flex flex-col gap-1.5">
          <label class="text-xs font-medium text-foreground" for="currentPassword">当前密码</label>
          <Input
            id="currentPassword"
            v-model="form.currentPassword"
            type="password"
            placeholder="请输入当前密码"
            autocomplete="current-password"
            :aria-invalid="!!errors.currentPassword"
            @input="errors.currentPassword = ''"
          />
          <p v-if="errors.currentPassword" class="text-xs text-destructive">{{ errors.currentPassword }}</p>
        </div>

        <!-- 新密码 -->
        <div class="flex flex-col gap-1.5">
          <label class="text-xs font-medium text-foreground" for="newPassword">新密码</label>
          <Input
            id="newPassword"
            v-model="form.newPassword"
            type="password"
            placeholder="请输入 8-20 位新密码"
            autocomplete="new-password"
            :maxlength="20"
            :aria-invalid="!!errors.newPassword"
            @input="errors.newPassword = ''"
          />
          <p v-if="errors.newPassword" class="text-xs text-destructive">{{ errors.newPassword }}</p>
        </div>

        <!-- 确认新密码 -->
        <div class="flex flex-col gap-1.5">
          <label class="text-xs font-medium text-foreground" for="confirmPassword">确认新密码</label>
          <Input
            id="confirmPassword"
            v-model="form.confirmPassword"
            type="password"
            placeholder="请再次输入新密码"
            autocomplete="new-password"
            :maxlength="20"
            :aria-invalid="!!errors.confirmPassword"
            @input="errors.confirmPassword = ''"
          />
          <p v-if="errors.confirmPassword" class="text-xs text-destructive">{{ errors.confirmPassword }}</p>
        </div>
      </div>

      <!-- 提示：修改成功后会被强制下线 -->
      <p class="text-xs text-muted-foreground/70 mt-1">
        修改成功后将自动退出当前登录，请使用新密码重新登录。
      </p>

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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { changePassword } from '@/api/modules/user'
import { ApiError } from '@/api/request'
import { ERROR_CODES } from '@/api/constants'

/**
 * Props
 * - visible：弹窗显隐（v-model:visible）
 */
const props = defineProps<{
  visible: boolean
}>()

/**
 * Emits
 * - update:visible：关闭弹窗
 * - success：修改密码成功（父组件据此清理登录态并跳转登录页）
 */
const emit = defineEmits<{
  (e: 'update:visible', v: boolean): void
  (e: 'success'): void
}>()

/** 提交中状态（驱动按钮 loading） */
const submitting = ref(false)

/** 表单数据 */
const form = reactive({
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
})

/** 表单错误信息 */
const errors = reactive({
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
})

/**
 * 打开弹窗时清空字段与错误
 */
watch(
  () => props.visible,
  (v) => {
    if (v) {
      form.currentPassword = ''
      form.newPassword = ''
      form.confirmPassword = ''
      errors.currentPassword = ''
      errors.newPassword = ''
      errors.confirmPassword = ''
    }
  },
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
  errors.currentPassword = ''
  errors.newPassword = ''
  errors.confirmPassword = ''

  if (!form.currentPassword) {
    errors.currentPassword = '请输入当前密码'
    ok = false
  } else if (form.currentPassword.length < 8 || form.currentPassword.length > 20) {
    errors.currentPassword = '密码长度需为 8-20 位'
    ok = false
  }

  if (!form.newPassword) {
    errors.newPassword = '请输入新密码'
    ok = false
  } else if (form.newPassword.length < 8 || form.newPassword.length > 20) {
    errors.newPassword = '密码长度需为 8-20 位'
    ok = false
  }

  if (!form.confirmPassword) {
    errors.confirmPassword = '请再次输入新密码'
    ok = false
  } else if (form.confirmPassword !== form.newPassword) {
    errors.confirmPassword = '两次输入的密码不一致'
    ok = false
  }

  return ok
}

/**
 * 提交修改密码
 * 1. 清空错误 → 2. 校验 → 3. 调 changePassword
 */
async function handleSubmit() {
  // 清除上次提交由后端业务错误设置的字段状态
  errors.currentPassword = ''
  errors.newPassword = ''
  errors.confirmPassword = ''

  if (!validate()) return

  submitting.value = true
  try {
    await changePassword({
      currentPassword: form.currentPassword,
      newPassword: form.newPassword,
    })
    emit('success')
    close()
  } catch (error) {
    if (error instanceof ApiError) {
      // 按业务码定位错误到具体字段
      if (error.code === ERROR_CODES.INVALID_OLD_PASSWORD) {
        errors.currentPassword = error.message
      } else if (error.code === ERROR_CODES.SAME_PASSWORD) {
        errors.newPassword = error.message
      } else {
        toast.error(error.message)
      }
    } else {
      console.error('[ChangePassword]', error)
      toast.error('修改失败，请稍后重试')
    }
  } finally {
    submitting.value = false
  }
}
</script>