<template>
  <aside class="flex flex-col h-full w-full bg-muted min-w-0">
    <!-- 顶部：Logo 图片跳转首页，个人知识库文字跳转仪表盘 -->
    <div class="flex justify-between items-center">
      <div class="flex items-center gap-0.5 h-10 pt-2 px-4 transition-colors">
        <!-- Logo 图片：点击跳转首页 / -->
        <span
          class="inline-flex items-center justify-center pl-0.5 cursor-pointer rounded transition-colors hover:bg-accent"
          title="回到首页"
          @click="router.push('/')"
        >
          <img src="/logo-icon.png" class="h-7" />
        </span>
        <ChevronRight :size="14" class="text-muted-foreground/50" />
        <!-- 访客态：静态「知识库分享」文案（无仪表盘可跳转）；
             owner：个人知识库，点击跳转仪表盘 /dashboard -->
        <span v-if="guest" class="text-[13px] text-muted-foreground">知识库分享</span>
        <span
          v-else
          class="text-[13px] text-muted-foreground cursor-pointer rounded px-1 py-0.5 transition-colors hover:bg-accent hover:text-foreground"
          title="个人知识库"
          @click="router.push('/dashboard')"
          >个人知识库</span
        >
      </div>
      <!-- 右侧：问问 AI 按钮（图标 + 文字，owner 专属；guest 访客无登录态 /rag/chat 需鉴权，不展示）：
           已开启 RAG 点击打开 AI 问答弹窗，未开启 RAG 弹「必须先开启」提示（见 handleAskYokiClick）；
           位置经用户指定：顶部面包屑行右端（原独立入口条 → 标题行图标 → 此处文字按钮），
           ghost 变体保持顶栏轻量，h-7 紧凑尺寸适配 32px 内容高，pr-3 与下方标题行「···」按钮右缘对齐 -->
      <div v-if="!guest" class="flex items-center h-10 pt-2 pr-3">
        <Button
          size="sm"
          variant="outline"
          title="基于知识库内容的 AI 问答"
          @click="handleAskYokiClick"
        >
          <Sparkles class="size-3" />
          <span class="text-[12px]">问问 AI</span>
        </Button>
      </div>
      <!-- 收拢按钮已迁移至中间栏顶部 (LayoutMain)，此处不再提供 -->
    </div>

    <!-- 侧栏顶栏 -->
    <div class="flex items-center justify-between h-10 px-3 my-2 shrink-0 gap-2">
      <!-- owner：知识库切换器（下拉）；guest：静态库信息块（见下方 v-else） -->
      <DropdownMenu v-if="!guest" v-model:open="wikiSwitcherVisible">
        <DropdownMenuTrigger as-child>
          <div
            class="flex items-center gap-2 cursor-pointer rounded-lg px-1 py-1 hover:bg-accent transition-colors"
          >
            <span
              class="inline-flex items-center justify-center w-7 h-7 rounded-lg"
              :style="{ background: wikiIconVisual.bg }"
            >
              <WikiIcon :icon="sidebarWiki?.icon" :color="sidebarWiki?.color" :size="16" />
            </span>
            <span class="text-[17px] font-semibold text-foreground">{{
              sidebarWiki?.name || '知识库'
            }}</span>
            <!-- 知识库锁状态图标：私密（未开启整库分享）= 锁住；公开（库分享开启）= 未锁住
                 判定数据来自 shareStatusLookup（getWikiShareConfig），配置未加载时不显示
                 点击图标直接打开知识库分享权限弹窗（复用 share-dialog 的 wiki-only 模式）：
                 pointerdown 与 click 都要 stop，否则事件冒泡到 DropdownMenuTrigger 会同时打开切换器下拉 -->
            <span
              v-if="wikiShareIconKind"
              class="cursor-pointer rounded transition-colors hover:text-foreground"
              :title="wikiShareIconKind === 'public' ? '公开分享中' : '私密（未开启分享）'"
              @pointerdown.stop
              @click.stop="openWikiShareDialog()"
            >
              <Globe
                v-if="wikiShareIconKind === 'public'"
                :size="14"
                class="text-muted-foreground/70 shrink-0"
              />
              <Lock v-else :size="14" class="text-muted-foreground/70 shrink-0" />
            </span>
            <ChevronDown
              :size="14"
              class="text-muted-foreground/50 transition-transform"
              :class="{ 'rotate-180': wikiSwitcherVisible }"
            />
          </div>
        </DropdownMenuTrigger>
        <DropdownMenuContent class="w-[320px] p-0" align="start" side="bottom" :side-offset="4">
          <!-- Tab 切换 -->
          <div class="px-4 pt-3">
            <Tabs v-model:model-value="wikiSwitcherTab">
              <TabsList class="grid w-full grid-cols-2">
                <TabsTrigger value="personal">我个人的</TabsTrigger>
                <TabsTrigger value="shared">邀请协作的</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          <!-- 搜索框 -->
          <div class="px-4 py-2">
            <InputGroup class="h-8">
              <InputGroupAddon align="inline-start">
                <Search />
              </InputGroupAddon>
              <InputGroupInput
                v-model="wikiSearchKeyword"
                type="text"
                placeholder="搜索知识库"
                class="text-sm"
              />
            </InputGroup>
          </div>

          <!-- 知识库列表 -->
          <div class="px-2 pb-3 max-h-[500px] overflow-y-auto">
            <!-- 加载中 -->
            <div v-if="wikisLoading" class="text-center py-6 text-sm text-muted-foreground">
              加载中...
            </div>

            <!-- 邀请协作 Tab 暂未实现 -->
            <div
              v-else-if="wikiSwitcherTab === 'shared'"
              class="text-center py-6 text-sm text-muted-foreground"
            >
              暂无协作知识库
            </div>

            <!-- 空状态 -->
            <div
              v-else-if="filteredWikis.length === 0"
              class="text-center py-6 text-sm text-muted-foreground"
            >
              未找到知识库
            </div>

            <!-- 知识库列表 -->
            <div v-else class="gap-y-1 flex flex-col">
              <button
                v-for="item in filteredWikis"
                :key="item.id"
                class="w-full flex items-center gap-3 px-2.5 py-2 rounded-lg hover:bg-accent transition-colors text-left"
                :class="{ 'bg-accent': item.id === route.params.wikiId }"
                @click="switchToWiki(item.id)"
              >
                <!-- 图标 -->
                <span
                  class="inline-flex items-center justify-center w-8 h-8 rounded-lg shrink-0"
                  :style="{ background: resolveWikiIconColor(item.color).bg }"
                >
                  <WikiIcon :icon="item.icon" :color="item.color" :size="16" />
                </span>

                <!-- 名称和标识 -->
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-1.5">
                    <span class="text-sm font-medium truncate">{{ item.name }}</span>
                    <Lock
                      v-if="item.visibility === 'private'"
                      :size="12"
                      class="text-muted-foreground shrink-0"
                    />
                  </div>
                  <span class="text-xs text-muted-foreground">{{ item.docCount }} 篇文档</span>
                </div>

                <!-- 当前知识库标识 -->
                <Check
                  v-if="item.id === route.params.wikiId"
                  :size="16"
                  class="text-primary shrink-0"
                />
              </button>
            </div>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>

      <!-- 访客态：静态库信息块（无切换器/锁状态图标/下拉），仅展示分享库图标与名称 -->
      <div v-else class="flex items-center gap-2 px-1 py-1 min-w-0">
        <span
          class="inline-flex items-center justify-center w-7 h-7 rounded-lg shrink-0"
          :style="{ background: wikiIconVisual.bg }"
        >
          <WikiIcon :icon="sidebarWiki?.icon" :color="sidebarWiki?.color" :size="16" />
        </span>
        <span class="text-[17px] font-semibold text-foreground truncate">{{
          sidebarWiki?.name || '知识库'
        }}</span>
      </div>

      <!-- 右侧操作组：知识库级 RAG 标签 + 设置按钮（guest 访客无管理操作，隐藏） -->
      <div v-if="!guest" class="flex items-center gap-1 shrink-0">
        <!-- RAG 索引状态标签（点 + RAG 文本）：当前知识库的整体 AI 索引进度 -->
        <!-- 状态用圆点颜色表达：未索引（灰）/ 索引中（琥珀，呼吸闪烁）/ 有失败（红）/ 全部已索引（绿）；点击弹出统计 -->
        <!-- 暂时隐藏 RAG 标志（恢复时删除 v-if="false" 即可） -->
        <Popover v-if="false" v-model:open="wikiRagPopoverVisible">
          <PopoverTrigger as-child>
            <!-- 共用徽章组件：与右侧文档栏同一套 RAG 样式，圆点随整库索引状态变色 -->
            <RagStatusBadge
              :dot-class="wikiRagDotClass"
              :title="`AI 索引：${wikiRagStatusText}`"
              aria-label="知识库 AI 索引状态"
            />
          </PopoverTrigger>
          <PopoverContent align="end" class="w-60 p-3 text-xs">
            <!-- 弹层标题：整体索引状态文案 -->
            <div class="flex items-center gap-1.5 font-medium text-foreground">
              AI 索引：{{ wikiRagStatusText }}
            </div>
            <!-- 统计行：已索引 / 待同步 / 失败 -->
            <div class="mt-1.5 text-muted-foreground">
              已索引 {{ wikiRagStatus?.done ?? 0 }} · 待同步 {{ wikiRagStatus?.pending ?? 0 }} ·
              失败 {{ wikiRagStatus?.failed ?? 0 }}
            </div>
            <!-- 切片总数 -->
            <div class="mt-1 text-muted-foreground">
              共 {{ wikiRagStatus?.chunkCount ?? 0 }} 个切片
            </div>
            <!-- 全库最新 RAG 时间 -->
            <div class="mt-1 text-muted-foreground">最新 RAG 时间：{{ wikiRagLastSyncedText }}</div>
            <!-- 失败原因提示（有失败任务时） -->
            <div v-if="wikiRagStatus?.failed" class="mt-1 text-red-500">
              有 {{ wikiRagStatus?.failed }} 个文档索引失败，可重建全库索引重试
            </div>
            <!-- 全库重建按钮：重置该库全部文档任务并重新入队（索引中不允许重复触发） -->
            <Button
              size="sm"
              class="mt-2.5 w-full h-7"
              :disabled="wikiReindexing || !!wikiRagStatus?.pending"
              @click="handleWikiReindex"
            >
              <Loader2 v-if="wikiReindexing" :size="13" class="animate-spin" />
              重建全库索引
            </Button>
          </PopoverContent>
        </Popover>
        <!-- 知识库设置按钮 -->
        <Button
          variant="ghost"
          size="icon"
          class="text-muted-foreground hover:text-foreground h-8 w-8"
          title="知识库设置"
          @click="editWikiVisible = true"
        >
          <MoreHorizontal :size="16" />
        </Button>
      </div>
    </div>

    <!-- 搜索栏 + 新建按钮（Notion 风格统一节点模型：仅"新建文档"） -->
    <!-- owner：搜索按钮为触发器（点击 / ⌘J 唤起 DocSearchDialog，不内联过滤树）+ 新建按钮；
         guest：内联搜索框直接过滤文档树（无 DocSearchDialog、无新建语义） -->
    <div class="px-3 pb-2 flex gap-1">
      <!-- 访客态：内联搜索框（输入即过滤 guestSidebarTreeData） -->
      <InputGroup v-if="guest" class="h-9 flex-1 bg-white border">
        <InputGroupAddon align="inline-start">
          <Search />
        </InputGroupAddon>
        <InputGroupInput
          v-model="guestKeyword"
          type="text"
          placeholder="搜索文档"
          class="text-xs"
        />
      </InputGroup>
      <!-- owner 模式：搜索按钮 + 新建按钮 -->
      <template v-else>
        <!-- 搜索按钮：样式对齐原输入框（白底 + 边框 + 圆角），左侧放大镜与占位文案、右侧 ⌘J 快捷键提示 -->
        <Button
          variant="outline"
          class="flex-1 h-9 justify-between bg-white border text-xs font-normal text-muted-foreground hover:bg-white"
          title="搜索文档（⌘J）"
          @click="searchOpen = true"
        >
          <span class="flex items-center gap-2">
            <Search :size="16" class="opacity-70" />
            搜索文档…
          </span>
          <!-- 快捷键提示暂时隐藏（实际唤起快捷键为 ⌘J，展示有歧义） -->
          <!-- <Kbd class="text-[10px]">⌘K</Kbd> -->
        </Button>

        <!-- 新建按钮：下拉菜单（回收站视图隐藏）：
             「新建文档」= 原有行为，直接新建根层级空白文档并进入编辑态；
             「导入文档」二级子菜单 → 「Markdown」= 选择本地 .md 文件，解析为 TipTap
             文档创建（解析管线见 notion-editor/utils/markdown-import.ts），
             二级结构便于后续扩展更多导入格式（Word / HTML 等） -->
        <DropdownMenu v-if="viewMode === 'tree'">
          <DropdownMenuTrigger as-child>
            <Button
              variant="outline"
              size="icon"
              class="w-9 h-9 border"
              :disabled="creating"
              title="新建"
            >
              <Plus />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuGroup>
              <!-- 一级项「新建文档」：图标用 FileText（文档语义，与触发按钮的 + 区分） -->
              <DropdownMenuItem @click="handleCreateDoc">
                <FileText class="size-3.5 mr-1" />
                新建文档
              </DropdownMenuItem>
              <!-- 二级项「导入文档」：悬停展开格式子菜单，二级项为具体导入格式 -->
              <DropdownMenuSub>
                <DropdownMenuSubTrigger class="cursor-pointer">
                  <FileUp class="size-3.5 mr-1" />
                  导入文档
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent class="w-36 p-1.5 rounded-xl">
                  <DropdownMenuItem
                    class="rounded-lg cursor-pointer"
                    @click="triggerImportMarkdown"
                  >
                    <FileCode class="size-3.5 mr-1" />
                    Markdown
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <!-- 隐藏文件选择框：accept 限定 Markdown 文件（.md / .markdown），
             由二级菜单「Markdown」项触发 click；导入处理见 onImportFileChange -->
        <input
          ref="markdownFileInputRef"
          type="file"
          accept=".md,.markdown,text/markdown"
          class="hidden"
          @change="onImportFileChange"
        />
      </template>
    </div>

    <!-- 导航区域 -->
    <div class="px-3 pb-1">
      <!-- 访客态：固定「目录」行（无视图切换/回收站语义），右侧保留全部展开/折叠切换 -->
      <div
        v-if="guest"
        class="w-full flex items-center gap-2 h-9 px-2 rounded-lg text-sm bg-accent text-foreground font-medium"
      >
        <ListTree :size="16" />
        <span class="text-left">目录</span>
        <span class="flex-1" />
        <component
          :is="guestAllExpanded ? Minimize2 : Maximize2"
          :size="14"
          class="text-muted-foreground/70 cursor-pointer hover:text-foreground transition-colors"
          :title="guestAllExpanded ? '全部折叠文件夹' : '全部展开文件夹'"
          @click="toggleAllFolders"
        />
      </div>
      <!-- owner：目录/回收站视图切换行：左侧「图标 + 标题 + chevron」整体为下拉触发器，
           右侧功能区按视图切换：目录视图 = 展开/折叠；回收站视图 = 一键清空（click.stop 独立）；
           整行保留 bg-accent 灰底表示当前视图，下拉菜单当前项同样灰底高亮 -->
      <div
        v-else
        class="w-full flex items-center gap-2 h-9 rounded-lg text-sm transition-colors bg-accent text-foreground font-medium"
      >
        <!-- 下拉触发器：点击图标 / 标题 / chevron 任意位置弹出视图切换菜单 -->
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <button
              type="button"
              class="flex items-center gap-2 h-8 -ml-2 pl-2 pr-1 rounded-md cursor-pointer hover:bg-accent-foreground/5 transition-colors"
              title="切换视图"
            >
              <component :is="viewMode === 'tree' ? ListTree : Trash2" :size="16" />
              <span class="text-left">{{ viewMode === 'tree' ? '目录' : '回收站' }}</span>
              <ChevronDown class="w-3.5 h-3.5 text-foreground/50" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent class="w-36" align="start" side="bottom" :side-offset="4">
            <!-- 当前激活视图项灰底高亮（bg-accent）+ Check 标记 -->
            <DropdownMenuItem
              :class="viewMode === 'tree' ? 'bg-accent' : ''"
              @click="viewMode = 'tree'"
            >
              <ListTree class="size-3.5 mr-1" />
              目录
              <Check v-if="viewMode === 'tree'" class="ml-auto size-3.5" />
            </DropdownMenuItem>
            <DropdownMenuItem
              :class="viewMode === 'trash' ? 'bg-accent' : ''"
              @click="viewMode = 'trash'"
            >
              <Trash2 class="size-3.5 mr-1" />
              回收站
              <Check v-if="viewMode === 'trash'" class="ml-auto size-3.5" />
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <!-- 弹性占位：把右侧功能按钮推到行尾 -->
        <span class="flex-1" />

        <!-- 目录视图：全部展开 / 全部折叠（在触发按钮之外，click.stop 不会误开下拉） -->
        <component
          :is="isAllExpanded ? Minimize2 : Maximize2"
          v-if="viewMode === 'tree'"
          :size="14"
          class="text-muted-foreground/70 cursor-pointer hover:text-foreground transition-colors"
          :title="isAllExpanded ? '全部折叠文件夹' : '全部展开文件夹'"
          @click.stop="toggleAllFolders"
        />
        <!-- 回收站视图：一键清空（点击弹出确认弹窗，硬删除不可恢复） -->
        <button
          v-else
          type="button"
          class="size-5 flex items-center justify-center rounded hover:bg-accent-foreground/10 transition-colors"
          title="清空回收站"
          @click.stop="clearOpen = true"
        >
          <BrushCleaning class="w-3.5 h-3.5 text-foreground/50" />
        </button>
      </div>
    </div>

    <!-- 文档树：使用 arco-vue Tree 组件实现渲染、展开/收起、拖拽排序
         dragstart 用捕获阶段监听（arco 内部 onDragStart 会 stopPropagation 阻断冒泡，
         冒泡阶段监听收不到），用于把默认直角快照幽灵替换为圆角幽灵 -->
    <div
      v-if="viewMode === 'tree'"
      class="flex-1 min-h-0 overflow-y-auto px-4 pb-2"
      aria-label="文档树"
      @dragstart.capture="onTreeDragStart"
    >
      <!-- 加载态：guest 用父组件注入的 guestLoading（树数据由 index.vue 拉取） -->
      <div
        v-if="guest ? guestLoading : loading"
        class="p-4 text-center text-xs text-muted-foreground/70"
      >
        加载中…
      </div>
      <!-- 空态：guest 搜索态区分「未找到匹配文档」与「暂无文档」 -->
      <div
        v-else-if="(guest ? guestSidebarTreeData : displayTree).length === 0"
        class="p-4 text-center text-xs text-muted-foreground/70"
      >
        {{ guest && guestSearching ? '未找到匹配文档' : '暂无文档' }}
      </div>
      <a-tree
        v-else
        blockNode
        class="yokimind-tree"
        :data="guest ? guestSidebarTreeData : displayTree"
        :draggable="!guest"
        :selected-keys="selectedKeys"
        :expanded-keys="guest ? guestEffectiveExpandedKeys : openKeys"
        @update:expanded-keys="onExpandedKeysChange"
        @select="onTreeSelect"
        @drop="onTreeDrop"
      >
        <!-- 自定义展开/收起图标：使用同一 ChevronDown 图标，展开时旋转 90° 变向下 -->
        <template #switcher-icon="nodeStatus">
          <ChevronDown
            v-if="nodeStatus && !nodeStatus.isLeaf"
            class="w-3.5 h-3.5 text-foreground/50 shrink-0 transition-transform duration-150"
          />
          <span v-else class="inline-block w-3.5 h-3.5 shrink-0" />
        </template>

        <!-- 自定义节点标题：图标 + 标题 + 操作菜单
             说明：arco 提供 title 插槽时，作用域 props 即该节点的 treeNodeData（含 key/title），
             因此用 { key, title } 解构即可拿到节点 ID 用于图标查询与菜单操作 -->
        <template #title="{ key, title }">
          <div
            class="group relative flex items-center w-full h-8 px-2 rounded-md cursor-pointer transition-colors"
            :class="
              key === activeId
                ? 'bg-primary/10 text-primary font-medium'
                : 'text-foreground/70 hover:bg-accent hover:text-foreground'
            "
          >
            <!-- 节点图标：有自定义 emoji icon 时显示，无 icon 时不显示 -->
            <span v-if="nodeIcon(String(key))" class="text-base leading-none shrink-0 mr-1">{{
              nodeIcon(String(key))
            }}</span>
            <span class="flex-1 min-w-0 text-sm truncate">{{ title }}</span>
            <!-- 分享状态图标（owner 专属：guest 恒隐藏，shareConfig 在 guest 模式本就不加载）：
                 - Globe（常显）：仅库分享关闭（顶栏显示 Lock）时该节点单独开启了页面分享；
                   库分享开启时顶栏已显示库级 Globe，节点不再重复显示（去重）
                 - 私密节点不显示任何图标（此前 hover 显示的 Lock 已按设计移除）
                 - 分享配置未加载或加载失败时不渲染任何图标（静默降级，不阻塞文档树渲染）
                 点击图标打开该节点的分享权限弹窗（share-dialog full 模式）：
                 click.stop 阻止冒泡到树节点行，避免同时触发文档选中/跳转 -->
            <span
              v-if="!guest && nodeShareIconKind(String(key)) === 'public'"
              class="flex items-center shrink-0 cursor-pointer"
              @click.stop="openNodeShareDialog(String(key))"
            >
              <Globe
                :size="14"
                class="w-3.5 h-3.5 mr-1 text-foreground/40 shrink-0"
                title="已对外公开"
              />
            </span>
            <!-- 操作菜单按钮（owner 专属，guest 只读隐藏）：hover 行时才显示（hidden 不占位，让标题吃满整行宽度）；
                 菜单打开期间（menuOpenKey 命中）即使鼠标已移走也保持显示，
                 避免下拉菜单还开着而触发按钮先消失的割裂感；
                 按钮显示由 btnVisibleKey 控制（关闭后延迟隐藏）：按钮是菜单 popper 的定位锚点，
                 若退场动画期间按钮就 display:none，菜单残影会被重定位到页面左上角形成闪现 -->
            <DropdownMenu
              v-if="!guest"
              :open="menuOpenKey === String(key)"
              @update:open="(v: boolean) => onMenuOpen(String(key), v)"
            >
              <DropdownMenuTrigger as-child>
                <button
                  class="items-center justify-center size-5 rounded hover:bg-accent-foreground/10 transition-colors shrink-0"
                  :class="btnVisibleKey === String(key) ? 'flex' : 'hidden group-hover:flex'"
                  @click.stop
                >
                  <MoreHorizontal class="w-4 h-4 text-foreground/50" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent class="w-30" align="end">
                <DropdownMenuGroup>
                  <DropdownMenuItem @click="handleCreateChildDoc(String(key))">
                    <Plus class="size-3.5 mr-1" />
                    新建子文档
                  </DropdownMenuItem>
                  <DropdownMenuItem @click="openRenameDialog(String(key))">
                    <PencilLine class="size-3.5 mr-1" />
                    重命名
                  </DropdownMenuItem>
                  <!-- 分享：复用树节点 Globe 图标同一入口（openNodeShareDialog），
                       打开 full 模式分享弹窗（分享此页面 + 知识库可见性双 Tab） -->
                  <DropdownMenuItem @click="openNodeShareDialog(String(key))">
                    <Share2 class="size-3.5 mr-1" />
                    分享
                  </DropdownMenuItem>
                  <!-- 分割线 + 危险操作：删除与常规操作区分（destructive 红色样式） -->
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" @click="openDeleteDialog(String(key))">
                    <Trash2 class="size-3.5 mr-1" />
                    删除
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </template>
      </a-tree>
    </div>

    <!-- 回收站列表：viewMode === 'trash' 时替代文档树展示（顶层删除项，按删除时间倒序）
         行内 hover 出现操作按钮：恢复（直接执行）/ 彻底删除（需确认弹窗） -->
    <div v-else class="flex-1 min-h-0 overflow-y-auto px-4 pb-2" aria-label="回收站列表">
      <div v-if="trashLoading" class="p-4 text-center text-xs text-muted-foreground/70">
        加载中…
      </div>
      <div
        v-else-if="trashItems.length === 0"
        class="p-4 text-center text-xs text-muted-foreground/70"
      >
        回收站为空
      </div>
      <div v-else class="flex flex-col gap-y-1">
        <div
          v-for="item in trashItems"
          :key="item.id"
          class="group relative flex items-center w-full h-8 px-2 rounded-md cursor-pointer text-sm text-foreground/70 hover:bg-accent hover:text-foreground transition-colors"
          :class="item.id === activeId && 'bg-accent text-foreground'"
          :title="`删除于 ${formatTrashDate(item.deletedAt)}`"
          @click="openTrashDoc(item)"
        >
          <!-- 节点图标：有 emoji icon 时显示 -->
          <span v-if="item.icon" class="text-base leading-none shrink-0 mr-1">{{ item.icon }}</span>
          <span class="flex-1 min-w-0 truncate">{{ item.title }}</span>
          <!-- hover 操作按钮：与文档树节点菜单一致 hidden 不占位，hover 时展示 -->
          <span class="hidden group-hover:flex items-center shrink-0">
            <button
              class="size-5 flex items-center justify-center rounded hover:bg-accent-foreground/10 transition-colors"
              title="恢复"
              @click.stop="handleRestoreTrash(item.id)"
            >
              <Undo2 class="w-3.5 h-3.5 text-foreground/50" />
            </button>
            <button
              class="size-5 flex items-center justify-center rounded hover:bg-accent-foreground/10 transition-colors"
              title="彻底删除"
              @click.stop="openPurgeDialog(item)"
            >
              <Trash2 class="w-3.5 h-3.5 text-foreground/50" />
            </button>
          </span>
        </div>
      </div>
    </div>

    <!-- 底部：owner 用户信息块（NavUser 风格：触发行 + 向上弹出的用户菜单）；
         guest 访客无账号体系，不渲染（左下角留白，品牌 logo 已在顶部展示） -->
    <div v-if="!guest" class="p-2 shrink-0">
      <NavUser />
    </div>

    <!-- 重命名弹窗 -->
    <Dialog v-model:open="renameOpen">
      <DialogContent class="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>重命名</DialogTitle>
          <DialogDescription>修改节点标题</DialogDescription>
        </DialogHeader>
        <!-- 表单区：label 与输入框间距用 gap-3（12px），避免标签贴住输入框 -->
        <div class="flex flex-col gap-3">
          <label class="text-sm font-medium leading-none">名称</label>
          <Input v-model="renameValue" placeholder="请输入新名称" />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" @click="renameOpen = false">取消</Button>
          <Button type="button" :disabled="!renameValue.trim() || renaming" @click="confirmRename">
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- 删除确认弹窗 -->
    <AlertDialog v-model:open="deleteOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>确认删除</AlertDialogTitle>
          <AlertDialogDescription>
            此操作将把「{{ deleteTargetTitle }}」
            <span v-if="deleteTargetHasChildren">及其所有子内容</span>
            移入回收站，可在回收站中恢复。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction :disabled="deleting" @click="confirmDelete">
            {{ deleting ? '删除中...' : '确认删除' }}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <!-- 彻底删除确认弹窗（回收站内操作，硬删除不可恢复） -->
    <AlertDialog v-model:open="purgeOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>彻底删除</AlertDialogTitle>
          <AlertDialogDescription>
            此操作将从回收站中彻底删除「{{ purgeTargetTitle }}」
            <span v-if="purgeTargetCount > 1">及其携带的 {{ purgeTargetCount - 1 }} 项子内容</span>
            ，该操作不可恢复。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction :disabled="purging" @click="confirmPurge">
            {{ purging ? '删除中...' : '彻底删除' }}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <!-- 清空回收站确认弹窗（回收站行右侧扫帚 icon 触发，硬删除不可恢复） -->
    <AlertDialog v-model:open="clearOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>清空回收站</AlertDialogTitle>
          <AlertDialogDescription>
            此操作将彻底删除回收站中的全部
            {{ trashItems.length }} 项内容（含各自子内容），该操作不可恢复。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction :disabled="clearing || trashItems.length === 0" @click="confirmClear">
            {{ clearing ? '清空中...' : '一键清空' }}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <!-- 弹窗：搜索文档（独立搜索组件 searchbox：历史搜索记录 + 文档过滤，⌘J 快捷键内聚在组件内）
         guest 模式不挂载：组件内注册的 ⌘J 全局快捷键不应在访客态唤起 owner 搜索弹窗 -->
    <SearchBox v-if="!guest" v-model:open="searchOpen" />

    <!-- 弹窗：问问 YOKI AI（基于知识库 RAG 的流式问答，入口为顶部面包屑行右侧「问问 AI」按钮） -->
    <YokiAiDialog v-model:open="yokiAiOpen" :wiki-id="currentWikiId" />

    <!-- 提示：未开启 RAG 时点击「问问 YOKI AI」的引导弹窗
         （「去开启」关闭本提示并打开知识库设置弹窗，其中含自动 RAG 索引开关） -->
    <AlertDialog v-model:open="ragPromptOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>尚未开启 AI 索引（RAG）</AlertDialogTitle>
          <AlertDialogDescription>
            「问问 YOKI AI」基于知识库的 RAG
            索引回答问题，当前知识库还未开启该功能。请先在知识库设置中开启 AI
            索引（RAG）并等待文档索引完成后再试。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction @click="goEnableRag">去开启</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <!-- 弹窗：编辑知识库 -->
    <CreateWikiModal
      v-model:visible="editWikiVisible"
      :edit-data="wiki"
      @success="handleWikiEdited"
    />

    <!-- 弹窗：知识库/页面分享权限（复用 share-dialog，双入口共用一个实例）：
         1. 顶栏锁状态图标 → wiki-only 模式（shareTargetNodeId 为 null，仅库级配置）
         2. 文档树节点分享图标 → full 模式（shareTargetNodeId 定位页级 Tab，
            documentId 用于拼文档分享链接）
         保存后派发的 wiki-share-updated 事件由本组件已有监听刷新顶栏/文档树分享图标 -->
    <ShareDialog
      v-model:visible="wikiShareDialogVisible"
      :wiki-id="currentWikiId"
      :node-id="shareTargetNodeId ?? undefined"
      :document-id="shareTargetDocumentId"
      :mode="shareTargetNodeId ? 'full' : 'wiki-only'"
    />
  </aside>
