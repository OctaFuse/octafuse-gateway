import { migratePostgres } from './postgres.js';

function printHelp(): void {
	console.log('usage: octafuse-migrate --driver postgres|pg|postgresql|mysql|mysql2');
}

function normalizeDriver(raw: string): 'postgres' | 'mysql' | null {
	const d = raw.trim().toLowerCase();
	if (d === 'postgres' || d === 'postgresql' || d === 'pg') {
		return 'postgres';
	}
	if (d === 'mysql' || d === 'mysql2') {
		return 'mysql';
	}
	return null;
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	let driver = '';
	for (let i = 0; i < args.length; i++) {
		const a = args[i];
		if (a === '--help' || a === '-h') {
			printHelp();
			return;
		}
		if (a === '--driver' && args[i + 1]) {
			driver = args[i + 1];
			i += 1;
		}
	}

	const kind = normalizeDriver(driver);
	if (!kind) {
		console.error('octafuse-migrate: 需要 --driver postgres|pg|mysql|mysql2');
		printHelp();
		process.exitCode = 1;
		return;
	}

	if (kind === 'postgres') {
		await migratePostgres();
	} else {
		const { migrateMysql } = await import('./mysql.js');
		await migrateMysql();
	}
}

main().catch((error) => {
	if (
		error &&
		typeof error === 'object' &&
		'code' in error &&
		(error as { code?: string }).code === '3D000'
	) {
		console.error(
			'[migrate-postgres] 提示: 当前连接串里的 database 在该 PostgreSQL 实例上不存在，或你连到了另一台主机/端口（例如误用本机 127.0.0.1 而非面板服务器 IP）。请核对 URL 最后一段路径与面板「数据库名」完全一致。'
		);
	}
	console.error(error);
	process.exitCode = 1;
});
