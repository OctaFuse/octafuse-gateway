/**
 * 导出远程 D1 表结构（无数据）到 data/remote/
 * 产出：`schema-remote-<时间戳>.sql`（仅 DDL，不含表数据）。
 * 用法: npx tsx scripts/db/d1-remote-export/export-remote-schema.ts
 *      npm run db:export:remote:schema
 */
import { join } from "node:path";
import {
	DEFAULT_DATABASE_NAME,
	ensureRemoteDir,
	exportTimestamp,
	runWranglerExport,
	REMOTE_DATA_DIR,
} from "../lib/remote-export";

const ts = exportTimestamp();
const file = join(REMOTE_DATA_DIR, `schema-remote-${ts}.sql`);

ensureRemoteDir();
console.log(`Exporting remote schema → ${file} (database: ${DEFAULT_DATABASE_NAME})`);
runWranglerExport(["--output", file, "--no-data"]);
