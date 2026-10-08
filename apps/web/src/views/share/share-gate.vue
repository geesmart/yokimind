<template>
  <!--
    访客分享闸门组件（三态中的前置两态，浏览态由 owner view 布局承载）：
    - state='password'：密码卡片（加密分享需先校验访问密码，verify 通过签发访客令牌）
    - state='invalid'：分享失效卡片（分享不存在 / 已关闭 / 库已删除）
    抽取自原 share-guest.vue 的卡片形态；密码校验与令牌存储逻辑内聚在本组件，
    校验成功 emit('verified') 由父组件（wiki/index.vue）切入浏览态并加载访客数据
  -->
  <div class="h-screen min-h-170 bg-muted flex flex-col">
    <!-- ============ 状态一：需要密码 ============ -->
    <div v-if="state === 'password'" class="flex-1 flex flex-col items-center justify-center p-6 gap-8">
      <!-- 墨刻文档品牌标识（与密码卡片作为整体垂直居中），点击跳转首页 -->
      <a href="/" class="shrink-0" aria-label="返回首页" @click.prevent="goHome">
        <img src="/logo-yokimind.png" alt="墨刻文档" class="h-12" />
      </a>
      <div class="w-full max-w-sm flex flex-col gap-5 rounded-xl border border-border bg-background p-8 shadow-sm">
        <div class="flex flex-col items-center gap-3 text-center">
          <!-- 知识库 / 文档信息块：带标签的结构化展示（知识库名 + 文档名，链接带 docId 时显示文档行） -->
          <div class="w-full rounded-lg bg-muted/60 border border-border/60 px-4 py-3 flex flex-col gap-1.5 text-left">
            <div class="flex items-center gap-2 text-sm min-w-0">
              <BookOpen :size="14" class="text-muted-foreground shrink-0" />
              <span class="text-muted-foreground shrink-0">知识库：</span>
              <span class="font-medium truncate" :title="wikiName">{{ wikiName }}</span>
            </div>
            <div v-if="docTitle" class="flex items-center gap-2 text-sm min-w-0">
              <FileText :size="14" class="text-muted-foreground shrink-0" />
              <span class="text-muted-foreground shrink-0">文档：</span>
              <span class="font-medium truncate" :title="docTitle">{{ docTitle }}</span>
            </div>
          </div>
          <!-- 单页形态提示「页面」已加密（校验页密码）；整库形态提示「知识库」（校验库密码） -->
          <p class="text-sm text-muted-foreground">
            {{ isPageMode ? '该页面已加密分享，请输入访问密码' : '该知识库已加密分享，请输入访问密码' }}
          </p>
        </div>
        <div class="flex flex-col gap-2">
          <!-- 密码输入框：InputGroup 带前置锁图标，加大高度与字号 -->
          <InputGroup class="h-11">
            <InputGroupInput
              v-model="password"
              type="password"
              placeholder="访问密码"
              maxlength="32"
              class="h-11 text-sm"
              @keyup.enter="onVerify"
            />
            <InputGroupAddon align="inline-start">
              <Lock :size="14" class="text-muted-foreground" />
            </InputGroupAddon>
          </InputGroup>
          <p v-if="passwordError" class="text-xs text-destructive">{{ passwordError }}</p>
        </div>
        <Button :disabled="verifying || !password" @click="onVerify">
          {{ verifying ? '校验中…' : '进入浏览' }}
        </Button>
      </div>
    </div>

    <!-- ============ 状态二：分享失效 ============ -->
    <div
      v-else
      class="flex-1 flex flex-col items-center justify-center p-6 gap-8"
    >
      <!-- 墨刻文档品牌标识（与失效卡片作为整体垂直居中），点击跳转首页 -->
      <a href="/" class="shrink-0" aria-label="返回首页" @click.prevent="goHome">
        <img src="/logo-yokimind.png" alt="墨刻文档" class="h-12" />
      </a>
      <div class="flex flex-col items-center gap-3 text-center">
        <div class="flex items-center justify-center size-12 rounded-full bg-accent">
          <ShieldOff :size="20" class="text-muted-foreground" />
        </div>
        <h1 class="text-lg font-semibold">分享不存在或已关闭</h1>
        <p class="text-sm text-muted-foreground">该知识库的分享链接已失效</p>
        <Button variant="outline" size="sm" @click="goLogin">去登录</Button>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
