<template>
  <!-- 忘记密码页：按设计稿 design/忘记密码.html 还原 -->
  <AuthLayout max-width="420px">
    <!-- 品牌标识 -->
    <header class="text-center mb-6">
      <h1 class="text-base font-semibold text-foreground">找回密码</h1>
    </header>

    <!--
      功能未开放提示条
      本版本后端尚未支持验证码（send-code / verify-code / reset-password），
      找回密码功能暂不可用，等下个版本接入验证码后恢复
    -->
    <div
      class="mb-5 p-3 rounded-xl text-xs flex items-start gap-2"
      style="background: rgba(245, 158, 11, 0.12); border: 1px solid rgba(245, 158, 11, 0.22)"
    >
      <ShieldAlert :size="16" class="text-amber-500 shrink-0 mt-0.5" />
      <div class="leading-relaxed text-muted-foreground">
        <div class="font-medium text-foreground mb-1">本版本暂未开放找回密码功能</div>
        如需重置密码，请联系管理员处理，敬请谅解。
      </div>
    </div>

    <!-- 身份选择标签：邮箱 / 手机号 -->
    <div class="flex gap-2 mb-5 p-1 bg-muted rounded-xl" role="tablist" aria-label="身份验证方式">
      <Button
        v-for="tab in identityTabs"
        :key="tab.key"
        variant="ghost"
        size="sm"
        type="button"
        role="tab"
        :aria-selected="identity === tab.key"
        class="flex-1"
        :class="
          identity === tab.key
            ? 'bg-background text-foreground shadow-sm'
            : 'bg-transparent text-muted-foreground hover:text-foreground'
        "
        @click="identity = tab.key"
      >
        <component :is="tab.icon" :size="16" />
        <span>{{ tab.label }}</span>
      </Button>
    </div>

    <!-- 找回密码表单：vee-validate + zod 驱动（验证码 UI 已注释，本版本不可提交） -->
    <form novalidate @submit="onSubmit">
      <!-- 邮箱 / 手机号输入 -->
      <FormField v-slot="{ componentField, errors }" name="identifier">
        <FormItem>
          <FormLabel>{{ identityConfig.label }}</FormLabel>
          <FormControl>
            <InputGroup class="h-10">
              <InputGroupAddon align="inline-start">
                <component :is="identityConfig.icon" />
              </InputGroupAddon>
              <InputGroupInput
                :type="identityConfig.type"
                :autocomplete="identityConfig.autocomplete"
                :placeholder="identityConfig.placeholder"
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

      <!-- 主操作按钮（本版本禁用） -->
      <Button
        type="submit"
        variant="default"
        size="lg"
        class="w-full"
        disabled
      >
        下一步
      </Button>
    </form>

    <!-- 流程说明 -->
    <div class="mt-4 p-3 rounded-xl bg-muted text-xs text-muted-foreground">
      <div class="font-medium text-foreground mb-1">如何找回密码？</div>
      <div class="leading-relaxed">
        选择验证方式并输入账号，点击“发送验证码”后查收邮件或短信。验证码 5
        分钟内有效，验证通过即可设置新密码。
      </div>
    </div>

    <!-- 底部链接 -->
    <footer class="mt-5 text-xs text-center flex items-center justify-center gap-4">
      <RouterLink to="/login" class="text-primary hover:text-primary/80 hover:underline">
        返回登录
      </RouterLink>
      <span class="text-muted-foreground/50">|</span>
      <RouterLink to="/register" class="text-primary hover:text-primary/80 hover:underline">
        还没有账号？去注册
      </RouterLink>
    </footer>
  </AuthLayout>
</template>

<script lang="ts" setup>
import { computed, ref } from 'vue'
import { useForm } from 'vee-validate'
import { toTypedSchema } from '@vee-validate/zod'
import * as z from 'zod'
import { Button } from '@/components/ui/button'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import {
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from '@/components/ui/form'
import { Mail, ShieldAlert, Smartphone } from '@lucide/vue'
import type { Component } from 'vue'
import AuthLayout from './components/auth-layout.vue'
// SendCodeButton 已在模板中注释，等后端支持验证码后启用
// import SendCodeButton from './components/send-code-button.vue'

/**
 * 身份类型
 */
type Identity = 'email' | 'phone'

/**
 * 身份标签配置
 */
interface IdentityTab {
  key: Identity
  label: string
  icon: Component
}

/**
 * 身份选择标签列表
 */
const identityTabs: IdentityTab[] = [
  { key: 'email', label: '邮箱', icon: Mail },
  { key: 'phone', label: '手机号', icon: Smartphone },
]

/**
 * 当前选中的身份类型
 */
const identity = ref<Identity>('email')

/**
 * 不同身份对应的输入框配置（类型、占位符、自动完成、图标）
 */
const identityConfigs: Record<
  Identity,
  { type: string; placeholder: string; label: string; autocomplete: string; icon: Component }
> = {
  email: {
    type: 'email',
    placeholder: '请输入邮箱地址',
    label: '邮箱地址',
    autocomplete: 'email',
    icon: Mail,
  },
  phone: {
    type: 'tel',
    placeholder: '请输入手机号',
    label: '手机号',
    autocomplete: 'tel',
    icon: Smartphone,
  },
}

/**
 * 当前身份对应的输入配置
 */
const identityConfig = computed(() => identityConfigs[identity.value])

/**
 * 找回密码 schema
 * - 校验依赖当前身份 tab，通过 superRefine 读取 identity.value 区分邮箱/手机号
 * - code 字段保留（已注释的验证码 UI 用），后续恢复时无需改 schema 结构
 */
const forgotSchema = z.object({
  identifier: z
    .string()
    .min(1, '请输入账号')
    .superRefine((value, ctx) => {
      const ok =
        identity.value === 'email'
          ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
          : /^1[3-9]\d{9}$/.test(value)
      if (!ok) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            identity.value === 'email' ? '请输入正确的邮箱地址' : '请输入正确的手机号',
        })
      }
    }),
  // code: z.string().min(1, '请输入验证码'), // 验证码字段保留，本版本不使用
})

/**
 * vee-validate 表单实例
 */
const { handleSubmit } = useForm({
  validationSchema: toTypedSchema(forgotSchema),
  initialValues: {
    identifier: '',
    // code: '', // 验证码字段保留，本版本不使用
  },
})

/**
 * 发送验证码：本版本已注释验证码 UI，函数保留以便后续恢复
 */
// function handleSendCode() {
//   const value = form.identifier.trim()
//   if (!value || !isValidIdentifier(value)) {
//     errors.identifier = identity.value === 'email' ? '请输入正确的邮箱地址' : '请输入正确的手机号'
//     return
//   }
//   errors.identifier = ''
//   Message.success('验证码已发送，请注意查收')
//   sendCodeRef.value?.start()
// }

/**
 * 提交下一步：本版本功能未开放，按钮已 disabled，此函数仅为占位
 */
const onSubmit = handleSubmit(async () => {
  // 本版本未开放找回密码，按钮已 disabled，此函数仅为占位
})
</script>

<style scoped></style>
