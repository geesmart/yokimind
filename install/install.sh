#!/usr/bin/env bash
# ============================================================================
# YokiMind · 一键安装脚本（源码部署 · Linux / macOS）
#
# 面向 git clone 用户的部署入口，一条命令完成「配置生成 → 镜像拉取 → 启动 → 验证」：
#
#   git clone <本仓库>
#   cd <仓库>/install
#   ./install.sh            # 或 bash install.sh
#
# 七步流水线（每步输出「[n/7] 描述 ... ✓（耗时）」，失败即停并给排查提示）：
#   [1/7] 预检        根目录文件 / docker / compose v2 / 端口占用 / 旧栈状态
#   [2/7] 交互收集    对外端口 HTTP_PORT（回车取默认 60000）；
#                     凭据【不交互】全自动随机生成（见 [3/7]）
#   [3/7] 生成 .env   幂等合并：已有值绝不动（重跑安全），缺失项才补写；
#                     凭据全部随机：JWT_SECRET = 64 位混合字母数字；
#                     POSTGRES_PASSWORD / RUSTFS_SECRET_KEY = 分段可读样式
#                     （4 组 5 字符，如 Kp3Xw-9Rt2M-v7Qz5-Bn8Jd）；
#                     RUSTFS_ACCESS_KEY = 16 位混合字母数字（无符号，S3 惯例）
#   [4/7] 拉取镜像    docker compose pull（应用镜像 + 4 个基础设施镜像）
#   [5/7] 启动全栈    docker compose up -d --wait（healthcheck 链保证就绪顺序）
#   [6/7] 可用性验证  轮询 /api/v1/health 至 200（curl → wget → node 三级探测）
#   [7/7] 输出配置    生成 NOTES.md（安装备注：访问地址 + 本次全部实际配置 +
#                     常用命令），凭据明文写入，权限 600
#
# 设计约定：
#   - 静默安装：终端只显示 [n/7] 进度与耗时；docker 全部输出（拉取进度/容器
#     启停/健康等待）写入 install.log（每次安装重写），排查问题看它；
#     启动时先删除上次的 NOTES.md 与 install.log，避免失败后残留旧内容误导
#   - 幂等：重复执行安全——.env 只补缺失项不动已有值；栈已在跑则等价于
#     「pull + up --wait」的更新操作（与 update.sh 效果一致）
#   - 零交互兼容：stdin 非 tty（管道/curl|bash 执行）时跳过交互、全部取默认值
#   - 环境变量预设：HTTP_PORT=61000 ./install.sh 可跳过端口交互（自动化/CI 场景）
#   - 自包含：compose/.env/README 全在本目录，凭据只落本目录，不碰仓库根
# ============================================================================

set -euo pipefail

# ============================================================================
# 输出基建：颜色（非 tty 自动去色，管道执行不出乱码）
# ============================================================================
if [ -t 1 ]; then
  C_INFO=$'\033[36m'   # 青：步骤名
  C_OK=$'\033[32m'     # 绿：✓ 成功
  C_WARN=$'\033[33m'   # 黄：⚠ 警告
  C_ERR=$'\033[31m'    # 红：✗ 失败
  C_NC=$'\033[0m'      # 复位
else
  C_INFO='' C_OK='' C_WARN='' C_ERR='' C_NC=''
fi

info() { printf '%s▸ %s%s\n' "$C_INFO" "$*" "$C_NC"; }
ok()   { printf '%s✓ %s%s\n' "$C_OK" "$*" "$C_NC"; }
warn() { printf '%s⚠ %s%s\n' "$C_WARN" "$*" "$C_NC"; }

# 步骤框架：step 开一行「[n/7] 描述 ...」，命令跑完后 step_ok/step_fail 收尾
STEP_T0=0
step() { STEP_T0=$(date +%s); printf '%s[%s/7] %s ...%s\n' "$C_INFO" "$1" "$2" "$C_NC"; }
step_ok() { printf '%s✓（%ss）%s\n' "$C_OK" "$(( $(date +%s) - STEP_T0 ))" "$C_NC"; }

die() { printf '%s✗ %s%s\n' "$C_ERR" "$*" "$C_NC"; exit 1; }

