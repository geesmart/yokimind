<template>
  <section class="flex flex-col flex-1 min-w-0 min-h-0 bg-background">
    <!-- 顶栏：左折叠按钮 + 面包屑 + 保存状态 + 主操作 + 右折叠按钮 -->
    <div class="flex items-center justify-between h-14 px-5 border-b border-border shrink-0 gap-4">
      <div class="flex items-center justify-center gap-3">
        <!-- 左侧栏折叠按钮：图标随折叠态切换，tooltip 提示当前可执行动作
             showLeftToggle=false 时隐藏（guest 单页形态无左栏） -->
        <TooltipProvider v-if="showLeftToggle">
          <Tooltip>
            <TooltipTrigger as-child>
              <Button
                variant="ghost"
                size="icon"
                class="h-7 w-7 shrink-0"
                :aria-label="leftCollapsed ? '展开侧栏' : '折叠侧栏'"
                @click="emit('toggle:left')"
              >
                <PanelLeftOpen v-if="leftCollapsed" :size="16" />
                <PanelLeftClose v-else :size="16" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" class="text-xs px-2 py-1">
              {{ leftCollapsed ? '展开侧栏' : '折叠侧栏' }}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <!-- 面包屑导航：知识库名 > 父级路径 > 当前文档 -->
        <Breadcrumb
          v-if="wikiName || docTitle || (docPath && docPath.length > 0)"
          class="min-w-0"
        >
          <BreadcrumbList class="flex-nowrap overflow-x-auto">
            <!-- 知识库名层（最左，显示 emoji 图标）：owner / 访客整库形态可点击，
                 跳回知识库首页（第一篇文档）；访客单页形态无整库浏览权限，降级纯文本不可点击 -->
            <template v-if="wikiName">
              <BreadcrumbItem class="max-w-[150px]">
                <BreadcrumbLink
                  v-if="wikiClickable"
                  href="#"
                  class="truncate max-w-[150px] inline-flex items-center gap-1"
                  @click.prevent="emit('go:wiki')"
                >
                  <span class="truncate">{{ wikiName }}</span>
                </BreadcrumbLink>
                <BreadcrumbPage v-else class="truncate inline-flex items-center gap-1">
                  <span v-if="wikiIcon" class="text-sm leading-none shrink-0">{{
                    wikiIcon
                  }}</span>
                  <span class="truncate">{{ wikiName }}</span>
                </BreadcrumbPage>
              </BreadcrumbItem>
              <BreadcrumbSeparator v-if="(docPath?.length ?? 0) > 0 || docTitle" />
            </template>
            <!-- 父级路径节点（可点击跳转，显示 emoji 图标） -->
            <template v-for="(node, index) in docPath || []" :key="node.id">
              <BreadcrumbItem>
                <BreadcrumbLink
                  href="#"
                  class="truncate max-w-[120px] inline-flex items-center gap-1"
                  @click.prevent="goToNode(node.id)"
                >
                  <span v-if="node.icon" class="text-sm leading-none shrink-0">{{
                    node.icon
                  }}</span>
                  <span class="truncate">{{ node.title }}</span>
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator v-if="index < (docPath?.length ?? 0) - 1 || docTitle" />
            </template>
            <!-- 当前文档标题（不可点击，高亮显示，显示 emoji 图标） -->
            <BreadcrumbItem v-if="docTitle" class="max-w-[150px]">
              <BreadcrumbPage class="truncate inline-flex items-center gap-1">
                <span v-if="icon" class="text-sm leading-none shrink-0">{{ icon }}</span>
                <span class="truncate">{{ docTitle }}</span>
              </BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        <!-- RAG 索引状态标签（点 + RAG 文本，位于面包屑右侧）：当前文档的 AI 索引进度 -->
        <!-- 状态用圆点颜色表达：未索引（灰）/ 索引中（琥珀，呼吸闪烁）/ 已索引（绿）/ 失败（红）；点击弹出详情 -->
        <!-- 暂时隐藏 RAG 标志（恢复时把 v-if="false" 改回 documentId 即可） -->
        <Popover v-if="false && documentId" v-model:open="ragPopoverVisible">
          <PopoverTrigger as-child>
            <!-- 共用徽章组件：与左侧知识库栏同一套 RAG 样式，圆点随状态变色 -->
            <RagStatusBadge :dot-class="ragDotClass" />
          </PopoverTrigger>
          <PopoverContent align="start" class="w-60 p-3 text-xs">
            <!-- 弹层标题：当前索引状态（文案四态：未索引/索引中/已索引/索引失败） -->
            <div class="flex items-center gap-1.5 font-medium text-foreground">
              AI 索引状态：{{ ragStatusText }}
            </div>
            <!-- 最新 RAG 时间：最近一次成功同步时间；从未索引时显示占位 -->
            <div class="mt-1.5 text-muted-foreground">最新 RAG 时间：{{ ragLastSyncedText }}</div>
            <!-- 已索引：显示切片数与用途说明 -->
            <div v-if="ragDetail?.status === 'done'" class="mt-1 text-muted-foreground">
              已索引 {{ ragDetail?.chunkCount }} 个切片，可用于 AI 问答与语义搜索
            </div>
            <!-- 索引中：说明异步处理 -->
            <div
              v-else-if="ragDetail?.status === 'pending' || ragDetail?.status === 'running'"
              class="mt-1 text-muted-foreground"
            >
              文档正在切片并向量化，完成后自动可用于 AI 问答
            </div>
            <!-- 失败：展示最近一次失败原因 -->
            <div
              v-else-if="ragDetail?.status === 'failed'"
              class="mt-1 max-w-56 break-all text-red-500"
            >
              {{ ragDetail?.error || '索引失败，可点击下方按钮重试' }}
            </div>
            <!-- 立即索引按钮：直接触发当前文档重建索引（pending/running 时不允许重复触发） -->
            <Button
              size="sm"
              class="mt-2.5 w-full h-7"
              :disabled="
                reindexing || ragDetail?.status === 'pending' || ragDetail?.status === 'running'
              "
              @click="handleReindexDocument"
            >
              <Loader2 v-if="reindexing" :size="13" class="animate-spin" />
              {{ ragDetail?.status === 'none' ? '立即索引' : '重新索引' }}
            </Button>
          </PopoverContent>
        </Popover>
      </div>

      <div class="flex items-center gap-3">
        <!-- 保存状态指示器（guest 访客只读无保存链路，隐藏） -->
        <!-- 回收站文档（inTrash）同样隐藏：只读展示不可编辑，无保存动作，显示「已保存」有歧义 -->
        <div
          v-if="!guest && !inTrash"
          class="flex items-center gap-1.5 text-xs text-muted-foreground/70 shrink-0"
        >
          <Loader2 v-if="saveStatus === 'saving'" :size="14" class="animate-spin" />
          <CheckCircle2 v-else-if="saveStatus === 'saved'" :size="14" class="text-green-500" />
          <AlertCircle v-else-if="saveStatus === 'error'" :size="14" class="text-red-500" />
          <span>{{ formatSavedText() }}</span>
        </div>
        <!-- Markdown 复制按钮（保存状态右侧、编辑/预览切换左侧）：一键复制当前文档
             Markdown 源码到剪贴板，与编辑切换同可见性（owner 正常态），
             回收站文档（inTrash）与 guest 访客隐藏；
             图标为「复制为 Markdown」（CodyAsMd）自绘 SVG：双层文档叠放 + MD 字样 -->
        <TooltipProvider v-if="!guest && !inTrash">
          <Tooltip>
            <TooltipTrigger as-child>
              <Button
                variant="ghost"
                size="icon"
                class="h-8 w-8 text-muted-foreground hover:text-foreground"
                aria-label="复制 Markdown"
                @click="copyMarkdownFromEditor"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  fill-rule="evenodd"
                  class="size-5"
                  data-name="CodyAsMd"
                  aria-hidden="true"
                >
                  <path
                    d="M11.701 1.797a3.373 3.373 0 0 1 3.376 3.266 2.817 2.817 0 0 0-1.093-.219h-.401A1.908 1.908 0 0 0 11.7 3.262H5.486a1.906 1.906 0 0 0-1.908 1.903v7.249c0 .993.762 1.808 1.735 1.896v.222c0 .449.105.873.292 1.25h-.119a3.372 3.372 0 0 1-3.377-3.368V5.165a3.372 3.372 0 0 1 3.377-3.368h6.215Z"
                  ></path>
                  <path
                    d="M14.514 4.297a3.372 3.372 0 0 1 3.377 3.368v7.249a3.372 3.372 0 0 1-3.377 3.368H8.299a3.372 3.372 0 0 1-3.377-3.368V7.665a3.372 3.372 0 0 1 3.377-3.368h6.215Zm-.01 1.407H8.309c-1.051 0-1.903.855-1.903 1.91v7.273c0 1.055.852 1.91 1.903 1.91h6.195c1.05 0 1.902-.855 1.902-1.91V7.614c0-1.055-.851-1.91-1.902-1.91Z"
                  ></path>
                  <text
                    font-family="PingFangSC-Semibold, PingFang SC"
                    font-size="5.625"
                    font-weight="500"
                    transform="translate(0 .028)"
                  >
                    <tspan x="6.875" y="13.316">MD</tspan>
                  </text>
                </svg>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" class="text-xs px-2 py-1">复制 Markdown</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <!-- 收藏按钮：暂时注释，后续功能就绪后恢复 -->
        <!-- <Button variant="ghost" size="icon" class="h-7 w-7" aria-label="收藏">
          <Star :size="16" />
        </Button> -->
        <!-- 编辑/预览分段切换：Tabs 组件，高亮当前所处模式（guest 访客恒只读，隐藏） -->
        <!-- 回收站文档（inTrash）同样隐藏：只读展示，恢复后才能编辑 -->
        <Tabs
          v-if="!guest && !inTrash"
          :model-value="editMode ? 'edit' : 'preview'"
          @update:model-value="(v) => (editMode = v === 'edit')"
        >
          <TabsList>
            <TabsTrigger value="edit" class="px-2.5">编辑</TabsTrigger>
            <TabsTrigger value="preview" class="px-2.5">预览</TabsTrigger>
          </TabsList>
        </Tabs>
        <!-- 发布按钮（蓝色，位于分享左侧）：下拉为「发布成 Wiki」卡片（guest 访客隐藏） -->
        <!-- 回收站文档（inTrash）隐藏：回收站内容不可发布/分享，恢复后操作恢复 -->
        <DropdownMenu v-if="!guest && !inTrash" v-model:open="publishMenuOpen">
          <DropdownMenuTrigger as-child>
            <Button size="sm" class="h-8 bg-blue-500 text-white hover:bg-blue-600">
              <Send class="size-3.5" />
              发布
              <span
                v-if="isPublishedWiki"
                class="ml-0.5 inline-block size-1.5 rounded-full bg-green-400"
                aria-hidden="true"
              />
            </Button>
          </DropdownMenuTrigger>
          <!-- ==================== 发布成 Wiki 卡片 ==================== -->
          <!-- 下拉整体为一张卡片（p-0 关闭菜单默认内边距）：头部状态 + 链接区块 + 操作区 -->
          <DropdownMenuContent align="end" class="w-100 p-0">
            <div class="flex flex-col gap-3.5 p-4">
              <!-- 头部：图标 + 标题 + 状态徽标 + 一句话说明发布语义 -->
              <div class="flex items-start gap-2.5">
                <div
                  class="flex size-9 shrink-0 items-center justify-center rounded-md bg-blue-50 dark:bg-blue-950/50"
                >
                  <Book class="size-5 text-blue-600 dark:text-blue-400" />
                </div>
                <div class="flex min-w-0 flex-col gap-1">
                  <div class="flex items-center gap-1.5">
                    <span class="text-sm font-medium leading-none">发布成 Wiki</span>
                    <!-- 状态徽标：已发布绿点高亮，未发布灰色；title 补充语义 -->
                    <span
                      class="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] leading-none"
                      :class="
                        isPublishedWiki
                          ? 'bg-green-50 text-green-600 dark:bg-green-950/50 dark:text-green-400'
                          : 'bg-muted text-muted-foreground'
                      "
                      :title="
                        isPublishedWiki ? '已发布成 Wiki，访客可访问' : '未发布，访客无法访问'
                      "
                    >
                      <span
                        class="inline-block size-1.5 rounded-full"
                        :class="isPublishedWiki ? 'bg-green-500' : 'bg-muted-foreground/40'"
                        aria-hidden="true"
                      />
                      {{ isPublishedWiki ? '已发布' : '未发布' }}
                    </span>
                  </div>
                  <span class="text-xs text-muted-foreground">
                    发布后访客可通过链接只读浏览知识库
                  </span>
                </div>
              </div>

              <!-- 形态切换提示（边界场景）：站点形态为博客时发布成 Wiki 会切为帮助中心 -->
              <div
                v-if="!isPublishedWiki && wikiPublishSettings?.publishType === 'blog'"
                class="rounded-md bg-amber-50 px-2.5 py-2 text-xs leading-relaxed text-amber-600 dark:bg-amber-950/40 dark:text-amber-500"
              >
                当前站点形态为博客，发布成 Wiki 后将切换为帮助中心形态
              </div>

              <!-- 链接区块：截断展示 + 图标复制按钮（与访客打开的 pages 站 URL 一致） -->
              <div class="flex flex-col gap-1.5 rounded-md border bg-muted/40 p-2.5">
                <span class="text-xs font-medium text-muted-foreground">Wiki 链接</span>
                <div class="flex items-center gap-1">
                  <span
                    class="flex-1 min-w-0 truncate font-mono text-xs text-foreground"
                    :title="wikiPagesLink"
                  >
                    {{ wikiPagesLink }}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    class="size-7 shrink-0"
                    title="复制 Wiki 链接"
                    @click="copyWikiLink"
                  >
                    <Copy :size="13" />
                  </Button>
                </div>
                <!-- 发布时间行：已发布展示最近一次配置更新时间，未发布展示引导提示 -->
                <p class="text-xs text-muted-foreground/70">
                  <template v-if="isPublishedWiki && wikiPublishedAtText">
                    发布时间：{{ wikiPublishedAtText }}
                  </template>
                  <template v-else>发布后访客才能通过此链接访问</template>
                </p>
              </div>

              <!-- 操作区：预览引导详细配置（预览页带站点外观设置面板）；发布/下架二态切换 -->
              <div class="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  class="h-8 flex-1"
                  :disabled="publishing || unpublishing"
                  @click="handlePreviewWiki"
                >
                  <Play :size="14" />
                  预览与配置
                </Button>
                <!-- 未发布 → 主按钮「发布」（public + help 形态一步完成）；
                     已发布 → 「下架」（二次确认后转 private，不动站点形态 publishType） -->
                <Button
                  v-if="!isPublishedWiki"
                  size="sm"
                  class="h-8 flex-1 bg-blue-600 text-white hover:bg-blue-700"
                  :disabled="publishing || unpublishing"
                  @click="handlePublishWiki"
                >
                  <Loader2 v-if="publishing" :size="14" class="animate-spin" />
                  发布
                </Button>
                <Button
                  v-else
                  variant="destructive"
                  size="sm"
                  class="h-8 flex-1"
                  :disabled="publishing || unpublishing"
                  @click="handleUnpublishWiki"
                >
                  <Loader2 v-if="unpublishing" :size="14" class="animate-spin" />
                  下架
                </Button>
              </div>
              <!-- 详细配置引导：站点外观等配置不在发布卡片内管理，引导到预览页调整 -->
              <p class="text-xs text-muted-foreground/60">站点外观等详细配置可在预览页中调整</p>
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
        <!-- 恢复按钮（右上角，回收站文档专属）：整棵子树恢复到原位置，恢复后可正常编辑/分享 -->
        <Button
          v-if="!guest && inTrash"
          variant="default"
          size="sm"
          class="h-8"
          :disabled="restoring"
          @click="handleRestoreDoc"
        >
          <Loader2 v-if="restoring" :size="14" class="animate-spin" />
          <Undo2 v-else :size="14" />
          {{ restoring ? '恢复中…' : '恢复' }}
        </Button>
        <!-- 分享按钮：回收站文档隐藏（不可分享），恢复后重新出现 -->
        <Button
          v-if="!guest && !inTrash"
          variant="default"
          size="sm"
          class="h-8"
          @click="shareDialogVisible = true"
        >
          <Share2 :size="14" />
          分享
        </Button>
        <!-- 导出按钮（最右侧，三个点图标）：点击展开 dropdown，提供两种导出形态 ——
             Markdown 压缩包（正文 + assets/ 图片资源）/ Markdown 文件（仅正文，图片保留原链接）。
             正文取当前挂载编辑器的实时内容（含未保存改动）；guest 访客只读态同样可导出；
             回收站文档隐藏（与分享同语义），未选中文档时隐藏（无内容可导出） -->
        <DropdownMenu v-if="!inTrash && docId">
          <DropdownMenuTrigger as-child>
            <Button
              variant="ghost"
              size="icon"
              class="h-8 w-8 text-muted-foreground hover:text-foreground"
              aria-label="导出文档"
              title="导出文档"
            >
              <MoreHorizontal :size="16" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" class="w-60">
            <DropdownMenuItem class="cursor-pointer gap-2 py-2.5" @click="handleExportMarkdownZip">
              <FileArchive :size="15" class="shrink-0 text-muted-foreground" />
              <div class="flex flex-col gap-0.5">
                <span class="text-sm leading-none">导出 Markdown 压缩包</span>
                <span class="text-xs text-muted-foreground">正文 + 图片资源（assets/ 目录）</span>
              </div>
            </DropdownMenuItem>
            <DropdownMenuItem class="cursor-pointer gap-2 py-2.5" @click="handleExportMarkdownFile">
              <FileDown :size="15" class="shrink-0 text-muted-foreground" />
              <div class="flex flex-col gap-0.5">
                <span class="text-sm leading-none">导出 Markdown 文件</span>
                <span class="text-xs text-muted-foreground">仅正文，图片保留原始链接</span>
              </div>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <!-- guest 访客态：顶栏右侧「登录」「注册」双入口（迁移自原 share-guest 悬浮按钮），
             访客态必然未登录，登录后回到该链接即进入 owner 视图；
             登录用描边胶囊（次级动作），注册用主色胶囊（引导新用户注册） -->
        <template v-if="guest">
          <Button
            variant="outline"
            size="sm"
            class="h-7 rounded-full px-3 text-xs text-muted-foreground hover:text-foreground"
            @click="router.push('/login')"
          >
            登录
          </Button>
          <Button
            variant="default"
            size="sm"
            class="h-7 rounded-full px-3 text-xs"
            @click="router.push('/register')"
          >
            注册
          </Button>
        </template>
        <!-- 用户入口已迁移至左侧栏底部（nav-user.vue，NavUser 风格），顶栏右上角不再展示 -->
        <!-- 以下三个按钮暂时隐藏：Markdown 视图 / 历史版本 / 更多操作，后续功能就绪后恢复 -->
        <!-- <TooltipProvider>
          <Tooltip>
            <TooltipTrigger as-child>
              <Button
                variant="ghost"
                size="icon"
                class="h-7 w-7"
                aria-label="Markdown 视图"
                @click="openMarkdownView"
              >
                <FileCode :size="16" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" class="text-xs px-2 py-1">
              查看 Markdown 源码
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <Button variant="ghost" size="icon" class="h-7 w-7" aria-label="历史版本">
          <History :size="16" />
        </Button>
        <Button variant="ghost" size="icon" class="h-7 w-7" aria-label="更多操作">
          <MoreHorizontal :size="16" />
        </Button> -->
        <!-- 右侧栏折叠按钮：仅在 showRightToggle（=isXl）时渲染，图标随折叠态切换 -->
        <!--        <TooltipProvider v-if="showRightToggle">-->
        <!--          <Tooltip>-->
        <!--            <TooltipTrigger as-child>-->
        <!--              <Button-->
        <!--                variant="ghost"-->
        <!--                size="icon"-->
        <!--                class="h-7 w-7 shrink-0"-->
        <!--                :aria-label="rightCollapsed ? '展开大纲栏' : '折叠大纲栏'"-->
        <!--                @click="emit('toggle:right')"-->
        <!--              >-->
        <!--                <PanelRightOpen v-if="rightCollapsed" :size="16" />-->
        <!--                <PanelRightClose v-else :size="16" />-->
        <!--              </Button>-->
        <!--            </TooltipTrigger>-->
        <!--            <TooltipContent side="bottom" class="text-xs px-2 py-1">-->
        <!--              {{ rightCollapsed ? '展开大纲栏' : '折叠大纲栏' }}-->
        <!--            </TooltipContent>-->
        <!--          </Tooltip>-->
        <!--        </TooltipProvider>-->
      </div>
    </div>

    <!-- 独立编辑器组件：工具栏 + 内容区 -->
    <!-- content 就绪后才挂载（:key=docId 切换文档重建编辑器，避免默认内容闪烁） -->
    <!-- :anchor-heading：搜索「内容命中」跳转携带的标题锚点（URL ?h=），编辑器就绪后滚动定位 -->
    <!-- guest 访客态：不传 document-id/node-id（只读浏览无保存链路），editable 由 editMode 强制 false -->
    <NotionEditor
      v-if="content"
      :key="docId"
      ref="notionEditorRef"
      class="flex-1 min-h-0"
      :content="content"
      :title="docTitle"
      :icon="icon"
      :document-id="guest ? undefined : documentId"
      :node-id="guest ? undefined : nodeId"
      :anchor-heading="anchorHeading"
      v-model:editable="editMode"
      @save:status="onSaveStatus"
      @save:title="onSaveTitle"
      @save:icon="onSaveIcon"
      @update:title="onLiveTitle"
      @anchor:navigated="onAnchorNavigated"
    />
    <!-- 内容加载中 -->
    <div
      v-else-if="contentLoading"
      class="flex-1 min-h-0 flex items-center justify-center text-xs text-muted-foreground/70"
    >
      文档加载中…
    </div>
    <!-- 无选中文档 / 文档为空 -->
    <div
      v-else
      class="flex-1 min-h-0 flex items-center justify-center text-xs text-muted-foreground/70"
    >
      请从左侧选择文档
    </div>

    <!-- Markdown 全屏弹窗：展示文档的 Markdown 源码 -->
    <Dialog :open="markdownViewVisible" @update:open="onMarkdownDialogChange">
      <DialogContent class="max-w-[90vw] h-[90vh] flex flex-col p-0 gap-0">
        <DialogHeader
          class="flex items-center justify-between w-full px-6 py-3 border-b border-border shrink-0"
        >
          <div class="flex items-center gap-2">
            <FileCode :size="18" />
            <DialogTitle class="text-sm font-semibold">Markdown 源码</DialogTitle>
          </div>
          <div class="flex items-center gap-2">
            <!-- 复制到剪贴板按钮 -->
            <Button variant="outline" size="sm" @click="copyMarkdown">
              <Copy :size="14" data-icon="inline-start" />
              复制
            </Button>
            <DialogClose as-child>
              <Button variant="outline" size="sm">关闭</Button>
            </DialogClose>
          </div>
        </DialogHeader>
        <div class="flex-1 min-h-0 p-0">
          <textarea
            v-model="markdownContent"
            class="w-full h-full p-6 bg-background text-foreground font-mono text-xs leading-relaxed outline-none resize-none border-none"
            spellcheck="false"
            readonly
          ></textarea>
        </div>
      </DialogContent>
    </Dialog>
    <!-- 分享弹窗：双 Tab 配置（分享此页面 / 知识库可见性），guest 访客隐藏（无分享配置能力） -->
    <!-- 传入当前文档上下文：nodeId 用于页级分享配置（nodes 行匹配与 upsertNodeShare），documentId 用于拼文档分享链接 -->
    <!-- 注意：仅渲染一个实例 —— 曾误渲染两份导致两个模态 Dialog 叠加，点击（如切 Tab）被吞掉无响应 -->
    <template v-if="!guest">
      <ShareDialog
        v-model:visible="shareDialogVisible"
        :wiki-id="wikiId"
        :node-id="nodeId"
        :document-id="documentId"
      />
    </template>
  </section>
