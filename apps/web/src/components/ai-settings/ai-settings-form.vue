<template>
  <!--
    AI 配置共享表单（/admin AI 大模型管理页 与 用户菜单「AI 大模型管理」弹窗共用）
    - 对话服务：服务商地址 / API 密钥 / 对话模型
    - 向量服务：服务商地址 / API 密钥 / 向量模型
    - 精排服务：服务商地址 / API 密钥 / 精排模型（独立 rerank 协议）
    - 检索参数：意图开关 / 查询扩展开关 / 召回候选数 / 相似度阈值 / 精排保留数
    - 配置存储：数据库 app_settings 表（优先级 DB > .env），保存后即时生效无需重启
    - 密钥脱敏：后端只回掩码（如 sk-***abcd），输入框留空 = 保留现值不修改
    - 连接测试：以「当前表单填写值」临时构造实例测试（未保存的修改也参与），失败不抛错逐项展示
    - 挂载即拉取配置：弹窗内以 v-if 挂载，每次打开都会重新拿到最新视图
    - 界面文案以中文展示，对应的环境变量名以灰色等宽小字标注在标签右侧
  -->
  <!-- 加载中：拉取当前配置视图 -->
  <div
    v-if="loading"
    class="flex items-center justify-center gap-2 py-24 text-sm text-muted-foreground"
  >
    <Loader2 class="size-4 animate-spin" />
    正在加载配置…
  </div>

  <!-- 无管理员权限：后端返回 90001 时渲染（不泄露配置内容）；仅作为提示块，不用 Card -->
  <div
    v-else-if="forbidden"
    class="flex flex-col items-center gap-3 rounded-xl border border-destructive/30 bg-gray-50 px-4 py-12"
  >
    <ShieldOff class="size-10 text-muted-foreground/40" />
    <p class="text-sm font-medium">无管理员权限</p>
    <p class="max-w-xs text-center text-xs leading-relaxed text-muted-foreground">
      当前账号不在管理员白名单中，请联系管理员在服务端执行 set-admin 脚本添加。
    </p>
    <!-- 弹窗场景：按钮为「关闭」并通知父组件关弹窗；页面场景：返回工作台 -->
    <Button v-if="inModal" variant="outline" class="cursor-pointer" @click="emit('close')">
      关闭
    </Button>
    <Button v-else variant="outline" class="cursor-pointer" @click="router.push('/dashboard')">
      返回工作台
    </Button>
  </div>

  <!-- 配置表单主体：模块不再用 Card 包裹，统一以 Separator 分割线分区 -->
  <template v-else-if="view">
    <!-- ==================== 对话服务 ==================== -->
    <section class="flex flex-col gap-4 px-2">
      <!-- 分区标题：图标 + 标题 + 状态徽标 + 描述 -->
      <div class="flex flex-col gap-1">
        <div class="flex items-center gap-2">
          <Sparkles class="size-4 text-muted-foreground" />
          <h3 class="text-base font-semibold leading-none">对话服务</h3>
          <!-- 状态徽标：测试通过绿 / 失败红 / 未测试按配置就绪度灰显 -->
          <Badge :variant="badgeState('chat').variant" :class="badgeState('chat').class">
            {{ badgeState('chat').text }}
          </Badge>
        </div>
        <p class="text-sm text-muted-foreground">
          兼容 OpenAI 接口协议，用于 AI 问答、知识库对话等能力
        </p>
      </div>
      <div class="flex flex-col gap-4">
        <!-- 服务商地址（AI_BASE_URL，OpenAI 兼容 baseURL） -->
        <div class="flex flex-col gap-1.5">
          <Label for="ai-base-url">
            服务商地址
            <span
              class="ms-1 align-middle font-mono text-[10px] font-normal text-muted-foreground/60"
              >AI_BASE_URL</span
            >
          </Label>
          <Input
            id="ai-base-url"
            v-model="form.baseUrl"
            placeholder="https://api.openai.com/v1"
            autocomplete="off"
          />
        </div>

        <!-- API 密钥（AI_API_KEY）：仅输入新值才提交；留空 = 保留现值；右侧眼睛切换明文核对本次输入 -->
        <div class="flex flex-col gap-1.5">
          <Label for="ai-api-key">
            API 密钥
            <span
              class="ms-1 align-middle font-mono text-[10px] font-normal text-muted-foreground/60"
              >AI_API_KEY</span
            >
          </Label>
          <InputGroup>
            <InputGroupInput
              id="ai-api-key"
              v-model="form.apiKey"
              :type="showApiKey ? 'text' : 'password'"
              :placeholder="view.hasApiKey ? `已配置（${view.apiKeyMask}），留空保持不变` : 'sk-…'"
              autocomplete="new-password"
            />
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                size="icon-xs"
                class="cursor-pointer"
                :title="showApiKey ? '隐藏密钥' : '显示密钥'"
                :aria-label="showApiKey ? '隐藏密钥' : '显示密钥'"
                :aria-pressed="showApiKey"
                @click="showApiKey = !showApiKey"
              >
                <EyeOff v-if="showApiKey" class="size-4 text-muted-foreground" />
                <Eye v-else class="size-4 text-muted-foreground" />
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
          <p class="text-xs text-muted-foreground/70">
            密钥保存后不再回显明文（仅展示掩码），眼睛图标仅用于核对本次输入
          </p>
        </div>

        <!-- 对话模型（AI_CHAT_MODEL） -->
        <div class="flex flex-col gap-1.5">
          <Label for="ai-chat-model">
            对话模型
            <span
              class="ms-1 align-middle font-mono text-[10px] font-normal text-muted-foreground/60"
              >AI_CHAT_MODEL</span
            >
          </Label>
          <Input id="ai-chat-model" v-model="form.chatModel" autocomplete="off" />
        </div>
      </div>
    </section>

    <Separator class="my-6" />

    <!-- ==================== 向量服务 ==================== -->
    <section class="flex flex-col gap-4 px-2">
      <!-- 分区标题：图标 + 标题 + 状态徽标 + 描述；独立配置 / 回退对话服务额外标注 -->
      <div class="flex flex-col gap-1">
        <div class="flex items-center gap-2">
          <Layers class="size-4 text-muted-foreground" />
          <h3 class="text-base font-semibold leading-none">向量服务</h3>
          <Badge :variant="badgeState('embedding').variant" :class="badgeState('embedding').class">
            {{ badgeState('embedding').text }}
          </Badge>
        </div>
        <p class="text-sm text-muted-foreground">
          用于知识库内容向量化；地址 / 密钥未单独配置时自动回退上方对话服务商
        </p>
      </div>
      <div class="flex flex-col gap-4">
        <!-- 服务商地址（AI_EMBEDDING_BASE_URL）：留空且已配置时 = 保留现值不清空 -->
        <div class="flex flex-col gap-1.5">
          <Label for="ai-embedding-base-url">
            服务商地址
            <span
              class="ms-1 align-middle font-mono text-[10px] font-normal text-muted-foreground/60"
              >AI_EMBEDDING_BASE_URL</span
            >
          </Label>
          <Input
            id="ai-embedding-base-url"
            v-model="form.embeddingBaseUrl"
            :placeholder="
              view.embeddingFallback ? '未配置，回退对话服务商地址' : 'https://api.example.com/v1'
            "
            autocomplete="off"
          />
        </div>

        <!-- API 密钥（AI_EMBEDDING_API_KEY）：仅输入新值才提交；留空 = 保留现值；右侧眼睛切换明文 -->
        <div class="flex flex-col gap-1.5">
          <Label for="ai-embedding-api-key">
            API 密钥
            <span
              class="ms-1 align-middle font-mono text-[10px] font-normal text-muted-foreground/60"
              >AI_EMBEDDING_API_KEY</span
            >
          </Label>
          <InputGroup>
            <InputGroupInput
              id="ai-embedding-api-key"
              v-model="form.embeddingApiKey"
              :type="showEmbeddingApiKey ? 'text' : 'password'"
              :placeholder="
                view.hasEmbeddingApiKey
                  ? view.embeddingApiKeyMask
                    ? `已配置（${view.embeddingApiKeyMask}），留空保持不变`
                    : '回退对话服务密钥，留空保持不变'
                  : 'sk-…'
              "
              autocomplete="new-password"
            />
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                size="icon-xs"
                class="cursor-pointer"
                :title="showEmbeddingApiKey ? '隐藏密钥' : '显示密钥'"
                :aria-label="showEmbeddingApiKey ? '隐藏密钥' : '显示密钥'"
                :aria-pressed="showEmbeddingApiKey"
                @click="showEmbeddingApiKey = !showEmbeddingApiKey"
              >
                <EyeOff v-if="showEmbeddingApiKey" class="size-4 text-muted-foreground" />
                <Eye v-else class="size-4 text-muted-foreground" />
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
          <p class="text-xs text-muted-foreground/70">
            地址与密钥必须成对配置，否则视为未独立配置（回退对话服务）
          </p>
        </div>

        <!-- 向量模型（AI_EMBEDDING_MODEL） -->
        <div class="flex flex-col gap-1.5">
          <Label for="ai-embedding-model">
            向量模型
            <span
              class="ms-1 align-middle font-mono text-[10px] font-normal text-muted-foreground/60"
              >AI_EMBEDDING_MODEL</span
            >
          </Label>
          <Input id="ai-embedding-model" v-model="form.embeddingModel" autocomplete="off" />
          <p class="text-xs text-muted-foreground/70">
            当前向量维度：{{ view.embeddingDim }}（须与数据库 rag_chunks.embedding
            列一致，修改模型需重建索引）
          </p>
        </div>

      </div>
    </section>

    <Separator class="my-6" />

    <!-- ==================== 精排服务（GLM rerank，独立 HTTP 协议非 OpenAI 兼容） ==================== -->
    <section class="flex flex-col gap-4 px-2">
      <!-- 分区标题：图标 + 标题 + 状态徽标 + 描述；独立配置 / 回退对话服务额外标注 -->
      <div class="flex flex-col gap-1">
        <div class="flex items-center gap-2">
          <ArrowDownUp class="size-4 text-muted-foreground" />
          <h3 class="text-base font-semibold leading-none">精排服务</h3>
          <Badge :variant="badgeState('rerank').variant" :class="badgeState('rerank').class">
            {{ badgeState('rerank').text }}
          </Badge>
        </div>
        <p class="text-sm text-muted-foreground">
          对知识库多路召回的候选片段重打相关性分（如智谱 GLM rerank 端点）； 地址 /
          密钥未单独配置时自动回退上方对话服务商
        </p>
      </div>
      <div class="flex flex-col gap-4">
        <!-- 服务商地址（AI_RERANK_BASE_URL）：智谱为 https://open.bigmodel.cn/api/paas/v4（非 OpenAI 协议勿填 OpenAI 地址） -->
        <div class="flex flex-col gap-1.5">
          <Label for="ai-rerank-base-url">
            服务商地址
            <span
              class="ms-1 align-middle font-mono text-[10px] font-normal text-muted-foreground/60"
              >AI_RERANK_BASE_URL</span
            >
          </Label>
          <Input
            id="ai-rerank-base-url"
            v-model="form.rerankBaseUrl"
            :placeholder="
              view.rerankFallback
                ? '未配置，回退对话服务商地址'
                : 'https://open.bigmodel.cn/api/paas/v4'
            "
            autocomplete="off"
          />
        </div>

        <!-- API 密钥（AI_RERANK_API_KEY）：仅输入新值才提交；留空 = 保留现值；右侧眼睛切换明文 -->
        <div class="flex flex-col gap-1.5">
          <Label for="ai-rerank-api-key">
            API 密钥
            <span
              class="ms-1 align-middle font-mono text-[10px] font-normal text-muted-foreground/60"
              >AI_RERANK_API_KEY</span
            >
          </Label>
          <InputGroup>
            <InputGroupInput
              id="ai-rerank-api-key"
              v-model="form.rerankApiKey"
              :type="showRerankApiKey ? 'text' : 'password'"
              :placeholder="
                view.hasRerankApiKey
                  ? view.rerankApiKeyMask
                    ? `已配置（${view.rerankApiKeyMask}），留空保持不变`
                    : '回退对话服务密钥，留空保持不变'
                  : 'sk-…'
              "
              autocomplete="new-password"
            />
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                size="icon-xs"
                class="cursor-pointer"
                :title="showRerankApiKey ? '隐藏密钥' : '显示密钥'"
                :aria-label="showRerankApiKey ? '隐藏密钥' : '显示密钥'"
                :aria-pressed="showRerankApiKey"
                @click="showRerankApiKey = !showRerankApiKey"
              >
                <EyeOff v-if="showRerankApiKey" class="size-4 text-muted-foreground" />
                <Eye v-else class="size-4 text-muted-foreground" />
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
          <p class="text-xs text-muted-foreground/70">
            地址与密钥必须成对配置，否则视为未独立配置（回退对话服务）
          </p>
        </div>

        <!-- 精排模型（AI_RERANK_MODEL）：开启精排的总开关 -->
        <div class="flex flex-col gap-1.5">
          <Label for="ai-rerank-model">
            精排模型
            <span
              class="ms-1 align-middle font-mono text-[10px] font-normal text-muted-foreground/60"
              >AI_RERANK_MODEL</span
            >
          </Label>
          <Input id="ai-rerank-model" v-model="form.rerankModel" autocomplete="off" />
          <p class="text-xs text-muted-foreground/70">
            模型名留空 =
            关闭精排（检索结果按向量相似度排序）；精排请求失败自动降级走向量序，不阻断问答
          </p>
        </div>

      </div>
    </section>

    <Separator class="my-6" />

    <!-- ==================== 检索参数（问答 / 语义搜索流程运行时可调项） ==================== -->
    <section class="flex flex-col gap-4 px-2">
      <!-- 分区标题：图标 + 标题 + 描述 -->
      <div class="flex flex-col gap-1">
        <div class="flex items-center gap-2">
          <SlidersHorizontal class="size-4 text-muted-foreground" />
          <h3 class="text-base font-semibold leading-none">检索参数</h3>
        </div>
        <p class="text-sm text-muted-foreground">
          知识库问答 / 语义搜索流程的运行时可调项，保存后即时生效，无需重建索引
        </p>
      </div>
      <div class="flex flex-col gap-4">
        <!-- 意图识别开关：开启后先判定「知识库查询 / 闲聊」，闲聊直接短路（0 检索 0 生成） -->
        <div class="flex items-center justify-between gap-4">
          <div class="flex flex-col gap-0.5">
            <Label for="rag-intent-enabled">意图识别</Label>
            <p class="text-xs text-muted-foreground/70">
              先判定「知识库查询 /
              闲聊」，闲聊直接礼貌回复（不检索不生成）；关闭后有历史时仍做问题改写
            </p>
          </div>
          <Switch id="rag-intent-enabled" v-model="form.ragIntentEnabled" />
        </div>

        <!-- 查询扩展开关：开启后按改写问题生成多路查询变体并行召回（鲁棒性换耗时） -->
        <div class="flex items-center justify-between gap-4">
          <div class="flex flex-col gap-0.5">
            <Label for="rag-query-expansion-enabled">查询扩展（多路召回）</Label>
            <p class="text-xs text-muted-foreground/70">
              生成多个查询变体并行召回后融合去重，覆盖口语化问法；关闭后仅单路召回（更快）
            </p>
          </div>
          <Switch id="rag-query-expansion-enabled" v-model="form.ragQueryExpansionEnabled" />
        </div>

        <!-- 数字参数：召回候选数 / 相似度阈值 / 精排保留数 -->
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div class="flex flex-col gap-1.5">
            <Label for="rag-recall-size">召回候选数</Label>
            <Input
              id="rag-recall-size"
              v-model="form.ragRecallSize"
              type="number"
              min="1"
              max="100"
              autocomplete="off"
            />
            <p class="text-xs text-muted-foreground/70">
              多路召回融合后进入精排的候选条数（1-100）
            </p>
          </div>
          <div class="flex flex-col gap-1.5">
            <Label for="rag-min-score">相似度阈值</Label>
            <Input
              id="rag-min-score"
              v-model="form.ragMinScore"
              type="number"
              min="0"
              max="1"
              step="0.01"
              autocomplete="off"
            />
            <p class="text-xs text-muted-foreground/70">
              低于该值判不相关（bge-m3 量纲 0-1）；全部不相关时走兜底推荐
            </p>
          </div>
          <div class="flex flex-col gap-1.5">
            <Label for="rag-final-top-k">精排保留数</Label>
            <Input
              id="rag-final-top-k"
              v-model="form.ragFinalTopK"
              type="number"
              min="1"
              max="20"
              autocomplete="off"
            />
            <p class="text-xs text-muted-foreground/70">精排后送入提示词的资料条数（1-20）</p>
          </div>
        </div>
      </div>
    </section>

    <!-- ==================== 连接测试结果 ==================== -->
    <div
      v-if="testResults"
      class="mt-6 flex flex-col gap-2 rounded-lg border bg-muted/30 px-4 py-3"
    >
      <p class="text-xs text-muted-foreground">
        连接测试结果（使用当前表单填写值，未保存的修改也参与测试）：
      </p>
      <div
        v-for="r in testResults"
        :key="r.target"
        class="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm"
      >
        <CheckCircle2 v-if="r.ok" class="size-4 text-emerald-600" />
        <XCircle v-else class="size-4 text-destructive" />
        <span class="font-medium">{{ testTargetLabel(r.target) }}</span>
        <!-- 成功：模型名 + 耗时 + 实测维度（向量服务专属） -->
        <span v-if="r.ok" class="text-xs text-muted-foreground">
          {{ r.model }}
          <template v-if="r.latencyMs != null"> · {{ r.latencyMs }}毫秒</template>
          <template v-if="r.dim != null"> · {{ r.dim }} 维</template>
        </span>
        <!-- 失败：原因（含「未配置」） -->
        <span v-else class="text-xs text-destructive/80">{{ r.error }}</span>
      </div>
    </div>

    <!-- ==================== 操作区（仅 /admin 页面模式内嵌；弹窗模式由 AiSettingsModal 固定底栏渲染） ==================== -->
    <div v-if="!inModal" class="mt-6 flex flex-wrap items-center gap-3">
      <Button
        variant="outline"
        class="cursor-pointer"
        :disabled="testing || saving"
        @click="handleTest"
      >
        <Loader2 v-if="testing" class="size-4 animate-spin" />
        <PlugZap v-else class="size-4" />
        {{ testing ? '测试中…' : '测试连接' }}
      </Button>
      <Button class="cursor-pointer" :disabled="saving || testing" @click="handleSave">
        <Loader2 v-if="saving" class="size-4 animate-spin" />
        <Save v-else class="size-4" />
        {{ saving ? '保存中…' : '保存配置' }}
      </Button>
      <p class="text-xs text-muted-foreground">保存后新配置即时生效，无需重启服务</p>
    </div>
  </template>
