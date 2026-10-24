<template>
  <!--
    Dashboard 主内容区：纯知识库列表页
    结构：工具栏（Tabs + 搜索 + 新建 + 视图切换）→ 卡片视图 / 列表视图
    - 已移除：问候语、快捷操作、最近访问、动态（2026-09 重构）
    - 视图模式持久化 localStorage（yokimind.wikiViewMode）
    - 设为常用 = 本地置顶（localStorage yokimind.pinnedWikis），不落库
  -->
  <div class="w-full h-full">
    <!-- flex 纵向布局：回收站面板 mt-auto 贴住页面底部 -->
    <div class="max-w-[1200px] mx-auto w-full px-4 sm:px-6 py-6 h-full flex flex-col">
      <!-- ==================== AI 未配置提示横幅 ==================== -->
      <!-- 仅 chat 服务未就绪时显示（aiChatReady=false）；null=检测中/失败不显示，避免闪烁误报。
           整条横幅可点击打开 AI 大模型配置弹窗；不可手动关闭，配置成功前持续提示 -->
      <div
        v-if="aiChatReady === false"
        class="flex items-center gap-3 mb-5 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 cursor-pointer transition-colors hover:bg-primary/10"
        @click="aiSettingsVisible = true"
      >
        <!-- 左侧图标：AI 语义 -->
        <Sparkles :size="16" class="text-primary shrink-0" />
        <!-- 文案：标题 + 说明 -->
        <div class="flex-1 min-w-0">
          <p class="text-sm font-medium text-foreground">还没有配置 AI 大模型</p>
          <p class="text-xs text-muted-foreground mt-0.5">
            配置服务商地址与 API Key 后，即可使用 AI 写作、知识库问答与智能检索
          </p>
        </div>
        <!-- 配置按钮：与整条横幅同动作（点击冒泡统一打开弹窗） -->
        <Button type="button" size="sm" class="shrink-0 cursor-pointer">立即配置</Button>
      </div>

      <!-- 页面标题 -->
      <h2 class="text-xl font-semibold text-foreground mb-4">知识库</h2>

      <!-- ==================== 工具栏 ==================== -->
      <div class="flex items-center justify-between gap-3 mb-6 flex-wrap">
        <!-- 左侧：范围切换（我个人的 / 邀请协作的） -->
        <Tabs v-model:model-value="activeTab">
          <TabsList>
            <TabsTrigger value="mine">我个人的</TabsTrigger>
            <TabsTrigger value="shared">邀请协作的</TabsTrigger>
          </TabsList>
        </Tabs>

        <!-- 右侧：搜索 / 新建 / 视图切换 -->
        <div class="flex items-center gap-2">
          <!-- 搜索知识库（前端过滤 name/description） -->
          <InputGroup class="h-9 w-52">
            <InputGroupAddon align="inline-start">
              <Search />
            </InputGroupAddon>
            <InputGroupInput
              v-model="keyword"
              type="text"
              placeholder="搜索知识库"
              class="text-sm"
            />
          </InputGroup>

          <!-- 新建知识库 -->
          <Button type="button" size="lg" @click="openCreate()">
            <Plus :size="16" />
            <span>新建知识库</span>
          </Button>

          <!-- 视图切换：卡片网格 / 列表表格 -->
          <div class="flex items-center rounded-lg border border-border p-0.5 gap-0.5">
            <button
              type="button"
              title="卡片视图"
              class="inline-flex items-center justify-center size-7 rounded-md transition-colors"
              :class="
                viewMode === 'grid'
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              "
              @click="setViewMode('grid')"
            >
              <LayoutGrid :size="16" />
            </button>
            <button
              type="button"
              title="列表视图"
              class="inline-flex items-center justify-center size-7 rounded-md transition-colors"
              :class="
                viewMode === 'list'
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              "
              @click="setViewMode('list')"
            >
              <List :size="16" />
            </button>
          </div>
        </div>
      </div>

      <!-- ==================== 邀请协作的（占位，后端暂无协作概念） ==================== -->
      <div v-if="activeTab === 'shared'" class="py-16 text-center text-sm text-muted-foreground/70">
        暂无协作知识库
      </div>

      <!-- ==================== 我个人的 ==================== -->
      <template v-else>
        <!-- 加载中 -->
        <div v-if="wikiLoading" class="py-16 text-center text-sm text-muted-foreground">
          加载中...
        </div>

        <template v-else>
          <!-- 空状态：无知识库 / 搜索无结果 -->
          <div
            v-if="sortedWikis.length === 0"
            class="py-16 text-center text-sm text-muted-foreground/70"
          >
            {{ keyword ? '未找到匹配的知识库' : '暂无知识库，点击右上角「新建知识库」创建' }}
          </div>

          <!-- ========== 卡片视图 ========== -->
          <section v-else-if="viewMode === 'grid'">
            <!-- 响应式网格：1 → 2 → 3 列 -->
            <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              <div
                v-for="kb in sortedWikis"
                :key="kb.id"
                class="group relative flex flex-col gap-2 p-4 bg-background border border-border rounded-xl hover:shadow-sm transition-shadow min-h-[120px]"
              >
                <!-- 首行：图标 + 名称（仅这两者可点击跳转）+ 分享状态 + 「...」菜单 -->
                <div class="flex items-center gap-2.5">
                  <!-- 图标 + 名称：点击跳转知识库 -->
                  <span
                    class="flex items-center gap-2.5 min-w-0 flex-1 cursor-pointer rounded-md"
                    title="打开知识库"
                    @click="goToWiki(kb.id)"
                  >
                    <span
                      class="inline-flex items-center justify-center w-8 h-8 rounded-lg shrink-0"
                      :style="{ background: kb.iconBg }"
                    >
                      <WikiIcon :icon="kb.icon" :color="kb.color" :size="18" />
                    </span>
                    <span
                      class="text-base font-semibold text-foreground truncate hover:underline underline-offset-4"
                      >{{ kb.title }}</span
                    >
                  </span>
                  <!-- 状态区：RAG 状态按钮 + 分享态 + 发布态并排（分享/发布数据源分表、可同时为 true）：
                       ⓪ RAG 状态按钮（绿点 + 进度文本）：灰=未开启 / 蓝=索引中 / 红=索引失败 / 绿=正常，
                              文本显示索引进度 RAG {done}/{total}（索引中随 3s 轮询实时推进），
                          点击打开编辑知识库弹窗（AI 索引开关 / 重建索引）；
                       ① 分享态（wiki_shares 库级行 share_status）：公开 → Globe 地球图标（已分享公开），
                          私密 → Lock 图标；两种图标点击均打开分享设置弹窗进行设置；
                       ② 发布态（wiki_publish.enabled）：已发布 → Send 图标（点击跳转预览页），
                          未发布不显示；每个图标带 Tooltip 悬浮提示 -->
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger as-child>
                        <!-- RAG 状态按钮：圆点颜色由 ragDotClass 按四态映射，文本由 ragBadgeText 显示索引进度（done/total），点击打开编辑知识库弹窗 -->
                        <button
                          type="button"
                          class="inline-flex items-center gap-1 h-5 px-1.5 rounded-md border border-border text-[11px] leading-none text-muted-foreground shrink-0 cursor-pointer hover:text-foreground transition-colors"
                          @click.stop="openSettings(kb)"
                        >
                          <span
                            class="inline-block size-1.5 rounded-full"
                            :class="ragDotClass(kb)"
                            aria-hidden="true"
                          />
                          <span class="text-[10px] font-semibold ml-1 tabular-nums">{{ ragBadgeText(kb) }}</span>
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top" class="text-xs px-2 py-1">
                        <span :class="ragTooltipTextClass(kb)">{{ ragTooltipText(kb) }}</span>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger as-child>
                        <!-- 分享态图标按钮：公开 → Globe / 私密 → Lock，点击均打开分享设置弹窗 -->
                        <button
                          type="button"
                          class="inline-flex items-center justify-center size-5 rounded text-muted-foreground/60 hover:text-foreground transition-colors shrink-0 cursor-pointer"
                          @click.stop="openShareDialog(kb.id)"
                        >
                          <Globe v-if="kb.isShared" :size="14" />
                          <Lock v-else :size="14" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top" class="text-xs px-2 py-1">
                        {{ kb.isShared ? '已分享公开，点击管理分享' : '私密，点击设置分享' }}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  <!-- 发布态（wiki_publish.enabled）：已发布 → Send 图标，点击跳转预览页
                       （签发短时效预览令牌后新标签打开 /w/{wikiId}/preview?t={token}），未发布不显示 -->
                  <TooltipProvider v-if="kb.isPublished">
                    <Tooltip>
                      <TooltipTrigger as-child>
                        <button
                          type="button"
                          title="已发布，点击打开预览"
                          class="inline-flex items-center justify-center size-5 rounded text-muted-foreground/60 hover:text-foreground transition-colors shrink-0 cursor-pointer"
                          @click.stop="handlePublishPreview(kb.id)"
                        >
                          <Send :size="14" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top" class="text-xs px-2 py-1">
                        已发布，点击打开预览
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  <!-- 「...」操作菜单：hover 或菜单打开期间可见 -->
                  <DropdownMenu
                    :open="openMenuId === kb.id"
                    @update:open="(v: boolean) => (openMenuId = v ? kb.id : null)"
                  >
                    <DropdownMenuTrigger as-child>
                      <button
                        type="button"
                        title="更多操作"
                        class="inline-flex items-center justify-center size-7 rounded-md text-muted-foreground/60 hover:text-foreground hover:bg-accent transition-colors shrink-0"
                        :class="openMenuId === kb.id ? 'visible' : 'invisible group-hover:visible'"
                        @click.stop
                      >
                        <MoreHorizontal :size="16" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent class="w-44" align="end" @click.stop>
                      <!-- 暂时隐藏：设为常用 / 取消常用（本地置顶）；移动到分组（本期占位） -->
                      <DropdownMenuItem @click.stop="togglePin(kb.id)">
                        <PinOff v-if="kb.isPinned" class="size-3.5 text-muted-foreground mr-1" />
                        <Pin v-else class="size-3.5 text-muted-foreground mr-1" />
                        {{ kb.isPinned ? '取消常用' : '设为常用' }}
                      </DropdownMenuItem>
                      <!-- <DropdownMenuItem @click.stop="toastSoon('移动到分组')">
                        <FolderOutput class="size-3.5 text-muted-foreground mr-1" />
                        移动到分组
                      </DropdownMenuItem> -->

                      <DropdownMenuSeparator />

                      <DropdownMenuItem @click.stop="openSettings(kb)">
                        <Settings2 class="size-3.5 text-muted-foreground mr-1" />
                        编辑
                      </DropdownMenuItem>

                      <!-- 分享：复用 share-dialog（wiki-only 模式） -->
                      <DropdownMenuItem @click.stop="openShareDialog(kb.id)">
                        <Share2 class="size-3.5 text-muted-foreground mr-1" />
                        分享
                      </DropdownMenuItem>

                      <!-- 预览入口（文案随发布状态切换）：已发布 → 「已发布」（点击仍打开预览）；
                           未发布 → 「发布预览」。签发短时效预览令牌后新标签打开 pages 站预览页 -->
                      <DropdownMenuItem @click.stop="handlePublishPreview(kb.id)">
                        <Send class="size-3.5 text-muted-foreground mr-1" />
                        {{ kb.isPublished ? '已发布' : '发布预览' }}
                      </DropdownMenuItem>

                      <DropdownMenuSeparator />

                      <!-- 删除：二次确认后调用 deleteWiki 接口（variant=destructive：文字+图标红色） -->
                      <DropdownMenuItem variant="destructive" @click.stop="openDelete(kb)">
                        <Trash2 class="size-3.5 mr-1" />
                        删除
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                <!-- 描述：有值才显示 -->
                <p v-if="kb.desc" class="text-xs text-muted-foreground/80 line-clamp-2 pl-[42px]">
                  {{ kb.desc }}
                </p>
              </div>
            </div>
          </section>

          <!-- ========== 列表视图 ========== -->
          <section v-else aria-labelledby="kb-list-title">
            <Table>
              <TableHeader>
                <TableRow class="hover:bg-transparent">
                  <!-- 名称列：点击切换排序 -->
                  <TableHead class="w-[40%]">
                    <button
                      type="button"
                      class="inline-flex items-center gap-1 text-sm font-normal transition-colors hover:text-foreground"
                      :class="sortKey === 'name' ? 'text-foreground' : ''"
                      @click="toggleSort('name')"
                    >
                      名称
                      <ArrowUpDown :size="13" class="text-muted-foreground" />
                    </button>
                  </TableHead>
                  <!-- 简介列 -->
                  <TableHead class="text-sm font-normal">简介</TableHead>
                  <!-- 更新时间列：点击切换排序（默认按更新时间倒序） -->
                  <TableHead class="w-[160px]">
                    <button
                      type="button"
                      class="inline-flex items-center gap-1 text-sm font-normal transition-colors hover:text-foreground"
                      :class="sortKey === 'updatedAt' ? 'text-primary' : ''"
                      @click="toggleSort('updatedAt')"
                    >
                      更新时间
                      <!-- 当前排序列显示方向箭头，否则显示双向箭头 -->
                      <ArrowDown
                        v-if="sortKey === 'updatedAt' && sortOrder === 'desc'"
                        :size="13"
                      />
                      <ArrowUp
                        v-else-if="sortKey === 'updatedAt' && sortOrder === 'asc'"
                        :size="13"
                      />
                      <ArrowUp v-else-if="sortKey === 'name' && sortOrder === 'asc'" :size="13" />
                      <ArrowDown
                        v-else-if="sortKey === 'name' && sortOrder === 'desc'"
                        :size="13"
                      />
                      <ArrowUpDown v-else :size="13" class="text-muted-foreground" />
                    </button>
                  </TableHead>
                  <!-- 置顶操作列 -->
                  <TableHead class="w-[60px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow v-for="kb in sortedWikis" :key="kb.id" class="group">
                  <!-- 名称：图标 + 名称（点击跳转）+ 分享状态图标 -->
                  <TableCell class="py-4">
                    <div class="flex items-center gap-2.5 min-w-0">
                      <!-- 图标 + 名称：点击跳转知识库 -->
                      <div
                        class="flex items-center gap-2.5 min-w-0 cursor-pointer w-fit"
                        title="打开知识库"
                        @click="goToWiki(kb.id)"
                      >
                        <span
                          class="inline-flex items-center justify-center w-8 h-8 rounded-md shrink-0"
                          :style="{ background: kb.iconBg }"
                        >
                          <WikiIcon :icon="kb.icon" :color="kb.color" :size="16" />
                        </span>
                        <span
                          class="text-sm font-medium text-foreground truncate hover:underline underline-offset-4"
                          >{{ kb.title }}</span
                        >
                      </div>
                      <!-- 状态区：RAG 状态按钮 + 分享态 + 发布态并排（分享/发布数据源分表、可同时为 true）：
                           ⓪ RAG 状态按钮（绿点 + 进度文本）：灰=未开启 / 蓝=索引中 / 红=索引失败 / 绿=正常，
                              文本显示索引进度 RAG {done}/{total}（索引中随 3s 轮询实时推进），
                              点击打开编辑知识库弹窗（AI 索引开关 / 重建索引）；
                           ① 分享态（wiki_shares 库级行 share_status）：公开 → Globe 地球图标（已分享公开），
                              私密 → Lock 图标；两种图标点击均打开分享设置弹窗进行设置；
                           ② 发布态（wiki_publish.enabled）：已发布 → Send 图标（点击跳转预览页），
                              未发布不显示；每个图标带 Tooltip 悬浮提示 -->
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger as-child>
                            <!-- RAG 状态按钮：圆点颜色由 ragDotClass 按四态映射，文本由 ragBadgeText 显示索引进度（done/total），点击打开编辑知识库弹窗 -->
                            <button
                              type="button"
                              class="inline-flex items-center gap-1 h-5 px-1.5 rounded-md border border-border text-[11px] leading-none text-muted-foreground shrink-0 cursor-pointer hover:text-foreground transition-colors"
                              @click.stop="openSettings(kb)"
                            >
                              <span
                                class="inline-block size-1.5 rounded-full"
                                :class="ragDotClass(kb)"
                                aria-hidden="true"
                              />
                              <span class="text-[10px] font-semibold ml-1 tabular-nums">{{ ragBadgeText(kb) }}</span>
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="top" class="text-xs px-2 py-1">
                            <span :class="ragTooltipTextClass(kb)">{{ ragTooltipText(kb) }}</span>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger as-child>
                            <!-- 分享态图标按钮：公开 → Globe / 私密 → Lock，点击均打开分享设置弹窗 -->
                            <button
                              type="button"
                              class="inline-flex items-center justify-center size-5 rounded text-muted-foreground/60 hover:text-foreground transition-colors shrink-0 cursor-pointer"
                              @click.stop="openShareDialog(kb.id)"
                            >
                              <Globe v-if="kb.isShared" :size="14" />
                              <Lock v-else :size="14" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="top" class="text-xs px-2 py-1">
                            {{ kb.isShared ? '已分享公开，点击管理分享' : '私密，点击设置分享' }}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                      <!-- 发布态（wiki_publish.enabled）：已发布 → Send 图标，点击跳转预览页
                           （签发短时效预览令牌后新标签打开 /w/{wikiId}/preview?t={token}），未发布不显示 -->
                      <TooltipProvider v-if="kb.isPublished">
                        <Tooltip>
                          <TooltipTrigger as-child>
                            <button
                              type="button"
                              title="已发布，点击打开预览"
                              class="inline-flex items-center justify-center size-5 rounded text-muted-foreground/60 hover:text-foreground transition-colors shrink-0 cursor-pointer"
                              @click.stop="handlePublishPreview(kb.id)"
                            >
                              <Send :size="14" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="top" class="text-xs px-2 py-1">
                            已发布，点击打开预览
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                  </TableCell>
                  <!-- 简介 -->
                  <TableCell class="text-sm text-muted-foreground truncate max-w-0">
                    {{ kb.desc || '' }}
                  </TableCell>
                  <!-- 更新时间 -->
                  <TableCell class="text-sm text-muted-foreground tabular-nums">
                    {{ kb.updatedLabel }}
                  </TableCell>
                  <!-- 行尾操作：置顶图钉 + 「...」菜单（与卡片菜单一致） -->
                  <TableCell @click.stop>
                    <div class="flex items-center gap-1">
                      <!-- 置顶图钉：已置顶常显，未置顶 hover 显示 -->
                      <button
                        type="button"
                        :title="kb.isPinned ? '取消常用' : '设为常用'"
                        class="inline-flex items-center justify-center size-7 rounded-md transition-colors"
                        :class="
                          kb.isPinned
                            ? 'text-primary'
                            : 'text-muted-foreground/50 opacity-0 hover:opacity-100 hover:text-foreground group-hover:opacity-100'
                        "
                        @click="togglePin(kb.id)"
                      >
                        <Pin v-if="kb.isPinned" :size="15" />
                        <PinOff v-else :size="15" />
                      </button>

                      <!-- 「...」操作菜单：hover 或菜单打开期间可见（同卡片菜单） -->
                      <DropdownMenu
                        :open="openMenuId === kb.id"
                        @update:open="(v: boolean) => (openMenuId = v ? kb.id : null)"
                      >
                        <DropdownMenuTrigger as-child>
                          <button
                            type="button"
                            title="更多操作"
                            class="inline-flex items-center justify-center size-7 rounded-md text-muted-foreground/60 hover:text-foreground hover:bg-accent transition-colors"
                            :class="
                              openMenuId === kb.id ? 'visible' : 'invisible group-hover:visible'
                            "
                          >
                            <MoreHorizontal :size="16" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent class="w-44" align="end">
                          <!-- 暂时隐藏：设为常用 / 取消常用（本地置顶）；移动到分组（本期占位） -->
                          <!-- <DropdownMenuItem @click="togglePin(kb.id)">
                            <PinOff
                              v-if="kb.isPinned"
                              class="size-3.5 text-muted-foreground mr-1"
                            />
                            <Pin v-else class="size-3.5 text-muted-foreground mr-1" />
                            {{ kb.isPinned ? '取消常用' : '设为常用' }}
                          </DropdownMenuItem> -->
                          <!-- <DropdownMenuItem @click="toastSoon('移动到分组')">
                            <FolderOutput class="size-3.5 text-muted-foreground mr-1" />
                            移动到分组
                          </DropdownMenuItem> -->

                          <DropdownMenuSeparator />

                          <!-- 分享：复用 share-dialog（wiki-only 模式） -->
                          <DropdownMenuItem @click="openShareDialog(kb.id)">
                            <Share2 class="size-3.5 text-muted-foreground mr-1" />
                            分享
                          </DropdownMenuItem>
                          <!-- 重命名：复用 create-wiki-modal 编辑模式 -->
                          <DropdownMenuItem @click="openRename(kb)">
                            <SquarePen class="size-3.5 text-muted-foreground mr-1" />
                            重命名
                          </DropdownMenuItem>
                          <!-- 更多设置：与编辑器左侧栏「知识库设置」一致，打开 create-wiki-modal 编辑模式弹窗 -->
                          <DropdownMenuItem @click="openSettings(kb)">
                            <Settings2 class="size-3.5 text-muted-foreground mr-1" />
                            更多设置
                          </DropdownMenuItem>
                          <!-- 预览入口（文案随发布状态切换）：已发布 → 「已发布」（点击仍打开预览）；
                               未发布 → 「发布预览」。签发短时效预览令牌后新标签打开 pages 站预览页 -->
                          <DropdownMenuItem @click="handlePublishPreview(kb.id)">
                            <Play class="size-3.5 text-muted-foreground mr-1" />
                            {{ kb.isPublished ? '已发布' : '发布预览' }}
                          </DropdownMenuItem>

                          <DropdownMenuSeparator />

                          <!-- 删除：二次确认后调用 deleteWiki 接口（variant=destructive：文字+图标红色） -->
                          <DropdownMenuItem variant="destructive" @click="openDelete(kb)">
                            <Trash2 class="size-3.5 mr-1" />
                            删除
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </section>
        </template>

        <!-- ==================== 回收站（软删除知识库，默认折叠，展开时懒加载列表） ==================== -->
        <!-- 折叠头与「知识库」分区标题同款设计：text-xl font-semibold，点击整行切换展开；mt-auto 贴住页面底部 -->
        <Collapsible v-model:open="trashExpanded" class="mt-auto pt-10">
          <CollapsibleTrigger class="group flex w-full items-center gap-2.5 mb-4 text-left">
            <h2 class="text-xl font-semibold text-foreground">回收站</h2>
            <!-- 数量徽标：仅在已加载且非空时显示 -->
            <span v-if="trashItems.length > 0" class="text-xs text-muted-foreground/70 mt-1">
              {{ trashItems.length }} 个知识库
            </span>
          </CollapsibleTrigger>

          <CollapsibleContent class="mt-4">
            <!-- 展开内容：加载中 / 空状态 / 回收站列表 -->
            <div class="rounded-xl border border-border bg-background px-4 py-3">
              <!-- 加载中 -->
              <div v-if="trashLoading" class="py-6 text-center text-sm text-muted-foreground">
                加载中...
              </div>

              <!-- 空状态 -->
              <div
                v-else-if="trashItems.length === 0"
                class="py-6 text-center text-sm text-muted-foreground/70"
              >
                回收站为空
              </div>

              <template v-else>
                <!-- 列表：删除时间倒序（后端已排序） -->
                <div class="space-y-1">
                  <div
                    v-for="item in trashItems"
                    :key="item.id"
                    class="group flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-accent/50 transition-colors"
                  >
                    <!-- 图标 + 名称 + 元信息 -->
                    <div class="flex items-center gap-2.5 min-w-0 flex-1">
                      <span
                        class="inline-flex items-center justify-center w-8 h-8 rounded-lg shrink-0"
                        :style="{ background: resolveWikiIconColor(item.color).bg }"
                      >
                        <WikiIcon :icon="item.icon" :color="item.color" :size="18" />
                      </span>
                      <div class="min-w-0">
                        <div class="text-sm font-medium text-foreground truncate">
                          {{ item.name }}
                        </div>
                        <div class="text-xs text-muted-foreground/70 truncate">
                          {{ item.docCount }} 篇文档 · 删除于 {{ formatSmartTime(item.deletedAt) }}
                        </div>
                      </div>
                    </div>

                    <!-- 行内操作：恢复（图标，直接执行）/ 彻底删除（X 图标，需确认弹窗） -->
                    <div class="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        title="恢复"
                        class="inline-flex items-center justify-center size-7 rounded-md text-muted-foreground/60 hover:text-foreground hover:bg-accent transition-colors"
                        @click="handleRestore(item)"
                      >
                        <RotateCcw :size="15" />
                      </button>
                      <button
                        type="button"
                        title="彻底删除"
                        class="inline-flex items-center justify-center size-7 rounded-md text-muted-foreground/60 hover:text-destructive hover:bg-accent transition-colors"
                        @click="openPurgeConfirm(item)"
                      >
                        <X :size="15" />
                      </button>
                    </div>
                  </div>
                </div>
              </template>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </template>
    </div>

    <!-- 弹窗：新建 / 重命名知识库（复用组件，editData 有值 = 编辑模式） -->
    <CreateWikiModal
      v-model:visible="createWikiVisible"
      :edit-data="editingWiki"
      @success="handleWikiSaved"
    />

    <!-- 弹窗：知识库权限（复用 share-dialog wiki-only 模式） -->
    <ShareDialog v-model:visible="shareVisible" :wiki-id="shareWikiId ?? ''" mode="wiki-only" />

    <!-- 弹窗：AI 大模型配置（横幅点击打开；与用户菜单 / AI 写作浮条共用同一套配置表单） -->
    <AiSettingsModal
      v-model:visible="aiSettingsVisible"
      title="AI 大模型管理"
      @saved="onAiSettingsSaved"
    />

    <!-- 弹窗：删除知识库二次确认（软删除 → 移入回收站，可恢复） -->
    <AlertDialog :open="deleteVisible" @update:open="(v: boolean) => (deleteVisible = v)">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>删除知识库「{{ deleteTarget?.title }}」？</AlertDialogTitle>
          <AlertDialogDescription>
            知识库将移入回收站，期间分享与发布链接将无法访问；如需永久删除，请在回收站中彻底删除。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction
            class="bg-destructive text-white hover:bg-destructive/90"
            :disabled="deleting"
            @click="handleDelete"
          >
            {{ deleting ? '删除中...' : '移入回收站' }}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <!-- 弹窗：彻底删除单库二次确认（硬删除不可恢复，级联清理文档树/正文/分享/发布/RAG 向量） -->
    <AlertDialog :open="purgeVisible" @update:open="(v: boolean) => (purgeVisible = v)">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>彻底删除</AlertDialogTitle>
          <AlertDialogDescription>
            此操作将从回收站中彻底删除「{{ purgeTarget?.name }}」及其全部文档（共
            {{ purgeTarget?.docCount ?? 0 }} 篇），该操作不可恢复。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction
            class="bg-destructive text-white hover:bg-destructive/90"
            :disabled="purging"
            @click="confirmPurge"
          >
            {{ purging ? '删除中...' : '彻底删除' }}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>

