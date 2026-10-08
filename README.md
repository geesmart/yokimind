<p align="center">
  <img src="/images/banner.png" width="400" alt="YokiMind" />
  <!-- TODO: banner 图待补充，放入仓库根目录 images/banner.png -->
</p>

<p align="center">
  <strong>YokiMind · 把你的知识记录，做团队的企业大脑</strong>
</p>

<p align="center">
  <!-- TODO: 官方网站与交流群链接待补充 -->
  <a target="_blank" href="#">📖 官方网站</a> &nbsp; | &nbsp;
  <a target="_blank" href="/images/wechat.png">🙋‍♂️ 微信交流群</a>
</p>

## 👋 项目介绍

YokiMind 是一款国产开源的 **AI 知识库与文档协作系统**，帮助你快速构建智能化的 **产品文档、技术文档、FAQ、博客系统**：

- 📚 **国内开源语雀平替**：知识库、文档树、富文本编辑器，团队文档管理的核心能力开箱即用
- 🤝 **飞书知识库轻量替代**：私有化部署，数据完全自持，没有按人头订阅费
- 🤖 **ima 同款 AI 知识库**：文档喂进去，基于 RAG 的 AI 问答与 AI 搜索随问随答
- 🧠 **企业大脑**：把散落各处的知识沉淀为整个组织的第二大脑

同时它也是一套开箱即用的 **私有化部署方案**：一条 Docker 命令即可拉起完整服务（应用 + 数据库 + 对象存储 + 向量检索 + 统一入口网关），数据全部留在你自己的服务器上。

<p align="center">
  <!-- TODO: 产品全景截图待补充，放入 images/setup.png -->
  <img src="/images/setup.png" width="800" alt="YokiMind 界面总览" />
</p>

## ⚡️ 界面展示

<!-- TODO: 四张界面截图待补充，放入 images/screenshot-1.png ~ screenshot-4.png -->

| 控制台                                           | Wiki 网站前台                                    |
|--------------------------------------------------|--------------------------------------------------|
| <img src="/images/screenshot-1.png" width=370 /> | <img src="/images/screenshot-2.png" width=370 /> |
| <img src="/images/screenshot-3.png" width=370 /> | <img src="/images/screenshot-4.png" width=370 /> |

## 🔥 功能与特色

- **AI 驱动智能化**：AI 辅助创作、基于 RAG 向量检索的 AI 问答与 AI 搜索（Qdrant + LangChain，兼容 OpenAI 接口的大模型服务商均可接入）。
- **强大的富文本编辑能力**：Tiptap 3 编辑器，兼容 Markdown，支持表格、任务列表、目录、代码高亮、数学公式、图片等；local-first 自动保存，刷新、断网内容都不丢。
- **文档分享与发布**：支持密码保护的分享链接；一键发布为 SEO 友好的公开站点（Nuxt SSR 渲染），博客、Wiki、图文日志直接对外呈现。
- **媒体文件管理**：基于 S3 兼容对象存储（内置 RustFS），上传图片直链访问，换域名零配置。
- **多格式导入导出**：支持 Markdown 等多种格式的内容导入与导出。
- **开箱即用的私有化部署**：单 Docker 镜像 + 一条命令，自带 PostgreSQL / Redis / Qdrant / RustFS 全套依赖与数据持久化。

## 🚀 上手指南

### 一键部署

你需要一台装有 **Docker 20.x 以上版本**（含 Docker Compose 插件）的 Linux / macOS 服务器。

```bash
# 1. 获取项目（git clone 或下载 release 包均可）
git clone <仓库地址> yokimind && cd yokimind

# 2. 生成部署配置（全部参数都有默认值，可先不改）
cp .env.example .env

# 3. 启动（首次会自动构建应用镜像，需几分钟）
docker compose up -d
```

命令执行完毕后，浏览器打开 **http://localhost:60000**（Caddy 统一入口，可用 `HTTP_PORT` 修改），注册账号即可开始使用。

> 首次启动 `docker compose` 会自动构建 `yokimind:latest`（应用镜像）与 `yokimind-caddy:latest`（网关镜像），之后重启秒级完成。
>
> 所有数据（数据库、上传文件、向量索引、队列）都存放在 Docker 命名卷中，容器升级、重建均不丢失。

### 配置 AI 模型

> YokiMind 由 AI 大模型驱动，在未配置大模型的情况下，AI 创作、AI 问答、AI 搜索等功能无法正常使用。

登录后进入控制台的 AI 设置，配置任意 **OpenAI 兼容接口** 的服务商（填入 Base URL、API Key、模型名即可），聊天模型与向量 Embedding 模型支持分开配置。配置保存后 AI 功能即刻可用，后续修改同样即时生效。

### 创建知识库

「知识库」是一组文档的集合。创建知识库后，你可以在其中组织文档树、编辑内容、启用 AI 问答，并将知识库一键发布为公开网站。

<!-- TODO: 创建知识库截图待补充，放入 images/createkb.png -->
<p align="center">
  <img src="/images/createkb.png" width="800" alt="创建知识库" />
</p>

### 💪 开始使用

