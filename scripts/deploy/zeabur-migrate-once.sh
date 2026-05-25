#!/usr/bin/env sh
# 在 Zeabur / 任意 Docker 环境发版前执行一次性 Postgres/MySQL 迁移。
# 用法（仓库根目录）：
#   export DATABASE_URL='postgresql://...'
#   export GATEWAY_MIGRATE_IMAGE=ghcr.io/octafuse/octafuse-gateway-migrate:latest
#   ./scripts/deploy/zeabur-migrate-once.sh
#
# 成功时日志应含 MIGRATE_DONE；随后再部署 gateway-proxy / gateway-admin。

set -eu

if [ -z "${DATABASE_URL:-}" ]; then
	echo "[zeabur-migrate-once] ERROR: DATABASE_URL is required" >&2
	exit 1
fi

IMAGE="${GATEWAY_MIGRATE_IMAGE:-ghcr.io/octafuse/octafuse-gateway-migrate:latest}"
DRIVER="${DATABASE_DRIVER:-postgres}"

echo "[zeabur-migrate-once] image=${IMAGE}"
echo "[zeabur-migrate-once] DATABASE_DRIVER=${DRIVER}"

docker run --rm \
	-e "DATABASE_DRIVER=${DRIVER}" \
	-e "DATABASE_URL=${DATABASE_URL}" \
	"${IMAGE}"

echo "[zeabur-migrate-once] 迁移容器已退出；请确认上方日志含 MIGRATE_DONE，再部署 proxy/admin。"
