#!/bin/sh
# proxy / admin 常驻镜像入口：AUTO_MIGRATE 为真时先跑迁移再 exec CMD；默认跳过迁移。

set -eu

MIGRATE_CLI="/app/packages/core/dist/migrate/cli.js"

_is_truthy() {
	case "$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')" in
		1|true|yes|on) return 0 ;;
		*) return 1 ;;
	esac
}

_run_migrate() {
	_driver="$1"
	if ! node "$MIGRATE_CLI" --driver "$_driver"; then
		echo "[docker-entrypoint:app] ERROR: migrate CLI exited non-zero" >&2
		exit 1
	fi
	echo "[docker-entrypoint:app] MIGRATE_DONE"
}

if _is_truthy "${AUTO_MIGRATE:-}"; then
	if [ -z "${DATABASE_URL:-}" ]; then
		echo "[docker-entrypoint:app] ERROR: AUTO_MIGRATE is set but DATABASE_URL is required" >&2
		exit 1
	fi

	if [ ! -f "$MIGRATE_CLI" ]; then
		echo "[docker-entrypoint:app] ERROR: migrate CLI missing at ${MIGRATE_CLI}" >&2
		exit 1
	fi

	_eff="$(printf '%s' "${DATABASE_DRIVER:-}" | tr '[:upper:]' '[:lower:]')"
	case "$_eff" in
		""|postgres|postgresql|pg)
			echo "[docker-entrypoint:app] AUTO_MIGRATE: DATABASE_DRIVER=postgres (default)"
			_run_migrate postgres
			;;
		mysql|mysql2)
			export DATABASE_DRIVER="${DATABASE_DRIVER:-mysql}"
			echo "[docker-entrypoint:app] AUTO_MIGRATE: DATABASE_DRIVER=${DATABASE_DRIVER}"
			_run_migrate mysql
			;;
		*)
			echo "[docker-entrypoint:app] ERROR: unsupported DATABASE_DRIVER='${DATABASE_DRIVER:-}'" >&2
			exit 1
			;;
	esac
fi

exec "$@"
