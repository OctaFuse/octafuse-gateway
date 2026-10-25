import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..', '..');
/** `npm run gen:wrangler` 生成；本地模式靠它解析数据库绑定名。 */
const D1_WRANGLER_CONFIG = join(PROJECT_ROOT, 'packages', 'core', 'wrangler.d1.jsonc');

export interface D1ExecutionConfig {
	databaseName: string;
	source: 'remote' | 'local';
	persistTo: string;
}

export const DEFAULT_D1_DATABASE_NAME = process.env.D1_DATABASE_NAME?.trim() || 'octafuse-gateway';
export const DEFAULT_D1_PERSIST_TO = process.env.D1_PERSIST_TO ?? '../.wrangler/state';

export function parseD1ExecutionConfig(args: string[]): D1ExecutionConfig {
	const sourceArg = args.find((arg) => arg.startsWith('--d1-source='))?.split('=')[1];
	const persistArg = args.find((arg) => arg.startsWith('--d1-persist-to='))?.split('=')[1];
	// 写错值时绝不能静默回退到 remote（会误读线上库）。
	if (sourceArg !== undefined && sourceArg !== 'local' && sourceArg !== 'remote') {
		throw new Error(`Invalid --d1-source "${sourceArg}", expected "local" or "remote"`);
	}
	const source = sourceArg === 'local' ? 'local' : 'remote';
	return {
		databaseName: DEFAULT_D1_DATABASE_NAME,
		source,
		persistTo: persistArg?.trim() || DEFAULT_D1_PERSIST_TO,
	};
}

function extractWranglerError(stdout: string | null | undefined): string {
	const raw = (stdout ?? '').trim();
	if (!raw) {
		return '';
	}
	try {
		const parsed = JSON.parse(raw) as { error?: { text?: string } };
		return parsed?.error?.text?.trim() || raw.slice(0, 500);
	} catch {
		return raw.slice(0, 500);
	}
}

function spawnWranglerD1(sqlText: string, config: D1ExecutionConfig): string {
	const args = ['wrangler', 'd1', 'execute', config.databaseName];
	if (config.source === 'remote') {
		args.push('--remote');
	} else {
		if (!existsSync(D1_WRANGLER_CONFIG)) {
			throw new Error(
				'Local D1 needs packages/core/wrangler.d1.jsonc to resolve the database binding. Run `npm run gen:wrangler` first.'
			);
		}
		args.push('--local', '--persist-to', config.persistTo, '--config', D1_WRANGLER_CONFIG);
	}
	args.push('--command', sqlText, '--json');

	const result = spawnSync('npx', args, {
		cwd: PROJECT_ROOT,
		encoding: 'utf-8',
		shell: false,
		env: process.env,
		// spawnSync 默认只收 1MB stdout；请求日志一批 JSON 很容易超限并以 ENOBUFS 失败。
		maxBuffer: 512 * 1024 * 1024,
	});

	if (result.error) {
		throw result.error;
	}
	if (result.status !== 0) {
		// wrangler 常把 --json 错误写在 stdout（{"error":{"text":...}}）而 stderr 为空。
		const detail = extractWranglerError(result.stdout) || result.stderr?.trim();
		throw new Error(detail || `wrangler d1 execute failed with exit code ${result.status ?? 'unknown'}`);
	}
	return (result.stdout ?? '').trim();
}

type D1Rows = Record<string, unknown>[];

function parseBatches(raw: string): D1Rows[] {
	if (!raw) {
		return [];
	}
	const parsed = JSON.parse(raw) as unknown;
	if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && 'error' in parsed) {
		throw new Error(extractWranglerError(raw));
	}
	const batches = Array.isArray(parsed) ? parsed : [parsed];
	return batches.map((batch) => {
		const results = (batch as { results?: unknown } | null)?.results;
		return Array.isArray(results) ? (results as D1Rows) : [];
	});
}

export function runD1ExecuteJson(sqlText: string, config: D1ExecutionConfig): D1Rows {
	return parseBatches(spawnWranglerD1(sqlText, config))[0] ?? [];
}

/**
 * 一次 wrangler 调用执行多条语句，结果按语句顺序对齐。
 * 每次调用的固定开销（启动 wrangler、建立连接）远大于小表的查询本身，批量后调用次数从“每表几次”降到常数次。
 * wrangler 按分号切分语句，所以每条语句内部不能出现 `;`（我们生成的语句里没有）。
 */
export function runD1ExecuteMany(statements: readonly string[], config: D1ExecutionConfig): D1Rows[] {
	if (statements.length === 0) {
		return [];
	}
	for (const statement of statements) {
		if (statement.includes(';')) {
			throw new Error(`Batched D1 statement must not contain ';': ${statement.slice(0, 80)}`);
		}
	}
	const batches = parseBatches(spawnWranglerD1(statements.join(';\n'), config));
	if (batches.length !== statements.length) {
		throw new Error(`D1 returned ${batches.length} result sets for ${statements.length} statements`);
	}
	return batches;
}

export function getTableColumns(tableName: string, config: D1ExecutionConfig): string[] {
	const rows = runD1ExecuteJson(`PRAGMA table_info("${tableName}")`, config);
	return rows
		.map((row) => row.name)
		.filter((name): name is string => typeof name === 'string' && name.length > 0);
}

/** 一次调用取回所有表的列名。 */
export function getTablesColumns(tableNames: readonly string[], config: D1ExecutionConfig): Map<string, string[]> {
	const batches = runD1ExecuteMany(
		tableNames.map((table) => `SELECT name FROM pragma_table_info('${table.replace(/'/g, "''")}')`),
		config
	);
	return new Map(
		tableNames.map((table, index) => [
			table,
			batches[index]
				.map((row) => row.name)
				.filter((name): name is string => typeof name === 'string' && name.length > 0),
		])
	);
}
