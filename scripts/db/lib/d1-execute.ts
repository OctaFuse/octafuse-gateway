import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..', '..');

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
	const source = sourceArg === 'local' ? 'local' : 'remote';
	return {
		databaseName: DEFAULT_D1_DATABASE_NAME,
		source,
		persistTo: persistArg?.trim() || DEFAULT_D1_PERSIST_TO,
	};
}

export function runD1ExecuteJson(
	sqlText: string,
	config: D1ExecutionConfig
): Record<string, unknown>[] {
	const args = ['wrangler', 'd1', 'execute', config.databaseName];
	if (config.source === 'remote') {
		args.push('--remote');
	} else {
		args.push('--local', '--persist-to', config.persistTo);
	}
	args.push('--command', sqlText, '--json');

	const result = spawnSync('npx', args, {
		cwd: PROJECT_ROOT,
		encoding: 'utf-8',
		shell: false,
		env: process.env,
	});

	if (result.error) {
		throw result.error;
	}
	if (result.status !== 0) {
		const stderr = result.stderr?.trim();
		if (stderr) {
			throw new Error(stderr);
		}
		throw new Error(`wrangler d1 execute failed with exit code ${result.status ?? 'unknown'}`);
	}

	const raw = (result.stdout ?? '').trim();
	if (!raw) {
		return [];
	}
	const parsed = JSON.parse(raw) as unknown;
	const firstBatch = Array.isArray(parsed) ? parsed[0] : parsed;
	if (
		!firstBatch ||
		typeof firstBatch !== 'object' ||
		!('results' in firstBatch) ||
		!Array.isArray((firstBatch as { results: unknown }).results)
	) {
		return [];
	}
	return (firstBatch as { results: Record<string, unknown>[] }).results;
}

export function getTableColumns(tableName: string, config: D1ExecutionConfig): string[] {
	const rows = runD1ExecuteJson(`PRAGMA table_info("${tableName}")`, config);
	return rows
		.map((row) => row.name)
		.filter((name): name is string => typeof name === 'string' && name.length > 0);
}
