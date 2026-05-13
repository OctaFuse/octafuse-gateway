import type { D1Database } from '@cloudflare/workers-types';
import type { StorageContext } from '@octafuse/core/storage/context';
import { initD1Drizzle } from '@octafuse/core/storage/drizzle/client-d1';
import { createD1Repositories } from '@octafuse/core/storage/repositories-d1';
import {
	resolveNodeDatabaseConfig,
	resolveWorkerDatabaseConfig,
} from '@octafuse/core/storage/runtime-database-config';
import type { AdminBindings } from '@/lib/admin-env';

let nodeStoragePromise: Promise<StorageContext> | null = null;
type RuntimeMode = 'auto' | 'cloudflare' | 'node';

/** Node：`DATABASE_URL` 与 `DATABASE_DRIVER` 与 bindings 合并（与 proxy 一致）。 */
function getNodeDatabaseEnv(bindings?: AdminBindings): {
	DATABASE_DRIVER?: string;
	DATABASE_URL?: string;
} {
	const dbUrl = bindings?.DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim() || undefined;
	const driver = bindings?.DATABASE_DRIVER?.trim() || process.env.DATABASE_DRIVER?.trim() || undefined;
	return {
		DATABASE_URL: dbUrl,
		DATABASE_DRIVER: driver,
	};
}

function createAdminD1StorageContext(db: D1Database): StorageContext {
	const client = {
		driver: 'd1' as const,
		raw: db,
		drizzle: initD1Drizzle(db),
	};
	return { client, repositories: createD1Repositories(client) };
}

export async function resolveAdminStorageContext(
	bindings?: AdminBindings,
	mode: RuntimeMode = 'auto'
): Promise<StorageContext> {
	if (bindings?.STORAGE_CONTEXT) {
		return bindings.STORAGE_CONTEXT;
	}

	if (bindings?.DB) {
		const cfg = resolveWorkerDatabaseConfig({
			DB: bindings.DB,
			DATABASE_DRIVER: bindings.DATABASE_DRIVER,
		});
		return createAdminD1StorageContext(cfg.db);
	}

	const isCloudflareMode = mode === 'cloudflare' || (mode === 'auto' && Boolean(bindings?.ASSETS));
	if (isCloudflareMode) {
		throw new Error('Cloudflare runtime requires D1 binding `DB`; Postgres fallback is disabled.');
	}

	const nodeEnv = getNodeDatabaseEnv(bindings);
	const nodeCfg = resolveNodeDatabaseConfig(nodeEnv);

	if (nodeStoragePromise === null) {
		const nodeContext = await import('@octafuse/core/storage/context');
		const p =
			nodeCfg.driver === 'mysql'
				? nodeContext.createMySqlStorageContext(nodeCfg.connectionString)
				: nodeContext.createPostgresStorageContext(nodeCfg.connectionString);
		nodeStoragePromise = p.catch((err) => {
			nodeStoragePromise = null;
			throw err;
		});
	}
	return nodeStoragePromise;
}
