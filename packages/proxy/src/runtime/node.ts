import {
	createMySqlStorageContext,
	createPostgresStorageContext,
	resolveNodeDatabaseConfig,
	type StorageContext,
} from '@octafuse/core';
import { serve } from '@hono/node-server';
import { pathToFileURL } from 'node:url';
import { createProxyApp } from '../app';

let nodeStoragePromise: Promise<StorageContext> | null = null;

async function resolveNodeStorage(): Promise<StorageContext> {
	const config = resolveNodeDatabaseConfig(process.env);
	if (nodeStoragePromise === null) {
		const p =
			config.driver === 'mysql'
				? createMySqlStorageContext(config.connectionString)
				: createPostgresStorageContext(config.connectionString);
		nodeStoragePromise = p.catch((err) => {
			nodeStoragePromise = null;
			throw err;
		});
	}
	return nodeStoragePromise;
}

export function createNodeApp() {
	return createProxyApp(async () => resolveNodeStorage());
}

function redactDatabaseConnectionUrl(connectionString: string): string {
	try {
		const u = new URL(connectionString);
		if (u.password) {
			u.password = '***';
		}
		return u.toString();
	} catch {
		return '（连接串无法解析为 URL，已省略）';
	}
}

function printNodeStartupBanner(
	port: number,
	dbKind: 'postgres' | 'mysql',
	redactedUrl: string
): void {
	const base = `http://127.0.0.1:${port}`;
	const dbDriver = process.env.DATABASE_DRIVER?.trim() || 'postgres（默认）';
	const nodeEnv = process.env.NODE_ENV?.trim() ?? '（未设置）';
	const runtimeLabel = dbKind === 'mysql' ? 'Node（MySQL）' : 'Node（Postgres）';
	const dbLineLabel = dbKind === 'mysql' ? 'MySQL' : 'Postgres';
	const lines = [
		'',
		'────────────────────────────────────────────────────────────',
		`  octafuse · gateway-proxy · ${runtimeLabel}`,
		'────────────────────────────────────────────────────────────',
		`  服务地址       ${base}`,
		`  健康检查       GET  ${base}/health`,
		`  Chat           POST ${base}/v1/chat/completions`,
		`  Anthropic      POST ${base}/v1/messages`,
		`  Gemini         POST ${base}/v1beta/models/{model}:generateContent`,
		`  Web search     POST ${base}/v1/tools/web-search`,
		'',
		`  数据库         ${dbLineLabel}  ${redactedUrl}`,
		`  DATABASE_DRIVER ${dbDriver}`,
		`  NODE_ENV       ${nodeEnv}`,
		`  Admin API/UI   独立部署（本进程不含 /admin）`,
		'────────────────────────────────────────────────────────────',
		'',
	];
	console.log(lines.join('\n'));
}

export async function startNodeServer(port = Number(process.env.PORT ?? 8787)): Promise<void> {
	let redactedUrl = '';
	let dbKind: 'postgres' | 'mysql' = 'postgres';
	try {
		const cfg = resolveNodeDatabaseConfig(process.env);
		dbKind = cfg.driver === 'mysql' ? 'mysql' : 'postgres';
		redactedUrl = redactDatabaseConnectionUrl(cfg.connectionString);
	} catch (err) {
		console.error(
			'[Gateway Proxy Node] 启动前校验失败（请检查 DATABASE_URL、DATABASE_DRIVER=postgres|mysql 等）：'
		);
		console.error(err);
		process.exit(1);
	}

	printNodeStartupBanner(port, dbKind, redactedUrl);

	process.on('unhandledRejection', (reason) => {
		console.error('[Gateway Proxy] unhandledRejection', reason);
	});
	process.on('uncaughtException', (err) => {
		console.error('[Gateway Proxy] uncaughtException', err);
	});

	const app = createNodeApp();
	serve({
		fetch: app.fetch,
		port,
	});
}

if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
	startNodeServer().catch((err) => {
		console.error(err);
		process.exit(1);
	});
}