如果你顺利完成了以上步骤，那么恭喜你，属于你的 YokiMind 搭建成功，你可以：

- 访问 **控制台** 来管理知识库、编辑文档、配置 AI 与分享发布
- 访问 **Wiki 网站** 查看发布效果，体验 AI 问答与 AI 搜索

## ⚙️ 环境变量

复制 `.env.example` 为 `.env` 后按需修改，**全部参数均有默认值**，最小化配置即可启动：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `HTTP_PORT` | `60000` | Caddy 对外入口端口（对外唯一端口，避开 80/443/808x 常见占用） |
| `YOKIMIND_PORT` | `8080` | 应用直连调试端口（→ 容器 6001 API，日常走统一入口可留可关） |
| `JWT_SECRET` | 空（回退公开默认值） | 分享/预览令牌的 HMAC 签名密钥，**公网部署务必设置为随机长字符串** |
| `POSTGRES_PASSWORD` | `yokimind` | PostgreSQL 密码（仅首次建卷初始化时生效） |
| `RUSTFS_ACCESS_KEY` | `yokimind` | 对象存储访问凭据，**生产环境务必修改** |
| `RUSTFS_SECRET_KEY` | `yokimind-secret` | 对象存储访问凭据，**生产环境务必修改** |
| `S3_PUBLIC_URL` | 不设 | 媒体对外地址，默认按 `X-Forwarded-*` 请求头自动派生；仅 CDN / 独立文件域名场景才需显式覆盖 |

## 🔒 HTTPS 部署

本方案对外仅暴露一个纯 HTTP 端口（`HTTP_PORT`，默认 60000），**不内置自动 HTTPS**。需要加密传输时，在前面的反向代理 / 云负载均衡上做 TLS 终结（nginx / Caddy / 云 SLB 均可），把 443 流量转发到本机 `HTTP_PORT` 端口即可。

媒体文件 URL 由服务端按 `X-Forwarded-*` 请求头自动派生，与证书层无关，更换域名零配置。

## 🧩 进阶部署

已有 PostgreSQL / Redis / Qdrant / S3 的用户（少拉几个镜像），可以直接运行纯应用镜像：

```bash
docker build -t yokimind:latest .

docker run -d -p 8080:6001 \
  -e DATABASE_URL=postgres://用户:密码@主机:5432/库名 \
  -e REDIS_URL=redis://主机:6379/2 \
  -e QDRANT_URL=http://主机:6333 \
  -e S3_ENDPOINT=http://主机:9000 \
  -e S3_BUCKET=yokimind-media \
  -e S3_ACCESS_KEY=... -e S3_SECRET_KEY=... \
  yokimind:latest
```

## 🏗️ 架构与目录

所有流量经 Caddy 按路径分流到单容器内的三个服务（单域名 + 路径区分，与生产反代同构）：

| 路径 | 上游 | 说明 |
| --- | --- | --- |
| `/` | web SPA | Vue 3 编辑器控制台 |
| `/api/*` | Hono API | 后端服务 |
| `/w` `/b` `/_nuxt` | Nuxt SSR | 公开内容站（SEO 友好） |
| `/media/*` | RustFS | S3 兼容对象存储（图片等媒体文件） |

Monorepo 结构（pnpm workspace + TypeScript）：

| 目录 | 说明 | 技术栈 |
| --- | --- | --- |
| `apps/web` | 编辑器控制台（SPA） | Vue 3 · Arco Design Vue · Tailwind CSS 4 · Vite 8 · Tiptap 3 |
| `apps/server` | 后端服务 | Hono · Drizzle ORM · PostgreSQL 17 · Redis 7 / BullMQ · Qdrant · LangChain |
| `apps/pages` | 公开内容站（SSR） | Nuxt 4 · Tailwind CSS 4 |

## 📚 文档索引

深入设计细节可阅读仓库内文档：

- [Docker 部署与镜像发布方案](docs/产品设计/Docker部署与镜像发布方案.md)
- [服务地址与端口规划](docs/产品设计/服务地址与端口规划.md)
- [RAG 智能问答功能设计](docs/产品设计/RAG智能问答功能设计.md)
- [分享功能设计](docs/产品设计/分享功能设计.md)
- [媒体文件存储设计](docs/产品设计/媒体文件存储设计.md)

## 🛠️ 本地开发

想在本地跑起开发环境？依赖容器一键启动（`pnpm docker:up`），应用进程宿主机直跑，详见 [docs/测试环境启动.md](docs/测试环境启动.md)。

## 🤝 贡献

欢迎提交 Pull Request 或创建 Issue 来帮助改进项目。

## 💬 社区交流

欢迎加入我们的微信群进行交流。

<!-- TODO: 微信群二维码待补充，放入 images/wechat.png -->
<p align="center">
  <img src="/images/wechat.png" width="300" alt="微信交流群" />
</p>

## 📝 许可证

本项目采用 GNU Affero General Public License v3.0 (AGPL-3.0) 许可证。这意味着：

- 你可以自由使用、修改和分发本软件
- 你必须以相同的许可证开源你的修改
- 如果你通过网络提供服务，也必须开源你的代码
- 商业使用需要遵守相同的开源要求