</template>

<script lang="ts" setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Kbd } from '@/components/ui/kbd'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuGroup,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Maximize2,
  Minimize2,
  Search,
  MoreHorizontal,
  ChevronDown,
  ChevronRight,
  ListTree,
  Globe,
  Lock,
  Check,
  Plus,
  PencilLine,
  Share2,
  Trash2,
  Undo2,
  BrushCleaning,
  Loader2,
  Sparkles,
  FileUp,
  FileText,
  FileCode,
} from '@lucide/vue'
import { useWikiDocStore } from '@/stores/wiki-doc'
import { useWikiStore } from '@/stores/wiki'
import { ApiError } from '@/api/request'
import { getDocPersistence } from '@/composables/document-persistence'
import { parseMarkdownToDoc } from '@/components/notion-editor/utils/markdown-import'
import type { MarkdownImportResult } from '@/components/notion-editor/utils/markdown-import'
import { collectExternalImageUrls, rewriteImageUrls } from '@/components/notion-editor/utils/normalize-markdown-json'
import { transferRemoteImages } from '@/api/modules/media'
import type { WikiDocItem } from '@/types/wiki-doc'
import type { TrashItem } from '@/api/modules/wiki'
import type { WikiItem } from '@/api/modules/wiki'
import { getWikiShareConfig } from '@/api/modules/share'
import type { WikiShareConfig } from '@/api/modules/share'
import { getRagStatus, reindexRag, type RagStatus } from '@/api/modules/rag'
import CreateWikiModal from '@/views/dashboard/components/create-wiki-modal.vue'
import ShareDialog from '@/views/wiki/components/share-dialog.vue'
import SearchBox from '@/components/searchbox/index.vue'
import RagStatusBadge from '@/components/wiki/rag-status-badge.vue'
import YokiAiDialog from '@/views/wiki/components/yoki-ai-dialog.vue'
import NavUser from './nav-user.vue'
import type { GuestTreeItem } from '@/views/share/guest-tree'
import {
  collectGuestFolderIds,
  filterGuestTree,
  findGuestNode,
  toGuestTreeData,
} from '@/views/share/guest-tree'
import { resolveWikiIconColor } from '@/views/dashboard/components/wiki-icon-meta'
import WikiIcon from '@/views/dashboard/components/wiki-icon.vue'

