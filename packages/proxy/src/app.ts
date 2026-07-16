import type { D1Database } from '@cloudflare/workers-types';
import type { GatewayRepositories, StorageContext } from '@octafuse/core';
import { Hono } from 'hono';
import type { Context, MiddlewareHandler } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import type { ApiKeyContext } from './middleware/auth';
import { healthRoutes } from './routes/health';
import { chatRoutes } from './routes/v1/chat';
import { geminiRoutes } from './routes/v1/gemini';
import { meRoutes } from './routes/v1/me';
import { messagesRoutes } from './routes/v1/messages';
import { catalogRoutes } from './routes/catalog';
import { modelsRoutes } from './routes/v1/models';
import { webSearchRoutes } from './routes/v1/tools/web-search';
import { proxyAppVersion } from './app-version';

/** Cloudflare Worker bindings：D1 `DB`。Postgres 见 `src/runtime/node.ts`。 */
export type GatewayBindings = {
	DB?: D1Database;
	/** 可选；仅允许 `d1` 或省略。 */
	DATABASE_DRIVER?: string;
};

export type Env = {
	Bindings: GatewayBindings;
	Variables: {
		apiKey?: ApiKeyContext;
		repositories: GatewayRepositories;
	};
};

export type StorageResolver = (context: Context<Env>) => Promise<StorageContext>;

export type ProxyAppOptions = {
	/**
	 * 在所有其它中间件（含 logger / CORS / 存储）之前执行。
	 * Worker 场景下用于尽早校验 D1 绑定：Cloudflare 仅在请求进入 fetch 时注入 `env`，无独立「进程启动」钩子，故最早失败点为首个请求的此处。
	 */
	beforeAll?: MiddlewareHandler<Env>;
};

export function createProxyApp(resolveStorage: StorageResolver, options?: ProxyAppOptions): Hono<Env> {
	const app = new Hono<Env>();

	if (options?.beforeAll) {
		app.use('*', options.beforeAll);
	}

	app.use('*', logger());
	app.use(
		'*',
		cors({
			origin: '*',
			allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
			allowHeaders: ['Content-Type', 'Authorization'],
		}),
	);

	app.use('*', async (c, next) => {
		const storage = await resolveStorage(c);
		c.set('repositories', storage.repositories);
		await next();
	});

	app.route('/health', healthRoutes);
	app.route('/v1/chat/completions', chatRoutes);
	app.route('/v1/messages', messagesRoutes);
	app.route('/v1beta', geminiRoutes);
	app.route('/v1/me', meRoutes);
	app.route('/v1/models', modelsRoutes);
	app.route('/v1/tools/web-search', webSearchRoutes);
	app.route('/catalog', catalogRoutes);

	app.get('/', (c) => c.json({ name: 'octafuse-proxy', version: proxyAppVersion }));

	return app;
}