# 总耗时基准（秒），成功摘要用
TOTAL_T0=$(date +%s)

# ============================================================================
# 路径定位：一切以「本脚本所在目录」（install/）为工作目录。
# compose / .env / .env.example / README 都在这里，自包含、不依赖执行时的 cwd，
# 从仓库根、install/ 内、甚至绝对路径调用行为完全一致。
# ============================================================================
cd "$(dirname "$0")"
ENV_FILE=".env"
COMPOSE_FILE="docker-compose.yml"
ENV_EXAMPLE=".env.example"
NOTES_FILE="NOTES.md"
LOG_FILE="install.log"

# 启动即清理上一轮安装产物：NOTES.md 记录的是「上次成功安装」的配置，本次若
# 装到一半失败，残留的旧备注会误导排查，故随 install.log 一并删除；
# install.log 紧接着重建，保证内容只属于本次安装
rm -f "$LOG_FILE" "$NOTES_FILE"
{
  printf 'YokiMind 安装日志  %s\n' "$(date '+%Y-%m-%d %H:%M:%S')"
  printf '脚本目录：%s\n\n' "$(pwd)"
} > "$LOG_FILE"

# ============================================================================
# 工具函数
# ============================================================================

# rand_key <长度>：生成随机字母数字串（无符号）。
# 字符表：去除易混淆字符（0/O、1/l/I）的混合大小写字母 + 数字，
# 纯字母数字对 URL userinfo（postgres 连接串）与 S3 签名都绝对安全
# 随机源：优先 openssl（有限输出，管道自然 EOF 收尾）；无 openssl 时退
# dd 定长读 /dev/urandom 循环补足——全程【有限读取】，规避「无限流 + head
# 截断」模式在某些环境下的挂起风险（tr 永不退出导致管道悬死）
rand_key() {
  local n="$1" out=""
  if command -v openssl >/dev/null 2>&1; then
    # 目标字母表 ⊂ base64 字符集（命中率约 84%），取 2n 字节必够，不足由下方循环补
    out=$(openssl rand -base64 $(( n * 2 )) \
      | LC_ALL=C tr -dc 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789')
  fi
  while [ "${#out}" -lt "$n" ]; do
    out="$out$(dd if=/dev/urandom bs=$(( n * 6 )) count=1 2>/dev/null \
      | LC_ALL=C tr -dc 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789')"
  done
  printf '%s' "${out:0:$n}"
}

# rand_pass <组数>：生成「美观可读」的随机密码——每组 5 字符、组间 '-' 分隔，
# 如 4 组 → Kp3Xw-9Rt2M-v7Qz5-Bn8Jd（20 字符 ≈ 114 位熵）。
# '-' 属 URL 保留字符外的 unreserved，连接串中无需转义；fold 分组 + paste 连接
rand_pass() {
  rand_key $(( $1 * 5 )) | fold -w 5 | paste -sd- -
}

# env_get <KEY>：从 .env 读已有值（未设置/文件不存在输出空串）
env_get() {
  [ -f "$ENV_FILE" ] || return 0
  grep -E "^$1=" "$ENV_FILE" | head -n1 | cut -d= -f2- || true
}

# env_set <KEY> <VALUE>：幂等写入 .env——已有 KEY= 行【绝不动】（重跑安全），
# 只在缺失时追加。返回 0=本次新写入，1=已保留旧值（调用方据此汇报）
env_set() {
  if grep -qE "^$1=" "$ENV_FILE" 2>/dev/null; then
    return 1
  fi
  printf '%s=%s\n' "$1" "$2" >> "$ENV_FILE"
}

# port_in_use <PORT>：宿主端口是否已被监听（lsof 优先，退 bash 内建 /dev/tcp 探测）
port_in_use() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
  else
    (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null
  fi
}

# http_ok <URL>：HTTP 探测是否 200（curl → wget → node 三级探测）。
# 备 node 一级的原因：部分安全软件会拦本机 curl/wget，node fetch 不受影响
http_ok() {
  if command -v curl >/dev/null 2>&1; then
    curl -sf -o /dev/null --max-time 3 "$1" && return 0
  fi
  if command -v wget >/dev/null 2>&1; then
    wget -q -O /dev/null -T 3 "$1" 2>/dev/null && return 0
  fi
  if command -v node >/dev/null 2>&1; then
    node -e "fetch('$1').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" && return 0
  fi
  return 1
}

# detect_lan_ips：探测本机全部局域网 IPv4（多网卡全列出，第一个作为主访问地址）
#   Linux: ip -4 -o addr scope global；无 ip 命令退 hostname -I
#   macOS: ifconfig 过滤非回环 IPv4
detect_lan_ips() {
  case "$(uname -s)" in
    Linux*)
      if command -v ip >/dev/null 2>&1; then
        ip -4 -o addr show scope global 2>/dev/null | awk '{split($4,a,"/"); print a[1]}'
      else
        hostname -I 2>/dev/null | tr ' ' '\n' | grep -v '^$'
      fi
      ;;
    Darwin*)
      ifconfig 2>/dev/null | awk '/inet / && $2 !~ /^127\./ {print $2}'
      ;;
  esac
}