</template>

<script lang="ts" setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Separator } from '@/components/ui/separator'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import NotionEditor from '@/components/notion-editor/index.vue'
import type { Content } from '@tiptap/vue-3'
import type { AutoSaveStatus } from '@/composables/document-persistence'
import { saveNodeTitle, saveNodeIcon } from '@/api/modules/wiki'
import { getWikiShareConfig, upsertWikiShare } from '@/api/modules/share'
import {
  getPublishSettings,
  upsertPublishSettings,
  getPublishPreviewToken,
  publishWikiSite,
  unpublishWikiSite,
  buildWikiPagesLink,
  buildWikiPreviewLink,
} from '@/api/modules/publish'
import { getDocumentRagStatus, reindexDocumentRag, type RagDocumentStatus } from '@/api/modules/rag'
import type { WikiShareConfig } from '@/api/modules/share'
import type { WikiPublishSettings } from '@/api/modules/publish'
import { ApiError } from '@/api/request'
import ShareDialog from '@/views/wiki/components/share-dialog.vue'
import {
  History,
  MoreHorizontal,
  Share2,
  Star,
  FileCode,
  Copy,
  Loader2,
  CheckCircle2,
  AlertCircle,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Send,
  Play,
  Book,
  ExternalLink,
  Undo2,
  FileArchive,
  FileDown,
} from '@lucide/vue'
import { toast } from 'vue-sonner'
import { copyTextToClipboard } from '@/lib/utils'
import { exportMarkdownZip, exportMarkdownFile } from '@/utils/export-markdown'
import RagStatusBadge from '@/components/wiki/rag-status-badge.vue'
import { useWikiDocStore } from '@/stores/wiki-doc'

