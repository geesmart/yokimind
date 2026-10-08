<template>
  <!-- 注册页：按设计稿 design/注册.html 还原 -->
  <AuthLayout max-width="420px">
    <!-- 标题 -->
    <h1 class="text-center text-xl font-semibold text-foreground mb-6">创建账号</h1>

    <!-- 注册表单：vee-validate + zod 驱动 -->
    <form class="flex flex-col gap-4" novalidate @submit="onSubmit">
      <!-- 邮箱 -->
      <FormField v-slot="{ componentField, errors }" name="email">
        <FormItem>
          <FormLabel>邮箱</FormLabel>
          <FormControl>
            <InputGroup class="h-10">
              <InputGroupAddon align="inline-start">
                <Mail />
              </InputGroupAddon>
              <InputGroupInput
                type="email"
                autocomplete="email"
                placeholder="请输入邮箱"
                :aria-invalid="errors.length > 0"
                v-bind="componentField"
              />
            </InputGroup>
          </FormControl>
          <FormMessage />
        </FormItem>
      </FormField>

      <!-- 昵称 -->
      <FormField v-slot="{ componentField, errors }" name="nickname">
        <FormItem>
          <FormLabel>昵称</FormLabel>
          <FormControl>
            <InputGroup class="h-10">
              <InputGroupAddon align="inline-start">
                <User />
              </InputGroupAddon>
              <InputGroupInput
                type="text"
                autocomplete="nickname"
                placeholder="请输入 2-50 位昵称"
                :aria-invalid="errors.length > 0"
                v-bind="componentField"
              />
            </InputGroup>
          </FormControl>
          <FormMessage />
        </FormItem>
      </FormField>

      <!--
        验证码 UI 已注释：本版本后端不支持验证码（send-code / verify-code）
        等后续版本接入验证码后恢复此区块与 SendCodeButton 组件
      -->
      <!--
      <FormField v-slot="{ componentField, errors }" name="code">
        <FormItem>
          <FormLabel>验证码</FormLabel>
          <FormControl>
            <InputGroup class="h-10">
              <InputGroupAddon align="inline-start">
                <KeyRound />
              </InputGroupAddon>
              <InputGroupInput
                type="text"
                inputmode="numeric"
                autocomplete="one-time-code"
                placeholder="请输入验证码"
                :aria-invalid="errors.length > 0"
                v-bind="componentField"
              />
              <InputGroupAddon align="inline-end">
                <SendCodeButton @send="handleSendCode" />
              </InputGroupAddon>
            </InputGroup>
          </FormControl>
          <FormMessage />
        </FormItem>
      </FormField>
      -->

      <!-- 密码 -->
      <FormField v-slot="{ componentField, errors }" name="password">
        <FormItem>
          <FormLabel>密码</FormLabel>
          <FormControl>
            <InputGroup class="h-10">
              <InputGroupAddon align="inline-start">
                <Lock />
              </InputGroupAddon>
              <InputGroupInput
                type="password"
                autocomplete="new-password"
                placeholder="请设置 8-20 位密码"
                :aria-invalid="errors.length > 0"
                v-bind="componentField"
              />
            </InputGroup>
          </FormControl>
          <FormMessage />
        </FormItem>
      </FormField>

      <!-- 确认密码 -->
      <FormField v-slot="{ componentField, errors }" name="confirmPassword">
        <FormItem>
          <FormLabel>确认密码</FormLabel>
          <FormControl>
            <InputGroup class="h-10">
              <InputGroupAddon align="inline-start">
                <LockKeyhole />
              </InputGroupAddon>
              <InputGroupInput
                type="password"
                autocomplete="new-password"
                placeholder="请再次输入密码"
                :aria-invalid="errors.length > 0"
                v-bind="componentField"
              />
            </InputGroup>
          </FormControl>
          <FormMessage />
        </FormItem>
      </FormField>

      <!-- 邀请码（可选） -->
      <FormField v-slot="{ componentField }" name="inviteCode">
        <FormItem>
          <FormLabel>邀请码（可选）</FormLabel>
          <FormControl>
            <InputGroup class="h-10">
              <InputGroupAddon align="inline-start">
                <Ticket />
              </InputGroupAddon>
              <InputGroupInput
                type="text"
                placeholder="如有邀请码请填写"
                v-bind="componentField"
              />
            </InputGroup>
          </FormControl>
          <FormMessage />
        </FormItem>
      </FormField>

      <!-- 用户协议 -->
      <FormField v-slot="{ value }" name="agree">
        <FormItem>
          <div class="flex items-start gap-2">
            <FormControl>
              <Checkbox
                id="register-agree"
                :checked="value"
                @update:checked="onAgreeChange"
              />
            </FormControl>
            <label for="register-agree" class="text-xs leading-relaxed text-muted-foreground">
              我已阅读并同意
              <a href="#" class="text-primary hover:underline">《用户服务协议》</a>
              与
              <a href="#" class="text-primary hover:underline">《隐私政策》</a>
            </label>
          </div>
          <FormMessage />
        </FormItem>
      </FormField>

      <!-- 注册按钮 -->
      <Button
        type="submit"
        variant="default"
        size="lg"
        class="w-full"
        :disabled="isSubmitting"
      >
        <Spinner v-if="isSubmitting" data-icon="inline-start" />
        {{ isSubmitting ? '注册中…' : '注册' }}
      </Button>
    </form>

    <!-- 底部登录入口 -->
    <p class="mt-6 text-center text-sm text-muted-foreground">
      已有账号？
      <RouterLink
        to="/login"
        class="font-medium text-primary hover:text-primary/80 hover:underline"
      >
        去登录
      </RouterLink>
    </p>
  </AuthLayout>
