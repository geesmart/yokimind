# YokiMind 部署指南

YokiMind 的全部服务（应用 + PostgreSQL 17 + Redis 7 + Qdrant + RustFS 对象存储）打包为一个 Docker 镜像，配合 `docker-compose.yml` 编排，一条命令即可拉起完整的自托管环境，无需安装 Node.js 或任何数据库软件。对外仅暴露一个 HTTP 端口（默认 `60000`）。

## 快速开始

前置要求：Docker 20.10+（含 Docker Compose v2，`docker compose version` 可验证）；建议 2 核 CPU / 4GB 内存 / 10GB 磁盘起。

### 一键安装（推荐）

```sh
git clone <本仓库地址>
cd yokimind/install
./install.sh
```

脚本会：

- 只交互确认对外端口（回车默认 `60000`）
- 自动生成 `.env`：签名密钥、数据库密码、对象存储密钥全部随机生成，零手工配置
- 幂等可重跑：已有配置绝不覆盖，栈已在跑时重跑等价于一次更新
- 完成后生成 `NOTES.md`：安装备注——本次部署的访问地址与实际配置（含明文凭据，勿外传）
- 启动时先删除上次的 `NOTES.md` 与 `install.log`；全程输出记录在 `install.log`，终端只显示进度，排查问题看它

### 安装后首次使用

1. 浏览器打开 `http://<服务器IP>:<端口>`（本机为 `http://localhost:60000`），注册的第一个账号即为管理员。
2. 进 **/admin → AI 设置** 填写服务商 API 地址、模型与 API Key，保存即生效。未配置 AI 时文档写作不受影响，AI 问答与知识库索引会保持等待，配置后自动恢复。

也可以手工部署：复制 `.env.example` 为 `.env` 按需修改，然后 `docker compose up -d --wait`（注意：手工路径没有自动生成凭据，公网部署务必自行设置 `JWT_SECRET` 与对象存储凭据）。

## 配置说明

`cp .env.example .env` 后按需修改，所有项都有默认值（一键安装已自动生成并随机化凭据）：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `HTTP_PORT` | `60000` | 对外唯一入口端口，端口被占时改这里 |
| `JWT_SECRET` | 空（回退内置默认） | 分享/预览令牌签名密钥，**公网部署务必设随机长字符串** |
| `POSTGRES_PASSWORD` | `yokimind` | 数据库密码，**仅首次建卷时生效**，已有数据后修改需进库改 |
| `RUSTFS_ACCESS_KEY` / `RUSTFS_SECRET_KEY` | `yokimind` / `yokimind-secret` | 对象存储凭据，生产环境务必修改 |
| `S3_ENDPOINT` / `S3_BUCKET` / `S3_ACCESS_KEY` / `S3_SECRET_KEY` | 空（回退内置 RustFS） | 外接 S3 兼容存储（MinIO/云 S3）时设置，应用直连外部存储；凭据须成对，改内置 RustFS 凭据直接改 `RUSTFS_*` |
| `YOKIMIND_IMAGE` | `geesmart/yokimind:v1.0.0` | 应用镜像地址，离线导入/私有 registry 时改成实际 tag |

## 日常操作

```sh
docker compose ps                   # 服务状态（全部 healthy 即就绪）
docker compose logs --tail 100 app  # 应用日志
docker compose down                 # 停止并移除容器（数据保留）
docker compose down -v              # 彻底卸载，连同数据卷一并删除（谨慎！）
```

所有数据持久化在命名卷中，停止/更新/重建容器不丢失。

备份数据库：

```sh
docker exec $(docker compose ps -q postgres) \
  pg_dump -U postgres -d yokimind > yokimind-backup-$(date +%F).sql
```

恢复：`cat <备份文件> | docker exec -i $(docker compose ps -q postgres) psql -U postgres -d yokimind`

## 常见问题

**如何升级？** 新版本发布后，把 `.env` 的 `YOKIMIND_IMAGE` 改指向新镜像 tag（默认 tag 有更新则不用改），然后执行：

```sh
./update.sh    # 或重跑 ./install.sh，两者等价
```

数据全部保留在命名卷中，应用启动时自动执行数据库迁移（幂等）。
