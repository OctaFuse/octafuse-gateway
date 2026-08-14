import {
	createMySqlStorageContext,
	createPostgresStorageContext,
	resolveNodeDatabaseConfig,
	type StorageContext,
} from '@octafuse/core';
import { createAdaptorServer } from '@hono/node-server';
import type { IncomingMessage } from 'node:http';
import { pathToFileURL } from 'node:url';
import { createProxyApp } from '../app';
import {
	createNodeDashScopeRealtimeDispatch,
	createNodeWebSocketServer,
	type NodeWebSocket,
} from './node-realtime';

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
		`  Responses      POST ${base}/v1/responses`,
		`  Images         POST ${base}/v1/images/generations`,
		`  Image edits    POST ${base}/v1/images/edits`,
		`  Anthropic      POST ${base}/v1/messages`,
		`  Gemini         POST ${base}/v1beta/models/{model}:generateContent`,
		`  Web search     POST ${base}/v1/tools/web-search`,
		`  DashScope WS   GET  ${base}/v1/dashscope/realtime`,
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
	const server = createAdaptorServer({ fetch: app.fetch });
	const websocketServer = createNodeWebSocketServer();
	// HTTP upgrade 先由 ws 完成握手，再把已接受的 socket 注入共享 Hono 路由。
	server.on('upgrade', (request, socket, head) => {
		const pathname = new URL(
			request.url ?? '/',
			`http://${request.headers.host ?? '127.0.0.1'}`
		).pathname;
		if (pathname !== '/v1/dashscope/realtime') {
			socket.destroy();
			return;
		}
		websocketServer.handleUpgrade(request, socket, head, (client) => {
			void handleNodeRealtimeUpgrade(app, request, client);
		});
	});
	server.listen(port);
}

async function handleNodeRealtimeUpgrade(
	app: ReturnType<typeof createNodeApp>,
	request: IncomingMessage,
	client: NodeWebSocket
): Promise<void> {
	const protocol = (request.socket as { encrypted?: boolean }).encrypted ? 'https' : 'http';
	const url = `${protocol}://${request.headers.host ?? '127.0.0.1'}${request.url ?? '/'}`;
	const headers = new Headers();
	for (const [key, value] of Object.entries(request.headers)) {
		if (typeof value === 'string') headers.set(key, value);
		else if (Array.isArray(value)) headers.set(key, value.join(', '));
	}
	const fetchRequest = new Request(url, {
		method: 'GET',
		headers,
	});
	try {
		const response = await app.fetch(fetchRequest, {
			NODE_REALTIME_DISPATCH: createNodeDashScopeRealtimeDispatch(client),
		});
		if (response.headers.get('x-octafuse-realtime-upgrade') === '1') return;
		const message = (await response.clone().text()).trim() || `HTTP ${response.status}`;
		if (client.readyState !== 3) client.close(1008, message.slice(0, 123));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (client.readyState !== 3) client.close(1011, message.slice(0, 123));
	}
}

if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
	startNodeServer().catch((err) => {
		console.error(err);
		process.exit(1);
	});
}
