<template>
  <!--
    公共用户菜单组件（顶栏右侧头像下拉）
    - 已登录：仅显示头像圆标（不显示昵称，昵称/邮箱在菜单头部展示），点击弹出下拉菜单
    - 未登录：显示登录用户图标，点击跳转登录页
    菜单项：修改用户信息 / 修改密码 / 返回工作台 / 回到首页 / 智能体接入 / AI 大模型管理（仅管理员，弹窗） / 退出登录
    无 props / 无 emits，wiki 顶栏与 dashboard 顶栏均可零配置复用
  -->
  <!-- 未登录：登录用户图标，点击去登录页 -->
  <Button
    v-if="!user"
    variant="ghost"
    size="icon"
    class="h-7 w-7 shrink-0"
    aria-label="去登录"
    title="去登录"
    @click="router.push('/login')"
  >
    <CircleUserRound :size="18" />
  </Button>
  <!-- 已登录：头像触发器 + 下拉菜单 -->
  <DropdownMenu v-else>
    <DropdownMenuTrigger as-child>
      <button
        class="flex items-center justify-center w-7 h-7 rounded-full bg-accent/80 text-foreground text-xs font-semibold overflow-hidden shrink-0 cursor-pointer hover:ring-2 hover:ring-accent transition-all"
        aria-label="用户菜单"
        :title="user.email"
      >
        <img
          v-if="user.avatar"
          :src="user.avatar"
          :alt="user.nickname"
          class="w-full h-full object-cover"
        />
        <template v-else>{{ userInitial }}</template>
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" class="w-[200px]">
      <!-- 用户信息头部：昵称 + 邮箱 -->
      <div class="px-3 py-2 border-b border-border mb-2">
        <div class="text-xs font-medium text-foreground truncate">
          {{ user.nickname }}
        </div>
        <div v-if="user.email" class="text-xs text-muted-foreground/70 truncate">
          {{ user.email }}
        </div>
      </div>

      <!-- 修改用户信息：打开资料编辑弹窗 -->
      <DropdownMenuItem @click="editVisible = true">
        <User class="size-3.5 text-muted-foreground mr-1" />
        修改用户信息
      </DropdownMenuItem>

      <!-- 修改密码：打开改密弹窗 -->
      <DropdownMenuItem @click="passwordVisible = true">
        <Lock class="size-3.5 text-muted-foreground mr-1" />
        修改密码
      </DropdownMenuItem>

      <DropdownMenuSeparator />

      <!-- 返回工作台：跳转知识库列表页（dashboard 页内已在工作台，隐藏此项） -->
      <DropdownMenuItem v-if="showWorkspaceEntry" @click="router.push('/dashboard')">
        <LayoutDashboard class="size-3.5 text-muted-foreground mr-1" />
        返回工作台
      </DropdownMenuItem>

      <!-- 回到首页 -->
      <DropdownMenuItem @click="router.push('/')">
        <Home class="size-3.5 text-muted-foreground mr-1" />
        回到首页
      </DropdownMenuItem>

      <!-- 智能体接入（所有登录用户）：跳转 /settings/agents 管理访问令牌与 MCP / CLI / Skills 指引 -->
      <DropdownMenuItem @click="router.push('/settings/agents')">
        <Bot class="size-3.5 text-muted-foreground mr-1" />
        智能体接入
      </DropdownMenuItem>

      <!-- AI 大模型管理（仅管理员显示）：isAdmin 由 profile 接口返回；点击原地弹窗配置，不跳页面 -->
      <DropdownMenuItem v-if="user.isAdmin" @click="aiSettingsVisible = true">
        <ShieldCheck class="size-3.5 text-muted-foreground mr-1" />
        AI 大模型管理
      </DropdownMenuItem>

      <DropdownMenuSeparator />

      <!-- 退出登录：调后端接口（失败不阻塞），清理本地认证后跳登录页 -->
      <DropdownMenuItem class="text-destructive" @click="handleLogout">
        <LogOut class="size-3.5 mr-1" />
        退出登录
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>

  <!-- 弹窗：修改用户信息（成功后同步本组件展示与 localStorage） -->
  <EditProfileModal v-model:visible="editVisible" :user-info="user" @success="handleProfileUpdated" />

  <!-- 弹窗：修改密码（成功后后端已删 token，清理本地并跳登录页） -->
  <ChangePasswordModal v-model:visible="passwordVisible" @success="handlePasswordChanged" />

  <!-- 弹窗：AI 大模型管理（管理员；与 /admin 页共用同一套配置表单） -->
  <AiSettingsModal v-model:visible="aiSettingsVisible" title="AI 大模型管理" />
</template>

<script lang="ts" setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import {
  User,
  Lock,
  LogOut,
  Home,
  LayoutDashboard,
  CircleUserRound,
  ShieldCheck,
  Bot,
} from '@lucide/vue'
import { logout, getProfile } from '@/api/modules/user'
import { getUserInfo, isLoggedIn, saveUserInfo, clearAuth } from '@/utils/token'
import type { UserInfo } from '@/api/types'
import EditProfileModal from '@/views/dashboard/components/edit-profile-modal.vue'
import ChangePasswordModal from '@/views/dashboard/components/change-password-modal.vue'
import AiSettingsModal from '@/components/ai-settings/ai-settings-modal.vue'

/**
 * 组件 Props
 */
const props = withDefaults(
  defineProps<{
    /** 是否显示「返回工作台」菜单项（默认显示；dashboard 页内已在工作台，传 false 隐藏） */
    showWorkspaceEntry?: boolean
  }>(),
  { showWorkspaceEntry: true },
)

const router = useRouter()

/**
 * 当前登录用户信息（onMounted 时从本地缓存读取）
 * 仅在 token 有效时展示用户菜单（过期视为未登录，显示登录图标）
 */
const user = ref<UserInfo | null>(null)

/** 头像缺省时的首字符（昵称首字母大写，无则 'U'） */
const userInitial = computed(() => user.value?.nickname?.charAt(0)?.toUpperCase() ?? 'U')

/**
 * 弹窗显隐状态
 */
const editVisible = ref(false)
const passwordVisible = ref(false)
/** AI 大模型管理弹窗显隐：管理员点菜单项触发，原地弹窗不跳页 */
const aiSettingsVisible = ref(false)

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
    console.error('[UserMenu] refresh profile failed:', error)
  }
}

/**
 * 退出登录（下拉菜单项触发）
 * 调后端 logout 接口（失败不阻塞），清理本地认证信息后跳转登录页
 */
async function handleLogout() {
  try {
    await logout()
  } catch (error) {
    // 接口失败也继续清理本地，保证用户能退出
    console.error('[Logout]', error)
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