/**
 * 路由实例：用于面包屑点击跳转
 */
const router = useRouter()

/**
 * 当前路由（读取搜索跳转携带的标题锚点 query ?h=<标题文本>）
 */
const route = useRoute()

/**
 * 搜索跳转标题锚点：URL query h 的值（空串表示无锚点）
 * 传给 NotionEditor 的 anchor-heading prop，编辑器内容就绪后滚动定位到对应标题
 */
const anchorHeading = computed(() => (route.query.h as string) || '')

/**
 * 锚点定位完成回调：清除 URL 中的 h 参数
 * 不清除的话，切换文档时 anchorHeading 仍是旧标题，可能误触发对新文档的无效定位
 */
function onAnchorNavigated() {
  if (!route.query.h) return
  const { h: _removed, ...restQuery } = route.query
  router.replace({ query: restQuery })
}

/**
 * 面包屑路径项类型
 */
interface BreadcrumbPathItem {
  id: string
  title: string
  icon?: string | null
}

/**
 * 组件 Props（withDefaults：guest/showLeftToggle 可选布尔需默认值）
 */
const props = withDefaults(
  defineProps<{
    /** 当前文档正文（Tiptap JSON），null/undefined 表示未就绪或为空 */
    content?: Content | null
    /** 当前文档节点 ID（用作 NotionEditor 的 :key，切换文档重建编辑器） */
    docId?: string
    /** 文档正文加载中 */
    contentLoading?: boolean
    /** 父级路径数组（从根到直接父节点） */
    docPath?: BreadcrumbPathItem[]
    /** 当前文档标题（面包屑末级） */
    docTitle?: string
    /** 知识库名称（面包屑最左层；空串/undefined 不渲染该层） */
    wikiName?: string
    /** 知识库图标（emoji） */
    wikiIcon?: string | null
    /** 知识库名是否可点击（访客单页分享无整库浏览权限时 false，降级纯文本展示） */
    wikiClickable?: boolean
    /** 文档 ID（documents.id），用于自动保存 */
    documentId?: string
    /** 节点 ID（wikiNodes.id），用于标题保存 */
    nodeId?: string
    /** 当前文档图标（emoji） */
    icon?: string | null
    /** 左侧文档树栏是否已折叠（决定按钮图标与 tooltip） */
    leftCollapsed?: boolean
    /** 右侧大纲栏是否已折叠 */
    rightCollapsed?: boolean
    /** 是否显示右侧栏折叠按钮 */
    showRightToggle?: boolean
    /** 访客只读模式（语义见下方类型定义） */
    guest?: boolean
    /** 是否显示左侧栏折叠按钮（语义见下方类型定义） */
    showLeftToggle?: boolean
    /** 当前文档是否位于回收站：只读展示，隐藏分享/发布/编辑切换，右上角提供「恢复」 */
    inTrash?: boolean
  }>(),
  {
    guest: false,
    showLeftToggle: true,
    inTrash: false,
    wikiClickable: true,
  }
)

