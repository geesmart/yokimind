<script lang="ts" setup>
import type { HTMLAttributes } from 'vue'
import { ErrorMessage } from 'vee-validate'
import { toValue } from 'vue'
import { cn } from '@/lib/utils'
import { useFormField } from './useFormField'

const props = defineProps<{
  class?: HTMLAttributes['class']
}>()

const { name, formMessageId, isTouched } = useFormField()
</script>

<template>
  <!--
    仅在字段被交互过（失焦/提交触发 touched）后才渲染错误信息，
    避免表单一打开就满屏标红；touched 后错误信息随校验结果实时更新
  -->
  <ErrorMessage
    v-if="isTouched"
    :id="formMessageId"
    data-slot="form-message"
    as="p"
    :name="toValue(name)"
    :class="cn('text-destructive text-sm', props.class)"
  />
</template>