</template>

<script lang="ts" setup>
import { onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import {
  ArrowDownUp,
  CheckCircle2,
  Eye,
  EyeOff,
  Layers,
  Loader2,
  PlugZap,
  Save,
  ShieldOff,
  SlidersHorizontal,
  Sparkles,
  XCircle,
} from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Input } from '@/components/ui/input'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@/components/ui/input-group'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  getAiSettings,
  saveAiSettings,
  testAiConnection,
  type AiSettingsView,
  type AiTestItemResult,
  type AiTestTarget,
  type SaveAiSettingsParams,
} from '@/api/modules/admin'
import { ApiError } from '@/api/request'
import { ERROR_CODES } from '@/api/constants'

/**
 * Props
 * - inModal：是否运行在「AI 大模型管理」配置弹窗内（影响无权限卡片的按钮：关闭弹窗 / 返回工作台）
 */
withDefaults(
  defineProps<{
    inModal?: boolean
  }>(),
  { inModal: false }
)

/**
 * Emits
 * - saved：保存成功后抛出最新配置视图（供弹窗使用方判断 chatReady 自动关闭等）
 * - close：弹窗模式下无权限卡片的「关闭」按钮触发
 */
const emit = defineEmits<{
  (e: 'saved', view: AiSettingsView): void
  (e: 'close'): void
}>()