<script lang="ts" setup>
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import {
  Search,
  Plus,
  LayoutGrid,
  List,
  Lock,
  Globe,
  MoreHorizontal,
  Pin,
  PinOff,
  Share2,
  SquarePen,
  Settings2,
  Trash2,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  RotateCcw,
  X,
  BookOpen,
  Send,
  Sparkles,
} from '@lucide/vue'
import { useWikiStore } from '@/stores/wiki'
import type { WikiItem, WikiTrashItem } from '@/api/modules/wiki'
import { deleteWiki, listWikiTrash, restoreWikiTrash, purgeWikiTrash } from '@/api/modules/wiki'
import { getRagStatusBatch, type RagStatus } from '@/api/modules/rag'
import { buildWikiPreviewLink, getPublishPreviewToken } from '@/api/modules/publish'
import { getAiStatus } from '@/api/modules/ai'
import type { AiSettingsView } from '@/api/modules/admin'
import { ApiError } from '@/api/request'
import CreateWikiModal from './components/create-wiki-modal.vue'
import ShareDialog from '@/views/wiki/components/share-dialog.vue'
import AiSettingsModal from '@/components/ai-settings/ai-settings-modal.vue'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { resolveWikiIconColor } from './components/wiki-icon-meta'
import WikiIcon from './components/wiki-icon.vue'