# run_logged <描述> <命令...>：静默执行命令——输出全部追加进 install.log，
# 终端只显示一行「⏳ 描述」+ 旋转指示（非 tty 时无旋转），完成打印 ✓/✗。
# 返回命令的退出码，调用方据此走失败分支
run_logged() {
  local desc="$1"; shift
  local rc=0
  printf '  %s⏳%s %s ' "$C_INFO" "$C_NC" "$desc"
  if [ -t 1 ]; then
    "$@" >>"$LOG_FILE" 2>&1 &
    local pid=$!
    local spin='|/-\'
    local i=0
    while kill -0 "$pid" 2>/dev/null; do
      printf '\b%s' "${spin:$((i % 4)):1}"
      i=$((i + 1))
      sleep 0.2
    done
    wait "$pid" || rc=$?
    printf '\b \b'
  else
    "$@" >>"$LOG_FILE" 2>&1 || rc=$?
  fi
  if [ "$rc" -eq 0 ]; then
    printf '%s✓%s\n' "$C_OK" "$C_NC"
  else
    printf '%s✗%s\n' "$C_ERR" "$C_NC"
  fi
  return "$rc"
}

# ============================================================================
# [1/7] 预检：文件齐备性 → docker → compose v2 → 端口占用 → 旧栈状态
# ============================================================================
step 1 "环境预检"

[ -f "$COMPOSE_FILE" ] || die "找不到 $COMPOSE_FILE（请在 install/ 目录完整的仓库副本中运行）"
[ -f "$ENV_EXAMPLE" ] || die "找不到 $ENV_EXAMPLE"

# docker 命令 + daemon 活性（docker info 同时验证 CLI 与守护进程）
if ! command -v docker >/dev/null 2>&1; then
  printf '\n%s未检测到 Docker。安装指引：%s\n' "$C_ERR" "$C_NC"
  printf '  Linux:  curl -fsSL https://get.docker.com | sh   # 或发行版包管理器安装 docker-ce\n'
  printf '  macOS:  安装 Docker Desktop（https://www.docker.com/products/docker-desktop/）\n'
  printf '          或有 brew 时：brew install --cask docker\n'
  printf '  Windows: 安装 Docker Desktop（WSL2 后端），在 WSL 内运行本脚本\n'
  die "安装 Docker 后重新执行本脚本"
fi
docker info >/dev/null 2>&1 || die "Docker 已安装但守护进程未运行（Linux: sudo systemctl start docker；macOS/Windows: 启动 Docker Desktop）"

# compose v2 子命令（脚本用到 --wait / --wait-timeout，v1 不支持）
docker compose version >/dev/null 2>&1 || die "缺少 Docker Compose v2（docker compose version 验证失败），请升级 Docker"

ok "docker / compose v2 就绪"

# 本目录 compose 栈是否已在跑（决定端口占用时的处置方式：自家栈=继续重建，他者=退出）
OUR_STACK=0
if docker compose ps -q app 2>/dev/null | grep -q .; then
  OUR_STACK=1
  warn "检测到本目录的 YokiMind 栈已在运行，本次执行将按「更新」处理（数据卷不受影响）"
fi
step_ok