/**
 * 组件 Emits
 */
const emit = defineEmits<{
  /** 标题保存成功后通知父组件（刷新节点标题） */
  (e: 'update:doc-title', title: string): void
  /** 图标保存成功后通知父组件（刷新树节点图标） */
  (e: 'update:doc-icon', icon: string): void
  /** 请求切换左侧栏折叠/展开 */
  (e: 'toggle:left'): void
  /** 请求切换右侧栏折叠/展开 */
  (e: 'toggle:right'): void
  /** 点击面包屑知识库名：请求跳转知识库首页（第一篇文档，由父组件按 owner/guest 分流） */
  (e: 'go:wiki'): void
}>()

/**
 * 当前知识库 ID（从路由参数获取，用于面包屑跳转 + 分享链接拼装）
 * 全站统一小写 ID，toLowerCase() 兜底：防止 URL 中手输大写 ID 导致大小写混用
 */
const wikiId = computed(() => {
  const route = router.currentRoute.value
  return ((route.params.wikiId as string) || '').toLowerCase()
})

/**
 * 跳转到指定文档节点（面包屑点击父级路径时触发）
 * @param nodeId 节点 ID
 */
function goToNode(nodeId: string) {
  if (wikiId.value && nodeId) {
    // 携带当前模式后缀：预览态点面包屑保持预览，编辑态（含瞬态缺省）保持编辑
    const mode = route.params.mode === 'view' ? 'view' : 'edit'
    router.push(`/wiki/${wikiId.value}/${nodeId}/${mode}`)
  }
}