/**
 * 组件 Props
 * - wiki：知识库详情对象，用于顶栏渲染 + 编辑弹窗回填
 * - guest / guestTree / guestWiki 等访客模式 props：访客分享浏览态复用本组件渲染只读侧栏，
 *   树数据由父组件注入（listShareNodes 构建的嵌套树），全部写操作（新建/拖拽/菜单/回收站/
 *   切换器/分享配置/RAG）在 guest 模式下隐藏或跳过
 */
const props = defineProps<{
  wiki?: WikiItem | null
  /** 访客只读模式（true = 分享浏览态，树数据来自 guestTree 注入而非 wikiDocStore） */
  guest?: boolean
  /** 访客态侧栏展示信息（库名/图标/颜色，来自分享元信息 shareMeta 合成） */
  guestWiki?: { name: string; icon: string | null; color: string | null } | null
  /** 访客嵌套文档树（listShareNodes → buildGuestTree 产物，父组件注入） */
  guestTree?: GuestTreeItem[]
  /** 访客当前选中的节点 ID（空串 = 未选中） */
  guestSelectedKey?: string
  /** 访客文档树加载中 */
  guestLoading?: boolean
}>()

/**
 * Emits
 * - update-wiki：编辑成功后回传更新后的知识库（owner 模式）
 * - guest-select：guest 模式点击文档树节点（父组件负责 URL 同步与正文加载）
 */