# ============================================================================
# [2/7] 交互收集：唯一交互项 HTTP_PORT（凭据不交互，全自动生成）
#   取值优先级：环境变量预设 > .env 已有值 > 交互输入 > 默认 60000
# ============================================================================
step 2 "确认对外端口"

# 注意：环境预设必须先捕获到独立变量——后面给 HTTP_PORT 赋初值会覆盖同名环境变量
ENV_PRESET_PORT="${HTTP_PORT:-}"
HTTP_PORT_FROM_ENV=$(env_get HTTP_PORT)
HTTP_PORT=""

if [ -n "$ENV_PRESET_PORT" ]; then
  # 环境变量预设（调用方 HTTP_PORT=xxx ./install.sh），自动化/CI 场景跳过交互
  if ! printf '%s' "$ENV_PRESET_PORT" | grep -qE '^[0-9]+$' || [ "$ENV_PRESET_PORT" -lt 1 ] || [ "$ENV_PRESET_PORT" -gt 65535 ]; then
    die "环境变量预设端口非法：HTTP_PORT=$ENV_PRESET_PORT（须为 1-65535 的纯数字）"
  fi
  HTTP_PORT="$ENV_PRESET_PORT"
  info "使用环境变量预设端口：${HTTP_PORT}"
elif [ -n "$HTTP_PORT_FROM_ENV" ]; then
  # .env 已有值（重跑/此前配置过），沿用不问——幂等合并的「绝不动已有值」原则
  HTTP_PORT="$HTTP_PORT_FROM_ENV"
  info "沿用 .env 已配置端口：${HTTP_PORT}"
elif [ -t 0 ]; then
  # 交互输入：带默认值与合法性校验的循环
  printf '%s对外访问端口%s [回车=60000]: ' "$C_INFO" "$C_NC"
  read -r INPUT_PORT || INPUT_PORT=""
  while true; do
    PORT_CAND="${INPUT_PORT:-60000}"
    if ! printf '%s' "$PORT_CAND" | grep -qE '^[0-9]+$'; then
      warn "端口必须是纯数字，请重输"
      printf '对外访问端口 [回车=60000]: '
      read -r INPUT_PORT || INPUT_PORT=""
      continue
    fi
    if [ "$PORT_CAND" -lt 1 ] || [ "$PORT_CAND" -gt 65535 ]; then
      warn "端口范围 1-65535，请重输"
      printf '对外访问端口 [回车=60000]: '
      read -r INPUT_PORT || INPUT_PORT=""
      continue
    fi
    if [ "$PORT_CAND" -lt 1024 ]; then
      warn "1024 以下为特权端口，需要 Docker 以 root 权限绑定，建议改用 1024 以上"
    fi
    HTTP_PORT="$PORT_CAND"
    break
  done
else
  # stdin 非 tty（管道执行）：跳过交互取默认值，保证 curl|bash 场景不挂死
  HTTP_PORT="60000"
  info "非交互环境，使用默认端口：60000"
fi
ok "对外端口：${HTTP_PORT}"

# 端口占用检查（此刻端口才确定，故放在本步末尾）：
#   被自家栈占用 → 放行（更新场景）；被其他进程占用 → 失败退出并打印占用者
if port_in_use "$HTTP_PORT"; then
  if [ "$OUR_STACK" -eq 1 ]; then
    info "端口 ${HTTP_PORT} 由本目录栈自身占用，继续"
  else
    if command -v lsof >/dev/null 2>&1; then
      lsof -nP -iTCP:"$HTTP_PORT" -sTCP:LISTEN | tail -n +2 | head -n 5 || true
    fi
    die "端口 ${HTTP_PORT} 已被其他进程占用：改用其他端口（HTTP_PORT=xxxx ./install.sh 或交互重输），或释放该端口后重试"
  fi
fi
step_ok

# ============================================================================
# [3/7] 生成 .env：幂等合并 + 凭据随机生成（零配置核心）
#   - 文件不存在 → 新建并写入全部 5 项
#   - 文件已存在 → 只补缺失项，【绝不动已有值】（用户手工改过的配置不丢）
#   - 注意：不写 S3_PUBLIC_URL（代码已移除消费，URL 恒为相对路径）；
#           不写 DOMAIN（compose 暂无 HTTPS override 消费）
# ============================================================================
step 3 "生成部署配置 .env"

