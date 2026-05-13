import { createD1StorageContext, resolveWorkerDatabaseConfig, type StorageContext } from '@octafuse/core';
import type { Context } from 'hono';
import { createProxyApp, type Env } from '../app';

async function resolveWorkersStorage(context: Context<Env>): Promise<StorageContext> {
	const config = resolveWorkerDatabaseConfig(context.env);
	return createD1StorageContext(config.db);
}

export const workerApp = createProxyApp(resolveWorkersStorage, {
	beforeAll: (c, next) => {
		resolveWorkerDatabaseConfig(c.env);
		return next();
	},
});