/**
 * 知识库行/卡片展示数据（由 wiki store 派生）
 */
interface KnowledgeBase {
  id: string
  title: string
  desc: string
  /** wiki.icon 原始值（Solar id 或 legacy lucide key，null 走默认图标），由 WikiIcon 渲染 */
  icon: string | null
  /** wiki.color 原始 key（统一色板或 legacy 色 key，null 走默认色） */
  color: string | null
  /** 图标底色（resolveWikiIconColor 的 bg） */
  iconBg: string
  /** 是否已发布（数据源 wiki_publish.enabled）：Send 图标指示，与分享态独立可共存 */
  isPublished: boolean
  /** 是否已分享（数据源 wiki_shares 库级行 share_status=public）：Globe/Lock 指示，与发布态独立可共存 */
  isShared: boolean
  /** 是否开启 AI 索引（文档保存后自动切片向量化） */
  ragEnabled: boolean
  isPinned: boolean
  updatedLabel: string
}

// ==================== 基础状态 ====================

/**
 * 知识库 Store：真实知识库列表数据源
 */
const wikiStore = useWikiStore()
const { wikis: wikiList, loading: wikiLoading } = storeToRefs(wikiStore)

/**
 * 路由实例：知识库卡片/行点击跳转
 */
const router = useRouter()