/**
 * NotionEditor 组件引用，用于调用暴露的 getMarkdown 方法和 outline 相关方法
 */
const notionEditorRef = ref<InstanceType<typeof NotionEditor> | null>(null)

/**
 * 当前是否为编辑模式（true=编辑，false=预览）
 * URL 是唯一模式源：由路由后缀 :mode(edit|view)? 派生（/view → 预览，/edit 或瞬态缺省 → 编辑），
 * 通过 v-model:editable 传给 NotionEditor（attrs 透传至其 props.editable）
 * setter 供顶栏「编辑/预览」Tabs 赋值触发，用 router.replace 同步后缀（不产生历史记录）；
 * NotionEditor 从不 emit update:editable，因此 setter 不会被编辑器内部误触发
 * guest 访客模式：强制只读（恒 false，访客 URL 可能不带 /view 后缀，不能按路由派生）；
 * setter 直接空操作（guest 无 Tabs，永远不会触发 setter，此处仅作类型层兜底）
 * 回收站文档（inTrash）：强制只读（get 恒 false + setter 空操作），
 * Tabs 已隐藏，即使 URL 手输 /edit 也不可编辑，恢复后自动回到可编辑态
 */
const editMode = computed<boolean>({
  get: () => !props.guest && !props.inTrash && route.params.mode !== 'view',
  set: (v) => {
    if (props.guest || props.inTrash) return
    // 无 docId（空库/瞬态 URL）不写后缀，模式维持缺省编辑态
    const docId = route.params.docId as string | undefined
    if (!docId) return
    router.replace({
      name: 'wiki',
      params: { wikiId: wikiId.value, docId, mode: v ? 'edit' : 'view' },
    })
  },
})

/**
 * 分享弹窗显示状态（第一版分享功能：弹窗内配置密码访问，点击分享按钮打开）
 */
const shareDialogVisible = ref(false)

// ============ 回收站文档恢复（右上角「恢复」按钮） ============

/**
 * Wiki 文档 Store：恢复操作需要联动文档树刷新与回收站列表同步
 */
const wikiDocStore = useWikiDocStore()

/**
 * 恢复请求进行中（按钮 loading + 防重复点击）
 */
const restoring = ref(false)

/**
 * 恢复当前文档（整棵子树恢复到原位置，父级已删/缺失时挂根层级末尾）
 * 仅回收站文档展示该按钮（inTrash=true），docId 即回收站顶层条目 ID
 * 成功后：
 * - store.restoreDoc 内部移除回收站条目并强制刷新文档树（父组件 inTrash 计算属性随之翻转为
 *   false，联动隐藏恢复按钮、恢复分享/发布/编辑切换，并把 /view 只读 URL 切回 /edit）
 * - 派发 'wiki-trash-restored' 事件通知左侧栏：若侧栏停留在回收站视图则自动切回目录视图
 */
