import type { D1Database } from '@cloudflare/workers-types';
import type { GatewayRepositories, StorageContext } from '@octafuse/core';
import type { AdminPrincipal } from '@/lib/admin-principal';
import type { PlaygroundRealtimeNodeDispatch } from '@/lib/services/admin/playground-realtime-service';

/** Admin Hono 应用：Cloudflare 绑定与请求级变量。 */
export type AdminBindings = {
	DB?: D1Database;
	ASSETS?: unknown;
	/** Node / 自托管 Postgres：与 `@octafuse/proxy` 一致，使用 `DATABASE_URL`。 */
	DATABASE_URL?: string;
	/** 与 `DATABASE_URL` 命名对齐；Node 下省略视为 `postgres`（见 `@octafuse/core`）。 */
	DATABASE_DRIVER?: string;
	STORAGE_CONTEXT?: StorageContext;
	ADMIN_PRINCIPAL?: AdminPrincipal;
	/** Node 自定义 HTTP 入口注入：调试台实时 WS 用 `ws` 桥上游。 */
	NODE_PLAYGROUND_REALTIME_DISPATCH?: PlaygroundRealtimeNodeDispatch;
};

export type AdminEnv = {
	Bindings: AdminBindings;
	Variables: {
		repositories: GatewayRepositories;
		principal: AdminPrincipal;
	};
};