/**
 * 当前范围 Tab：mine = 我个人的；shared = 邀请协作的（占位）
 */
const activeTab = ref<'mine' | 'shared'>('mine')

/**
 * 搜索关键字（前端过滤 name/description，大小写不敏感）
 */
const keyword = ref('')

/** 视图模式 localStorage key */
const VIEW_MODE_KEY = 'yokimind.wikiViewMode'

/** 置顶知识库 localStorage key（存 wiki id 数组 JSON） */
const PINNED_KEY = 'yokimind.pinnedWikis'

/**
 * 视图模式：grid = 卡片网格（默认）；list = 列表表格
 * 持久化到 localStorage，刷新后记忆用户选择
 */
const viewMode = ref<'grid' | 'list'>(
  localStorage.getItem(VIEW_MODE_KEY) === 'list' ? 'list' : 'grid'
)

/**
 * 切换视图模式并持久化
 */
function setViewMode(mode: 'grid' | 'list') {
  viewMode.value = mode
  localStorage.setItem(VIEW_MODE_KEY, mode)
}

// ==================== AI 配置状态横幅 ====================

/**
 * chat 服务是否已配置就绪（数据源 POST /ai/status，登录即可查询、不暴露任何配置细节）
 * null = 检测中 / 检测失败：不显示横幅，避免首屏闪烁与误报
 */