const emit = defineEmits<{
  (e: 'update-wiki', wiki: WikiItem): void
  (e: 'guest-select', nodeId: string): void
}>()

/** 编辑知识库弹窗显隐 */
const editWikiVisible = ref(false)

/**
 * 知识库切换弹窗相关状态
 */
const wikiSwitcherVisible = ref(false)
const wikiSearchKeyword = ref('')
const wikiSwitcherTab = ref<'personal' | 'shared'>('personal')

/**
 * Wiki Store（用于获取知识库列表）
 */
const wikiStore = useWikiStore()
const { wikis, loading: wikisLoading } = storeToRefs(wikiStore)

/**
 * 过滤后的知识库列表（按搜索关键字过滤）
 */
const filteredWikis = computed(() => {
  const kw = wikiSearchKeyword.value.trim().toLowerCase()
  if (!kw) return wikis.value
  return wikis.value.filter((w) => w.name.toLowerCase().includes(kw))
})

/**
 * 顶栏/访客块的知识库图标底色（渲染统一走 WikiIcon 组件，自动区分 Solar id 与 legacy lucide key）
 */
const wikiIconVisual = computed(() => resolveWikiIconColor(sidebarWiki.value?.color))

/**
 * 切换到指定知识库
 */
function switchToWiki(wikiId: string) {
  wikiSwitcherVisible.value = false
  if (wikiId && wikiId !== route.params.wikiId) {
    router.push(`/wiki/${wikiId}`)
  }
}

/**
 * 监听下拉菜单打开事件：加载知识库列表 + 重置搜索
 */
watch(wikiSwitcherVisible, (open) => {
  // guest 模式无切换器入口（触发器整体隐藏），防御性跳过知识库列表加载
  if (props.guest) return
  if (open) {
    wikiSearchKeyword.value = ''
    wikiSwitcherTab.value = 'personal'
    wikiStore.loadWikis()
  }
})

/**
 * 侧栏实际渲染的知识库信息：
 * - owner 模式：取 props.wiki
 * - guest 模式：取 props.guestWiki（分享元信息 shareMeta 合成，仅消费 name/icon/color）
 */
const sidebarWiki = computed<{ name: string; icon?: string | null; color?: string | null } | null>(
  () => {
    if (props.guest) {
      if (!props.guestWiki) return null
      return {
        name: props.guestWiki.name,
        icon: props.guestWiki.icon,
        color: props.guestWiki.color,
      }
    }
    return props.wiki ?? null
  }
)

/**
 * 编辑知识库成功回调
 */
function handleWikiEdited(updated: WikiItem) {
  emit('update-wiki', updated)
  toast.success('知识库已更新')
}

/**
 * 提供给 a-tree 展示的节点结构（key 对应节点 ID，title 供无障碍使用）
 * 注：不能用 icon 字段，arco TreeNodeData 中的 icon 是渲染函数，图标在 title 插槽内按需查询
 */
interface TreeDataNode {
  key: string
  title: string
  isLeaf: boolean
  children?: TreeDataNode[]
}

/**
 * Wiki 文档 Store
 */
const wikiDocStore = useWikiDocStore()
const { sortedDisplayDocs, openKeys, loading, isAllExpanded, trashItems, trashLoading } =
  storeToRefs(wikiDocStore)

/**
 * 路由
 */
const router = useRouter()
const route = useRoute()

/**
 * 搜索弹窗显隐（搜索框为触发器：点击 / ⌘J 唤起 DocSearchDialog）
 */
const searchOpen = ref(false)

// ============ 问问 AI（顶部面包屑行按钮 + RAG 未开启提示） ============

/** 「问问 AI」问答弹窗显隐（顶部「问问 AI」按钮在 RAG 已开启时点击打开） */
const yokiAiOpen = ref(false)

/** RAG 未开启提示弹窗显隐（顶部「问问 AI」按钮在 RAG 未开启时点击打开） */
const ragPromptOpen = ref(false)

/**
 * 「问问 AI」按钮点击：
 * - 已开启 AI 索引（RAG）→ 打开 AI 问答弹窗
 * - 未开启（含历史数据 ragEnabled 缺失，兜底 ?? false）→ 弹「必须先开启」提示，
 *   引导去知识库设置弹窗开启（其中含自动 RAG 索引开关）
 */
function handleAskYokiClick() {
  if (!(props.wiki?.ragEnabled ?? false)) {
    ragPromptOpen.value = true
    return
  }
  yokiAiOpen.value = true
}

/** 提示弹窗「去开启」：关闭提示并打开知识库设置弹窗（编辑态，含 RAG 开关） */
function goEnableRag() {
  ragPromptOpen.value = false
  editWikiVisible.value = true
}

/**
 * 「+」按钮创建中状态（新建文档 / 导入 Markdown 共用，按钮 disabled + 防重入）
 */
const creating = ref(false)

/**
 * 隐藏文件选择框引用：「导入本地 Markdown」菜单项触发其 click 唤起系统选文件
 */
const markdownFileInputRef = ref<HTMLInputElement | null>(null)

/**
 * 当前选中文档 ID
 * - owner 模式：由路由 docId 派生
 * - guest 模式：由父组件注入的 guestSelectedKey 派生（保持选中态数据流单向，树高亮走 props）
 */
const activeId = computed(() =>
  props.guest ? (props.guestSelectedKey ?? '') : (route.params.docId as string) || ''
)

/**
 * a-tree 选中的 key（由路由 docId 派生，单向控制）
 */
const selectedKeys = computed<string[]>(() => (activeId.value ? [activeId.value] : []))

/**
 * 树节点展开/收起变化时回调
 * 来自用户点击树节点的展开/收起图标操作
 */
function onExpandedKeysChange(keys: (string | number)[]) {
  // guest 模式：展开态由本组件托管（openKeys 属 owner wikiDocStore，访客不可触碰）
  if (props.guest) {
    guestExpandedKeys.value = keys.map(String)
    // 手动展开/收起后「全部展开」状态跟随实际：无收起的深层目录即视为全展开
    guestAllExpanded.value = guestDeepFolderIds.value.every((id) =>
      guestExpandedKeys.value.includes(id)
    )
    return
  }
  openKeys.value = keys.map(String)
}

/**
 * 切换所有二级及以下嵌套父级节点的展开/收缩
 * 一级父级节点始终展开不受影响
 */
function toggleAllFolders() {
  // guest 模式：折叠时只收起二级及以下目录（一级保持展开），展开时恢复全部目录展开
  if (props.guest) {
    guestExpandedKeys.value = guestAllExpanded.value
      ? (props.guestTree ?? []).filter((item) => item.children.length > 0).map((item) => item.id)
      : [...guestAllFolderIds.value]
    guestAllExpanded.value = !guestAllExpanded.value
    return
  }
  if (isAllExpanded.value) {
    wikiDocStore.collapseAllFolders()
  } else {
    wikiDocStore.expandAllFolders()
  }
}

/**
 * 点击「+」按钮：在根层级新建文档
 */
async function handleCreateDoc() {
  const wikiId = route.params.wikiId as string
  if (!wikiId || creating.value) return

  creating.value = true
  try {
    const node = await wikiDocStore.createDoc(wikiId)
    // 新建文档强制编辑态（/edit 后缀）：创建即进入编辑
    router.push(`/wiki/${wikiId}/${node.id}/edit`)
  } catch (error) {
    if (error instanceof ApiError) {
      toast.error(error.message)
    } else {
      console.error('[LayoutLeft] createDoc error:', error)
      toast.error('创建文档失败，请稍后重试')
    }
  } finally {
    creating.value = false
  }
}

/**
 * 在指定父节点下新建子文档（Notion 风格：任何节点都可作为父级）
 */
async function handleCreateChildDoc(parentId: string) {
  const wikiId = route.params.wikiId as string
  if (!wikiId || creating.value) return

  creating.value = true
  try {
    const node = await wikiDocStore.createDoc(wikiId, parentId)
    // 自动展开父节点（store.createDoc 内部已处理，这里幂等保证）
    if (!openKeys.value.includes(parentId)) {
      openKeys.value.push(parentId)
    }
    // 新建文档强制编辑态（/edit 后缀）：创建即进入编辑
    router.push(`/wiki/${wikiId}/${node.id}/edit`)
    toast.success('文档创建成功')
  } catch (error) {
    if (error instanceof ApiError) {
      toast.error(error.message)
    } else {
      console.error('[LayoutLeft] createChildDoc error:', error)
      toast.error('创建文档失败，请稍后重试')
    }
  } finally {
    creating.value = false
  }
}

/**
 * 触发本地 Markdown 文件选择（「导入本地 Markdown」菜单项点击）：
 * 唤起隐藏 input 的系统文件选择框。
 * 先清空 input.value：浏览器只在 value 变化时触发 change，
 * 不清空的话连续两次选择同一个文件会没有反应。
 */
function triggerImportMarkdown() {
  const input = markdownFileInputRef.value
  if (!input) return
  input.value = ''
  input.click()
}

/**
 * 文件选择框 change 回调：取到所选文件后交给 handleImportMarkdown 处理
 * （取完即清空 value，与 triggerImportMarkdown 的清空配合保证可重复选同一文件）
 */
function onImportFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file) void handleImportMarkdown(file)
}

/**
 * 导入本地 Markdown 文件为知识库文档
 *
 * 流程（内容写入走 local-first 而非直调 saveDocument）：
 * 1. 读文件文本（空文件直接提示，不创建空文档）；
 * 2. parseMarkdownToDoc 解析为 TipTap JSON（headless 实例，与粘贴转换同一管线，
 *    首个 H1 摘出作为文档标题）；
 * 3. createDoc 建档（标题优先用解析出的 H1，否则文件名去扩展名，均截断 100 字符）；
 * 4. 外链图片转存：正文里的 http(s) 图片经服务端下载后转存到本站对象存储
 *    （RustFS），成功的 URL 改写为 /media/... 相对路径，失败项保留原外链
 *    （外链防盗链/失效不受控，「能转存的转存」）；
 * 5. getDocPersistence(documentId).pushSnapshot：导入内容作为「脏快照」即时落
 *    内存 + IndexedDB，并自动排程服务端同步（限流/失败自动退避重试）——
 *    随后的路由跳转中 loadDocContent 读到 dirty 本地快照直接渲染（本地赢），
 *    同步队列稍后把服务端追平，天然绕开服务端 2s 保存限流，内容不丢；
 * 6. 跳转阅读态查看导入结果（内容已完整，与新建空文档进编辑态区分）；
 * 7. 结果提示：外链转存结果与不支持语法残留处数聚合提示。
 */
