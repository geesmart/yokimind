<template>
  <!--
    访问令牌（PAT）管理组件（/settings/agents 智能体接入页使用）
    - 令牌表格：名称 / 前缀 / 创建时间 / 最近使用 / 过期时间 / 状态 / 吊销操作
    - 创建弹窗：两步式（填表 → 明文展示）；明文仅创建响应出现一次，
      等宽字体 + 一键复制 + 警示文案，关闭后无法再查看
    - 吊销确认：AlertDialog 二次确认（不可逆，外部智能体立即失效）
    - 挂载即拉取列表；创建 / 吊销成功后刷新
  -->
  <section class="flex flex-col gap-4 px-2">
    <!-- 分区标题 + 创建按钮 -->
    <div class="flex items-start justify-between gap-3">
      <div class="flex flex-col gap-1">
        <div class="flex items-center gap-2">
          <KeyRound class="size-4 text-muted-foreground" />
          <h3 class="text-base font-semibold leading-none">访问令牌</h3>
          <Badge v-if="tokens.length" variant="secondary">{{ tokens.length }}</Badge>
        </div>
        <p class="text-sm text-muted-foreground">
          个人访问令牌（yki_ 前缀）用于外部 AI 客户端访问你的知识库，等同于账号密码，请妥善保管
        </p>
      </div>
      <Button size="sm" class="cursor-pointer shrink-0" @click="openCreate">
        <Plus class="size-4" />
        创建令牌
      </Button>
    </div>

    <!-- 加载态 -->
    <div v-if="loading" class="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
      <Loader2 class="size-4 animate-spin" />
      正在加载令牌列表…
    </div>

    <!-- 令牌表格 -->
    <div v-else-if="tokens.length" class="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>名称</TableHead>
            <TableHead>令牌前缀</TableHead>
            <TableHead>创建时间</TableHead>
            <TableHead>最近使用</TableHead>
            <TableHead>过期时间</TableHead>
            <TableHead>状态</TableHead>
            <TableHead class="w-20 text-right">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="t in tokens" :key="t.id">
            <TableCell class="max-w-40 truncate font-medium">{{ t.name }}</TableCell>
            <TableCell>
              <code class="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{{ t.tokenPrefix }}…</code>
            </TableCell>
            <TableCell class="whitespace-nowrap text-muted-foreground">{{ formatTime(t.createdAt) }}</TableCell>
            <TableCell class="whitespace-nowrap text-muted-foreground">
              {{ t.lastUsedAt ? formatTime(t.lastUsedAt) : '从未使用' }}
            </TableCell>
            <TableCell class="whitespace-nowrap text-muted-foreground">
              {{ t.expiresAt ? formatTime(t.expiresAt) : '永不过期' }}
            </TableCell>
            <TableCell>
              <Badge v-if="statusOf(t) === 'active'" class="bg-green-600 text-white">有效</Badge>
              <Badge v-else-if="statusOf(t) === 'revoked'" variant="secondary">已吊销</Badge>
              <Badge v-else variant="destructive">已过期</Badge>
            </TableCell>
            <TableCell class="text-right">
              <Button
                v-if="statusOf(t) === 'active'"
                variant="ghost"
                size="sm"
                class="cursor-pointer text-destructive hover:text-destructive"
                @click="revokeTarget = t"
              >
                吊销
              </Button>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>

    <!-- 空态 -->
    <div
      v-else
      class="flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-12 text-center"
    >
      <KeyRound class="size-8 text-muted-foreground/40" />
      <p class="text-sm font-medium">还没有访问令牌</p>
      <p class="max-w-sm text-xs leading-relaxed text-muted-foreground">
        创建一个令牌，即可在 Claude / Cursor / Trae 等 AI 客户端中通过 MCP、CLI 或 Skills 访问你的知识库
      </p>
    </div>

    <!-- ==================== 创建弹窗（两步式） ==================== -->
    <Dialog :open="createVisible" @update:open="onCreateOpenChange">
      <DialogContent class="sm:max-w-md">
        <!-- 步骤一：填写名称与有效期 -->
        <template v-if="!created">
          <DialogHeader>
            <DialogTitle>创建访问令牌</DialogTitle>
            <DialogDescription>为令牌备注用途（如「Trae MCP」），方便日后辨识与吊销</DialogDescription>
          </DialogHeader>
          <div class="flex flex-col gap-4">
            <div class="flex flex-col gap-1.5">
              <Label for="pat-name">令牌名称</Label>
              <Input
                id="pat-name"
                v-model="createForm.name"
                placeholder="例如：Trae MCP"
                maxlength="50"
                autocomplete="off"
                @keydown.enter="submitCreate"
              />
            </div>
            <div class="flex flex-col gap-1.5">
              <Label for="pat-expires">有效期</Label>
              <Select v-model="createForm.expiresPreset">
                <SelectTrigger id="pat-expires" class="cursor-pointer">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="never" class="cursor-pointer">永不过期</SelectItem>
                  <SelectItem value="7" class="cursor-pointer">7 天</SelectItem>
                  <SelectItem value="30" class="cursor-pointer">30 天</SelectItem>
                  <SelectItem value="90" class="cursor-pointer">90 天</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" class="cursor-pointer" @click="closeCreate">取消</Button>
            <Button
              class="cursor-pointer"
              :disabled="creating || !createForm.name.trim()"
              @click="submitCreate"
            >
              <Loader2 v-if="creating" class="size-4 animate-spin" />
              {{ creating ? '创建中…' : '创建' }}
            </Button>
          </DialogFooter>
        </template>

        <!-- 步骤二：明文仅展示一次 -->
        <template v-else>
          <DialogHeader>
            <DialogTitle>令牌已创建</DialogTitle>
            <DialogDescription>
              请立即复制保存，这是唯一一次展示机会，关闭后无法再查看完整令牌
            </DialogDescription>
          </DialogHeader>
          <div class="flex flex-col gap-3">
            <!-- 警示条 -->
            <div class="flex items-start gap-2 rounded-lg border border-orange-600/30 bg-orange-600/5 px-3 py-2.5">
              <TriangleAlert class="mt-0.5 size-4 shrink-0 text-orange-600" />
              <p class="text-xs leading-relaxed text-orange-600">
                令牌等同账号密码：离开本页后将无法再次查看，仅能吊销重建。
              </p>
            </div>
            <!-- 明文 + 复制 -->
            <div class="flex items-center gap-2">
              <code
                class="min-w-0 flex-1 truncate rounded-md border bg-muted px-3 py-2.5 font-mono text-xs select-all"
                >{{ created.token }}</code
              >
              <Button variant="outline" size="sm" class="cursor-pointer shrink-0" @click="copyToken">
                <Check v-if="copied" class="size-4 text-green-600" />
                <Copy v-else class="size-4" />
                {{ copied ? '已复制' : '复制' }}
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button class="cursor-pointer" @click="closeCreate">我已保存，关闭</Button>
          </DialogFooter>
        </template>
      </DialogContent>
    </Dialog>

    <!-- ==================== 吊销确认（不可逆） ==================== -->
    <AlertDialog
      :open="!!revokeTarget"
      @update:open="(v: boolean) => { if (!v) revokeTarget = null }"
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>吊销令牌「{{ revokeTarget?.name }}」？</AlertDialogTitle>
          <AlertDialogDescription>
            吊销后立即生效且不可恢复，使用该令牌的 MCP / CLI / Skills 连接将立即失效，需要重新创建令牌并更新客户端配置。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel class="cursor-pointer">取消</AlertDialogCancel>
          <AlertDialogAction
            class="cursor-pointer bg-destructive text-white hover:bg-destructive/90"
            @click="submitRevoke"
          >
            确认吊销
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </section>
</template>

