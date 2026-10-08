<template>
  <!--
    SendCodeButton：发送验证码按钮（带倒计时）
    点击通过 emit('send') 通知父组件校验；父组件校验通过后调用 start() 启动倒计时
  -->
  <Button
    type="button"
    variant="outline"
    size="sm"
    :disabled="countdown > 0"
    @click="handleClick"
  >
    {{ countdown > 0 ? `${countdown}s 后重发` : label }}
  </Button>
</template>

<script lang="ts" setup>
import { Button } from '@/components/ui/button'
import { onBeforeUnmount, ref } from 'vue'

/**
 * 按钮文案
 */
const props = withDefaults(
  defineProps<{
    label?: string
    variant?: 'secondary' | 'ghost'
  }>(),
  { label: '发送验证码', variant: 'secondary' }
)

/**
 * 通知父组件执行发送前的校验
 */
const emit = defineEmits<{ send: [] }>()

/**
 * 倒计时剩余秒数，大于 0 时按钮禁用
 */
const countdown = ref(0)

/**
 * 倒计时定时器句柄
 */
let timer: ReturnType<typeof setInterval> | null = null

/**
 * 点击处理：仅在校验通过后才会由父组件调用 start() 启动倒计时
 */
function handleClick() {
  if (countdown.value > 0) return
  emit('send')
}

/**
 * 启动倒计时（由父组件在校验通过后调用）
 */
function start() {
  if (countdown.value > 0) return
  countdown.value = 60
  timer = setInterval(() => {
    countdown.value -= 1
    if (countdown.value <= 0) {
      stop()
    }
  }, 1000)
}

/**
 * 停止并清理定时器
 */
function stop() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

onBeforeUnmount(stop)

defineExpose({ start })
</script>

<style scoped></style>