async function handleImportMarkdown(file: File) {
  const wikiId = route.params.wikiId as string
  if (!wikiId || creating.value) return

  creating.value = true
  try {
    // 1. 读取文件文本；纯空白文件无导入意义，直接提示并终止
    const text = await file.text()
    if (!text.trim()) {
      toast.warning(`「${file.name}」是空文件，未导入`)
      return
    }

    // 2. 解析 Markdown → TipTap JSON（解析异常向上抛由下方统一提示）
    let parsed: MarkdownImportResult
    try {
      parsed = parseMarkdownToDoc(text)
    } catch (error) {
      console.error('[LayoutLeft] markdown parse error:', error)
      toast.error('导入失败：无法解析该 Markdown 文件')
      return
    }

    // 3. 创建文档：标题 = 首个 H1（已截断）→ 文件名去扩展名兜底（同样截断 100，
    //    与服务端 CreateWikiNodeSchema 的 title 上限对齐）；文件名非法为空时
    //    不传 title，服务端落默认「无标题文档」
    const fallbackTitle = file.name
      .replace(/\.(md|markdown)$/i, '')
      .trim()
      .slice(0, 100)
    const node = await wikiDocStore.createDoc(wikiId, undefined, parsed.title ?? fallbackTitle)
    if (!node.documentId) {
      // 服务端正常必回 documentId（Notion 统一节点模型），此处仅作异常数据防御
      toast.error('导入失败：文档创建异常')
      return
    }

    // 4. 外链图片转存：建档后调服务端批量下载 → RustFS（绑定 documentId 落
    //    attached 状态，进不了 orphan 清理队列）；整批接口异常时内容原样保留，
    //    导入不因转存失败而中断
    let content = parsed.content
    let transferredCount = 0
    let failedCount = 0
    const externalUrls = collectExternalImageUrls(parsed.content)
    if (externalUrls.length > 0) {
      try {
        const result = await transferRemoteImages({
          urls: externalUrls,
          wikiId,
          documentId: node.documentId,
        })
        // 成功项按「源 URL → 本站相对 URL」改写正文（失败项保留原外链）
        const urlMap = new Map(
          result.items.filter((item) => item.url).map((item) => [item.sourceUrl, item.url!])
        )
        content = rewriteImageUrls(parsed.content, urlMap)
        transferredCount = result.transferred
        failedCount = externalUrls.length - transferredCount
      } catch (error) {
        console.warn('[LayoutLeft] transfer remote images failed:', error)
        failedCount = externalUrls.length
      }
    }

    // 5. 内容写入 local-first：脏快照落本地 + 自动排程服务端同步（见函数头注释）
    getDocPersistence(node.documentId).pushSnapshot(content, parsed.wordCount)

    // 6. 跳转阅读态：loadDocContent 读到 dirty 快照 → 本地赢 → 直接渲染导入内容
    router.push(`/wiki/${wikiId}/${node.id}`)

    // 7. 结果提示：转存结果 + 残留处数聚合（有失败/残留用 warning，纯成功用 success）
    const notes: string[] = []
    if (transferredCount > 0) notes.push(`${transferredCount} 张外链图片已转存到本地`)
    if (failedCount > 0) notes.push(`${failedCount} 张转存失败保留原链接`)
    if (parsed.residueCount > 0) notes.push(`${parsed.residueCount} 处编辑器不支持的语法按原文保留`)
    const suffix = notes.length > 0 ? `，${notes.join('，')}` : ''
    if (failedCount > 0 || parsed.residueCount > 0) {
      toast.warning(`已导入「${node.title}」${suffix}`)
    } else {
      toast.success(`已导入「${node.title}」${suffix}`)
    }
  } catch (error) {
    if (error instanceof ApiError) {
      toast.error(error.message)
    } else {
      console.error('[LayoutLeft] importMarkdown error:', error)
      toast.error('导入失败，请稍后重试')
    }
  } finally {
    creating.value = false
  }
}

/**
 * 将 WikiDocItem 树转换为 a-tree 可识别的数据结构
 */
function toTreeData(node: WikiDocItem): TreeDataNode {
  return {
    key: node.id,
    title: node.title,
    isLeaf: !(node.children && node.children.length > 0),
    children: node.children && node.children.length > 0 ? node.children.map(toTreeData) : undefined,
  }
}

/**
 * 按 key 查找节点图标（emoji），供 title 插槽渲染
 */
function nodeIcon(key: string): string | undefined {
  // guest 模式：从父组件注入的访客树中查询（wikiDocStore 数据与访客无关）
  if (props.guest) {
    return findGuestNode(props.guestTree ?? [], key)?.icon ?? undefined
  }
  return wikiDocStore.findNode(key)?.icon ?? undefined
}

/**
 * 当前展示给 a-tree 的节点数据（完整可见树；搜索已由 DocSearchDialog 弹窗接管）
 */
const displayTree = computed<TreeDataNode[]>(() => sortedDisplayDocs.value.map(toTreeData))

// ============ 访客模式（guest）文档树状态 ============
// owner 树数据来自 wikiDocStore（路由驱动），guest 树数据来自父组件注入的 props.guestTree，
// 两套状态互不干扰：下方 guest* 状态仅在 guest 模式被读写，owner 模式恒为初始值

/**
 * 访客树搜索关键字（guest 模式内联过滤文档树）
 * owner 模式的搜索由 DocSearchDialog 弹窗接管，不使用该状态
 */
const guestKeyword = ref('')

/**
 * 访客树是否处于搜索态（关键字非空）
 */
const guestSearching = computed(() => guestKeyword.value.trim().length > 0)

/**
 * 访客树展开的节点 key 集合（a-tree 白名单模型：仅列表中的父级节点展开）
 * 初始为全部目录展开（watch props.guestTree 重置，与原 share-guest 行为一致）
 */
const guestExpandedKeys = ref<string[]>([])

/**
 * 当前是否处于「全部展开」状态（驱动 Minimize2 / Maximize2 图标切换）
 */
const guestAllExpanded = ref(true)

/**
 * 访客树全部目录节点 ID（供搜索态强制全展开与「全部展开」使用）
 */
const guestAllFolderIds = computed<string[]>(() => {
  const acc: string[] = []
  collectGuestFolderIds(props.guestTree ?? [], 0, 0, acc)
  return acc
})

/**
 * 访客树二级及以下目录节点 ID（「全部折叠」时收起这些，一级目录保持展开，同 owner 语义）
 */
const guestDeepFolderIds = computed<string[]>(() => {
  const acc: string[] = []
  collectGuestFolderIds(props.guestTree ?? [], 0, 1, acc)
  return acc
})

/**
 * 访客树实际生效的展开 keys：搜索态强制全展开（避免命中节点藏在收起的父级里看不到）
 */
const guestEffectiveExpandedKeys = computed<string[]>(() =>
  guestSearching.value ? guestAllFolderIds.value : guestExpandedKeys.value
)

/**
 * 访客树 a-tree 数据源：按关键字过滤 → 转 a-tree 结构
 * 搜索语义：标题命中保留完整子树、子命中仅保留命中链（filterGuestTree）
 */
const guestSidebarTreeData = computed<TreeDataNode[]>(() => {
  const kw = guestKeyword.value.trim().toLowerCase()
  const tree = kw ? filterGuestTree(props.guestTree ?? [], kw) : (props.guestTree ?? [])
  return tree.map(toGuestTreeData)
})

/**
 * 访客树数据变化（父组件加载完成/刷新）时重置展开态为全部目录展开
 */
watch(
  () => props.guestTree,
  () => {
    guestExpandedKeys.value = [...guestAllFolderIds.value]
    guestAllExpanded.value = true
  },
  { immediate: true }
)

/**
 * 点击节点：打开对应文档
 * 携带当前模式后缀：预览态点树保持预览，编辑态（含瞬态缺省）保持编辑
 */
function onTreeSelect(keys: (string | number)[]) {
  const id = keys[0]
  if (id == null) return
  // guest 模式：选中事件上抛父组件（URL 同步与正文加载由 index.vue 编排）
  if (props.guest) {
    emit('guest-select', String(id))
    return
  }
  const wikiId = route.params.wikiId as string
  if (wikiId) {
    const mode = route.params.mode === 'view' ? 'view' : 'edit'
    router.push(`/wiki/${wikiId}/${id}/${mode}`)
  }
}

/**
 * 拖拽落点计算：把 arco 的 dropPosition 语义映射到 store.moveDoc
 * dropPosition === 0  作为 dropNode 的子节点插入（追加到末尾）
 * dropPosition  < 0   放到 dropNode 之前
 * dropPosition  > 0   放到 dropNode 之后
 * 注：drop-into（dropPosition === 0）会把节点追加为目标的最后一个子节点
 * （根层级节点同样可被嵌套，store.moveDoc 仅守卫自身/自身子树，无根层级限制）。
 * 本地重排后调 moveDocPersist 持久化到服务端（POST /wiki/node/:nodeId/move），
 * 失败时 store 内部已强制重拉文档树回滚本地乐观更新，这里补充用户提示。
 */
async function onTreeDrop(event: {
  dragNode?: { key?: string | number }
  dropNode?: { key?: string | number }
  dropPosition: number
  [key: string]: unknown
}) {
  const dragId = String(event.dragNode?.key ?? '')
  const dropId = String(event.dropNode?.key ?? '')
  if (!dragId || !dropId) return

  // 作为子节点放入：目标父级为 dropNode，追加到其子节点末尾
  if (event.dropPosition === 0) {
    // 传一个超大索引，Array.prototype.splice 超出长度时会追加到末尾
    wikiDocStore.moveDoc(dragId, dropId, Number.MAX_SAFE_INTEGER)
    // 自动展开目标父节点，便于看到新插入的子节点
    if (!openKeys.value.includes(dropId)) {
      openKeys.value.push(dropId)
    }
    await persistTreeMove(dragId)
    return
  }

  const dragPos = wikiDocStore.getNodePosition(dragId)
  const dropPos = wikiDocStore.getNodePosition(dropId)
  if (!dropPos) return

  // 同列表且被拖节点位于目标之前时：移除被拖节点后目标索引左移 1，需修正
  const sameList = dragPos?.parentId === dropPos.parentId
  let base = dropPos.index
  if (sameList && (dragPos?.index ?? 0) < dropPos.index) base -= 1

  const targetIndex = event.dropPosition < 0 ? base : base + 1
  wikiDocStore.moveDoc(dragId, dropPos.parentId, targetIndex)
  await persistTreeMove(dragId)
}

/**
 * 拖拽后持久化新排序：本地重排已完成，按最终位置同步服务端
 * 失败时 store.moveDocPersist 已重拉文档树回滚本地顺序，这里仅提示用户
 * @param nodeId 被拖拽节点 ID
 */
async function persistTreeMove(nodeId: string) {
  const ok = await wikiDocStore.moveDocPersist(nodeId)
  if (!ok) {
    toast.error('排序保存失败，已恢复原顺序')
  }
}

