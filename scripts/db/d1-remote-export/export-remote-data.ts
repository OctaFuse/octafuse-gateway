/**
 * 导出远程 D1 数据（无 CREATE TABLE）到 data/remote/
 *
 * 用法:
 *   npx tsx scripts/db/d1-remote-export/export-remote-data.ts all
 *   npx tsx scripts/db/d1-remote-export/export-remote-data.ts api_keys models
 *   npm run db:export:remote:data -- all
 *   npm run db:export:remote:data -- providers models model_routes system_config
 *   npm run db:export:remote:data -- api_keys providers
 *
 * all：按表逐个导出，每表一个文件（排除 sqlite_*、_cf_KV）。
 */
import { join } from "node:path";
import {
	DEFAULT_DATABASE_NAME,
	ensureRemoteDir,
	exportTimestamp,
	listRemoteDataTableNames,
	runWranglerExport,
	REMOTE_DATA_DIR,
} from "../lib/remote-export";

/** 打印 CLI 用法与环境说明。 */
function printUsage(): void {
	console.log(`Usage:
  npx tsx scripts/db/d1-remote-export/export-remote-data.ts all
  npx tsx scripts/db/d1-remote-export/export-remote-data.ts <table> [<table> ...]

  all — 导出全部业务表，每表一个 SQL 文件（同时间戳前缀）

Environment:
  D1_DATABASE_NAME   Override database name (default: ${DEFAULT_DATABASE_NAME})

Output directory: ${REMOTE_DATA_DIR}
Files include timestamp (local time, second precision).`);
}

const argv = process.argv.slice(2).filter((a) => a !== "--");

if (argv.length === 0 || argv[0] === "-h" || argv[0] === "--help") {
	printUsage();
	process.exit(argv.length === 0 ? 1 : 0);
}

ensureRemoteDir();
const ts = exportTimestamp();
const mode = argv[0];

/** `all`：查询远程全部可导出业务表后逐表写文件（与显式表名互斥）。 */
if (mode === "all") {
	if (argv.length > 1) {
		console.error("With 'all', do not pass extra table names.");
		process.exit(1);
	}
	const tables = listRemoteDataTableNames();
	if (tables.length === 0) {
		console.error("No exportable tables found on remote database.");
		process.exit(1);
	}
	console.log(
		`Exporting ${tables.length} table(s), one file each (database: ${DEFAULT_DATABASE_NAME})`
	);
	for (const table of tables) {
		const safe = table.replace(/[^a-zA-Z0-9_-]/g, "_");
		const file = join(REMOTE_DATA_DIR, `data-remote-table-${safe}-${ts}.sql`);
		console.log(`  → ${file}`);
		runWranglerExport(["--table", table, "--output", file, "--no-schema"]);
	}
} else {
	// 显式表名：每表一个 --no-schema 数据文件
	const tables = argv;
	for (const table of tables) {
		const safe = table.replace(/[^a-zA-Z0-9_-]/g, "_");
		const file = join(REMOTE_DATA_DIR, `data-remote-table-${safe}-${ts}.sql`);
		console.log(
			`Exporting remote data → ${file} (table: ${table}, database: ${DEFAULT_DATABASE_NAME})`
		);
		runWranglerExport(["--table", table, "--output", file, "--no-schema"]);
	}
}
