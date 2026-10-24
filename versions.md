# 版本信息

记录每个版本的变更，新版本在最上方。版本号以根 package.json 为唯一来源，四端（server/web/pages）保持一致。

## v1.0.4（2026-10-24）

### 新功能

- server: 智能体接入层落地——PAT 访问令牌（/token）、Agent API（/agent）、MCP Server（/mcp）、Skills（/skills）四模块共用 PAT 认证中间件，新增 accessTokens 表迁移与 agent/mcp/skills/token 集成测试
- web: 新增智能体接入页 /settings/agents（PAT 管理与 MCP / CLI / Skills 接入指引，外部 AI 客户端经 PAT 访问知识库）
- cli: 新增 apps/cli 命令行应用（yokimind CLI）
- website: 新增 apps/website 官网应用（Nuxt）
- editor: 新增 callout、card、code-block（NodeView 代码高亮）、columns、steps、prompt 提示块（Vue NodeView）、下划线样式、标题折叠、缩进、placeholder 等扩展，新增图标/Emoji 选择面板（icon-emoji-panel）
- wiki: 服务端新增 Markdown 渲染器（document-markdown.renderer）、code-html-enhancer、content-json-prune、wiki-icon-svg
- bin: 新增 build-solar-outline.mjs 太阳系图标轮廓构建脚本

### 优化

- web: 编辑器与 UI 组件图标从 lucide 全面替换为 Hugeicons
- web: wiki 图标选择统一为 icon-emoji-panel + wiki-icon，移除旧 icon-picker
- monorepo: TS 配置对齐 TS7（baseUrl 已废弃，paths 改 ./ 相对前缀，server 调整 rootDir）；根包名 yokimind-monorepo → yokimind；品牌 logo 资源更新
- markdown-css: 样式大幅扩展并补充 index.d.ts 类型
- pages: 新增 code-block、prompt-copy 客户端插件，优化预览设置面板
- .trae: 新增多份功能计划文档与 skills，更新开发规则

### 修复BUG

- editor: 修复工具栏按钮激活态、折叠按钮布局、表格表头勾选同步、columns/容器 Backspace 删除、callout 内快捷键误触、code block 下 bubble menu 误弹、输入框 ring 光晕过宽、代码块全屏图标对调
- pages: 修复代码块与 prompt 块渲染问题

## v1.0.3（2026-10-14）

### 新功能

- bin: 新增 open-source/git-push.mjs 开源仓 add+commit+push 一条龙（remote 护栏校验、幂等退出、绝不 force）

### 优化

- bin: build-open-source/ 目录改名 open-source/（index.mjs → git-build.mjs），同步更新 README/docs/.ignore 旧路径引用
- bin: docker-publish.mjs 新增版本 tag 守卫（HEAD 必须精确在 v{version} tag 上，防新代码打出旧版本标签）
- bin: docker-publish.mjs 冒烟测试改为开头交互确认（跳过时不做 arm64 加载与 compose 探活，构建后直接进推送）
- bin: git-publish.mjs 移除测试关卡（dev 栈健康检查 + typecheck + test），流程收敛为 预检 → 定档 → 合并 push
- install: 默认镜像改追 latest tag，升级无需改 .env；锁定版本场景改 YOKIMIND_IMAGE 即可
- README: 重写项目介绍并补齐界面展示配图，删除过时的 v1_README.md

### 修复BUG

- web: Markdown 导出丢失图片尺寸（官方 renderMarkdown 只输出 ![alt](src)），width/对齐/样式非默认时改输出 HTML <img> 形式（px 宽度附带 width 内容属性兼容 GitHub），导入/粘贴可无损往返

## v1.0.2（2026-10-14）

### 新功能

- bin: 新增 git-dev.mjs 开始开发脚本（归位 dev 分支并对齐远端，不推送）
- bin: 新增 git-publish.mjs 发布脚本（测试→版本定档→合并 main→推送双分支+tag）
- bin: 新增 docker-publish.mjs 一条龙镜像发布（双架构构建→冒烟→推 Docker Hub，吸收原 build-publish-docker 三步）
- docs: 新增 Git版本与发布管理.md（dev 日常开发 / main 发布线的双分支模型设计）

### 优化

- bin: 移除 release.mjs 与 gitflow/、build-publish-docker/ 旧流水线，发版收敛为 git-publish + docker-publish 双脚本
- bin: 发版脚本交互统一 @clack/prompts，全程幂等可重入
- .trae: git-commit 命令适配新工作流（非 dev 分支提示 git-dev.mjs 归位，发版指向 git-publish.mjs）

### 修复BUG

- 无

## v1.0.1（2026-10-14）

### 新功能

- bin: 新增 release.mjs 一键发版编排，AI 发版命令脚本化收敛
- wiki 文档导出 Markdown；媒体模块扩展；迁移基线重置；gitflow 工具链
- web: 落地页展示当前版本号（构建期注入根 package.json version）
- pages: 优化AI聊天界面与后端集成
- wiki: 实现知识库目录首页自动跳转至首文档功能
- rag: 添加知识库RAG聚合状态表和批量查询接口
- rag: 添加RAG知识库功能和AI问答系统
- dashboard: 优化仪表板功能和文档编辑体验
- 初始化项目，提交墨刻文档编辑器代码

### 优化

- server: 更新服务器经验文档并优化pages端API连接策略
- experience: 更新开发规范文档与API常量定义
- project: 更新项目文档中的项目名称引用
- rules: 更新服务器部署和前端开发规则文档
- rules: 添加前后端开发经验文档和规则更新
- editor: 调整markdown样式和编辑器组件
- skills: 整理了下文件
- 更新文档编辑器相关计划文档 - 大更新
- dashboard: 重构首页为单列布局并优化图片组件

### 修复BUG

- editor: 修复标题层级显示与AI写作功能问题
- editor: 解决块菜单手柄定位和功能失效问题

## v1.0.0（2026-10-13）

### 新功能

- pages: 优化AI聊天界面与后端集成
- wiki: 实现知识库目录首页自动跳转至首文档功能
- rag: 添加知识库RAG聚合状态表和批量查询接口
- rag: 添加RAG知识库功能和AI问答系统
- dashboard: 优化仪表板功能和文档编辑体验
- 初始化项目，提交墨刻文档编辑器代码

### 优化

- server: 更新服务器经验文档并优化pages端API连接策略
- experience: 更新开发规范文档与API常量定义
- project: 更新项目文档中的项目名称引用
- rules: 更新服务器部署和前端开发规则文档
- rules: 添加前后端开发经验文档和规则更新
- editor: 调整markdown样式和编辑器组件
- skills: 整理了下文件
- 更新文档编辑器相关计划文档 - 大更新
- dashboard: 重构首页为单列布局并优化图片组件

### 修复BUG

- editor: 修复标题层级显示与AI写作功能问题
- editor: 解决块菜单手柄定位和功能失效问题