// ============ 拖拽幽灵图（drag ghost）自定义 ============

/**
 * 自定义拖拽幽灵图：把浏览器默认的直角白底快照替换为 rounded-lg 圆角卡片
 *
 * 背景：arco 把 draggable 挂在 title 元素上，HTML5 拖拽默认以该元素快照作为
 * 幽灵图，呈直角白底卡片，与侧栏圆角风格不符。
 *
 * 实现要点：
 * 1. 必须用捕获阶段监听（模板 @dragstart.capture）：arco 的 onDragStart 内部
 *    调用了 e.stopPropagation()，冒泡阶段监听收不到事件
 * 2. 节点根 div 带 data-key 属性（arco 渲染），closest 即可拿到被拖节点 ID，
 *    再从 store 查 title/icon 自行组装幽灵内容，避免 cloneNode 携带
 *    hover 态图标/作用域样式丢失等不确定性
 * 3. 幽灵元素 position: fixed + top: -9999px 置于视口外（不可 display:none，
 *    否则快照为空白），宽度与原行一致保证视觉 1:1
 * 4. setDragImage 的偏移取光标在原行内的相对位置，拖拽跟手不跳变
 * 5. dragend/drop（含 Esc 取消）后移除幽灵元素，重复 remove 无副作用
 */
function onTreeDragStart(e: DragEvent) {
  const nodeEl = (e.target as HTMLElement | null)?.closest?.('[data-key]') as HTMLElement | null
  if (!nodeEl || !e.dataTransfer) return

  const key = nodeEl.getAttribute('data-key') ?? ''
  const node = wikiDocStore.findNode(key)

  // 组装圆角幽灵卡片：白底 + rounded-lg + 阴影，内容为可选 emoji 图标 + 标题
  const ghost = document.createElement('div')
  ghost.className = 'flex items-center gap-1.5 text-sm text-foreground/70 bg-white'
  Object.assign(ghost.style, {
    position: 'fixed',
    top: '-9999px',
    left: '0',
    height: '32px',
    padding: '0 8px',
    // 与被拖行等宽，视觉上 1:1 还原；超出以省略号截断
    width: `${nodeEl.getBoundingClientRect().width}px`,
    borderRadius: '8px', // rounded-lg
    boxShadow: '0 4px 10px rgba(0, 0, 0, 0.12)',
    overflow: 'hidden',
    whiteSpace: 'nowrap',
  } as Partial<CSSStyleDeclaration>)

  // 可选 emoji 图标（与树节点行的 text-base 尺寸一致）
  if (node?.icon) {
    const iconSpan = document.createElement('span')
    iconSpan.textContent = node.icon
    iconSpan.style.fontSize = '16px'
    iconSpan.style.lineHeight = '1'
    ghost.appendChild(iconSpan)
  }

  // 标题：flex 子项需 min-width: 0 才能让省略号生效
  const titleSpan = document.createElement('span')
  titleSpan.textContent = node?.title ?? ''
  titleSpan.style.flex = '1'
  titleSpan.style.minWidth = '0'
  titleSpan.style.overflow = 'hidden'
  titleSpan.style.textOverflow = 'ellipsis'
  ghost.appendChild(titleSpan)

  document.body.appendChild(ghost)

  // 光标在原行内的相对位置作为幽灵图锚点，保持跟手不跳变
  const rect = nodeEl.getBoundingClientRect()
  e.dataTransfer.setDragImage(
    ghost,
    Math.round(e.clientX - rect.left),
    Math.round(e.clientY - rect.top)
  )

  // 拖拽结束（正常落下 / 放置 / Esc 取消）后清理幽灵元素
  const cleanup = () => ghost.remove()
  window.addEventListener('dragend', cleanup, { once: true })
  window.addEventListener('drop', cleanup, { once: true })
}

// ============ 文档树分享状态图标 ============

/**
 * 整库分享配置（含节点级覆盖列表），三态：
 * - undefined：未加载 / 加载失败（静默降级，节点行不渲染任何分享图标）
 * - null：已加载但从未配置过分享（无库级行 = 库级 private + 空 nodes，全部节点视为私密、不显示图标）
 * - WikiShareConfig：已加载的分享配置
 */
const shareConfig = ref<WikiShareConfig | null | undefined>(undefined)

/**
 * 当前路由中的知识库 ID（文档树所属库）
 */
const currentWikiId = computed(() => route.params.wikiId as string)

/**
 * 拉取整库分享配置（getWikiShareConfig 已禁用 GET 缓存，返回 null = 从未配置过）
 * 请求失败时静默降级：仅 console.warn，shareConfig 保持 undefined，
 * 节点行不显示分享图标，不阻塞文档树正常渲染
 */
async function loadShareConfig() {
  // guest 模式不拉取 owner 分享配置（无登录态会 401，且访客侧不显示分享图标）
  if (props.guest) {
    shareConfig.value = undefined
    return
  }
  const wikiId = currentWikiId.value
  if (!wikiId) {
    shareConfig.value = undefined
    return
  }
  try {
    const config = await getWikiShareConfig(wikiId)
    // 请求期间 wikiId 可能已切换：丢弃过期响应，避免旧库配置污染新库的图标
    if (wikiId === currentWikiId.value) {
      shareConfig.value = config
    }
  } catch (error) {
    console.warn('[LayoutLeft] 加载分享配置失败，分享图标降级隐藏:', error)
    if (wikiId === currentWikiId.value) {
      shareConfig.value = undefined
    }
  }
}

/**
 * wikiId 变化时重新拉取分享配置
 * immediate: true 使组件挂载时立即执行一次，覆盖"挂载时拉取"的需求
 */
watch(
  currentWikiId,
  () => {
    loadShareConfig()
  },
  { immediate: true }
)

/**
 * 归一化后的分享状态查询表（仅当配置成功加载后才非 null）：
 * - null 配置（从未配置过）归一化为「库级 private + 空 nodes」
 * - 页面分享行列表转为 Map<nodeId, shareStatus>（新模型下页级行仅 'public'），
 *   节点行渲染时 O(1) 查询
 */
const shareStatusLookup = computed<{
  wikiStatus: 'private' | 'public'
  nodeOverrides: Map<string, 'public'>
} | null>(() => {
  const config = shareConfig.value
  if (config === undefined) return null
  const nodeOverrides = new Map<string, 'public'>()
  if (config) {
    for (const node of config.nodes) {
      nodeOverrides.set(node.nodeId, node.shareStatus)
    }
  }
  return { wikiStatus: config?.shareStatus ?? 'private', nodeOverrides }
})

/**
 * 计算文档树节点应显示的分享图标类型
 *
 * 判定规则（新权限模型：库级主开关 + 页级独立分享）：
 * 1. 库分享开启（wikiStatus = 'public'）→ 全部文档跟随库公开，顶栏 wiki 名称旁
 *    已显示 Globe（公开分享中），节点级图标不再重复显示（去重）；
 *    单文档分享配置入口保留在节点操作菜单「分享」项
 * 2. 库分享关闭（私密）：
 *    - 节点单独开启了页面分享（nodes 列表中有行）→ Globe 常显
 *    - 其余（未单独分享 / 从未配置过分享）→ null（私密节点不显示图标）
 * 3. 配置未加载 / 加载失败 → null（不渲染图标，静默降级）
 *
 * @param nodeId 文档树节点 ID（a-tree 的 key）
 * @returns 'public' → Globe；null → 不显示图标（含库公开时的全部节点与私密节点）
 */
function nodeShareIconKind(nodeId: string): 'public' | null {
  const lookup = shareStatusLookup.value
  if (!lookup) return null
  // 库级已公开：顶栏已有库级 Globe，节点不重复显示
  if (lookup.wikiStatus === 'public') {
    return null
  }
  // 库级私密：仅单独分享出去的文档显示 Globe
  return lookup.nodeOverrides.get(nodeId) ?? null
}

/**
 * 顶栏知识库名称旁的锁状态图标类型（仅看库级分享主开关）：
 * - 'public'：库分享开启（全部文档跟随库公开）→ 未锁住，显示 Globe
 * - 'private'：库分享关闭 → 锁住，显示 Lock
 * - null：配置未加载 / 加载失败（静默降级，不显示图标）
 */
const wikiShareIconKind = computed<'public' | 'private' | null>(() => {
  const lookup = shareStatusLookup.value
  if (!lookup) return null
  return lookup.wikiStatus
})

/**
 * 知识库分享权限弹窗显示状态（顶栏锁状态图标 / 文档树节点分享图标点击打开）
 * 复用 share-dialog：根据 shareTargetNodeId 动态切换 wiki-only / full 模式
 */
const wikiShareDialogVisible = ref(false)

/**
 * 分享弹窗目标节点 ID（wikiNodes.id）：null = 顶栏库级入口（wiki-only 模式，仅库级配置）；
 * 非空 = 文档树节点图标入口（full 模式，可单独配置该页分享）
 */
const shareTargetNodeId = ref<string | null>(null)

/**
 * 分享弹窗目标文档 ID（documents.id）：拼文档分享链接用（链接 docId 段是 documents.id），
 * 从目标节点的 WikiDocItem.documentId 取；节点未关联正文时为 undefined（弹窗隐藏链接区）
 */
const shareTargetDocumentId = ref<string | undefined>(undefined)

/**
 * 打开知识库分享权限弹窗（顶栏锁状态图标 click 处理）
 * 清空目标节点 → 弹窗以 wiki-only 模式仅展示库级配置；
 * 事件冒泡已在模板中通过 @pointerdown.stop / @click.stop 阻断，不会触发切换器下拉
 */
function openWikiShareDialog() {
  shareTargetNodeId.value = null
  shareTargetDocumentId.value = undefined
  wikiShareDialogVisible.value = true
}

/**
 * 打开指定文档节点的分享权限弹窗（文档树节点分享图标 click 处理）
 * 设置目标节点 → 弹窗以 full 模式展示「分享此页面 + 知识库可见性」双 Tab，
 * 页级 Tab 定位到该节点（nodeId = wikiNodes.id，documentId 用于拼分享链接）
 * @param nodeId 树节点 key（wikiNodes.id）
 */
function openNodeShareDialog(nodeId: string) {
  const node = wikiDocStore.findNode(nodeId)
  shareTargetNodeId.value = nodeId
  shareTargetDocumentId.value = node?.documentId ?? undefined
  wikiShareDialogVisible.value = true
}

/**
 * 分享弹窗保存成功后派发的全局自定义事件名（与弹窗侧约定，事件名一字不差）
 * 弹窗侧 dispatch，本组件监听后重新拉取分享配置刷新图标
 */
const WIKI_SHARE_UPDATED_EVENT = 'wiki-share-updated'

/**
 * window 上 'wiki-share-updated' 事件回调：重新拉取分享配置刷新图标
 * @param event CustomEvent，detail 可能携带 { wikiId }（兼容不携带的情况）
 */
function onWikiShareUpdated(event: Event) {
  const detail = (event as CustomEvent<{ wikiId?: string }>).detail
  // 事件指明的是其他知识库时忽略，避免误刷新当前库
  if (detail?.wikiId && detail.wikiId !== currentWikiId.value) return
  loadShareConfig()
}

onMounted(() => {
  window.addEventListener(WIKI_SHARE_UPDATED_EVENT, onWikiShareUpdated)
})