const aiChatReady = ref<boolean | null>(null)

/**
 * 向量服务（embedding）是否就绪：随 loadAiStatus 一并查询（仅需登录接口）
 * null = 检测中 / 检测失败：RAG 徽标 tooltip 按原四态展示，不注入额外提示
 * false = 未配置向量模型：RAG 徽标 tooltip 提示「RAG 不可用」（此时任务入队也只会挂起）
 */
const aiEmbeddingReady = ref<boolean | null>(null)

/**
 * AI 大模型配置弹窗显隐：横幅 / 「立即配置」按钮点击打开
 * 复用全局 AiSettingsModal（与用户菜单、AI 写作浮条同一弹窗组件）
 */
const aiSettingsVisible = ref(false)

/**
 * 查询 AI 配置状态：chatReady=false 时页面顶部显示配置引导横幅
 * 请求失败静默降级（保持 null 不出横幅），不影响知识库列表正常使用
 */
async function loadAiStatus() {
  try {
    const { chatReady, embeddingReady } = await getAiStatus().send()
    aiChatReady.value = chatReady
    aiEmbeddingReady.value = embeddingReady
  } catch (error) {
    console.error('[Dashboard] getAiStatus failed:', error)
  }
}

/**
 * AI 配置保存成功回调（AiSettingsModal saved 事件）：
 * 用最新视图同步横幅状态；chat 已就绪时自动关闭弹窗并提示，横幅随之消失
 */
