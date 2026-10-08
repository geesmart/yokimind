<script lang="ts" setup>
import type { LabelProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'
import { Label } from '@/components/ui/label'
import { useFormField } from './useFormField'

const props = defineProps<LabelProps & { class?: HTMLAttributes['class'] }>()

const { error, isTouched, formItemId } = useFormField()
</script>

<template>
  <!--
    data-error 驱动 label 标红（data-[error=true]:text-destructive），
    仅在字段被交互过（touched）且有错误时才标红，避免表单初始状态满屏红字
  -->
  <Label
    data-slot="form-label"
    :data-error="!!error && isTouched"
    :class="cn(
      'data-[error=true]:text-destructive',
      props.class,
    )"
    :for="formItemId"
  >
    <slot />
  </Label>
</template>
