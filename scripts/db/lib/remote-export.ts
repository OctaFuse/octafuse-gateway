/**
 * 远程 D1 导出/查询共用工具：工程根路径、`data/remote` 目录、`wrangler d1 export|execute` 封装。
 * 供 `export-remote-schema.ts`、`export-remote-data.ts` 复用；需在仓库根目录执行且已登录 Cloudflare。
 */
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** 仓库根目录（octafuse/） */
export const PROJECT_ROOT = join(__dirname, "..", "..", "..");

/** 与根目录 `db:migrate` / `db:query:remote` 共用 */
export const D1_WRANGLER_CONFIG = "./packages/core/wrangler.d1.jsonc";

/** 远程导出目录 */
export const REMOTE_DATA_DIR = join(PROJECT_ROOT, "data", "remote");

/** 与 wrangler.jsonc 中 database_name 一致 */
export const DEFAULT_DATABASE_NAME =
	process.env.D1_DATABASE_NAME?.trim() || "octafuse-gateway";

/**
 * 本地执行时间，精确到秒，文件名安全（无冒号）
 * 例：2026-03-29T13-05-09
 */
export function exportTimestamp(): string {
	const d = new Date();
	const p = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

/** 确保 `data/remote` 存在（幂等）。 */
export function ensureRemoteDir(): void {
	mkdirSync(REMOTE_DATA_DIR, { recursive: true });
}

/**
 * 在仓库根目录执行 `npx wrangler d1 export <db> --remote ...`；失败时继承 wrangler 退出码。
 * @param args 追加在 `export` 子命令后的参数（如 `--output`、`--table`）
 */
export function runWranglerExport(
	args: string[],
	databaseName: string = DEFAULT_DATABASE_NAME
): void {
	const fullArgs = [
		"wrangler",
		"d1",
		"export",
		databaseName,
		"--config",
		D1_WRANGLER_CONFIG,
		"--remote",
		...args,
	];
	const result = spawnSync("npx", fullArgs, {
		cwd: PROJECT_ROOT,
		stdio: "inherit",
		shell: true,
		env: process.env,
	});
	if (result.error) {
		throw result.error;
	}
	if (result.status !== 0 && result.status != null) {
		process.exit(result.status);
	}
}

/**
 * 远程执行 SQL 并解析 `wrangler d1 execute --json` 的首批 `results` 行数组。
 * 使用 `shell: false`，避免 SQL 中单引号被 shell 截断。
 */
export function runWranglerExecuteRemoteJson(
	sql: string,
	databaseName: string = DEFAULT_DATABASE_NAME
): Record<string, unknown>[] {
	const result = spawnSync(
		"npx",
		[
			"wrangler",
			"d1",
			"execute",
			databaseName,
			"--config",
			D1_WRANGLER_CONFIG,
			"--remote",
			"--command",
			sql,
			"--json",
		],
		{
			cwd: PROJECT_ROOT,
			encoding: "utf-8",
			// 必须为 false：shell: true 时整段经 sh 解析，SQL 里 type='table' 的单引号会截断参数，
			// 导致 FROM、sqlite_schema 等被当成 wrangler 的未知参数。
			shell: false,
			env: process.env,
		}
	);
	if (result.error) {
		throw result.error;
	}
	if (result.status !== 0 && result.status != null) {
		if (result.stderr) {
			console.error(result.stderr);
		}
		process.exit(result.status);
	}
	const raw = (result.stdout ?? "").trim();
	if (!raw) {
		return [];
	}
	const data = JSON.parse(raw) as unknown;
	const batch = Array.isArray(data) ? data[0] : data;
	if (
		!batch ||
		typeof batch !== "object" ||
		!("results" in batch) ||
		!Array.isArray((batch as { results: unknown }).results)
	) {
		return [];
	}
	return (batch as { results: Record<string, unknown>[] }).results;
}

const INTERNAL_TABLE_PREFIXES = ["sqlite_"];

/** 可导出数据的业务表（排除 D1 / SQLite 内部表） */
export function filterExportableTableNames(names: string[]): string[] {
	return names.filter((name) => {
		if (name === "_cf_KV") {
			return false;
		}
		return !INTERNAL_TABLE_PREFIXES.some((p) => name.startsWith(p));
	});
}

/** 远程库中可导出的表名列表（有序） */
export function listRemoteDataTableNames(
	databaseName: string = DEFAULT_DATABASE_NAME
): string[] {
	const rows = runWranglerExecuteRemoteJson(
		"SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name",
		databaseName
	);
	const names = rows
		.map((r) => r.name)
		.filter((v): v is string => typeof v === "string" && v.length > 0);
	return filterExportableTableNames(names);
}
