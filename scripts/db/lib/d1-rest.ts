import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const API_BASE = 'https://api.cloudflare.com/client/v4';
const MAX_ATTEMPTS = 10;

export type D1Row = Record<string, unknown>;
export type D1Reader = (sql: string) => Promise<D1Row[]>;

/** D1 `/raw` 返回列名数组 + 行数组（行里不重复列名），这里还原成对象。 */
export function rawToObjects(columns: readonly string[], rows: readonly (readonly unknown[])[]): D1Row[] {
	return rows.map((row) => {
		const object: D1Row = {};
		for (let index = 0; index < columns.length; index += 1) {
			object[columns[index]] = row[index];
		}
		return object;
	});
}

/** 值得重试的失败：限流、服务端错误、D1 排队过载 / 超时。 */
export function isRetryableD1Failure(status: number, message: string): boolean {
	return status === 429 || status >= 500 || /overloaded|timed? ?out|temporar|try again|network connection lost/i.test(message);
}

function runWrangler(args: string[]): string {
	const result = spawnSync('npx', ['wrangler', ...args], {
		cwd: PROJECT_ROOT,
		encoding: 'utf-8',
		shell: false,
		env: process.env,
		maxBuffer: 16 * 1024 * 1024,
	});
	if (result.error) {
		throw result.error;
	}
	if (result.status !== 0) {
		throw new Error(`wrangler ${args.join(' ')} failed: ${(result.stderr || result.stdout || '').trim().slice(0, 300)}`);
	}
	return (result.stdout ?? '').trim();
}

function parseJsonOutput(text: string): Record<string, unknown> {
	const start = text.indexOf('{');
	if (start < 0) {
		throw new Error(`Unexpected wrangler output: ${text.slice(0, 200)}`);
	}
	return JSON.parse(text.slice(start)) as Record<string, unknown>;
}

function resolveAccountId(): string {
	const fromEnv = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
	if (fromEnv) {
		return fromEnv;
	}
	const accounts = (parseJsonOutput(runWrangler(['whoami', '--json'])).accounts ?? []) as { id?: string }[];
	if (accounts.length !== 1 || !accounts[0].id) {
		throw new Error(`wrangler 登录了 ${accounts.length} 个账号，无法确定账号；请设置 CLOUDFLARE_ACCOUNT_ID`);
	}
	return accounts[0].id;
}

function resolveDatabaseId(databaseName: string): string {
	const info = parseJsonOutput(runWrangler(['d1', 'info', databaseName, '--json']));
	const id = String(info.uuid ?? info.database_id ?? info.id ?? '');
	if (!id) {
		throw new Error(`无法解析 D1 数据库 ID：${databaseName}`);
	}
	return id;
}

function readWranglerToken(): string {
	const lines = runWrangler(['auth', 'token'])
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean);
	const token = lines[lines.length - 1] ?? '';
	if (token.length < 20 || /\s/.test(token)) {
		throw new Error('无法从 `wrangler auth token` 取得令牌；请先 wrangler login，或设置 CLOUDFLARE_API_TOKEN');
	}
	return token;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 直连 Cloudflare D1 REST `/raw` 查询接口。
 * 相比每批启动一次 `wrangler d1 execute`：省掉约 3 秒的进程启动，行数据不重复列名，且 HTTP 响应走 gzip。
 * D1 单库是单线程的，并发查询只会排队，所以调用方应当串行读取（用预取与写入重叠即可）。
 */
export function createRemoteD1Reader(databaseName: string): D1Reader {
	const accountId = resolveAccountId();
	const databaseId = resolveDatabaseId(databaseName);
	const envToken = process.env.CLOUDFLARE_API_TOKEN?.trim();
	let token = envToken || readWranglerToken();
	const url = `${API_BASE}/accounts/${accountId}/d1/database/${databaseId}/raw`;

	return async (sql: string): Promise<D1Row[]> => {
		for (let attempt = 1; ; attempt += 1) {
			let status = 0;
			let message = '';
			try {
				const response = await fetch(url, {
					method: 'POST',
					headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
					body: JSON.stringify({ sql }),
				});
				status = response.status;
				const text = await response.text();
				if ((status === 401 || status === 403) && !envToken && attempt < MAX_ATTEMPTS) {
					// wrangler 的 OAuth 令牌会过期；重新取一次（wrangler 会自动刷新）。
					token = readWranglerToken();
					continue;
				}
				let body: {
					success?: boolean;
					errors?: { message?: string }[];
					result?: { success?: boolean; error?: string; results?: { columns?: string[]; rows?: unknown[][] } }[];
				} = {};
				try {
					body = JSON.parse(text);
				} catch {
					message = text.slice(0, 200);
				}
				const result = body.result?.[0];
				if (response.ok && body.success && result?.results?.columns && result.results.rows) {
					return rawToObjects(result.results.columns, result.results.rows);
				}
				message =
					body.errors?.map((error) => error.message).join('; ') || result?.error || message || `HTTP ${status}`;
			} catch (error) {
				message = error instanceof Error ? error.message : String(error);
				status = status || 599;
			}
			if (attempt >= MAX_ATTEMPTS || !isRetryableD1Failure(status, message)) {
				throw new Error(`D1 REST query failed (HTTP ${status}): ${message}`);
			}
			const delay = Math.min(60_000, 2000 * 2 ** (attempt - 1));
			console.warn(`[D1] ${message}（HTTP ${status}），${delay / 1000}s 后重试 ${attempt}/${MAX_ATTEMPTS - 1}`);
			await sleep(delay);
		}
	};
}