const router = useRouter()

// ==================== 表单状态 ====================

/** 首次加载配置视图进行中 */
const loading = ref(true)

/** 无管理员权限（后端 90001）：渲染无权限卡片 */
const forbidden = ref(false)

/** 当前生效配置视图（脱敏，来自后端 getSettingsView） */
const view = ref<AiSettingsView | null>(null)

/** 保存中 / 测试中（驱动按钮 loading 与禁用） */
const saving = ref(false)
const testing = ref(false)

/** 最近一次连接测试结果（null = 未测过或保存后已失效） */
const testResults = ref<AiTestItemResult[] | null>(null)

/** 密钥明文显示开关（右侧眼睛图标切换，仅用于核对本次输入，不影响已保存密钥） */
const showApiKey = ref(false)
const showEmbeddingApiKey = ref(false)
const showRerankApiKey = ref(false)

/**
 * 表单数据（与后端配置字段一一对应）
 * - 三个密钥输入框恒为空：不回显明文，placeholder 展示掩码
 * - 留空语义：密钥 = 保留现值；其余字符串字段 = 未修改不提交
 * - 数字参数以字符串承接（type=number 输入框），提交时 parse，非法/空 = 不提交
 */
const form = reactive({
  baseUrl: '',
  apiKey: '',
  chatModel: '',
  embeddingBaseUrl: '',
  embeddingApiKey: '',
  embeddingModel: '',
  // 精排服务三字段
  rerankBaseUrl: '',
  rerankApiKey: '',
  rerankModel: '',
  // 检索流程参数（布尔开关直接绑 Switch；数字以字符串承接输入框）
  ragIntentEnabled: true,
  ragQueryExpansionEnabled: true,
  ragRecallSize: '',
  ragMinScore: '',
  ragFinalTopK: '',
})

