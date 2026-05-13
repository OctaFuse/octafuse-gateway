#!/bin/sh
# 专用迁移镜像入口：有参数时原样 exec（供 compose command 覆盖）；无参数时按 DATABASE_DRIVER 执行一次迁移后退出。

set -eu

MIGRATE_CLI="/app/packages/core/dist/migrate/cli.js"

if [ "$#" -gt 0 ]; then
	exec "$@"
fi

if [ -z "${DATABASE_URL:-}" ]; then
	echo "[docker-entrypoint:migrate] ERROR: DATABASE_URL is required" >&2
	exit 1
fi

if [ ! -f "$MIGRATE_CLI" ]; then
	echo "[docker-entrypoint:migrate] ERROR: migrate CLI missing at ${MIGRATE_CLI}" >&2
	exit 1
fi

_eff="$(printf '%s' "${DATABASE_DRIVER:-}" | tr '[:upper:]' '[:lower:]')"
case "$_eff" in
	""|postgres|postgresql|pg)
		echo "[docker-entrypoint:migrate] DATABASE_DRIVER=postgres (default)"
		node "$MIGRATE_CLI" --driver postgres
		;;
	mysql|mysql2)
		export DATABASE_DRIVER="${DATABASE_DRIVER:-mysql}"
		echo "[docker-entrypoint:migrate] DATABASE_DRIVER=${DATABASE_DRIVER}"
		node "$MIGRATE_CLI" --driver mysql
		;;
	*)
		echo "[docker-entrypoint:migrate] ERROR: unsupported DATABASE_DRIVER='${DATABASE_DRIVER:-}'" >&2
		exit 1
		;;
esac
