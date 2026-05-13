import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RowDataPacket } from 'mysql2';
import mysql from 'mysql2/promise';

const MIGRATIONS_DIR = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'../../migrations-mysql'
);

function logMysqlTarget(connectionString: string): void {
	try {
		const normalized = connectionString.replace(/^mysql:\/\//i, 'mysql://');
		const u = new URL(normalized);
		const pathDb = u.pathname.replace(/^\//, '').split('?')[0];
		const database = pathDb ? decodeURIComponent(pathDb) : '(路径为空)';
		console.log(
			'[migrate-mysql] 连接目标: host=%s port=%s user=%s database=%s',
			u.hostname,
			u.port || '3306',
			decodeURIComponent(u.username) || '(empty)',
			database
		);
	} catch {
		console.error('[migrate-mysql] DATABASE_URL 格式无法解析，请使用 mysql:// 连接串');
	}
}

export async function migrateMysql(): Promise<void> {
	const connectionString = process.env.DATABASE_URL;
	if (!connectionString) {
		throw new Error('DATABASE_URL is required');
	}

	logMysqlTarget(connectionString);
	console.log('[migrate-mysql] 迁移目录: %s', MIGRATIONS_DIR);

	const conn = await mysql.createConnection({
		uri: connectionString,
		multipleStatements: true,
	});

	const MIGRATION_LOCK_NAME = 'octafuse_schema_migrations';
	let applied = 0;
	let skipped = 0;
	try {
		const t0 = performance.now();
		await conn.query(`
			CREATE TABLE IF NOT EXISTS schema_migrations (
				version VARCHAR(255) NOT NULL PRIMARY KEY,
				applied_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
			) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
		`);
		console.log(
			'[migrate-mysql] 已确保表 schema_migrations 存在（%d ms）',
			Math.round(performance.now() - t0)
		);

		const entries = await readdir(MIGRATIONS_DIR, { withFileTypes: true });
		const migrationFiles = entries
			.filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
			.map((entry) => entry.name)
			.sort((a, b) => a.localeCompare(b));

		if (migrationFiles.length === 0) {
			console.log('[migrate-mysql] 未发现 packages/core/migrations-mysql/*.sql，无需执行');
			return;
		}

		console.log('[migrate-mysql] 共 %d 个迁移文件（按文件名排序）', migrationFiles.length);

		const [lockRows] = await conn.query<RowDataPacket[]>(
			'SELECT GET_LOCK(?, 30) AS locked',
			[MIGRATION_LOCK_NAME]
		);
		const locked = Array.isArray(lockRows) && Number(lockRows[0]?.locked) === 1;
		if (!locked) {
			throw new Error('[migrate-mysql] 获取迁移锁失败（GET_LOCK 超时或返回 NULL）');
		}
		console.log('[migrate-mysql] 已获取迁移锁（GET_LOCK=%s）', MIGRATION_LOCK_NAME);

		const [appliedRows] = await conn.query<RowDataPacket[]>(
			'SELECT version FROM schema_migrations'
		);
		const appliedVersions = new Set(
			Array.isArray(appliedRows)
				? appliedRows.map((row) => String(row.version))
				: []
		);

		for (const fileName of migrationFiles) {
			if (appliedVersions.has(fileName)) {
				skipped += 1;
				console.log('[migrate-mysql] 跳过（已记录）: %s', fileName);
				continue;
			}

			const sqlText = await readFile(path.join(MIGRATIONS_DIR, fileName), 'utf8');
			const bytes = Buffer.byteLength(sqlText, 'utf8');
			const sizeLabel = bytes < 1024 ? `${bytes} B` : `约 ${Math.round(bytes / 1024)} KB`;
			console.log('[migrate-mysql] 执行: %s（%s）…', fileName, sizeLabel);

			const runStart = performance.now();
			try {
				await conn.query(sqlText);
			} catch (err) {
				console.error('[migrate-mysql] ✗ 执行失败: %s', fileName);
				console.error(
					'[migrate-mysql] 提示：MySQL DDL 多为隐式提交。' +
					'如需回滚请手动 DROP TABLE / 删除相关对象后重新运行迁移。'
				);
				throw err;
			}

			await conn.query('INSERT IGNORE INTO schema_migrations (version) VALUES (?)', [fileName]);
			appliedVersions.add(fileName);
			applied += 1;
			console.log(
				`[migrate-mysql] ✓ 完成: ${fileName}（${Math.round(performance.now() - runStart)} ms）`
			);
		}

		console.log(
			'[migrate-mysql] 汇总: 新执行 %d 个, 跳过 %d 个, 扫描 %d 个文件',
			applied,
			skipped,
			migrationFiles.length
		);
		console.log('[migrate-mysql] 全部完成。');
	} finally {
		try {
			await conn.query('SELECT RELEASE_LOCK(?)', [MIGRATION_LOCK_NAME]);
		} catch (error) {
			console.warn('[migrate-mysql] 释放迁移锁失败: %s', String(error));
		}
		await conn.end();
	}
}