async function handleRestoreDoc() {
  const id = props.docId
  if (!id || restoring.value) return
  restoring.value = true
  try {
    await wikiDocStore.restoreDoc(id)
    toast.success('已恢复')
    window.dispatchEvent(new CustomEvent('wiki-trash-restored'))
  } catch (error) {
    if (error instanceof ApiError) {
      toast.error(error.message)
    } else {
      console.error('[layout-main] 恢复回收站文档失败:', error)
      toast.error('恢复失败，请稍后重试')
    }
  } finally {
    restoring.value = false
  }
}

/**
 * 库级分享配置（wiki_shares 表库级行，发布开关 shareStatus 的唯一数据源）
 * null = 从未配置过分享（未发布）；由 loadPublishStatus 拉取并在配置变更事件时刷新
 */
const wikiShareConfig = ref<WikiShareConfig | null>(null)

/**
 * 发布设置（wiki_publish 表，站点形态 publishType + 站点外观）
 * null = 读取失败或未就绪，展示层按默认 help 形态兜底；由 loadPublishStatus 并行拉取
 */
const wikiPublishSettings = ref<WikiPublishSettings | null>(null)

/**
 * 是否已发布成 Wiki：直接取 wiki_publish 表的发布开关（getPublishSettings 返回的 enabled，
 * 发布/下架接口单事务内翻转），不再由 shareStatus + publishType 推断 —— 分享与发布是
 * 两个独立状态，发布态唯一数据源是 wiki_publish.enabled
 * 顶栏徽标与卡片状态徽标共用
 */
const isPublishedWiki = computed(() => wikiPublishSettings.value?.enabled === true)

// ============ 发布卡片（下拉内：状态 + 链接 + 预览与配置 / 发布 / 下架） ============

/**
 * 发布下拉菜单显示状态（受控）
 * 预览 / 发布 / 下架等卡片操作完成后主动置 false 收起面板，避免面板遮挡后续反馈
 */
const publishMenuOpen = ref(false)

/**
 * 发布请求进行中（按钮 loading + 防重复提交，预览按钮同步置灰避免并发操作）
 */
const publishing = ref(false)

/**
 * 取消发布（下架）请求进行中（按钮 loading + 防重复提交，预览按钮同步置灰避免并发操作）
 */
const unpublishing = ref(false)

/**
 * Wiki 发布链接：指向 pages 公开站帮助中心路由（/w/{wikiId}），与访客打开的 URL 一致
 * 发布语义即"公开站点"，对外链接用 pages 站（SSR + SEO 友好），origin 约定见 buildWikiPagesLink；
 * 站点形态实时取发布设置（blog → /b/{wikiId}），未就绪时按 help 兜底
 */
const wikiPagesLink = computed(() =>
  buildWikiPagesLink(wikiId.value, wikiPublishSettings.value?.publishType ?? 'help')
)

/**
 * 发布时间文案：取库级分享配置的最后更新时间（wiki_shares.updatedAt）
 * 每次发布/取消发布都会 upsert 该行，故已发布状态下即最近一次发布时间；未配置过分享时为空
 */
const wikiPublishedAtText = computed(() => {
  const iso = wikiShareConfig.value?.updatedAt
  if (!iso) return ''
  return formatDateTime(new Date(iso))
})

/**
 * 复制 Wiki 发布链接到剪贴板
 * 走公共 copyTextToClipboard：安全上下文用 Clipboard API，非安全上下文（本地域名）自动降级 execCommand
 */
async function copyWikiLink() {
  if (await copyTextToClipboard(wikiPagesLink.value)) {
    toast.success('Wiki 链接已复制')
  } else {
    toast.error('复制失败，请手动复制')
  }
}

/**
 * 预览 Wiki 公开站（owner 专属预览模式，整库语义）：
 * 先向后端签发短时效预览令牌（1h，仅 owner 可获取），再新标签打开 pages 站
 * /w/{wikiId}/preview?t={token} —— 预览页带站点外观设置面板，未发布的库也能预览；
 * 不要求先选中文档，pages 站自动定位文档树第一个文档展示
 * 令牌经 URL ?t= 携带（pages 站与 web 不同源无法共享登录态），过期后需从编辑器重新打开
 */
async function handlePreviewWiki() {
  try {
    // 先签发预览令牌（登录过期 / 非 owner 时后端拒绝，此时不打开页面）
    const { token } = await getPublishPreviewToken(wikiId.value).send()
    // 先收起面板再打开新标签，避免面板遮挡新标签页窗口
    publishMenuOpen.value = false
    window.open(buildWikiPreviewLink(wikiId.value, token), '_blank', 'noopener')
  } catch (error) {
    // ApiError = 后端业务校验失败（如登录过期），直接透出后端 message 兜底
    if (error instanceof ApiError) {
      toast.error(error.message)
    } else {
      console.error('[layout-main] 获取预览令牌失败:', error)
      toast.error('打开预览失败，请重试')
    }
  }
}

/**
 * 发布成 Wiki（卡片主操作）：发布动作 + 站点形态两步完成（share/publish 语义拆分）
 * 1. publish 模块发布接口：单事务内翻转发布开关（库级 shareStatus → public +
 *    wiki_publish.enabled → true + 清密码 + 同步 wikis.visibility）
 * 2. publish 模块设置接口：站点形态切为 help（帮助中心，wiki_publish 表，不动 enabled）
 * 成功后收起面板、广播 wiki-share-updated 事件（左侧文档树分享 icon / 顶栏徽标刷新）并重新拉取配置
 */
async function handlePublishWiki() {
  if (publishing.value) return
  publishing.value = true
  try {
    // 第一步：publish 模块开发布开关（原子同步 shareStatus / enabled / visibility）
    await publishWikiSite(wikiId.value).send()
    // 第二步：publish 模块切站点形态为 help（保持其他外观设置不变）
    await upsertPublishSettings(wikiId.value, { publishType: 'help' }).send()
    toast.success('已发布成 Wiki')
    // 先收起面板，再刷新本地状态 + 广播事件（左侧文档树监听同一事件）
    publishMenuOpen.value = false
    window.dispatchEvent(new CustomEvent('wiki-share-updated'))
    await loadPublishStatus()
  } catch (error) {
    // ApiError = 后端业务校验失败，直接透出后端 message 兜底
    if (error instanceof ApiError) {
      toast.error(error.message)
    } else {
      console.error('[layout-main] 发布失败:', error)
      toast.error('发布失败，请重试')
    }
  } finally {
    publishing.value = false
  }
}

/**
 * 下架（卡片主操作）：发布动作走 publish 模块接口（单事务内库级 shareStatus → private +
 * wiki_publish.enabled → false + 同步 wikis.visibility，不动 publish 设置，再次发布仍为 help 形态）
 * 二次确认防误触；成功后广播 wiki-share-updated 事件驱动左侧文档树分享 icon / 顶栏徽标刷新
 */
