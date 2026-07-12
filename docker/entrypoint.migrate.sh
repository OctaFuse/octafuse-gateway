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
_run_migrate() {
	_driver="$1"
	shift
	if ! node "$MIGRATE_CLI" --driver "$_driver" "$@"; then
		echo "[docker-entrypoint:migrate] ERROR: migrate CLI exited non-zero" >&2
		exit 1
	fi
	echo "[docker-entrypoint:migrate] MIGRATE_DONE"
	echo "[docker-entrypoint:migrate] 一次性任务已完成，容器将正常退出。"
	echo "[docker-entrypoint:migrate] Zeabur/K8s 上请勿将此镜像作为常驻 Service；见 docs/operators/deployment/zeabur.md"
}

case "$_eff" in
	""|postgres|postgresql|pg)
		echo "[docker-entrypoint:migrate] DATABASE_DRIVER=postgres (default)"
		_run_migrate postgres
		;;
	mysql|mysql2)
		export DATABASE_DRIVER="${DATABASE_DRIVER:-mysql}"
		echo "[docker-entrypoint:migrate] DATABASE_DRIVER=${DATABASE_DRIVER}"
		_run_migrate mysql
		;;
	*)
		echo "[docker-entrypoint:migrate] ERROR: unsupported DATABASE_DRIVER='${DATABASE_DRIVER:-}'" >&2
		exit 1
		;;
esac