if [ ! -f "$ENV_FILE" ]; then
  cat > "$ENV_FILE" <<EOF
# YokiMind 部署配置（由 install.sh 自动生成于 $(date '+%Y-%m-%d %H:%M:%S')）
#
# 变量完整说明：同目录 README.md「配置说明」；本次实际生效值清单：NOTES.md
# 修改后执行 docker compose up -d 重建容器生效
# 安全提示：本文件含随机生成的密钥/密码，请勿提交到仓库或外泄（已设 600 权限）

EOF
  WRITTEN=""
  KEPT=""
else
  WRITTEN=""
  KEPT=""
fi

# 逐项幂等写入，记录「新写入 / 已保留」用于结果汇报
for KV in \
  "HTTP_PORT:${HTTP_PORT}" \
  "JWT_SECRET:$(rand_key 64)" \
  "POSTGRES_PASSWORD:$(rand_pass 4)" \
  "RUSTFS_ACCESS_KEY:$(rand_key 16)" \
  "RUSTFS_SECRET_KEY:$(rand_pass 4)"
do
  KEY="${KV%%:*}"
  VALUE="${KV#*:}"
  if env_set "$KEY" "$VALUE"; then
    WRITTEN="${WRITTEN} ${KEY}"
  else
    KEPT="${KEPT} ${KEY}"
  fi
done

# 凭据文件收紧权限：仅属主可读写（含随机密码与签名密钥）
chmod 600 "$ENV_FILE"

if [ -n "$KEPT" ]; then
  info "保留 .env 已有配置：${KEPT}"
fi
ok "写入配置：${WRITTEN:-（无新增，全部沿用已有值）}"
step_ok

# ============================================================================
# [4/7] 拉取镜像：应用镜像（Docker Hub）+ 4 个基础设施镜像
#   客户版 compose 全部走 image: 拉取（无本地构建）；
#   降级策略：在线拉取失败但本地镜像齐备（离线 docker load 导入场景）→ 警告后
#   继续启动；本地也缺失 → 失败退出并给排查提示
# ============================================================================
step 4 "拉取镜像（首次约 500MB-1GB，视网速而定）"

PULL_FAILED=0
run_logged "在线拉取镜像（应用 + PostgreSQL/Redis/Qdrant/RustFS）" docker compose pull || PULL_FAILED=1

if [ "$PULL_FAILED" -eq 1 ]; then
  # 盘点 compose 全部服务镜像的本地齐备性：缺一个都不行（up 会因缺镜像失败）
  MISSING_IMAGES=""
  for IMG in $(docker compose config --images); do
    docker image inspect "$IMG" >/dev/null 2>&1 || MISSING_IMAGES="$MISSING_IMAGES $IMG"
  done
  if [ -n "$MISSING_IMAGES" ]; then
    printf '\n%s镜像拉取失败，且本地缺失:%s\n' "$C_ERR" "$MISSING_IMAGES"
    printf '常见原因：\n'
    printf '  1. 网络无法访问 Docker Hub → 配置镜像加速器（daemon.json registry-mirrors）\n'
    printf '  2. 私有网络 → 在 .env 设置 YOKIMIND_IMAGE 指向可达的镜像地址后重试\n'
    printf '  3. 离线环境 → docker load 导入离线镜像包后重试\n'
    die "docker compose pull 失败（完整输出见 install.log）"
  fi
  warn "在线拉取失败，但所需镜像本地齐备（离线导入场景），继续启动"
fi
step_ok

# ============================================================================
# [5/7] 启动全栈：up -d --wait 等待全部 healthcheck 通过
#   depends_on service_healthy 链保证 postgres → redis/qdrant/rustfs → app 顺序；
#   app 容器 entrypoint 自动执行数据库迁移（幂等）；--wait-timeout 覆盖首次
#   建表 + 桶初始化 + RAG worker 拉起的总耗时
# ============================================================================
step 5 "启动服务（首次启动含数据库建表，请稍候）"

