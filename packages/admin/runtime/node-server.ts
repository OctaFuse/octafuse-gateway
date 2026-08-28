/**
 * Admin Node HTTP 入口：普通请求交给 Next，调试台实时 WS 在 Upgrade 时旁路。
 * `next dev` 的 HMR 也走 Upgrade，非 playground 路径必须转交 Next。
 */
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import next, { type NextConfig } from 'next';
import { PLAYGROUND_REALTIME_PATH } from '../lib/playground-realtime-path';
import {
	handleAdminNodeRealtimeUpgrade,
	incomingMessageToFetchRequest,
} from '../lib/admin-node-realtime';
import {
	createPlaygroundNodeWebSocketServer,
	type NodeWebSocket,
} from '../lib/playground-node-realtime';

type NextUpgradeHandler = (
	req: IncomingMessage,
	socket: Duplex,
	head: Buffer,
) => void | Promise<void>;

type NextServerWithUpgrade = ReturnType<typeof next> & {
	prepare: () => Promise<void>;
	getRequestHandler: () => (
		req: IncomingMessage,
		res: import('node:http').ServerResponse,
	) => unknown;
	getUpgradeHandler?: () => NextUpgradeHandler;
	/**
	 * Next 自定义 server 在第一次 HTTP 请求时会给同一台 http.Server 再挂一个 upgrade 监听，
	 * 并对已匹配的 App Router 路径 `socket.end()`。调试台实时 WS 必须抢先独占 upgrade，
	 * 并把这个标记设为 true，避免 101 之后被 Next 拆成 1006。
	 */
	didWebSocketSetup?: boolean;
	upgradeHandler?: NextUpgradeHandler;
};

function resolveAdminDir(): string {
	const here = dirname(fileURLToPath(import.meta.url));
	return basename(here) === 'runtime' ? join(here, '..') : here;
}

/**
 * Next standalone 运行层没有 `next.config.mjs`，且裁掉了 `next/dist/compiled/webpack`。
 * 必须复用构建期序列化配置（等价官方 `standalone/.../server.js`）。
 *
 * 设置 `__NEXT_PRIVATE_STANDALONE_CONFIG` 后 Next 会跳过 `loadEnvConfig`
 *（不再读 next.config / `.env`）；容器 / compose 注入的环境变量不受影响。
 */
function loadStandaloneConfig(dir: string): NextConfig | null {
	const file = join(dir, '.next/required-server-files.json');
	if (!existsSync(file)) {
		return null;
	}
	const parsed = JSON.parse(readFileSync(file, 'utf8')) as { config?: NextConfig };
	return parsed.config ?? null;
}

function applyStandaloneConfig(dir: string): NextConfig | undefined {
	const config = loadStandaloneConfig(dir);
	if (!config) {
		throw new Error(
			`[octafuse-admin] missing ${join(dir, '.next/required-server-files.json')}; production must start from Next standalone output`,
		);
	}
	process.env.__NEXT_PRIVATE_STANDALONE_CONFIG ??= JSON.stringify(config);
	return config;
}

async function handlePlaygroundUpgrade(request: IncomingMessage, client: NodeWebSocket): Promise<void> {
	try {
		const response = await handleAdminNodeRealtimeUpgrade(
			incomingMessageToFetchRequest(request),
			client,
		);
		if (response.headers.get('x-octafuse-realtime-upgrade') === '1') {
			client.resume();
			return;
		}
		const message = (await response.clone().text()).trim() || `HTTP ${response.status}`;
		console.warn(`[octafuse-admin] playground realtime upgrade rejected: ${message.slice(0, 300)}`);
		if (client.readyState !== 3) client.close(1008, message.slice(0, 123));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error('[octafuse-admin] playground realtime upgrade failed', error);
		if (client.readyState !== 3) client.close(1011, message.slice(0, 123));
	} finally {
		try {
			client.resume();
		} catch {
			// ignore
		}
	}
}

export async function startAdminNodeServer(
	port = Number(process.env.PORT ?? 8789),
	hostname = process.env.HOSTNAME?.trim() || '0.0.0.0',
): Promise<void> {
	const dev = process.env.NODE_ENV !== 'production';
	const dir = resolveAdminDir();
	const conf = dev ? undefined : applyStandaloneConfig(dir);
	const app = next({
		dev,
		hostname,
		port,
		dir,
		...(conf ? { conf } : {}),
	}) as NextServerWithUpgrade;
	await app.prepare();
	app.didWebSocketSetup = true;
	const handle = app.getRequestHandler();
	const nextUpgrade =
		typeof app.upgradeHandler === 'function'
			? app.upgradeHandler
			: typeof app.getUpgradeHandler === 'function'
				? app.getUpgradeHandler()
				: null;
	const websocketServer = createPlaygroundNodeWebSocketServer();
	const server = createServer((req, res) => {
		void handle(req, res);
	});

	server.on('upgrade', (request, socket, head) => {
		const pathname = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`).pathname;
		if (pathname === PLAYGROUND_REALTIME_PATH) {
			websocketServer.handleUpgrade(request, socket, head, (client) => {
				// 同一拍 pause 会卡住 101 刷出，浏览器会一直停在 CONNECTING，调试台只剩「停止」和空响应。
				setImmediate(() => {
					if (client.readyState === 3) return;
					client.pause();
					void handlePlaygroundUpgrade(request, client);
				});
			});
			return;
		}
		if (nextUpgrade) {
			void nextUpgrade(request, socket, head);
			return;
		}
		socket.destroy();
	});

	await new Promise<void>((resolve) => {
		server.listen(port, hostname, () => resolve());
	});
	const displayHost = hostname === '0.0.0.0' ? '127.0.0.1' : hostname;
	console.log(`[octafuse-admin] Node listening on http://${displayHost}:${port} (realtime WS enabled)`);
}

function isDirectNodeServerEntry(): boolean {
	const argvPath = process.argv[1];
	if (argvPath) {
		try {
			if (import.meta.url === pathToFileURL(argvPath).href) return true;
		} catch {
			// ignore invalid argv paths from loaders
		}
		if (/(?:^|[/\\])node-server\.(ts|mjs|js)$/.test(argvPath)) return true;
	}
	return process.argv.some((arg) => /(?:^|[/\\])node-server\.(ts|mjs|js)$/.test(arg));
}

if (isDirectNodeServerEntry()) {
	startAdminNodeServer().catch((err) => {
		console.error(err);
		process.exit(1);
	});
}