</template>

<script lang="ts" setup>
import { useForm } from 'vee-validate'
import { toTypedSchema } from '@vee-validate/zod'
import * as z from 'zod'
import { useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import {
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from '@/components/ui/form'
import { Spinner } from '@/components/ui/spinner'
import { Lock, LockKeyhole, Mail, Ticket, User } from '@lucide/vue'
import AuthLayout from './components/auth-layout.vue'
// SendCodeButton 已在模板中注释，等后端支持验证码后启用
// import SendCodeButton from './components/send-code-button.vue'
import { register } from '@/api/modules/user'
import type { RegisterResult } from '@/api/modules/user'
import { ApiError } from '@/api/request'
import { saveToken, saveUserInfo } from '@/utils/token'
import type { UserInfo } from '@/api/types'

const router = useRouter()

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * 注册表单 schema
 * - code 字段保留（已注释的验证码 UI 用），后续恢复时无需改 schema 结构
 * - inviteCode 后端未实现，仅前端收集
 * - nickname 的 min(1)/min(2) 文案不同：空值触发 min(1,'请输入昵称')，长度不足触发 min(2)
 */
const registerSchema = z
  .object({
    email: z
      .string()
      .min(1, '请输入邮箱')
      .regex(EMAIL_RE, '请输入正确的邮箱地址'),
    nickname: z
      .string()
      .min(1, '请输入昵称')
      .min(2, '昵称长度需为 2-50 位')
      .max(50, '昵称长度需为 2-50 位'),
    // code: z.string().min(1, '请输入验证码'), // 验证码字段保留，本版本不使用
    password: z
      .string()
      .min(1, '请设置密码')
      .min(8, '密码长度需为 8-20 位')
      .max(20, '密码长度需为 8-20 位'),
    confirmPassword: z.string().min(1, '请再次输入密码'),
    inviteCode: z.string().optional(),
    agree: z.boolean().refine(v => v === true, {
      message: '请先阅读并同意用户协议与隐私政策',
    }),
  })
  .refine(v => v.confirmPassword === v.password, {
    message: '两次输入的密码不一致',
    path: ['confirmPassword'],
  })

/**
 * vee-validate 表单实例
 * - isSubmitting 由 vee-validate 自动维护，替代手写 submitting ref
 */
const { handleSubmit, isSubmitting, setFieldValue } = useForm({
  validationSchema: toTypedSchema(registerSchema),
  initialValues: {
    email: '',
    nickname: '',
    // code: '', // 验证码字段保留，本版本不使用
    password: '',
    confirmPassword: '',
    inviteCode: '',
    agree: true,
  },
})

/**
 * 用户协议勾选回调：Checkbox 的 checked 变化同步到 vee-validate 的 agree 字段
 */
function onAgreeChange(value: boolean | 'indeterminate') {
  // Checkbox 状态可能为 'indeterminate'，注册协议场景只在 true/false 之间切换
  setFieldValue('agree', value === true)
}

/**
 * 提交注册
 * 后端注册成功会直接签发 token 与用户信息（见 RegisterResult），
 * 前端无需再走登录接口，直接落库为登录态并跳转控制台首页。
 */
const onSubmit = handleSubmit(async (values) => {
  try {
    // 注册接口无需 Token（meta.auth=false），返回值含 token 与用户信息
    const result: RegisterResult = await register({
      email: values.email.trim(),
      password: values.password,
      nickname: values.nickname.trim(),
      // confirmPassword 与 inviteCode 后端均不接收，前端仅做校验/展示
    })

    // 保存 Token（与登录页一致：30 天有效期）
    const expiresAt = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60
    saveToken({ accessToken: result.token, expiresAt })

    // 保存用户信息到 localStorage（与登录页结构一致）
    const userInfo: UserInfo = {
      id: result.id,
      nickname: result.nickname,
      email: result.email,
      avatar: result.avatar ?? undefined,
    }
    saveUserInfo(userInfo)

    toast.success('注册成功，欢迎加入！')
    // 注册即登录：直接进入控制台首页
    router.push('/dashboard')
  } catch (error) {
    // ApiError 来自 alova responded 的统一解包
    if (error instanceof ApiError) {
      // 用户已存在 / 校验失败等业务错误
      toast.error(error.message)
    } else {
      console.error('[Register]', error)
      toast.error('注册失败，请稍后重试')
    }
  }
})

/**
 * 发送验证码：本版本已注释验证码 UI，函数保留以便后续恢复
 */
// function handleSendCode() {
//   if (!form.email.trim() || !isValidEmail(form.email.trim())) {
//     errors.email = '请先输入正确的邮箱'
//     return
//   }
//   errors.email = ''
//   Message.success('验证码已发送，请注意查收')
//   sendCodeRef.value?.start()
// }
</script>

<style scoped></style>