function onAiSettingsSaved(view: AiSettingsView) {
  aiChatReady.value = view.chatReady
  // 同步向量服务就绪状态：配置 embedding 后 RAG 徽标 tooltip 立即恢复四态文案
  aiEmbeddingReady.value = view.embeddingReady
  if (view.chatReady) {
    aiSettingsVisible.value = false
    toast.success('AI 大模型配置已生效')
  }
}

// ==================== 排序 ====================

/**
 * 排序字段：name / updatedAt（默认 updatedAt）
 */
const sortKey = ref<'name' | 'updatedAt'>('updatedAt')

/**
 * 排序方向：asc / desc（默认 desc = 最近更新在前）
 */
const sortOrder = ref<'asc' | 'desc'>('desc')

/**
 * 点击表头切换排序：同列翻转方向，异列重置为默认方向
 * name 默认 asc（字典序），updatedAt 默认 desc（最近在前）
 */
function toggleSort(key: 'name' | 'updatedAt') {
  if (sortKey.value === key) {
    sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortKey.value = key
    sortOrder.value = key === 'name' ? 'asc' : 'desc'
  }
}

// ==================== 设为常用（本地置顶） ====================

/**
 * 置顶知识库 ID 集合（本地 localStorage，不落库）
 */
const pinnedIds = ref<string[]>(loadPinnedIds())

/**
 * 从 localStorage 读取置顶列表（容错：解析失败返回空数组）
 */