/** 连接测试目标的展示名（结果列表用） */
function testTargetLabel(target: AiTestItemResult['target']): string {
  if (target === 'chat') return '对话服务'
  if (target === 'embedding') return '向量服务'
  return '精排服务'
}

/** 徽标 variant 的变体类型（对齐 shadcn Badge 的 variant 联合） */
type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline'

/**
 * 分区状态徽标（对话 / 向量 / 精排三节共用）：
 * - 该目标最近一次连接测试通过 → 绿色「测试通过」
 * - 测试失败 → 红色「测试失败」
 * - 未测试 → 灰色描边，文案按配置就绪度显示「已就绪 / 未配置」
 * 保存 / 清除配置后 testResults 会清空，徽标自动回到灰色态
 */
function badgeState(target: AiTestTarget): {
  text: string
  variant: BadgeVariant
  class?: string
} {
  const result = testResults.value?.find((r) => r.target === target)
  if (result) {
    return result.ok
      ? {
          text: '测试通过',
          variant: 'outline',
          class: 'border-emerald-600/40 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400',
        }
      : { text: '测试失败', variant: 'destructive' }
  }
  const ready =
    target === 'chat'
      ? !!view.value?.chatReady
      : target === 'embedding'
        ? !!view.value?.embeddingReady
        : !!view.value?.rerankReady
  return { text: ready ? '已就绪' : '未配置', variant: 'outline' }
}