if ! run_logged "启动容器（等待全部健康检查通过）" docker compose up -d --wait --wait-timeout 300; then
  printf '\n%s启动失败，最近的应用日志：%s\n' "$C_ERR" "$C_NC"
  docker compose logs --tail 50 app || true
  printf '\n常见原因：内存不足（建议 4GB）/ 磁盘满 / 端口冲突（改 .env 的 HTTP_PORT）\n'
  die "docker compose up 失败（完整输出见 install.log）"
fi
step_ok

# ============================================================================
# [6/7] 可用性验证：从宿主轮询统一入口全链路（入口 → caddy → API → DB/迁移/worker）
#   上限 120s；失败自动回显应用日志尾部 + 三类常见原因
# ============================================================================
step 6 "验证服务可用性"

HEALTH_URL="http://127.0.0.1:${HTTP_PORT}/api/v1/health"
HEALTH_OK=0
for _ in $(seq 1 60); do
  if http_ok "$HEALTH_URL"; then
    HEALTH_OK=1
    break
  fi
  sleep 2
done

if [ "$HEALTH_OK" -ne 1 ]; then
  printf '\n%s健康检查超时（120s），最近的应用日志：%s\n' "$C_ERR" "$C_NC"
  docker compose logs --tail 50 app || true
  printf '\n常见原因：\n'
  printf '  1. 首次启动迁移耗时超过 120s → docker compose ps 观察 app 转 healthy 即成功\n'
  printf '  2. 端口映射异常 → 核对 .env 的 HTTP_PORT 与 docker compose ps 端口列\n'
  printf '  3. 容器反复重启 → docker compose logs -f app 查看崩溃原因\n'
  die "服务可用性验证未通过"
fi
ok "健康检查通过：${HEALTH_URL}"
step_ok

# ============================================================================
# [7/7] 输出安装备注 NOTES.md（含本次全部实际配置明文）
#   定位：安装后的速查备注——访问地址 / 实际凭据 / 拓扑 / 常用命令 / 注意事项；
#   启动时删除上次文件，安装成功后重建（内容反映本次实际配置），权限 600
# ============================================================================
step 7 "生成安装备注 NOTES.md"

# 局域网 IP 列表（多网卡全列，第一个作主地址）；拿不到时给占位说明
LAN_IPS=$(detect_lan_ips | grep -v '^$' || true)
PRIMARY_IP=$(printf '%s\n' "$LAN_IPS" | head -n1)
[ -n "$PRIMARY_IP" ] || PRIMARY_IP="<服务器局域网IP>"

# 生效镜像地址：.env 显式设置优先，否则取客户版 compose 的默认值
EFFECTIVE_IMAGE=$(env_get YOKIMIND_IMAGE)
[ -n "$EFFECTIVE_IMAGE" ] || EFFECTIVE_IMAGE="geesmart/yokimind:v1.0.0"

# 读回 .env 最终值（幂等合并后以文件为准；已有旧值场景展示的才是真实生效值）
FINAL_PORT=$(env_get HTTP_PORT)
FINAL_JWT=$(env_get JWT_SECRET)
FINAL_PG_PASSWORD=$(env_get POSTGRES_PASSWORD)
FINAL_RUSTFS_AK=$(env_get RUSTFS_ACCESS_KEY)
FINAL_RUSTFS_SK=$(env_get RUSTFS_SECRET_KEY)

cat > "$NOTES_FILE" <<EOF
# YokiMind 安装备注（自动生成）

> 由 install.sh 于 $(date '+%Y-%m-%d %H:%M:%S') 生成，每次安装成功后重建。
> 完整部署文档（备份/恢复/HTTPS/故障排查）见同目录 [README.md](./README.md)。
> 本文件含**明文凭据**，请勿外传（权限已设为 600）。

## 访问地址

| 地址 | 说明 |
|---|---|
| http://${PRIMARY_IP}:${FINAL_PORT} | 局域网/公网访问（主地址） |
$(printf '%s\n' "$LAN_IPS" | tail -n +2 | awk -v p="${FINAL_PORT}" '{printf "| http://%s:%s | 备用网卡地址 |\n", $1, p}')
| http://localhost:${FINAL_PORT} | 本机访问 |

> 多网卡机器如上列出全部地址；云服务器请用公网 IP 并放行安全组 ${FINAL_PORT} 端口。