function loadPinnedIds(): string[] {
  try {
    const raw = localStorage.getItem(PINNED_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : []
  } catch {
    return []
  }
}

/**
 * 切换置顶状态并持久化
 */
function togglePin(wikiId: string) {
  const next = pinnedIds.value.includes(wikiId)
    ? pinnedIds.value.filter((id) => id !== wikiId)
    : [...pinnedIds.value, wikiId]
  pinnedIds.value = next
  localStorage.setItem(PINNED_KEY, JSON.stringify(next))
}

// ==================== 列表派生 ====================

/**
 * 智能时间格式化（对齐设计稿：昨天 21:06 / 08-21 18:26）
 * 规则：今天 → HH:mm；昨天 → 昨天 HH:mm；今年 → MM-DD HH:mm；更早 → YYYY-MM-DD
 */
function formatSmartTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const hm = `${pad(date.getHours())}:${pad(date.getMinutes())}`
  const sameDay = date.toDateString() === now.toDateString()
  if (sameDay) return hm
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (date.toDateString() === yesterday.toDateString()) return `昨天 ${hm}`
  if (date.getFullYear() === now.getFullYear()) {
    return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${hm}`
  }
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * 列表展示数据：wiki store → 卡片/表格行结构
 * 图标/配色优先用 wiki.icon + wiki.color（Solar id 或 legacy lucide key），
 * 渲染统一走 WikiIcon（自动区分新旧格式），底色经 resolveWikiIconColor 归一化
 */
const displayWikis = computed<KnowledgeBase[]>(() =>
  wikiList.value.map((wiki: WikiItem) => {
    return {
      id: wiki.id,
      title: wiki.name,
      desc: wiki.description ?? '',
      icon: wiki.icon ?? null,
      color: wiki.color ?? null,
      iconBg: resolveWikiIconColor(wiki.color).bg,
      // 两个独立状态（数据源分表、可同时为 true，前端并排独立展示不做互斥推断）：
      // - isShared：是否已分享（wiki_shares 库级行 share_status=public）→ Globe/Lock 图标
      // - isPublished：是否已发布（wiki_publish.enabled）→ Send 图标
      isPublished: wiki.published,
      isShared: wiki.shared,
      // 是否开启 AI 索引（创建/设置弹窗里的开关，后端原样返回）
      ragEnabled: wiki.ragEnabled,
      isPinned: pinnedIds.value.includes(wiki.id),
      updatedLabel: formatSmartTime(wiki.updatedAt),
    }
  })
)

/**
 * 最终展示列表：关键字过滤 → 置顶优先 → 排序字段排序
 */
const sortedWikis = computed<KnowledgeBase[]>(() => {
  const kw = keyword.value.trim().toLowerCase()
  const filtered = kw
    ? displayWikis.value.filter(
        (kb) => kb.title.toLowerCase().includes(kw) || kb.desc.toLowerCase().includes(kw)
      )
    : [...displayWikis.value]

  // 排序：置顶优先（组内仍按 sortKey 排序）
  return filtered.sort((a, b) => {
    if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1
    if (sortKey.value === 'name') {
      return sortOrder.value === 'asc'
        ? a.title.localeCompare(b.title, 'zh-Hans-CN')
        : b.title.localeCompare(a.title, 'zh-Hans-CN')
    }
    // updatedAt：按原始时间戳比较（从 store 里取）
    const ta = wikiList.value.find((w) => w.id === a.id)?.updatedAt ?? ''
    const tb = wikiList.value.find((w) => w.id === b.id)?.updatedAt ?? ''
    return sortOrder.value === 'asc' ? ta.localeCompare(tb) : tb.localeCompare(ta)
  })
})

/**
 * 点击知识库卡片/行，跳转到知识库编辑页
 */
function goToWiki(wikiId: string) {
  router.push(`/wiki/${wikiId}`)
}

// ==================== RAG 索引状态徽标 ====================

/**
 * 各知识库 RAG 索引状态统计（wikiId → 状态统计）
 * 仅对 ragEnabled = true 的库拉取（未开启的库显示灰色点，无需请求）
 */
const ragStatusMap = ref<Record<string, RagStatus>>({})

/** RAG 状态轮询定时器句柄（有进行中任务时启动，全部完成后停止） */
let ragPollTimer: ReturnType<typeof setInterval> | null = null

/** RAG 状态轮询间隔（与编辑器左侧 RAG 面板轮询周期一致） */
const RAG_POLL_INTERVAL_MS = 3000

/**
 * 拉取所有开启 AI 索引的库的 RAG 状态（批量接口，一次请求替代逐库 N 次）
 * 请求失败静默降级（保留旧值/缺失 → 灰点），不阻断列表展示；
 * 存在进行中任务（pending > 0）时自动开启轮询，全部完成后停止
 */
async function loadRagStatuses() {
  const targets = wikiList.value.filter((w: WikiItem) => w.ragEnabled)
  if (targets.length === 0) {
    stopRagStatusPolling()
    return
  }
  try {
    // 一次批量请求拉取全部开启 RAG 库的状态快照（后端读 wiki_rag 表，越权/无行返回全 0）
    const { items } = await getRagStatusBatch(targets.map((w: WikiItem) => w.id)).send()
    for (const item of items) {
      ragStatusMap.value[item.wikiId] = item
    }
  } catch {
    // 降级：请求失败保留旧状态（缺失时按灰点展示），不打断列表展示
  }
  const anyInProgress = targets.some((w: WikiItem) => (ragStatusMap.value[w.id]?.pending ?? 0) > 0)
  if (anyInProgress) {
    startRagStatusPolling()
  } else {
    stopRagStatusPolling()
  }
}

/** 启动 RAG 状态轮询（幂等：已有定时器时跳过） */
function startRagStatusPolling() {
  if (ragPollTimer) return
  ragPollTimer = setInterval(loadRagStatuses, RAG_POLL_INTERVAL_MS)
}

/** 停止 RAG 状态轮询 */
function stopRagStatusPolling() {
  if (ragPollTimer) {
    clearInterval(ragPollTimer)
    ragPollTimer = null
  }
}

/**
 * RAG 状态圆点颜色（按四态）：
 * 灰色 = 未开启 AI 索引；蓝色 = 索引进行中（呼吸闪烁）；
 * 红色 = 存在索引失败 / 向量模型未配置（RAG 不可用）；绿色 = 已开启且无进行中/失败任务
 * （含暂无文档/状态未就绪——「已开启」本身即表达正常运行，不再显示灰点）
 */
function ragDotClass(kb: KnowledgeBase) {
  if (!kb.ragEnabled) return 'bg-muted-foreground/40'
  // 向量模型未配置：RAG 整体不可用，红点提示（优先于索引中蓝点——挂起的任务不会再推进）
  if (aiEmbeddingReady.value === false) return 'bg-red-500'
  const st = ragStatusMap.value[kb.id]
  if (st && st.pending > 0) return 'bg-blue-500 animate-pulse'
  if (st && st.failed > 0) return 'bg-red-500'
  // 已开启即视为正常（含暂无文档/状态未就绪）：绿点表达「AI 索引已开启」
  return 'bg-green-500'
}

/**
 * RAG 徽标文本：仅索引进行中（有待同步任务，蓝点呼吸）展示「RAG {已索引}/{总数}」，
 * 数字随 3s 轮询实时推进即进度显示；
 * 全部完成/失败等稳态下数字无信息量（tooltip 已有明细），徽标回归纯 RAG；
 * 未开启/暂无可索引文档时同样仅显示 RAG
 */
function ragBadgeText(kb: KnowledgeBase) {
  if (!kb.ragEnabled) return 'RAG'
  const st = ragStatusMap.value[kb.id]
  if (!st || st.pending === 0) return 'RAG'
  return `RAG ${st.done}/${st.total}`
}

/** RAG 状态按钮 Tooltip 文案（按四态区分，含进度明细） */
function ragTooltipText(kb: KnowledgeBase) {
  if (!kb.ragEnabled) return '未开启 AI 索引'
  // 向量模型未配置时 RAG 整体不可用：任何状态文案都会误导（进行中的任务也不会再推进），优先提示
  if (aiEmbeddingReady.value === false) return '向量模型未配置，AI 索引（RAG）不可用'
  const st = ragStatusMap.value[kb.id]
  if (!st || st.total === 0) return 'AI 索引已开启'
  if (st.pending > 0)
    return `AI 索引进行中：已索引 ${st.done}/${st.total}，待同步 ${st.pending} 个文档`
  if (st.failed > 0)
    return `AI 索引异常：已索引 ${st.done}/${st.total}，${st.failed} 个文档索引失败`
  return `AI 索引正常：已索引 ${st.done}/${st.total} 个文档`
}

/**
 * RAG Tooltip 文案颜色：向量模型未配置的「不可用」提示标红
 * Tooltip 为深色底（bg-foreground），用亮红 red-400 保证对比度；其余状态用默认文字色
 */
function ragTooltipTextClass(kb: KnowledgeBase) {
  return kb.ragEnabled && aiEmbeddingReady.value === false ? 'text-red-400' : ''
}

// 监听列表变化重新拉取 RAG 状态（首屏加载 / 强制刷新 / 库增删都会触发）
watch(wikiList, loadRagStatuses)

// ==================== 卡片「...」菜单 ====================

/**
 * 当前打开菜单的知识库 ID（null = 全部关闭）
 * 用于：菜单打开期间触发按钮保持可见（不受 group-hover 限制）
 */
const openMenuId = ref<string | null>(null)

/**
 * 占位功能统一提示
 */
function toastSoon(feature: string) {
  toast.info(`「${feature}」暂未支持，敬请期待`)
}

// ==================== 新建 / 重命名 ====================

/**
 * 新建/重命名弹窗显隐
 */
const createWikiVisible = ref(false)

/**
 * 重命名目标（null = 新建模式）
 */
const editingWiki = ref<WikiItem | null>(null)

/**
 * 打开新建弹窗（清空编辑目标）
 */
function openCreate() {
  editingWiki.value = null
  createWikiVisible.value = true
}

/**
 * 打开重命名弹窗（传入当前知识库 → 编辑模式）
 */
function openRename(kb: KnowledgeBase) {
  const raw = wikiList.value.find((w) => w.id === kb.id)
  if (!raw) return
  editingWiki.value = raw
  createWikiVisible.value = true
}

/**
 * 打开「更多设置」弹窗：与编辑器左侧栏「知识库设置」入口保持一致，
 * 复用 create-wiki-modal 编辑模式（名称/图标/描述/AI 索引开关/重建索引）。
 * 打开逻辑与 openRename 相同（同一个弹窗实例，editingWiki 有值 = 编辑模式）；
 * 保存成功统一走 handleWikiSaved（toast + 刷新列表），两个入口互不冲突。
 */
function openSettings(kb: KnowledgeBase) {
  openRename(kb)
}

// ==================== 发布预览 ====================

/**
 * 发布预览（菜单项）：签发 owner 专属短时效预览令牌（1h）后新标签打开 pages 站
 * /w/{wikiId}/preview?t={token} —— 预览页带站点外观设置面板，未发布的库也能预览
 * （与编辑器顶栏发布卡片的「预览与配置」行为一致，此处为 Dashboard 快捷入口）
 */
async function handlePublishPreview(wikiId: string) {
  try {
    // 先签发预览令牌（登录过期 / 非 owner 时后端拒绝，此时不打开页面）
    const { token } = await getPublishPreviewToken(wikiId).send()
    window.open(buildWikiPreviewLink(wikiId, token), '_blank', 'noopener')
  } catch (error) {
    // ApiError = 后端业务校验失败（如登录过期），直接透出后端 message 兜底
    if (error instanceof ApiError) {
      toast.error(error.message)
    } else {
      console.error('[Dashboard] 获取预览令牌失败:', error)
      toast.error('打开预览失败，请重试')
    }
  }
}

/**
 * 新建/保存成功回调：强制刷新列表（弹窗内已回显错误，这里按模式提示）
 */
function handleWikiSaved() {
  wikiStore.loadWikis(true)
  if (editingWiki.value) {
    toast.success('知识库已保存')
    editingWiki.value = null
  } else {
    toast.success('知识库创建成功')
  }
}

// ==================== 权限弹窗 ====================

/**
 * 权限弹窗显隐 + 目标知识库 ID
 */
const shareVisible = ref(false)
const shareWikiId = ref<string | null>(null)

/**
 * 打开权限弹窗（share-dialog wiki-only 模式）
 */
function openShareDialog(wikiId: string) {
  shareWikiId.value = wikiId
  shareVisible.value = true
}

// ==================== 删除知识库 ====================

/**
 * 删除确认弹窗显隐 + 删除目标
 */
const deleteVisible = ref(false)
const deleteTarget = ref<KnowledgeBase | null>(null)
const deleting = ref(false)

/**
 * 打开删除确认弹窗
 */
function openDelete(kb: KnowledgeBase) {
  deleteTarget.value = kb
  deleteVisible.value = true
}

/**
 * 确认删除：调用后端 delete-wiki 接口（软删除 → 移入回收站，分享/发布即时失效）
 * 成功后刷新列表并清理本地置顶记录
 */
async function handleDelete() {
  const target = deleteTarget.value
  if (!target || deleting.value) return
  deleting.value = true
  try {
    await deleteWiki(target.id).send()
    deleteVisible.value = false
    toast.success('已移入回收站')
    // 刷新列表
    wikiStore.loadWikis(true)
    // 同步刷新回收站（折叠态也拉取，保证数量徽标准确）
    loadTrashList()
    // 清理本地置顶记录，避免残留脏数据
    if (pinnedIds.value.includes(target.id)) {
      togglePin(target.id)
    }
  } catch (error) {
    // 业务错误由 request 层统一 toast，这里仅兜底
    console.error('[Dashboard] deleteWiki failed:', error)
  } finally {
    deleting.value = false
  }
}

// ==================== 回收站（软删除知识库，页面底部折叠面板） ====================

/**
 * 回收站面板展开状态（默认折叠）
 * 折叠头由 CollapsibleTrigger 原生切换（v-model:open 回写）；
 * 展开时通过 watch 懒加载列表，避免每次进入 Dashboard 都多发一次请求
 */
const trashExpanded = ref(false)

/** 展开面板时自动拉取最新回收站列表（折叠 → 展开） */
watch(trashExpanded, (open) => {
  if (open) {
    loadTrashList()
  }
})

/** 回收站列表加载中（防重复点击） */
const trashLoading = ref(false)

/** 回收站列表数据（软删除的知识库，删除时间倒序） */
const trashItems = ref<WikiTrashItem[]>([])

/**
 * 拉取回收站列表（错误由 request 层统一 toast）
 */
async function loadTrashList() {
  if (trashLoading.value) return
  trashLoading.value = true
  try {
    trashItems.value = (await listWikiTrash().send()) ?? []
  } catch (error) {
    console.error('[Dashboard] listWikiTrash failed:', error)
  } finally {
    trashLoading.value = false
  }
}

/**
 * 恢复知识库（撤销软删除，分享/发布自动还原）
 * 成功后刷新回收站列表与知识库列表
 */
async function handleRestore(item: WikiTrashItem) {
  try {
    await restoreWikiTrash(item.id).send()
    toast.success(`「${item.name}」已恢复`)
    // 恢复后原库回到列表，回收站移除该项
    await loadTrashList()
    wikiStore.loadWikis(true)
  } catch (error) {
    console.error('[Dashboard] restoreWikiTrash failed:', error)
  }
}

// ============ 彻底删除弹窗（回收站内单库操作） ============

/** 彻底删除确认弹窗显隐 */
const purgeVisible = ref(false)

/** 彻底删除请求进行中（按钮 loading + 防重复点击） */
const purging = ref(false)

/** 待彻底删除的条目（弹窗回显名称 / 文档数用） */
const purgeTarget = ref<WikiTrashItem | null>(null)

/**
 * 打开彻底删除确认弹窗
 */
function openPurgeConfirm(item: WikiTrashItem) {
  purgeTarget.value = item
  purgeVisible.value = true
}

/**
 * 确认彻底删除：硬删除不可恢复（级联清理文档树/正文/分享/发布/RAG 向量）
 * 成功后刷新回收站列表
 */
async function confirmPurge() {
  const target = purgeTarget.value
  if (!target || purging.value) return
  purging.value = true
  try {
    await purgeWikiTrash(target.id).send()
    purgeVisible.value = false
    toast.success('已彻底删除')
    await loadTrashList()
  } catch (error) {
    console.error('[Dashboard] purgeWikiTrash failed:', error)
  } finally {
    purging.value = false
  }
}

onMounted(() => {
  // 加载知识库列表
  wikiStore.loadWikis()
  // 查询 AI 配置状态（chat 未就绪时顶部显示配置引导横幅）
  loadAiStatus()
  // 预取回收站列表：折叠态下数量徽标也需要数据（无回收项时徽标隐藏，无多余渲染）
  loadTrashList()
  // 监听分享配置变更事件（share-dialog 保存成功后广播）：
  // 知识库 public/private 可能变化，强制刷新列表以更新卡片/行的锁图标
  window.addEventListener('wiki-share-updated', onShareUpdated)
})

onBeforeUnmount(() => {
  // 成对解绑 window 级事件监听，避免组件卸载后残留
  window.removeEventListener('wiki-share-updated', onShareUpdated)
  // 停止 RAG 状态轮询定时器（防止卸载后继续请求）
  stopRagStatusPolling()
})

/**
 * 分享配置变更回调：强制刷新知识库列表（visibility 变化 → 锁/地球图标同步）
 */
function onShareUpdated() {
  wikiStore.loadWikis(true)
}
</script>

<style scoped></style>
