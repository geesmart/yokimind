<template>
  <!--
    LoginForm：可复用登录表单
    从登录页提取的表单组件，供两处复用：
    1. 登录页 /login（views/auth/login.vue）
    2. 全局登录弹窗（components/auth-login-dialog.vue，认证失效时弹出）
    组件内完成表单校验（vee-validate + zod）、登录请求与 Token/用户信息落库，
    登录成功后通过 success 事件通知宿主，由宿主决定后续行为（跳转 / 刷新页面）
  -->
  <form class="flex flex-col gap-5" novalidate @submit="onSubmit">
    <!-- 邮箱 -->
    <FormField v-slot="{ componentField, errors, meta }" name="account">
      <FormItem>
        <FormLabel>邮箱</FormLabel>
        <FormControl>
          <!-- h-10 与 size=lg 的提交按钮视觉对齐 -->
          <InputGroup class="h-10">
            <InputGroupAddon align="inline-start">
              <Mail />
            </InputGroupAddon>
            <InputGroupInput
              type="email"
              autocomplete="username"
              placeholder="name@company.com"
              :aria-invalid="errors.length > 0 && meta.touched"
              v-bind="componentField"
            />
          </InputGroup>
        </FormControl>
        <FormMessage />
      </FormItem>
    </FormField>

    <!-- 密码 -->
    <FormField v-slot="{ componentField, errors, meta }" name="password">
      <FormItem>
        <FormLabel>密码</FormLabel>
        <FormControl>
          <InputGroup class="h-10">
            <InputGroupAddon align="inline-start">
              <Lock />
            </InputGroupAddon>
            <InputGroupInput
              type="password"
              autocomplete="current-password"
              placeholder="请输入密码"
              :aria-invalid="errors.length > 0 && meta.touched"
              v-bind="componentField"
            />
          </InputGroup>
        </FormControl>
        <FormMessage />
      </FormItem>
    </FormField>

    <!-- 记住我 -->
    <div class="flex items-center justify-between">
      <label class="inline-flex items-center gap-2 cursor-pointer select-none">
        <Checkbox id="remember" />
        <span class="text-sm text-muted-foreground">记住我</span>
      </label>
    </div>

    <!-- 登录按钮 -->
    <Button type="submit" variant="default" size="lg" class="w-full" :disabled="isSubmitting">
      <Spinner v-if="isSubmitting" data-icon="inline-start" />
      {{ isSubmitting ? '登录中…' : '登录' }}
    </Button>
  </form>
</template>

<script lang="ts" setup>
import { useForm } from 'vee-validate'
import { toTypedSchema } from '@vee-validate/zod'
import * as z from 'zod'
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { FormField, FormItem, FormLabel, FormControl, FormMessage } from '@/components/ui/form'
import { Spinner } from '@/components/ui/spinner'
import { Lock, Mail } from '@lucide/vue'
import { login } from '@/api/modules/user'
import { ApiError } from '@/api/request'
import { saveToken, saveUserInfo } from '@/utils/token'
import type { UserInfo } from '@/api/types'
import type { LoginResult } from '@/api/modules/user'

/** 登录成功事件：携带接口返回的用户信息与 Token，宿主自行决定跳转/刷新 */
const emit = defineEmits<{
  success: [result: LoginResult]
}>()

/**
 * 登录表单 schema
 * - account 为邮箱（本版本暂不支持手机号登录）
 */
const loginSchema = z.object({
  account: z
    .string()
    .min(1, '请输入邮箱')
    .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, '请输入正确的邮箱地址'),
  password: z.string().min(1, '请输入密码'),
})

/**
 * vee-validate 表单实例
 * - isSubmitting 由 vee-validate 自动维护，替代手写 submitting ref
 */
const { handleSubmit, isSubmitting, setFieldError } = useForm({
  validationSchema: toTypedSchema(loginSchema),
  initialValues: {
    account: '',
    password: '',
  },
})

/**
 * 提交登录
 * 成功后写入 Token 与用户信息（localStorage），并向上抛出 success 事件
 */
const onSubmit = handleSubmit(async (values) => {
  try {
    // 表单字段 account 映射为后端 email
    const email = values.account.trim()
    const result = await login({ email, password: values.password })

    // 保存 Token（后端 token 有效期 30 天）
    const expiresAt = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60
    saveToken({ accessToken: result.token, expiresAt })

    // 保存用户信息到 localStorage
    const userInfo: UserInfo = {
      id: result.user.id,
      nickname: result.user.nickname,
      email: result.user.email,
      avatar: result.user.avatar ?? undefined,
    }
    saveUserInfo(userInfo)

    toast.success('登录成功，欢迎回来！')
    // 通知宿主登录成功（登录页跳转控制台 / 登录弹窗关闭并刷新页面）
    emit('success', result)
  } catch (error) {
    // ApiError 来自 alova responded 的统一解包
    if (error instanceof ApiError) {
      // 密码错误/用户不存在等业务错误：聚焦密码框更安全
      setFieldError('password', error.message)
      toast.error(error.message)
    } else {
      console.error('[Login]', error)
      toast.error('登录失败，请稍后重试')
    }
  }
})
</script>

<style scoped></style>