/**
 * 访客分享闸门组件
 *
 * 职责边界（与原 share-guest.vue 的职责拆分）：
 * - 本组件只承载「密码校验」与「分享失效」两张全屏卡片；
 * - 校验通过后的浏览态由父组件复用 owner view 布局（LayoutLeft + LayoutMain）渲染。
 *
 * 令牌 scope 规则（与后端签名 scope 一一对应）：
 * - 整库形态（isPageMode=false）：verify 不带 docId → 后端校验库密码、签库级 scope 令牌
 *   → 存库级 key `share-token:{wikiId}`
 * - 单页形态（isPageMode=true）：verify 必须带 docId（= URL docId = documents.id）
 *   → 后端校验页密码、签 `wikiId:nodeId` 页级 scope 令牌 → 存页级 key
 *   `share-token:{wikiId}:{docId}`
 */
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import { BookOpen, FileText, Lock, ShieldOff } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { ApiError } from '@/api/request'
import { setShareToken, verifySharePassword, SHARE_ERROR_CODES } from '@/api/modules/share'

/**
 * 组件 Props
 */
const props = defineProps<{
  /**
   * 闸门状态：
   * - 'password'：密码卡片（加密分享，需校验访问密码）
   * - 'invalid'：分享失效卡片（分享不存在 / 已关闭）
   */
  state: 'password' | 'invalid'
  /** 知识库 ID（分享上下文，密码校验与令牌存储 scope 维度） */
  wikiId: string
  /** 知识库名称（密码卡片信息块展示） */
  wikiName: string
  /** 文档名称（可空；链接带 docId 时由分享元信息返回，密码卡片在解锁前展示） */
  docTitle?: string | null
  /**
   * 是否单页分享形态（accessType='page'）：
   * true = 页密码 + 页级 scope 令牌（verify 带 docId）；false = 库密码 + 库级 scope 令牌
   */
  isPageMode?: boolean
  /**
   * 单页形态的文档 ID（documents.id，即 URL docId）：
   * verify 第三参与页级令牌 key 的 scope 维度；整库形态无需传（令牌存库级 key）
   */
  pageDocId?: string
}>()

/**
 * Emits
 * - verified：密码校验成功（令牌已存入 sessionStorage），父组件切入浏览态并加载访客数据
 */
const emit = defineEmits<{
  (e: 'verified'): void
}>()

const router = useRouter()

/**
 * 访客输入的密码
 */
const password = ref('')

/**
 * 密码校验中（按钮 loading + 防重复提交）
 */
const verifying = ref(false)

/**
 * 密码错误提示（卡片内联展示，密码错误时后端返回 SHARE_PASSWORD_INVALID）
 */
const passwordError = ref('')

/**
 * 提交密码校验
 * 成功：令牌按 scope 存 sessionStorage（标签页关闭即失效）→ 通知父组件进入浏览态
 * 失败：密码错误卡片内提示；分享失效切失效卡片；限流等其余错误 toast 提示
 */
async function onVerify() {
  if (!password.value || verifying.value) return
  verifying.value = true
  passwordError.value = ''
  try {
    // 单页形态带 docId 校验页密码，整库形态不带（undefined 时 body 自然不含 docId 字段）
    const scopeDocId = props.isPageMode ? props.pageDocId || undefined : undefined
    const result = await verifySharePassword(props.wikiId, password.value, scopeDocId).send()
    // 令牌存 sessionStorage，key 随 scope 隔离：
    // 整库 share-token:{wikiId}；单页 share-token:{wikiId}:{docId}
    setShareToken(props.wikiId, result, scopeDocId)
    password.value = ''
    emit('verified')
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.code === SHARE_ERROR_CODES.PASSWORD_INVALID) {
        // 密码错误：卡片内提示
        passwordError.value = '访问密码错误，请重试'
      } else {
        // 其余（限流等）：toast 提示；分享被 owner 实时撤销时父组件探测/加载会兜底切失效态
        toast.error(error.message)
      }
    } else {
      console.error('[share-gate] 密码校验失败:', error)
      toast.error('校验失败，请重试')
    }
  } finally {
    verifying.value = false
  }
}

/**
 * 跳转登录页（分享失效态的「去登录」按钮）
 */
function goLogin() {
  router.push('/login')
}

/**
 * 跳转首页（点击墨刻文档 logo；未登录时首页路由守卫会自动引导到登录页）
 */
function goHome() {
  router.push({ name: 'home' })
}
</script>