/**
 * 用后端配置视图回填表单
 * 密钥字段永不回填（保持空输入框），其余取生效值
 */
function applyView(v: AiSettingsView) {
  form.baseUrl = v.baseUrl ?? ''
  form.chatModel = v.chatModel
  form.embeddingBaseUrl = v.embeddingBaseUrl ?? ''
  form.embeddingModel = v.embeddingModel
  form.rerankBaseUrl = v.rerankBaseUrl ?? ''
  form.rerankModel = v.rerankModel ?? ''
  form.ragIntentEnabled = v.ragIntentEnabled
  form.ragQueryExpansionEnabled = v.ragQueryExpansionEnabled
  form.ragRecallSize = String(v.ragRecallSize)
  form.ragMinScore = String(v.ragMinScore)
  form.ragFinalTopK = String(v.ragFinalTopK)
  form.apiKey = ''
  form.embeddingApiKey = ''
  form.rerankApiKey = ''
}

// ==================== 数据加载 ====================

onMounted(async () => {
  try {
    const v = await getAiSettings().send()
    view.value = v
    applyView(v)
  } catch (e) {
    if (e instanceof ApiError && e.code === ERROR_CODES.ADMIN_FORBIDDEN) {
      // 非管理员：渲染无权限卡片（不 toast，卡片已有明确提示）
      forbidden.value = true
      return
    }
    // 其余错误：toast 提示（request 层已映射友好文案）
    toast.error(e instanceof Error ? e.message : '加载配置失败')
  } finally {
    loading.value = false
  }
})

