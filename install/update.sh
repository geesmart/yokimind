#!/bin/sh
# YokiMind 更新脚本：拉取新镜像 → 重建应用容器
#
# - 数据存放在命名卷中，更新/重建容器不丢失
# - 应用启动时自动执行数据库迁移（幂等，重复执行无副作用）
# 用法：./update.sh
set -e
cd "$(dirname "$0")"

echo "YokiMind · 拉取新镜像..."
docker compose pull

echo "YokiMind · 重建应用容器..."
docker compose up -d --wait

# 清理悬空的旧镜像层，释放磁盘
docker image prune -f

echo "YokiMind · 更新完成"
