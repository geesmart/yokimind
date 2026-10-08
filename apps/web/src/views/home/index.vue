<template>
  <!--
    网站首页（落地页）：
    顶部导航（logo + 登录/注册 或 进入控制台）
    → Hero 区（玻璃 logo + 主副标语 + 行动按钮）
    → 特性区（三张能力卡片）
    → 页脚（品牌素材入口 + 版权）
  -->
  <div class="min-h-screen w-full bg-background flex flex-col">
    <!-- ==================== 顶部导航栏：吸顶 + 毛玻璃 ==================== -->
    <!--    <header-->
    <!--      class="sticky top-0 z-10 w-full border-b border-border/60 bg-background/70 backdrop-blur-md"-->
    <!--    >-->
    <!--      <div class="mx-auto max-w-5xl h-14 px-4 flex items-center justify-end">-->
    <!--        &lt;!&ndash;-->
    <!--          右侧入口按钮：按登录态切换显示-->
    <!--          - 未登录：登录 / 注册（次级 outline 按钮，引导进入鉴权页）-->
    <!--          - 已登录：进入控制台（主按钮，直达 /dashboard）-->
    <!--          注意：as-child 会把 class 合并到 RouterLink 渲染出的 <a> 上，而 arco.css normalize-->
    <!--          有未分层规则 a { background-color: transparent }，会压过 @layer 里的 bg-* 工具类，-->
    <!--          因此这里的背景类（含 hover 背景）必须加 ! 强制 important，否则背景透明/无 hover 反馈。-->
    <!--        &ndash;&gt;-->
    <!--        <nav class="flex items-center gap-2">-->
    <!--          &lt;!&ndash; 未登录：登录 / 注册（次级按钮：透明底 + 边框，hover 需 ! 修复） &ndash;&gt;-->
    <!--          <template v-if="!loggedIn">-->
    <!--            <Button as-child variant="outline" class="hover:!bg-muted">-->
    <!--              <RouterLink to="/login">-->
    <!--                <LogIn class="size-4" />-->
    <!--                登录-->
    <!--              </RouterLink>-->
    <!--            </Button>-->
    <!--            <Button as-child variant="outline" class="hover:!bg-muted">-->
    <!--              <RouterLink to="/register">-->
    <!--                <UserPlus class="size-4" />-->
    <!--                注册-->
    <!--              </RouterLink>-->
    <!--            </Button>-->
    <!--          </template>-->
    <!--          &lt;!&ndash; 已登录：进入控制台（主按钮：品牌蓝填充） &ndash;&gt;-->
    <!--          <template v-else>-->
    <!--            <Button as-child class="!bg-blue-500 hover:!bg-blue-500/90">-->
    <!--              <RouterLink to="/dashboard">-->
    <!--                <LayoutDashboard class="size-4" />-->
    <!--                进入控制台-->
    <!--              </RouterLink>-->
    <!--            </Button>-->
    <!--          </template>-->
    <!--        </nav>-->
    <!--      </div>-->
    <!--    </header>-->

    <!-- ==================== 主体内容区 ==================== -->
    <main class="flex-1">
      <!-- Hero 区：居中展示 logo、标语与行动按钮 -->
      <section class="mx-auto max-w-5xl px-4 pt-20 pb-16 flex flex-col items-center text-center">
        <!--
          Hero 品牌标识：与顶部导航同款的「应用图标 + YOKi + 文档徽标」组合，整体放大展示
          （原彩色玻璃大 logo 暂时隐藏，需要时恢复 <LogoGlass :size="72" />）
        -->
        <div class="mb-8 flex items-center gap-4">
          <img src="/logo-yokimind.png" alt="YOKi 文档" class="w-100" />
        </div>

        <!-- 主标语：渐进字号，小屏 3xl / 大屏 5xl -->
        <h1
          class="text-5xl sm:text-4xl lg:text-6xl font-bold tracking-tight text-foreground text-balance"
        >
          开源的企业 AI 知识协作工具
        </h1>

        <!-- 副标语：弱化文案，强调产品定位与价值 -->
        <p class="mt-2 max-w-xl text-base sm:text-lg text-muted-foreground text-pretty">
          面向初创公司、企业和智能体的自托管AI知识库
        </p>

        <!-- 行动按钮组：按登录态切换主 CTA -->
        <div class="mt-8 flex items-center justify-center gap-3">
          <template v-if="!loggedIn">
            <!-- 主 CTA：免费注册（默认 variant 黑色填充 + hover，需 ! 修复） -->
            <Button as-child size="lg" class="!bg-primary hover:!bg-primary/80">
              <RouterLink to="/register">
                <Sparkles class="size-4" />
                免费开始使用
              </RouterLink>
            </Button>
            <!-- 次 CTA：已有账号去登录（outline：hover 需 ! 修复） -->
            <Button as-child variant="outline" size="lg" class="hover:!bg-muted">
              <RouterLink to="/login">登录账号</RouterLink>
            </Button>
          </template>
          <!-- 已登录：主 CTA 变为进入控制台 -->
          <template v-else>
            <Button as-child size="lg" class="!bg-primary hover:!bg-primary/80">
              <RouterLink to="/dashboard">
                <LayoutDashboard class="size-4" />
                进入控制台
              </RouterLink>
            </Button>
          </template>
        </div>
      </section>

      <!-- 特性区：三张能力卡片，小屏纵向堆叠 / 大屏三列 -->
      <!--      <section class="mx-auto max-w-5xl px-4 pb-20">-->
      <!--        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">-->
      <!--          &lt;!&ndash; 特性卡：AI 驱动 &ndash;&gt;-->
      <!--          <div-->
      <!--            class="rounded-2xl border border-border bg-card p-6 text-center sm:text-left transition-colors hover:border-primary/40"-->
      <!--          >-->
      <!--            <div-->
      <!--              class="mx-auto sm:mx-0 mb-4 flex size-10 items-center justify-center rounded-xl"-->
      <!--              :style="{ background: '#EDE9FE' }"-->
      <!--            >-->
      <!--              <Sparkles class="size-5" :style="{ color: '#7C3AED' }" />-->
      <!--            </div>-->
      <!--            <h3 class="font-semibold text-foreground">AI 驱动</h3>-->
      <!--            <p class="mt-1.5 text-sm text-muted-foreground">-->
      <!--              基于知识库内容的智能问答，让检索与创作一步到位-->
      <!--            </p>-->
      <!--          </div>-->

      <!--          &lt;!&ndash; 特性卡：实时协作 &ndash;&gt;-->
      <!--          <div-->
      <!--            class="rounded-2xl border border-border bg-card p-6 text-center sm:text-left transition-colors hover:border-primary/40"-->
      <!--          >-->
      <!--            <div-->
      <!--              class="mx-auto sm:mx-0 mb-4 flex size-10 items-center justify-center rounded-xl"-->
      <!--              :style="{ background: '#DBEAFE' }"-->
      <!--            >-->
      <!--              <Users class="size-5" :style="{ color: '#2563EB' }" />-->
      <!--            </div>-->
      <!--            <h3 class="font-semibold text-foreground">轻松分享</h3>-->
      <!--            <p class="mt-1.5 text-sm text-muted-foreground">-->
      <!--              单页或整库一键分享，支持密码保护，访客免注册即可阅读-->
      <!--            </p>-->
      <!--          </div>-->

      <!--          &lt;!&ndash; 特性卡：开源免费 &ndash;&gt;-->
      <!--          <div-->
      <!--            class="rounded-2xl border border-border bg-card p-6 text-center sm:text-left transition-colors hover:border-primary/40"-->
      <!--          >-->
      <!--            <div-->
      <!--              class="mx-auto sm:mx-0 mb-4 flex size-10 items-center justify-center rounded-xl"-->
      <!--              :style="{ background: '#DCFCE7' }"-->
      <!--            >-->
      <!--              <Code2 class="size-5" :style="{ color: '#16A34A' }" />-->
      <!--            </div>-->
      <!--            <h3 class="font-semibold text-foreground">开源免费</h3>-->
      <!--            <p class="mt-1.5 text-sm text-muted-foreground">-->
      <!--              代码完全开源，可自托管部署，数据始终掌握在自己手中-->
      <!--            </p>-->
      <!--          </div>-->
      <!--        </div>-->
      <!--      </section>-->
    </main>

    <!-- ==================== 页脚：品牌素材入口 + 版权信息 ==================== -->
    <footer class="w-full border-t border-border/60 py-6">
      <div
        class="mx-auto max-w-5xl px-4 flex items-center justify-center gap-4 text-xs text-muted-foreground"
      >
        <span>© 2026 YOKi 文档</span>
        <span class="text-border">|</span>
        <RouterLink
          to="/brand"
          class="inline-flex cursor-pointer items-center gap-1 hover:text-foreground transition-colors"
        >
          <Palette class="size-3.5" />
          品牌素材
        </RouterLink>
      </div>
    </footer>
  </div>
</template>

<script lang="ts" setup>
import { RouterLink } from 'vue-router'
import { computed } from 'vue'
import { Code2, LayoutDashboard, LogIn, Palette, Sparkles, UserPlus, Users } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import LogoWordmark from '@/components/brand-logo/LogoWordmark.vue'
import { isLoggedIn } from '@/utils/token'

/**
 * 登录态：响应式派生自 isLoggedIn()
 * 落地页作为入口页，用户从登录/注册页跳回时为全新页面加载，
 * computed 在组件挂载时读取一次 localStorage 即可正确反映当前状态。
 */
const loggedIn = computed(() => isLoggedIn())
</script>

<style scoped>
/*
 * 品牌字体（系统已安装，直接引用字体族名）：
 * - YOKi：Comic Neue（手写圆润风，缺省时回退 Comic Sans MS）
 * - 文档：霞鹜文楷（LXGW WenKai），中英文字体族名都写上以兼容不同系统的安装命名
 */
.font-comic-neue {
  font-family: 'Comic Neue', 'Comic Sans MS', cursive;
  font-weight: 700;
  letter-spacing: 0.02em;
}

.font-wenkai {
  font-family: 'LXGW WenKai', '霞鹜文楷', 'PingFang SC', serif;
}
</style>