onBeforeUnmount(() => {
  window.removeEventListener(WIKI_SHARE_UPDATED_EVENT, onWikiShareUpdated)
})

// ============ 知识库级 RAG 索引状态标签（顶栏设置按钮左侧） ============

/** 当前知识库的整体索引状态统计（null = 未加载 / 无知识库上下文） */
const wikiRagStatus = ref<RagStatus | null>(null)

/** RAG 标签弹层显示状态（点击标签打开，展示统计 + 最新时间 + 重建按钮） */
const wikiRagPopoverVisible = ref(false)

/** 全库重建请求进行中（按钮 loading + 防重复点击） */
const wikiReindexing = ref(false)

/** 全库状态轮询定时器句柄（有待同步任务时每 3s 刷新，无任务后停止） */
let wikiRagPollTimer: ReturnType<typeof setInterval> | null = null

/** 全库状态轮询间隔（毫秒），与文档编辑页徽标轮询节奏一致 */
const WIKI_RAG_POLL_INTERVAL_MS = 3000

/**
 * 拉取当前知识库的 RAG 索引状态统计
 * 有待同步任务（pending > 0）时自动轮询直至清零；失败仅告警不阻断页面
 */
async function loadWikiRagStatus() {
  const wikiId = currentWikiId.value
  if (!wikiId) return
  try {
    const status = await getRagStatus(wikiId).send()
    // 请求期间知识库可能已切换：丢弃过期响应，避免旧库数据污染
    if (wikiId === currentWikiId.value) {
      wikiRagStatus.value = status
      if (status.pending > 0) {
        startWikiRagPolling()
      } else {
        stopWikiRagPolling()
      }
    }
  } catch (err) {
    console.warn('[LayoutLeft] 查询知识库 RAG 状态失败:', err)
  }
}

/** 启动全库状态轮询（幂等：已有定时器时跳过） */
function startWikiRagPolling() {
  if (wikiRagPollTimer) return
  wikiRagPollTimer = setInterval(loadWikiRagStatus, WIKI_RAG_POLL_INTERVAL_MS)
}

/** 停止全库状态轮询 */
function stopWikiRagPolling() {
  if (wikiRagPollTimer) {
    clearInterval(wikiRagPollTimer)
    wikiRagPollTimer = null
  }
}

// 知识库切换时重置轮询并重新拉取状态（immediate 覆盖首屏）
watch(
  currentWikiId,
  () => {
    stopWikiRagPolling()
    wikiRagStatus.value = null
    // guest 模式不查询 RAG 状态（owner 专属接口，访客无登录态会 401）
    if (props.guest) return
    loadWikiRagStatus()
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  // 停止全库状态轮询定时器（防止卸载后继续请求）
  stopWikiRagPolling()
})

/** 标签弹层整体状态文案（未索引/索引中/部分失败/全部已索引） */
const wikiRagStatusText = computed(() => {
  const st = wikiRagStatus.value
  if (!st || st.total === 0) return '未索引'
  if (st.pending > 0) return '索引中'
  if (st.failed > 0) return '部分失败'
  return '全部已索引'
})

/** RAG 状态圆点颜色：全部已索引绿色，索引中琥珀（呼吸闪烁），有失败红色，未索引灰色 */
const wikiRagDotClass = computed(() => {
  const st = wikiRagStatus.value
  if (!st || st.total === 0) return 'bg-muted-foreground/40'
  if (st.pending > 0) return 'bg-amber-500 animate-pulse'
  if (st.failed > 0) return 'bg-red-500'
  return 'bg-green-500'
})

/** 全库最新 RAG 时间文案（YYYY-MM-DD HH:mm:ss），从未成功同步时显示占位 */
const wikiRagLastSyncedText = computed(() => {
  const iso = wikiRagStatus.value?.lastSyncedAt
  if (!iso) return '从未索引'
  return formatRagDateTime(new Date(iso))
})

/**
 * 格式化日期时间为 YYYY-MM-DD HH:mm:ss（本地时区）
 */
function formatRagDateTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/**
 * 重建全库索引：调用全量重索引接口，成功后立即刷新状态并启动轮询
 */
async function handleWikiReindex() {
  const wikiId = currentWikiId.value
  if (!wikiId || wikiReindexing.value) return
  wikiReindexing.value = true
  try {
    const result = await reindexRag(wikiId).send()
    toast.success(`已重置 ${result.marked} 个任务，队列重新消费中`)
    await loadWikiRagStatus()
  } catch (err) {
    toast.error((err as Error).message || '触发重建失败，请稍后重试')
  } finally {
    wikiReindexing.value = false
  }
}

/**
 * 当前打开的操作菜单所属节点 key（同一时刻仅一个菜单打开）
 * 绑定在 DropdownMenu 的 :open 上，清空即触发菜单立即关闭退场
 */
const menuOpenKey = ref('')

/**
 * 菜单按钮"延迟隐藏"key：与 menuOpenKey 解耦。
 * 菜单关闭时按钮不能跟着立刻 display:none —— 触发按钮是下拉菜单 popper 的
 * 定位锚点，退场动画（duration-100）期间锚点消失会使 reka-ui 把还在淡出的
 * 菜单重定位到页面左上角（表现为确认弹窗弹出时页面左上角"一闪"）。
 * 因此按钮的显示由本 key 控制，关闭后延迟 150ms 再隐藏，撑过退场动画。
 */
const btnVisibleKey = ref('')

/**
 * 按钮延迟隐藏定时器（同一时刻仅一个菜单，单个定时器足够）
 */
let menuCloseTimer: ReturnType<typeof setTimeout> | undefined

/**
 * 更新菜单打开状态
 */
function onMenuOpen(key: string, open: boolean) {
  if (open) {
    // 重新打开时取消未执行的隐藏定时器，防止误隐新菜单的按钮
    clearTimeout(menuCloseTimer)
    menuOpenKey.value = key
    btnVisibleKey.value = key
    return
  }
  if (menuOpenKey.value !== key) return
  menuOpenKey.value = ''
  menuCloseTimer = setTimeout(() => {
    // 期间若同一菜单被重新打开（key 相同），跳过隐藏
    if (btnVisibleKey.value === key) btnVisibleKey.value = ''
  }, 150)
}

// ============ 重命名弹窗 ============

const renameOpen = ref(false)
const renameValue = ref('')
const renaming = ref(false)
const renameTargetId = ref('')
const renameTargetTitle = ref('')

function openRenameDialog(id: string) {
  const node = wikiDocStore.findNode(id)
  if (!node) return
  renameTargetId.value = id
  renameTargetTitle.value = node.title
  renameValue.value = node.title
  renameOpen.value = true
}

async function confirmRename() {
  const title = renameValue.value.trim()
  if (!title || renaming.value) return

  renaming.value = true
  try {
    await wikiDocStore.updateDoc(renameTargetId.value, { title })
    toast.success('重命名成功')
    renameOpen.value = false
  } catch (error) {
    if (error instanceof ApiError) {
      toast.error(error.message)
    } else {
      console.error('[LayoutLeft] rename error:', error)
      toast.error('重命名失败，请稍后重试')
    }
  } finally {
    renaming.value = false
  }
}

// ============ 删除确认弹窗 ============

const deleteOpen = ref(false)
const deleting = ref(false)
const deleteTargetId = ref('')
const deleteTargetTitle = ref('')
// Notion 风格：是否提示"及其所有子内容"由是否有子节点决定（替代原 isFolder 判断）
const deleteTargetHasChildren = ref(false)

function openDeleteDialog(id: string) {
  const node = wikiDocStore.findNode(id)
  if (!node) return
  deleteTargetId.value = id
  deleteTargetTitle.value = node.title
  deleteTargetHasChildren.value = !!(node.children && node.children.length > 0)
  deleteOpen.value = true
}

/**
 * 统计某节点在当前展开状态下「可见的子孙节点数」（不含节点自身）
 * 展开规则与侧栏渲染一致：一级（depth === 0）父级恒展开，更深层级看 openKeys
 * @param node 目标节点
 * @param depth 目标节点所在层级（根层级为 0）
 */
function countVisibleDescendants(node: WikiDocItem, depth: number): number {
  if (!node.children || node.children.length === 0) return 0
  const expanded = depth === 0 || openKeys.value.includes(node.id)
  if (!expanded) return 0
  let count = 0
  for (const child of node.children) {
    count += 1 // 孩子节点自身可见
    count += countVisibleDescendants(child, depth + 1)
  }
  return count
}

/**
 * 查找目标节点在侧栏文档树中「视觉上的上一个 / 下一个可见节点」
 *
 * 按 a-tree 实际渲染顺序（先序 DFS）展平当前可见树：
 * - 一级（根层级）父级节点始终展开（与 store 默认展开/全部折叠规则一致）
 * - 二级及以下父级仅当 id 在 openKeys 中时才继续展平其子树
 *
 * 「下一个」需跳过目标节点自身的整棵子树——删除目录时子节点会被级联删除，
 * 直接取展平序列的后一项可能正好落在被删子树内。
 *
 * 注意：必须在删除调用之前执行——删除后目标节点及其整棵子树已从树中摘除，无法再定位。
 *
 * @param targetId 待删除节点 ID
 * @returns prev = 目标行正上方紧邻 item（没有则 null）；next = 目标子树之后紧邻 item（没有则 null）
 */
function findAdjacentVisibleNodes(targetId: string): {
  prev: WikiDocItem | null
  next: WikiDocItem | null
} {
  // 按当前展开状态展平后的可见节点序列（与 displayTree → a-tree 渲染的节点顺序保持一致）
  // 同步记录每个节点所在层级，便于按其真实深度判定子树展开状态
  const visible: WikiDocItem[] = []
  const depths: number[] = []
  const walk = (list: WikiDocItem[], depth: number) => {
    for (const node of list) {
      visible.push(node)
      depths.push(depth)
      const hasChildren = !!node.children && node.children.length > 0
      // 一级（depth === 0）父级始终展开；更深层级跟随 openKeys
      const expanded = depth === 0 || openKeys.value.includes(node.id)
      if (hasChildren && expanded) {
        walk(node.children!, depth + 1)
      }
    }
  }
  walk(sortedDisplayDocs.value, 0)

  const index = visible.findIndex((node) => node.id === targetId)
  if (index === -1) return { prev: null, next: null }

  // 上一个：展平序列中前一项（先序 DFS 下它不可能属于目标子树）
  const prev = index > 0 ? visible[index - 1] : null
  // 下一个：跳过目标自身及其全部可见子孙后，落在子树之外的第一个节点
  // （删除目录时子节点会被级联删除，不能直接取 index + 1）
  const afterSubtree = index + 1 + countVisibleDescendants(visible[index], depths[index])
  const next = afterSubtree < visible.length ? visible[afterSubtree] : null
  return { prev, next }
}

