/**
 * 列出 DATABASE_URL 所指服务器上的数据库名（先连到 `postgres` 系统库再查询）。
 * 无需本机安装 psql。用法：npm run db:list:pg
 */
import postgres from 'postgres';
function connectionStringWithDatabase(connectionString: string, database: string): string {
	const normalized = connectionString.replace(/^postgresql:\/\//i, 'postgres://');
	const u = new URL(normalized);
	u.pathname = '/' + database;
	return u.toString();
}

async function main(): Promise<void> {
	const raw = process.env.DATABASE_URL;
	if (!raw) {
		throw new Error('DATABASE_URL is required');
	}

	const tryDbs = ['postgres', 'template1'];
	let lastErr: unknown;
	for (const db of tryDbs) {
		const sql = postgres(connectionStringWithDatabase(raw, db), { max: 1 });
		try {
			const rows = await sql<{ datname: string }[]>`
				SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname
			`;
			console.log(`[db:list:pg] （经 ${db} 连接）服务器上的数据库（datname）：`);
			for (const r of rows) {
				console.log(' ', r.datname);
			}
			return;
		} catch (err) {
			lastErr = err;
		} finally {
			await sql.end();
		}
	}
	throw lastErr;
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
