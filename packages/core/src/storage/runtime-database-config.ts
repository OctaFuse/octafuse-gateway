import type { D1Database } from '@cloudflare/workers-types';
import type { DatabaseDriver } from './database-client';

/**
 * Proxy / Admin 运行时共用的数据库解析结果。
 * - Cloudflare Worker：仅 `d1`
 * - Node：`postgres` / `mysql`（连接串）
 */
export type RuntimeDatabaseConfig =
	| { driver: 'd1'; db: D1Database }
	| { driver: 'postgres'; connectionString: string }
	| { driver: 'mysql'; connectionString: string };

function parseDatabaseDriver(rawDriver: string | undefined, fallback: DatabaseDriver): DatabaseDriver {
	if (!rawDriver || rawDriver.trim() === '') {
		return fallback;
	}
	const normalized = rawDriver.trim().toLowerCase();
	if (normalized === 'd1') {
		return 'd1';
	}
	if (normalized === 'postgres' || normalized === 'postgresql') {
		return 'postgres';
	}
	if (normalized === 'mysql' || normalized === 'mysql2') {
		return 'mysql';
	}
	throw new Error(
		`Unsupported database driver "${rawDriver}" (set DATABASE_DRIVER). Expected "d1", "postgres" or "mysql".`
	);
}

/**
 * 校验 `DATABASE_DRIVER` 与 `DATABASE_URL` 协议是否一致，不一致则报错。
 * - mysql:// / mysql2:// → 须配 mysql
 * - postgres:// / postgresql:// → 须配 postgres
 * - 无协议前缀（如裸 host/IP）→ 不校验，由驱动自行处理
 */
function assertDriverUrlConsistency(driver: 'postgres' | 'mysql', connectionString: string): void {
	let scheme: string | undefined;
	try {
		const u = new URL(connectionString);
		scheme = u.protocol.replace(/:$/, '').toLowerCase();
	} catch {
		// 无法解析为 URL（如 Unix socket 路径）时跳过校验
		return;
	}

	const isMysqlScheme = scheme === 'mysql' || scheme === 'mysql2';
	const isPgScheme = scheme === 'postgres' || scheme === 'postgresql';

	if (driver === 'mysql' && isPgScheme) {
		throw new Error(
			`DATABASE_DRIVER=mysql 与 DATABASE_URL 协议 "${scheme}://" 不一致，请改为 mysql:// 连接串或将 DATABASE_DRIVER 改为 postgres。`
		);
	}
	if (driver === 'postgres' && isMysqlScheme) {
		throw new Error(
			`DATABASE_DRIVER=postgres（或省略）与 DATABASE_URL 协议 "${scheme}://" 不一致，请改为 postgres:// 连接串或将 DATABASE_DRIVER 改为 mysql。`
		);
	}
}

/**
 * Cloudflare Worker：仅支持 D1（`DB` 绑定）。Postgres 请使用各包的 Node 入口。
 */
export function resolveWorkerDatabaseConfig(bindings: {
	DB?: D1Database;
	DATABASE_DRIVER?: string;
}): Extract<RuntimeDatabaseConfig, { driver: 'd1' }> {
	const raw = bindings.DATABASE_DRIVER?.trim();
	if (raw) {
		const n = raw.toLowerCase();
		if (n === 'postgres' || n === 'postgresql') {
			throw new Error(
				'Workers do not support Postgres. Use D1 binding "DB" on Cloudflare, or run the gateway with Node for Postgres.'
			);
		}
		if (n === 'mysql' || n === 'mysql2') {
			throw new Error(
				'Workers do not support MySQL. Use D1 binding "DB" on Cloudflare, or run the gateway with Node for MySQL.'
			);
		}
		if (n !== 'd1') {
			throw new Error(
				`Unsupported database driver "${raw}" for Workers. Use D1 only (omit DATABASE_DRIVER or set d1).`
			);
		}
	}
	if (!bindings.DB) {
		throw new Error('Workers require D1 binding "DB".');
	}
	return { driver: 'd1', db: bindings.DB };
}

/**
 * Node 入口：由环境变量决定数据库类型与连接串。
 * - **`DATABASE_DRIVER`**：省略时默认为 `postgres`；支持 `postgres` / `mysql`（兼容 `mysql2`）。
 * - `DATABASE_URL`：连接串；须与驱动协议一致（mysql:// ↔ mysql，postgres:// ↔ postgres）。
 */
export function resolveNodeDatabaseConfig(env: {
	DATABASE_DRIVER?: string;
	DATABASE_URL?: string;
}): Extract<RuntimeDatabaseConfig, { connectionString: string }> {
	const driver = parseDatabaseDriver(env.DATABASE_DRIVER, 'postgres');

	if (driver === 'd1') {
		throw new Error('Node runtime does not support D1 binding. Set DATABASE_DRIVER=postgres or mysql.');
	}

	const connectionString = env.DATABASE_URL?.trim();
	if (!connectionString) {
		throw new Error('Node runtime requires DATABASE_URL.');
	}

	assertDriverUrlConsistency(driver, connectionString);

	return { driver, connectionString };
}
