<template>
  <!--
    侧栏底部用户信息块（wiki 左侧栏专用，shadcn Combobox 实现）
    - 已登录：整行触发表（圆角方形头像 + 昵称 + 邮箱 + ChevronsUpDown），
      点击向右侧弹出 Combobox 菜单：头部用户信息 + 功能项列表
    - 未登录：ghost 行（登录图标 + 文案），点击跳转登录页
    功能项沿用原顶栏 UserMenu 的集合：修改用户信息 / 修改密码 / 回到首页 /
    返回工作台 / AI 大模型管理（仅管理员，点击原地弹窗不跳页）/ 退出登录
    Combobox 要点：
    - model-value 受控恒为空串：不回写选中值，保证同一菜单项可重复选中触发
  -->
  <!-- 未登录：登录入口（owner 视图正常已登录，此为兜底分支） -->
  <button
    v-if="!user"
    class="flex w-full items-center gap-2 rounded-lg p-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    aria-label="去登录"
    title="去登录"
    @click="router.push('/login')"
  >
    <span
      class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent/80 text-foreground"
    >
      <CircleUserRound :size="18" />
    </span>
    <span class="flex-1 truncate font-medium">登录 / 注册</span>
  </button>

  <!-- 已登录：Combobox 触发行 + 向右侧弹出的用户菜单 -->
  <Combobox v-else v-model:open="open" :model-value="''" @update:model-value="onComboboxSelect">
    <!-- Anchor + Trigger：触发行整行可点，展开/收起菜单 -->
    <ComboboxAnchor as-child>
      <ComboboxTrigger as-child>
        <button
          class="flex w-full items-center gap-2 overflow-hidden rounded-lg p-1.5 text-left transition-colors border hover:bg-gray-50"
          aria-label="用户菜单"
        >
          <!-- 圆角方形头像（设计图为 rounded-lg，区别于旧顶栏的圆形头像） -->
          <Avatar class="size-8">
            <AvatarImage v-if="user.avatar" :src="user.avatar" :alt="user.nickname" />
            <AvatarFallback class="bg-accent/80 text-xs font-semibold text-foreground">
              {{ userInitial }}
            </AvatarFallback>
          </Avatar>

          <!-- 昵称 + 邮箱两行文本，超长 truncate（min-w-0 放开 flex 收缩限制） -->
          <span class="flex min-w-0 flex-1 flex-col">
            <span class="truncate text-sm font-semibold text-foreground">{{ user.nickname }}</span>
            <span v-if="user.email" class="truncate text-xs text-muted-foreground">
              {{ user.email }}
            </span>
          </span>

          <!-- 右侧展开/收起指示图标 -->
          <ChevronsUpDown :size="16" class="ml-auto shrink-0 text-muted-foreground" />
        </button>
      </ComboboxTrigger>
    </ComboboxAnchor>

    <!-- 菜单内容：向右侧弹出（side="right"），底部对齐触发行、距侧栏 16px，悬于编辑器内容区上 -->
    <ComboboxList side="right" align="end" :side-offset="16" class="w-56 rounded-lg">
      <!-- 菜单头部：用户信息（头像 + 昵称 + 邮箱），排版与触发行一致 -->
      <div class="flex items-center gap-2 px-2 py-1.5">
        <Avatar class="size-8 rounded-lg">
          <AvatarImage v-if="user.avatar" :src="user.avatar" :alt="user.nickname" />
          <AvatarFallback class="rounded-lg bg-accent/80 text-xs font-semibold text-foreground">
            {{ userInitial }}
          </AvatarFallback>
        </Avatar>
        <span class="flex min-w-0 flex-col">
          <span class="truncate text-sm font-semibold text-foreground">{{ user.nickname }}</span>
          <span v-if="user.email" class="truncate text-xs text-muted-foreground">
            {{ user.email }}
          </span>
        </span>
      </div>

      <ComboboxSeparator />

      <!-- 功能项列表：gap-1.5 拉开菜单项行距（默认过于紧凑） -->
      <div class="flex flex-col p-1">
        <template v-for="action in visibleActions" :key="action.key">
          <!-- 退出登录前加分隔线，与上方常规操作区隔开 -->
          <ComboboxSeparator v-if="action.destructive" />
          <!-- data-variant=destructive 统一加在所有项上：
               仅用于关闭基础样式中 hover 时 **:text-accent-foreground 对子元素（图标）的强制染色，
               使图标颜色稳定不随 hover 变化（并非标记该项为破坏性操作） -->
          <!-- 注意：此处不得再绑 @select —— 选中 item 时 reka 会同时触发 item 的 select
               事件与根组件的 update:model-value，两处都绑会导致动作执行两次
               （曾出现退出登录弹两条「已退出登录」toast + 发两次 logout 请求），
               动作统一由根组件的 onComboboxSelect 分发 -->
          <ComboboxItem
            :value="action.key"
            data-variant="destructive"
            class="py-1.5"
            :class="
              action.destructive
                ? 'text-destructive data-highlighted:text-destructive'
                : 'text-foreground data-highlighted:text-foreground'
            "
          >
            <!-- 图标不单独设色，继承 ComboboxItem 的文字颜色（图标与文字恒为同色） -->
            <component :is="action.icon" class="size-3.5" />
            {{ action.label }}
          </ComboboxItem>
        </template>
      </div>
    </ComboboxList>
  </Combobox>

  <!-- 弹窗：修改用户信息（成功后同步本组件展示与 localStorage） -->
  <EditProfileModal
    v-model:visible="editVisible"
    :user-info="user"
    @success="handleProfileUpdated"
  />

  <!-- 弹窗：修改密码（成功后后端已删 token，清理本地并跳登录页） -->
  <ChangePasswordModal v-model:visible="passwordVisible" @success="handlePasswordChanged" />

  <!-- 弹窗：AI 大模型管理（管理员；与顶栏用户菜单、/admin 页共用同一套配置表单） -->
  <AiSettingsModal v-model:visible="aiSettingsVisible" title="AI 大模型管理" />