// ==================== 保存 ====================

/**
 * 从表单构建保存补丁
 * - 密钥：仅当输入了新值（trim 非空）才提交
 * - 其余字段：trim 后非空且与当前生效值不同才提交（避免无谓写入）
 * - 返回空对象 = 表单无任何有效修改
 */
function buildPatch(): SaveAiSettingsParams {
  const patch: SaveAiSettingsParams = {}

  const baseUrl = form.baseUrl.trim()
  if (baseUrl && baseUrl !== (view.value?.baseUrl ?? '')) patch.baseUrl = baseUrl

  const apiKey = form.apiKey.trim()
  if (apiKey) patch.apiKey = apiKey

  const chatModel = form.chatModel.trim()
  if (chatModel && chatModel !== (view.value?.chatModel ?? '')) patch.chatModel = chatModel

  const embeddingBaseUrl = form.embeddingBaseUrl.trim()
  if (embeddingBaseUrl && embeddingBaseUrl !== (view.value?.embeddingBaseUrl ?? '')) {
    patch.embeddingBaseUrl = embeddingBaseUrl
  }

  const embeddingApiKey = form.embeddingApiKey.trim()
  if (embeddingApiKey) patch.embeddingApiKey = embeddingApiKey

  const embeddingModel = form.embeddingModel.trim()
  if (embeddingModel && embeddingModel !== (view.value?.embeddingModel ?? '')) {
    patch.embeddingModel = embeddingModel
  }

  // ===== 精排服务三字段（与向量服务同语义：留空不提交，变更才提交） =====
  const rerankBaseUrl = form.rerankBaseUrl.trim()
  if (rerankBaseUrl && rerankBaseUrl !== (view.value?.rerankBaseUrl ?? '')) {
    patch.rerankBaseUrl = rerankBaseUrl
  }

  const rerankApiKey = form.rerankApiKey.trim()
  if (rerankApiKey) patch.rerankApiKey = rerankApiKey

  const rerankModel = form.rerankModel.trim()
  if (rerankModel !== (view.value?.rerankModel ?? '')) {
    // 模型名允许提交空串（= 清除覆盖关闭精排），故不设非空门槛，只比对变更
    patch.rerankModel = rerankModel
  }

  // ===== 检索流程参数：布尔开关变更即提交；数字 parse 合法且变更才提交 =====
  if (form.ragIntentEnabled !== (view.value?.ragIntentEnabled ?? true)) {
    patch.ragIntentEnabled = form.ragIntentEnabled
  }
  if (form.ragQueryExpansionEnabled !== (view.value?.ragQueryExpansionEnabled ?? true)) {
    patch.ragQueryExpansionEnabled = form.ragQueryExpansionEnabled
  }

  /** 数字参数统一解析：空/非法 = 不提交；合法且与生效值不同 = 提交数值 */
  const num = (raw: string, current: number | undefined): number | undefined => {
    if (raw.trim() === '') return undefined
    const parsed = Number(raw)
    if (!Number.isFinite(parsed)) return undefined
    return parsed === current ? undefined : parsed
  }
  const recallSize = num(form.ragRecallSize, view.value?.ragRecallSize)
  if (recallSize !== undefined) patch.ragRecallSize = recallSize
  const minScore = num(form.ragMinScore, view.value?.ragMinScore)
  if (minScore !== undefined) patch.ragMinScore = minScore
  const finalTopK = num(form.ragFinalTopK, view.value?.ragFinalTopK)
  if (finalTopK !== undefined) patch.ragFinalTopK = finalTopK

  return patch
}