async function handleUnpublishWiki() {
  if (unpublishing.value) return
  // 二次确认：下架后所有访客立即失去访问能力
  if (!window.confirm('确定下架吗？下架后访客将无法访问此 Wiki。')) {
    return
  }
  unpublishing.value = true
  try {
    await unpublishWikiSite(wikiId.value).send()
    toast.success('已下架')
    // 先收起面板，再刷新本地状态 + 广播事件（左侧文档树监听同一事件）
    publishMenuOpen.value = false
    window.dispatchEvent(new CustomEvent('wiki-share-updated'))
    await loadPublishStatus()
  } catch (error) {
    // ApiError = 后端业务校验失败，直接透出后端 message 兜底
    if (error instanceof ApiError) {
      toast.error(error.message)
    } else {
      console.error('[layout-main] 下架失败:', error)
      toast.error('下架失败，请重试')
    }
  } finally {
    unpublishing.value = false
  }
}

/**
 * 拉取发布状态（share 配置 + publish 设置并行请求）
 * 挂载时执行一次 + 监听 'wiki-share-updated' 事件刷新
 * （分享弹窗保存成功 / 发布卡片发布·下架操作后都会广播该事件，保证徽标与卡片状态实时同步）
 * 两路请求各自 catch 降级为 null（不影响编辑主流程），控制台留痕便于排查
 */
async function loadPublishStatus() {
  // guest 访客只读：发布状态是 owner 专属数据（需登录态），访客态不发请求
  // （否则 onMounted / wiki-share-updated 事件都会打 owner 接口 → 401 报错刷屏）
  if (props.guest) return
  const [shareConfig, publishSettings] = await Promise.all([
    getWikiShareConfig(wikiId.value)
      .send()
      .catch((err: unknown) => {
        console.error('[layout-main] 加载发布状态失败:', err)
        return null
      }),
    getPublishSettings(wikiId.value)
      .send()
      .catch((err: unknown) => {
        console.error('[layout-main] 加载发布设置失败:', err)
        return null
      }),
  ])
  wikiShareConfig.value = shareConfig
  wikiPublishSettings.value = publishSettings
}

/**
 * window 事件监听句柄（onBeforeUnmount 成对移除）
 */
function onShareUpdated() {
  loadPublishStatus()
}

onMounted(() => {
  loadPublishStatus()
  window.addEventListener('wiki-share-updated', onShareUpdated)
})

onBeforeUnmount(() => {
  window.removeEventListener('wiki-share-updated', onShareUpdated)
  // 停止 RAG 状态轮询定时器（防止卸载后继续请求）
  stopRagPolling()
})

/**
 * 保存状态（从 NotionEditor 的 save:status 事件同步）
 */
const saveStatus = ref<AutoSaveStatus>('idle')
/**
 * 最近保存时间
 */
const lastSavedAt = ref<Date | null>(null)

/**
 * 处理 NotionEditor 的保存状态变化
 */
function onSaveStatus(status: AutoSaveStatus, savedAt: Date | null) {
  saveStatus.value = status
  if (savedAt) lastSavedAt.value = savedAt
}

// ============ RAG 索引状态标签（发布按钮左侧，可点击弹层 + 立即索引） ============

/**
 * 当前文档的 RAG 索引状态详情
 * null = 尚未加载（切换文档瞬间）或无文档
 */
const ragDetail = ref<RagDocumentStatus | null>(null)

/** RAG 状态轮询定时器句柄（索引中每 3s 刷新，进入终态后停止） */
let ragPollTimer: ReturnType<typeof setInterval> | null = null

/** RAG 轮询间隔（毫秒）：索引为异步任务，保存后通常数秒内完成 */
const RAG_POLL_INTERVAL_MS = 3000

/**
 * 拉取当前文档的 RAG 索引状态
 * pending/running 时启动轮询直至进入终态（done/failed/none）
 * 查询失败仅告警不阻断页面（保持当前展示）
 */
async function loadRagStatus() {
  if (!props.documentId) return
  try {
    const result = await getDocumentRagStatus(props.documentId).send()
    ragDetail.value = result
    if (result.status === 'pending' || result.status === 'running') {
      startRagPolling()
    } else {
      stopRagPolling()
    }
  } catch (err) {
    console.warn('查询文档 RAG 状态失败:', err)
  }
}

/** 启动 RAG 状态轮询（幂等：已有定时器时跳过） */
function startRagPolling() {
  if (ragPollTimer) return
  ragPollTimer = setInterval(loadRagStatus, RAG_POLL_INTERVAL_MS)
}

/** 停止 RAG 状态轮询 */
function stopRagPolling() {
  if (ragPollTimer) {
    clearInterval(ragPollTimer)
    ragPollTimer = null
  }
}

// 切换文档时重置轮询并重新拉取状态（immediate 覆盖首屏）
watch(
  () => props.documentId,
  () => {
    stopRagPolling()
    ragDetail.value = null
    loadRagStatus()
  },
  { immediate: true }
)

// 保存成功后刷新：开启自动索引的库保存挂钩会重新入队任务，状态从 done 转为 pending
watch(saveStatus, (v) => {
  if (v === 'saved') loadRagStatus()
})

/** 标签弹层显示状态（点击 RAG 标签打开，展示最新索引时间与立即索引按钮） */
const ragPopoverVisible = ref(false)

/** 立即索引请求进行中（按钮 loading + 防重复点击） */
const reindexing = ref(false)

/** 徽标文案（四态：未索引/索引中/已索引/索引失败） */
const ragStatusText = computed(() => {
  const s = ragDetail.value?.status ?? 'none'
  if (s === 'pending' || s === 'running') return '索引中'
  if (s === 'done') return '已索引'
  if (s === 'failed') return '索引失败'
  return '未索引'
})

/** RAG 状态圆点颜色：已索引绿色，索引中琥珀（呼吸闪烁），失败红色，未索引灰色 */
const ragDotClass = computed(() => {
  const s = ragDetail.value?.status ?? 'none'
  if (s === 'done') return 'bg-green-500'
  if (s === 'failed') return 'bg-red-500'
  if (s === 'pending' || s === 'running') return 'bg-amber-500 animate-pulse'
  return 'bg-muted-foreground/40'
})

/** 最新 RAG 时间文案：最近一次成功同步时间（YYYY-MM-DD HH:mm:ss），从未索引时显示占位 */
const ragLastSyncedText = computed(() => {
  const iso = ragDetail.value?.lastSyncedAt
  if (!iso) return '从未索引'
  return formatDateTime(new Date(iso))
})

/**
 * 格式化日期时间为 YYYY-MM-DD HH:mm:ss（本地时区）
 */
function formatDateTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/**
 * 立即索引当前文档：调用单文档重索引接口，成功后立即刷新状态并启动轮询
 * 失败提示由调用方 toast（ApiError.message 为后端错误信息）
 */