async function confirmDelete() {
  if (deleting.value) return
  deleting.value = true

  // 删除前快照：目标节点的「上一个 / 下一个可见节点」与当前打开文档 ID。
  // 删除目录时其子树会被级联删除，节点删除后无法再从 store 反查，必须提前记录。
  const targetId = deleteTargetId.value
  const { prev: prevNode, next: nextNode } = findAdjacentVisibleNodes(targetId)
  const activeIdBeforeDelete = activeId.value

  try {
    await wikiDocStore.deleteDoc(targetId)
    toast.success('已移入回收站')
    deleteOpen.value = false

    // 刷新回收站列表（静默，失败不影响删除结果）：
    // 保证父组件 inTrash 计算属性能立刻命中刚删除的文档 ——
    // 若删除的正是当前打开文档，正文区随即切换为只读态并显示右上角「恢复」按钮
    if (currentWikiId.value) {
      wikiDocStore.loadTrash(currentWikiId.value).catch(() => {})
    }

    // 当前打开的文档随本次删除消失（删除的就是它本身，或它位于被删目录的子树内被级联删除）：
    // 选中顺序 = 上一个 item → 下一个 item（已跳过被删子树）→ 知识库首页（树已空）
    if (activeIdBeforeDelete && !wikiDocStore.findNode(activeIdBeforeDelete)) {
      const wikiId = route.params.wikiId as string
      // 与点击树节点 onTreeSelect 保持一致：预览态（view）停留预览，其余进入编辑态
      const mode = route.params.mode === 'view' ? 'view' : 'edit'
      const fallbackNode = prevNode ?? nextNode
      if (fallbackNode) {
        router.push(`/wiki/${wikiId}/${fallbackNode.id}/${mode}`)
      } else {
        router.push(`/wiki/${wikiId}`)
      }
    }
  } catch (error) {
    if (error instanceof ApiError) {
      toast.error(error.message)
    } else {
      console.error('[LayoutLeft] delete error:', error)
      toast.error('删除失败，请稍后重试')
    }
  } finally {
    deleting.value = false
  }
}

// ============ 目录/回收站视图切换 ============

/**
 * 侧栏视图模式：tree = 文档树（目录）；trash = 回收站列表
 * 由「目录」行的下拉菜单切换，切换知识库时自动回到目录视图
 */
const viewMode = ref<'tree' | 'trash'>('tree')

/**
 * 监听视图切换：进入回收站视图时拉取回收站列表
 * 每次进入都强制刷新（loadTrash 内部不缓存），保证删除/恢复后的数据最新
 */
watch(viewMode, (mode) => {
  if (mode === 'trash' && currentWikiId.value) {
    wikiDocStore.loadTrash(currentWikiId.value).catch((error) => {
      console.warn('[LayoutLeft] 加载回收站失败:', error)
    })
  }
})

// 切换知识库时回到目录视图（回收站按库隔离，不跨库展示）
watch(currentWikiId, () => {
  viewMode.value = 'tree'
})

/**
 * 格式化回收站条目的删除时间为 M-D 短格式（完整时间在行 title 提示中展示）
 */
function formatTrashDate(iso: string): string {
  const d = new Date(iso)
  return `${d.getMonth() + 1}-${d.getDate()}`
}

/**
 * 打开回收站文档：跳转只读预览态（/view 后缀）
 * 正文正常展示（与目录内文档一致），但不可分享/编辑，顶栏右上角提供「恢复」按钮；
 * 当前行高亮由 activeId（路由 docId）驱动
 */
function openTrashDoc(item: TrashItem) {
  const wikiId = currentWikiId.value
  if (!wikiId) return
  router.push(`/wiki/${wikiId}/${item.id}/view`)
}

/**
 * 顶栏恢复回收站文档后派发的全局自定义事件名（与 layout-main 侧约定，事件名一字不差）
 * layout-main 恢复成功后 dispatch，本组件监听后切回目录视图，让用户立刻看到文档回到目录中
 */
const WIKI_TRASH_RESTORED_EVENT = 'wiki-trash-restored'

/**
 * window 上 'wiki-trash-restored' 事件回调：侧栏若停留在回收站视图则切回目录视图
 */
function onWikiTrashRestored() {
  viewMode.value = 'tree'
}

onMounted(() => {
  window.addEventListener(WIKI_TRASH_RESTORED_EVENT, onWikiTrashRestored)
})

onBeforeUnmount(() => {
  window.removeEventListener(WIKI_TRASH_RESTORED_EVENT, onWikiTrashRestored)
})

/**
 * 恢复回收站条目（整棵子树恢复到原位置，父级已删/缺失时挂根层级末尾）
 * 恢复成功后自动切回目录视图：让用户立刻看到文档回到目录中，
 * store.restoreDoc 内部已强制刷新文档树，此处只负责视图切换
 */
async function handleRestoreTrash(id: string) {
  try {
    await wikiDocStore.restoreDoc(id)
    viewMode.value = 'tree'
    toast.success('已恢复')
  } catch (error) {
    if (error instanceof ApiError) {
      toast.error(error.message)
    } else {
      console.error('[LayoutLeft] restore error:', error)
      toast.error('恢复失败，请稍后重试')
    }
  }
}

// ============ 彻底删除弹窗（回收站） ============

/** 彻底删除确认弹窗显隐 */
const purgeOpen = ref(false)

/** 彻底删除请求进行中（按钮 loading + 防重复点击） */
const purging = ref(false)

/** 待彻底删除的顶层条目 ID / 标题 / 子树规模（弹窗回显用） */
const purgeTargetId = ref('')
const purgeTargetTitle = ref('')
const purgeTargetCount = ref(1)

/**
 * 打开彻底删除确认弹窗
 */
function openPurgeDialog(item: TrashItem) {
  purgeTargetId.value = item.id
  purgeTargetTitle.value = item.title
  purgeTargetCount.value = item.count
  purgeOpen.value = true
}

/**
 * 确认彻底删除：硬删除不可恢复（级联清理正文/历史版本/RAG/分享配置）
 * 若当前打开文档在被删子树内（返回的 nodeIds 命中），跳转回知识库首页
 */
async function confirmPurge() {
  if (purging.value) return
  purging.value = true
  try {
    const result = await wikiDocStore.purgeDoc(purgeTargetId.value)
    toast.success('已彻底删除')
    purgeOpen.value = false

    // 当前打开文档被级联删除时跳转回知识库首页，避免停留在已删除内容上
    if (result?.nodeIds?.includes(activeId.value)) {
      const wikiId = route.params.wikiId as string
      router.push(`/wiki/${wikiId}`)
    }
  } catch (error) {
    if (error instanceof ApiError) {
      toast.error(error.message)
    } else {
      console.error('[LayoutLeft] purge error:', error)
      toast.error('彻底删除失败，请稍后重试')
    }
  } finally {
    purging.value = false
  }
}

// ============ 一键清空回收站 ============

/** 清空回收站确认弹窗显隐 */
const clearOpen = ref(false)

/** 清空请求进行中（按钮 loading + 防重复点击） */
const clearing = ref(false)

/**
 * 确认清空回收站：硬删除该库回收站全部内容，不可恢复
 * 若当前打开文档在被删内容内（返回的 nodeIds 命中），跳转回知识库首页
 */
async function confirmClear() {
  if (clearing.value) return
  clearing.value = true
  try {
    const result = await wikiDocStore.purgeAllDocs()
    toast.success('回收站已清空')
    clearOpen.value = false

    // 当前打开文档被级联删除时跳转回知识库首页，避免停留在已删除内容上
    if (result?.nodeIds?.includes(activeId.value)) {
      const wikiId = route.params.wikiId as string
      router.push(`/wiki/${wikiId}`)
    }
  } catch (error) {
    if (error instanceof ApiError) {
      toast.error(error.message)
    } else {
      console.error('[LayoutLeft] clear trash error:', error)
      toast.error('清空失败，请稍后重试')
    }
  } finally {
    clearing.value = false
  }
}
</script>

<style scoped>
/* 覆盖 arco Tree 默认选中/悬停背景，高亮与悬停样式由自定义 title 内联类控制 */

.yokimind-tree {
  padding-top: 2px;
}

.yokimind-tree :deep(.arco-tree-node-title),
.yokimind-tree :deep(.arco-tree-node-title:hover),
.yokimind-tree :deep(.arco-tree-node-selected > .arco-tree-node-title) {
  background: transparent;
}

.yokimind-tree :deep(.arco-tree-node-title) {
  padding: 0;
  transition: none;
}

/* 让节点文字容器占满整行，支持右侧操作按钮对齐 */
.yokimind-tree :deep(.arco-tree-node-title-text) {
  width: 100%;
}

/* 长标题省略号（修复标题溢出侧栏）：
   arco 在 blockNode 模式下给 title 元素追加了 title-block 类（flex: 1 的弹性子项），
   自定义节点内容又包在 title-text 里（它也是 .arco-tree-node-title 弹性容器的子项）。
   CSS 规范中弹性子项默认 min-width: auto —— 不允许收缩到「不可断行内容的最小宽度」
   以下，而 truncate 依赖 white-space: nowrap，其 min-content 恰好等于整行文字宽度，
   于是这两层都拒绝收缩，整行被长标题撑出侧栏，内部 span 的 truncate 永远不生效。
   给这两层显式设置 min-width: 0 放开收缩限制，省略号才能正常截断 */
.yokimind-tree :deep(.arco-tree-node-title-block),
.yokimind-tree :deep(.arco-tree-node-title-text) {
  min-width: 0;
}

/* 整行可拖拽：把 arco 的拖拽把手改为透明全覆盖层，让 title 点击/拖动都能触发拖拽；
   节点内部的交互元素（菜单按钮等）通过 pointer-events: auto 恢复点击 */
.yokimind-tree :deep(.arco-tree-node-drag-icon) {
  /* 透明、不可见，但保留 DOM 作为拖放把手 */
  opacity: 0;
  width: 100%;
  height: 100%;
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  margin: 0;
  padding: 0;
  cursor: grab;
}

/* title 内部内容默认不拦截鼠标事件，让拖拽把手捕获 */
.yokimind-tree :deep(.arco-tree-node-title-text) {
  width: 100%;
  pointer-events: none;
}

/* 恢复节点内交互元素的点击能力 */
.yokimind-tree :deep(.arco-tree-node-title-text button),
.yokimind-tree :deep(.arco-tree-node-title-text [data-radix-popper-content-wrapper]),
.yokimind-tree :deep(.arco-tree-node-title-text .group) {
  pointer-events: auto;
}

/* ========== 拖拽视觉反馈 ========== */

/* 作为子节点 drop（dropPosition === 0）：虚线边框提示，无左侧竖条
   arco 通过 title-highlight 类表达 dropPosition=0 的状态 */
.yokimind-tree :deep(.arco-tree-node-title-highlight) {
  position: relative;
  background: transparent !important;
  border-radius: 6px;
  /* 虚线边框提示 */
  outline: 1.5px dashed rgb(var(--primary-6));
  outline-offset: 1px;
}

/* 插入上/下横线（同层级排序）：统一为蓝色 1px 实线 */
.yokimind-tree :deep(.arco-tree-node-title-gap-top)::before,
.yokimind-tree :deep(.arco-tree-node-title-gap-bottom)::before {
  height: 1px;
  border-radius: 1px;
  background-color: rgb(var(--primary-6));
}

/* 节点行垂直间距：行与行之间增加 4px 空隙，避免列表过于贴紧 */
.yokimind-tree :deep(.arco-tree-node) {
  margin-bottom: 4px;
}

.yokimind-tree :deep(.arco-tree-node-switcher) {
  margin-right: 6px;
}
</style>