</template>

<script lang="ts" setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import {
  Combobox,
  ComboboxAnchor,
  ComboboxItem,
  ComboboxList,
  ComboboxSeparator,
  ComboboxTrigger,
} from '@/components/ui/combobox'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  ChevronsUpDown,
  CircleUserRound,
  User,
  KeyRound,
  LogOut,
  Home,
  LayoutDashboard,
  ShieldCheck,
  type LucideIcon,
} from '@lucide/vue'
import { logout, getProfile } from '@/api/modules/user'
import { getUserInfo, isLoggedIn, saveUserInfo, clearAuth } from '@/utils/token'
import type { UserInfo } from '@/api/types'
import EditProfileModal from '@/views/dashboard/components/edit-profile-modal.vue'
import ChangePasswordModal from '@/views/dashboard/components/change-password-modal.vue'
import AiSettingsModal from '@/components/ai-settings/ai-settings-modal.vue'

const router = useRouter()

/* ========== 用户信息状态 ========== */

/**
 * 当前登录用户信息（onMounted 时从本地缓存读取）
 * 仅在 token 有效时展示用户菜单（过期视为未登录，显示登录入口）
 */
const user = ref<UserInfo | null>(null)

/** 头像缺省时的首字符（昵称首字母大写，无则 'U'） */
const userInitial = computed(() => user.value?.nickname?.charAt(0)?.toUpperCase() ?? 'U')

onMounted(() => {
  user.value = isLoggedIn() ? getUserInfo() : null
  // 后台刷新一次 profile：isAdmin 管理员标记只在 profile 接口返回（login 不含），
  // 本地缓存的用户信息可能没有该字段；刷新后合并并同步本地缓存，
  // 保证管理员「AI 大模型管理」入口稳定显示（失败静默，不影响菜单基础功能）
  void refreshProfile()
})

/**
 * 后台刷新当前用户资料（含 isAdmin）
 * 成功后合并进本地 user 状态并写回 localStorage 缓存
 */
