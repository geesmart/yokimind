<template>
  <!--
    智能体接入指引组件（/settings/agents 智能体接入页使用）
    - 三折叠面板：MCP（Model Context Protocol）/ CLI（命令行）/ Skills（Agent Skills）
    - 端点与配置片段按当前站点 origin 动态生成，令牌以占位符展示（明文只在创建弹窗出现一次）
    - 每个片段右上角一键复制；面板标题右侧带协议简介
  -->
  <section class="flex flex-col gap-4 px-2">
    <!-- 分区标题 -->
    <div class="flex flex-col gap-1">
      <div class="flex items-center gap-2">
        <Bot class="size-4 text-muted-foreground" />
        <h3 class="text-base font-semibold leading-none">接入指引</h3>
      </div>
      <p class="text-sm text-muted-foreground">
        三种协议共用同一访问令牌（Authorization: Bearer yki_…），能力一致：列库、搜文档、读文档、创建与更新文档
      </p>
    </div>

    <!-- ==================== MCP 面板 ==================== -->
    <Collapsible v-model:open="mcpOpen">
      <div class="rounded-lg border">
        <CollapsibleTrigger
          class="flex w-full cursor-pointer items-center gap-2 px-4 py-3 text-left hover:bg-accent/50"
        >
          <ChevronDown class="size-4 shrink-0 text-muted-foreground transition-transform" :class="{ '-rotate-90': !mcpOpen }" />
          <span class="text-sm font-medium">MCP（Model Context Protocol）</span>
          <Badge variant="secondary" class="ml-auto shrink-0">推荐</Badge>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div class="flex flex-col gap-3 border-t px-4 py-4">
            <p class="text-xs leading-relaxed text-muted-foreground">
              在 Claude Desktop / Cursor / Trae / Claude Code 等客户端的 MCP 配置中加入以下片段即可。
              工具：wikis_list、wiki_tree、search_knowledge、read_document、create_document、update_document、ask_knowledge。
            </p>
            <CodeBlock :code="mcpJson" />
            <div class="flex flex-col gap-1.5">
              <p class="text-xs font-medium">请求头方式（脚本 / OpenAPI 调试）</p>
              <CodeBlock :code="mcpCurl" />
            </div>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>

    <!-- ==================== CLI 面板 ==================== -->
    <Collapsible v-model:open="cliOpen">
      <div class="rounded-lg border">
        <CollapsibleTrigger
          class="flex w-full cursor-pointer items-center gap-2 px-4 py-3 text-left hover:bg-accent/50"
        >
          <ChevronDown class="size-4 shrink-0 text-muted-foreground transition-transform" :class="{ '-rotate-90': !cliOpen }" />
          <span class="text-sm font-medium">CLI（命令行工具）</span>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div class="flex flex-col gap-3 border-t px-4 py-4">
            <p class="text-xs leading-relaxed text-muted-foreground">
              在终端中直接操作知识库；也可用 <code class="rounded bg-muted px-1 font-mono">yokimind mcp print</code>
              生成 MCP 配置片段喂给智能体。支持环境变量 YOKIMIND_URL / YOKIMIND_TOKEN 免登录运行。
            </p>
            <CodeBlock :code="cliSnippet" />
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>

    <!-- ==================== Skills 面板 ==================== -->
    <Collapsible v-model:open="skillsOpen">
      <div class="rounded-lg border">
        <CollapsibleTrigger
          class="flex w-full cursor-pointer items-center gap-2 px-4 py-3 text-left hover:bg-accent/50"
        >
          <ChevronDown class="size-4 shrink-0 text-muted-foreground transition-transform" :class="{ '-rotate-90': !skillsOpen }" />
          <span class="text-sm font-medium">Skills（Agent Skills / SKILL.md）</span>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div class="flex flex-col gap-3 border-t px-4 py-4">
            <p class="text-xs leading-relaxed text-muted-foreground">
              每个知识库自动生成一个 Agent Skills 标准技能（SKILL.md，含 frontmatter 与使用指引），
              供 Claude Code / Trae 等支持 Skills 的智能体加载。列表与下载走只读 HTTP 接口：
            </p>
            <CodeBlock :code="skillsSnippet" />
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  </section>
</template>

<script lang="ts" setup>
import { ref } from 'vue'
import { Bot, ChevronDown } from '@lucide/vue'
import { Badge } from '@/components/ui/badge'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import CodeBlock from './code-block.vue'

/** 面板展开态（MCP 默认展开） */
const mcpOpen = ref(true)
const cliOpen = ref(false)
const skillsOpen = ref(false)

/** 当前站点 API 根（生产同域部署 / 开发走 Vite 代理，均取页面 origin） */
const apiRoot = `${window.location.origin}/api/v1`

/** MCP 客户端 JSON 配置片段（Claude / Cursor / Trae 通用格式） */
const mcpJson = JSON.stringify(
  {
    mcpServers: {
      yokimind: {
        url: `${apiRoot}/mcp`,
        headers: {
          Authorization: 'Bearer yki_你的令牌',
        },
      },
    },
  },
  null,
  2,
)

/** MCP 原始请求示例（curl 形态，便于脚本调试） */
const mcpCurl = [
  `curl -X POST ${apiRoot}/mcp \\`,
  `  -H "Authorization: Bearer yki_你的令牌" \\`,
  `  -H "Content-Type: application/json" \\`,
  `  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`,
].join('\n')

/** CLI 常用命令片段 */
const cliSnippet = [
  '# 登录（令牌保存在 ~/.yokimind/config.json）',
  'npx @yokimind/cli login --url ' + apiRoot + ' --token yki_你的令牌',
  '',
  '# 常用命令',
  'yokimind wikis                        # 列出我的知识库',
  'yokimind tree <wikiId>                # 查看文档树',
  'yokimind search <wikiId> "关键词"      # 搜索（auto=语义优先，自动降级关键词）',
  'yokimind doc get <docId>              # 读取文档（Markdown）',
  'yokimind doc create <wikiId> --title "标题"',
  'yokimind doc update <docId> --file doc.md',
  '',
  '# 生成 MCP 配置片段（给智能体用）',
  'yokimind mcp print',
].join('\n')

/** Skills HTTP 接口片段 */
const skillsSnippet = [
  '# 技能列表（每个知识库一条：name / description / wikiId）',
  `curl ${apiRoot}/skills -H "Authorization: Bearer yki_你的令牌"`,
  '',
  '# 下载指定知识库的 SKILL.md（Agent Skills 标准格式）',
  `curl ${apiRoot}/skills/<wikiId>/SKILL.md -H "Authorization: Bearer yki_你的令牌" -o SKILL.md`,
].join('\n')
</script>