<script lang="ts" setup>
import { ref, onMounted } from 'vue'
import { toast } from 'vue-sonner'
import {
  Check,
  Copy,
  KeyRound,
  Loader2,
  Plus,
  TriangleAlert,
} from '@lucide/vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { listPat, createPat, revokePat } from '@/api/modules/agent'
import type { PatView, PatStatus } from '@/api/modules/agent'

// ==================== 列表状态 ====================

/** 令牌列表（脱敏视图，按创建时间倒序） */
const tokens = ref<PatView[]>([])
/** 列表加载中 */
const loading = ref(true)

/** 挂载即拉取列表 */
onMounted(refresh)

/** 拉取令牌列表（失败 toast，不阻塞页面其余区块） */
async function refresh() {
  try {
    tokens.value = await listPat().send()
  } catch (error) {
    toast.error(error instanceof Error ? error.message : '加载令牌列表失败')
  } finally {
    loading.value = false
  }
}

/** 推导令牌状态：吊销 > 过期 > 有效 */
function statusOf(t: PatView): PatStatus {
  if (t.revokedAt) return 'revoked'
  if (t.expiresAt && new Date(t.expiresAt).getTime() < Date.now()) return 'expired'
  return 'active'
}

/** 格式化时间为 YYYY-MM-DD HH:mm（本地时区） */
function formatTime(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// ==================== 创建令牌（两步式弹窗） ====================

/** 创建弹窗显隐 */
const createVisible = ref(false)
/** 创建提交中 */
const creating = ref(false)
/** 创建表单：名称 + 有效期预设（never/7/30/90 天） */
const createForm = ref({ name: '', expiresPreset: 'never' })
/** 创建成功后的明文结果（非空 = 弹窗切到明文展示步骤） */
const created = ref<{ token: string } | null>(null)
/** 明文是否已复制（按钮态反馈） */
const copied = ref(false)

/** 打开创建弹窗（重置表单） */
function openCreate() {
  createForm.value = { name: '', expiresPreset: 'never' }
  created.value = null
  copied.value = false
  createVisible.value = true
}

/** 关闭创建弹窗（明文步骤点关闭 = 用户已保存，刷新列表） */
function closeCreate() {
  createVisible.value = false
  if (created.value) {
    created.value = null
    void refresh()
  }
}

/** 受控开关：只处理关闭（遮罩 / Esc / X），语义同 closeCreate */
function onCreateOpenChange(open: boolean) {
  if (!open) closeCreate()
}

/** 有效期预设 → ISO 过期时间（含本地时区偏移，满足后端 zod datetime offset 校验） */
function toExpiresAt(preset: string): string | undefined {
  const days = Number(preset)
  if (!days) return undefined
  return new Date(Date.now() + days * 86_400_000).toISOString()
}

/** 提交创建：成功切到明文展示步骤（明文仅此一次） */
async function submitCreate() {
  const name = createForm.value.name.trim()
  if (!name || creating.value) return
  creating.value = true
  try {
    const result = await createPat(name, toExpiresAt(createForm.value.expiresPreset)).send()
    created.value = { token: result.token }
    toast.success('令牌创建成功，请立即保存')
  } catch (error) {
    toast.error(error instanceof Error ? error.message : '创建令牌失败')
  } finally {
    creating.value = false
  }
}

/** 复制明文令牌到剪贴板（失败降级提示手动选择复制） */
async function copyToken() {
  if (!created.value) return
  try {
    await navigator.clipboard.writeText(created.value.token)
    copied.value = true
    setTimeout(() => (copied.value = false), 2000)
  } catch {
    toast.error('复制失败，请手动选中令牌复制')
  }
}

// ==================== 吊销令牌 ====================

/** 待吊销目标（非空 = 确认弹窗打开） */
const revokeTarget = ref<PatView | null>(null)

/** 确认吊销：成功后刷新列表（视图 revokedAt 已填充，状态自动变「已吊销」） */
async function submitRevoke() {
  const target = revokeTarget.value
  if (!target) return
  try {
    await revokePat(target.id).send()
    toast.success(`令牌「${target.name}」已吊销`)
  } catch (error) {
    toast.error(error instanceof Error ? error.message : '吊销失败')
  } finally {
    revokeTarget.value = null
    void refresh()
  }
}
</script>