async function refreshProfile() {
  if (!isLoggedIn()) return
  try {
    const profile = await getProfile().send()
    user.value = { ...user.value, ...profile }
    saveUserInfo(user.value)
  } catch (error) {
    // 静默失败：profile 刷新失败不影响菜单展示（本地缓存兜底）
    console.error('[NavUser] refresh profile failed:', error)
  }
}

/* ========== Combobox 菜单状态 ========== */

/** 菜单展开状态（受控） */
const open = ref(false)

/**
 * 菜单项动作定义
 * - key：ComboboxItem 的 value（英文标识，仅用于事件回查动作）
 * - label：展示文案
 * - visible：动态显隐（AI 大模型管理仅管理员可见）
 * - destructive：退出登录的红色警示样式
 */
interface MenuAction {
  key: string
  label: string
  icon: LucideIcon
  visible?: () => boolean
  destructive?: boolean
  run: () => void
}

/** 全量菜单项（visible 返回 false 的项不渲染也不参与搜索） */
const menuActions = computed<MenuAction[]>(() => [
  {
    key: 'profile',
    label: '修改用户信息',
    icon: User,
    run: () => (editVisible.value = true),
  },
  {
    key: 'password',
    label: '修改密码',
    icon: KeyRound,
    run: () => (passwordVisible.value = true),
  },
  {
    key: 'home',
    label: '回到首页',
    icon: Home,
    run: () => router.push('/'),
  },
  {
    key: 'dashboard',
    label: '返回工作台',
    icon: LayoutDashboard,
    run: () => router.push('/dashboard'),
  },
  {
    key: 'admin',
    label: 'AI 大模型管理',
    icon: ShieldCheck,
    // isAdmin 由 profile 接口返回，后台刷新后出现
    visible: () => !!user.value?.isAdmin,
    // 点击原地弹出 AI 大模型管理弹窗，不跳转 /admin 页面
    run: () => (aiSettingsVisible.value = true),
  },
  {
    key: 'logout',
    label: '退出登录',
    icon: LogOut,
    destructive: true,
    run: handleLogout,
  },
])

/** 可见菜单项（visible 返回 false 的项不渲染，如非管理员的「AI 大模型管理」） */
const visibleActions = computed(() => menuActions.value.filter((a) => a.visible?.() ?? true))

/**
 * Combobox 选中回调（点击菜单项 / 键盘 Enter 都会触发）
 * model-value 受控恒为空串（不回写），保证同一项可重复选中；
 * 选中后 reka 自动关闭菜单，open watch 会重置搜索词
 */
function onComboboxSelect(value: unknown) {
  const action = menuActions.value.find((a) => a.key === String(value ?? ''))
  action?.run()
}

/* ========== 弹窗与登录态动作 ========== */

/**
 * 弹窗显隐状态
 */
const editVisible = ref(false)
const passwordVisible = ref(false)
/** AI 大模型管理弹窗显隐：管理员点菜单项触发，原地弹窗不跳页 */
const aiSettingsVisible = ref(false)

/**
 * 退出登录（菜单项触发）
 * 调后端 logout 接口（失败不阻塞），清理本地认证信息后跳转登录页
 */
async function handleLogout() {
  try {
    await logout()
  } catch (error) {
    // 接口失败也继续清理本地，保证用户能退出
    console.error('[NavUser] logout:', error)
  }
  clearAuth()
  toast.success('已退出登录')
  router.push('/login')
}

/**
 * 修改用户信息成功回调
 * 同步更新本组件展示与 localStorage
 */
function handleProfileUpdated(updated: UserInfo) {
  user.value = updated
  saveUserInfo(updated)
  editVisible.value = false
  toast.success('资料已更新')
}

/**
 * 修改密码成功回调
 * 后端已删除该用户所有 token，前端清理本地并跳转登录页
 */
function handlePasswordChanged() {
  passwordVisible.value = false
  toast.success('密码修改成功，请重新登录')
  clearAuth()
  router.push('/login')
}
</script>