## 本次部署的实际配置（.env）

| 变量 | 当前值 | 说明 |
|---|---|---|
| HTTP_PORT | ${FINAL_PORT} | 对外唯一入口端口 |
| JWT_SECRET | ${FINAL_JWT} | 分享/预览令牌签名密钥（安装时随机生成，请勿外泄） |
| POSTGRES_PASSWORD | ${FINAL_PG_PASSWORD} | PostgreSQL 密码（随机生成；仅首次建卷生效，之后改它需进库） |
| RUSTFS_ACCESS_KEY | ${FINAL_RUSTFS_AK} | 对象存储 AK（随机生成，rustfs 与应用两侧自动对齐） |
| RUSTFS_SECRET_KEY | ${FINAL_RUSTFS_SK} | 对象存储 SK（随机生成，同上） |
| YOKIMIND_IMAGE | ${EFFECTIVE_IMAGE} | 应用镜像地址 |

修改配置：编辑 .env 后执行 docker compose up -d 重建容器生效。

## 服务拓扑

| 容器 | 镜像 | 端口 | 数据卷 |
|---|---|---|---|
| app | ${EFFECTIVE_IMAGE} | 宿主 ${FINAL_PORT} → 容器 60000（caddy 统一入口） | yokimind-caddydata / yokimind-caddyconfig |
| postgres | postgres:17-alpine | 仅容器网络 | yokimind-pgdata（业务数据） |
| redis | redis:7-alpine | 仅容器网络 | yokimind-redisdata（任务队列） |
| qdrant | qdrant/qdrant:v1.19.1 | 仅容器网络 | yokimind-qdrantdata（AI 向量索引） |
| rustfs | rustfs/rustfs:1.0.0 | 127.0.0.1:9001（控制台，仅本机） | yokimind-rustfsdata（上传文件） |

对外流量经 app 容器内 caddy 按路径分流：/ → web 前端、/api/* → API、/w /b /_nuxt → 公开站、/media/* → 对象存储。

## 常用命令（本目录执行）

\`\`\`sh
docker compose ps            # 服务状态，全部 healthy 即就绪
docker compose logs -f app   # 应用日志
docker compose stop          # 停止（数据保留）
docker compose up -d --wait  # 启动
./update.sh                  # 更新到新镜像（数据不丢）
docker compose down          # 停止并移除容器（数据保留）
\`\`\`

## 配置 AI（装后必读）

浏览器打开本站 → 注册首个账号（即管理员）→ 右上角进入 **/admin 管理后台 → AI 设置**，
填入服务商地址 / API Key / 模型名，保存即时生效（无需重启）。未配置时 AI 功能保持待命降级，不影响其他功能。

## 注意事项

- **POSTGRES_PASSWORD 仅首次建卷生效**：已有数据后修改 .env 里的它不会改变数据库密码
- **JWT_SECRET / RUSTFS_SECRET_KEY 请勿外泄**：泄露可伪造分享密码令牌、读取上传文件元数据
- **备份**：\`docker exec \$(docker compose ps -q postgres) pg_dump -U postgres -d yokimind > backup.sql\`（详见 README.md「数据与备份」）
- **HTTPS**：前置反代/云负载均衡做 TLS 终结，443 转发到本机 ${FINAL_PORT} 即可（应用零配置）
EOF

chmod 600 "$NOTES_FILE"
ok "已生成 ${NOTES_FILE}"
step_ok

# ============================================================================
# 成功摘要
# ============================================================================
TOTAL_SECS=$(( $(date +%s) - TOTAL_T0 ))
printf '\n'
ok "YokiMind 安装完成（总耗时 ${TOTAL_SECS}s）"
printf '  访问地址：http://%s:%s（本机 http://localhost:%s）\n' "$PRIMARY_IP" "$FINAL_PORT" "$FINAL_PORT"
printf '  安装备注：%s/%s（含本次全部实际配置）\n' "$(pwd)" "$NOTES_FILE"
printf '  安装日志：%s/%s（本次安装完整输出，排查问题用）\n' "$(pwd)" "$LOG_FILE"
printf '  下一步：  打开地址注册首个账号 → /admin 配置 AI 即可使用\n'