/** 统一错误处理：90001 切无权限卡片；其余 toast（ApiError 已带友好文案） */
function handleError(e: unknown, fallback: string) {
  if (e instanceof ApiError && e.code === ERROR_CODES.ADMIN_FORBIDDEN) {
    forbidden.value = true
    return
  }
  toast.error(e instanceof Error ? e.message : fallback)
}

/** 保存配置：成功后用返回的最新视图刷新表单与状态徽标，并 emit saved 通知使用方 */
async function handleSave() {
  const patch = buildPatch()
  if (Object.keys(patch).length === 0) {
    toast.info('没有需要保存的修改')
    return
  }
  saving.value = true
  try {
    const latest = await saveAiSettings(patch).send()
    view.value = latest
    applyView(latest)
    testResults.value = null // 配置已变，旧测试结果作废
    toast.success('配置已保存，已对全部服务即时生效')
    emit('saved', latest)
  } catch (e) {
    handleError(e, '保存配置失败')
  } finally {
    saving.value = false
  }
}

// ==================== 连接测试 ====================

/**
 * 连接测试：以「当前表单填写值」作为 overrides 临时测试
 * - 未保存的修改也参与测试，方便保存前先验证
 * - 后端对失败逐项返回 ok:false，不会抛业务异常
 */
async function handleTest() {
  testing.value = true
  try {
    const overrides = buildPatch()
    const results = await testAiConnection({
      targets: ['chat', 'embedding', 'rerank'],
      overrides: Object.keys(overrides).length > 0 ? overrides : undefined,
    }).send()
    testResults.value = results
    // 汇总 toast：全部成功 / 部分失败
    const okCount = results.filter((r) => r.ok).length
    if (okCount === results.length) {
      toast.success(`连接测试全部通过（${okCount}/${results.length}）`)
    } else {
      toast.warning(`连接测试 ${okCount}/${results.length} 项通过，请查看失败原因`)
    }
  } catch (e) {
    handleError(e, '连接测试失败')
  } finally {
    testing.value = false
  }
}

/**
 * 暴露给弹窗外壳（AiSettingsModal）的接口：
 * 弹窗把「测试连接 / 保存配置」按钮固定在 DialogFooter（不随内容滚动），
 * 通过模板 ref 调用这里的动作；表单内部的 loading 状态与按钮禁用逻辑不变
 */
defineExpose({
  /** 保存配置（同内嵌操作区的保存按钮） */
  save: handleSave,
  /** 连接测试（同内嵌操作区的测试按钮） */
  test: handleTest,
})
</script>