async function handleReindexDocument() {
  if (!props.documentId || reindexing.value) return
  reindexing.value = true
  try {
    await reindexDocumentRag(props.documentId).send()
    toast.success('已加入索引队列，完成后自动更新状态')
    await loadRagStatus()
  } catch (err) {
    toast.error((err as Error).message || '触发索引失败，请稍后重试')
  } finally {
    reindexing.value = false
  }
}

/**
 * 标题实时同步（输入即触发，不走保存接口）
 * 编辑器内每次输入都把最新标题上报，父组件更新本地文档树/面包屑，
 * 侧边栏与顶部标题即时跟随，无需等到失焦/回车才刷新
 */
function onLiveTitle(title: string) {
  emit('update:doc-title', title)
}

/**
 * 处理 NotionEditor 的标题保存请求
 * 调用 API 保存节点标题，成功后通知父组件
 */
async function onSaveTitle(title: string) {
  if (!props.nodeId) return
  try {
    await saveNodeTitle(props.nodeId, { title })
    emit('update:doc-title', title)
  } catch (err) {
    console.error('标题保存失败:', err)
  }
}

/**
 * 处理 NotionEditor 的图标保存请求
 * 调用 API 保存节点图标，成功后通知父组件刷新树
 */
async function onSaveIcon(icon: string) {
  if (!props.nodeId) return
  try {
    await saveNodeIcon(props.nodeId, { icon })
    emit('update:doc-icon', icon)
  } catch (err) {
    console.error('图标保存失败:', err)
  }
}

/**
 * 格式化"已保存 X 分钟前"文本
 * local-first 语义：编辑产生后本地（内存 + IndexedDB）即刻落盘即视为已保存，
 * lastSavedAt 为空时（刚挂载尚未有服务端确认）显示「已保存」而非「未保存」
 */
function formatSavedText(): string {
  if (saveStatus.value === 'saving') return '保存中…'
  if (saveStatus.value === 'error') return '保存失败'
  if (!lastSavedAt.value) return saveStatus.value === 'saved' ? '已保存' : '未保存'
  const diff = Date.now() - lastSavedAt.value.getTime()
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return '已保存 · 刚刚'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `已保存 · ${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  return `已保存 · ${hours} 小时前`
}

/**
 * Markdown 弹窗显示状态
 */
const markdownViewVisible = ref(false)

/**
 * Markdown 文本内容
 */
const markdownContent = ref('')

/**
 * 打开 Markdown 视图
 * 从 NotionEditor 获取当前文档的 Markdown 格式内容并展示在全屏弹窗中
 */
function openMarkdownView() {
  markdownContent.value = notionEditorRef.value?.getMarkdown() ?? ''
  markdownViewVisible.value = true
}

/**
 * 处理 Dialog 状态变化
 */
function onMarkdownDialogChange(open: boolean) {
  if (!open) markdownViewVisible.value = false
}

/**
 * 复制 Markdown 内容到剪贴板
 *
 * 走公共 copyTextToClipboard 工具（lib/utils）：
 * - 安全上下文（HTTPS / localhost）用 Clipboard API；
 * - 非安全上下文（如 http://yokimind.local:6001）自动降级 execCommand，
 *   且降级 textarea 会挂到当前弹窗容器内 + 先 focus 再 select，
 *   规避 reka-ui Dialog 焦点陷阱抢焦点导致复制失败的问题。
 *
 * 历史坑：旧实现直接调 navigator.clipboard.writeText（非安全上下文下
 * navigator.clipboard 为 undefined，抛 TypeError），降级分支只 select 不 focus，
 * execCommand('copy') 复制不到 textarea 内容且无任何提示，剪贴板残留旧值，
 * 表现为「点复制后粘贴出来的是上一次复制的内容」。
 */
async function copyMarkdown() {
  if (await copyTextToClipboard(markdownContent.value)) {
    toast.success('Markdown 已复制')
  } else {
    toast.error('复制失败，请手动复制')
  }
}

/**
 * 顶栏 Markdown 按钮：一键复制当前文档的 Markdown 源码到剪贴板
 *
 * - 不经过「Markdown 源码」弹窗，直接从 NotionEditor 暴露的 getMarkdown() 取值
 *   （编辑器常驻挂载，编辑 / 预览两种模式下都能取到当前正文）；
 * - 复制走公共 copyTextToClipboard 工具（Clipboard API + 非安全上下文降级，
 *   详见 copyMarkdown 注释），成功提示「已复制 Markdown 格式」；
 * - 空白文档（全文无可见字符）不复制，toast 提示避免复制出空内容。
 */
async function copyMarkdownFromEditor() {
  const markdown = notionEditorRef.value?.getMarkdown() ?? ''
  if (!markdown.trim()) {
    toast.error('当前文档暂无内容，无法复制')
    return
  }
  if (await copyTextToClipboard(markdown)) {
    toast.success('已复制 Markdown 格式')
  } else {
    toast.error('复制失败，请手动复制')
  }
}

/**
 * 顶栏「导出」dropdown：导出当前文档为 Markdown 压缩包
 *
 * - 正文从 NotionEditor 暴露的 getMarkdown() 取实时内容（含未保存的 local-first 改动，
 *   所见即所得）；图片等资源下载后打包进 assets/，引用同步改写为相对路径；
 * - 部分资源下载失败不算导出失败：zip 照常产出，失败项保留原链接并 toast 警告。
 */
async function handleExportMarkdownZip() {
  const markdown = notionEditorRef.value?.getMarkdown() ?? ''
  try {
    const result = await exportMarkdownZip(props.docTitle ?? '', markdown)
    if (!result) {
      toast.error('当前文档暂无内容，无法导出')
      return
    }
    if (result.failedAssetCount > 0) {
      toast.warning(`已导出 ${result.fileName}（${result.failedAssetCount} 个资源下载失败，已保留原链接）`)
    } else if (result.assetCount > 0) {
      toast.success(`已导出 ${result.fileName}（含 ${result.assetCount} 个资源）`)
    } else {
      toast.success(`已导出 ${result.fileName}`)
    }
  } catch (err) {
    console.error('[export-markdown] 导出失败', err)
    toast.error('导出失败，请稍后重试')
  }
}

/**
 * 顶栏「导出」dropdown：导出当前文档为单个 Markdown 文件
 * 仅正文 .md（首行补 # 标题），图片保留原始链接不做下载改写，直接下载不打包
 */
function handleExportMarkdownFile() {
  const markdown = notionEditorRef.value?.getMarkdown() ?? ''
  const result = exportMarkdownFile(props.docTitle ?? '', markdown)
  if (!result) {
    toast.error('当前文档暂无内容，无法导出')
    return
  }
  toast.success(`已导出 ${result.fileName}`)
}
</script>
