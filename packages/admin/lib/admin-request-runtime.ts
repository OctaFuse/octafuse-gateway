import { getCloudflareContext } from '@opennextjs/cloudflare';
import type { StorageContext } from '@octafuse/core';
import type { AdminBindings } from '@/lib/admin-env';
import { getCloudflareEnv } from '@/lib/cloudflare';
import { resolveAdminStorageContext } from '@/lib/storage-context';

interface RequestWithCloudflare extends Request {
	ctx?: { cloudflare?: { env?: CloudflareEnv } };
	env?: CloudflareEnv;
}

export async function resolveAdminRequestRuntime(request?: Request): Promise<{
	bindings: AdminBindings;
	storage: StorageContext;
	ctx?: ExecutionContext;
}> {
	let env: CloudflareEnv | undefined;
	let ctx: ExecutionContext | undefined;
	let hasCloudflareContext = false;
	try {
		const cf = getCloudflareContext();
		env = cf.env as CloudflareEnv;
		ctx = cf.ctx;
		hasCloudflareContext = true;
	} catch {
		env = getCloudflareEnv(request);
	}

	const requestEnv = request as RequestWithCloudflare | undefined;
	const cloudflareRuntime = hasCloudflareContext || Boolean(
		env?.DB || env?.ASSETS || requestEnv?.ctx?.cloudflare?.env || requestEnv?.env?.DB || requestEnv?.env?.ASSETS
	);
	if (cloudflareRuntime && !env?.DB) {
		throw new Error('Cloudflare runtime requires D1 binding `DB`.');
	}

	const bindings: AdminBindings = {
		DB: env?.DB,
		ASSETS: env?.ASSETS,
		DATABASE_URL: cloudflareRuntime ? undefined : process.env.DATABASE_URL,
		DATABASE_DRIVER: cloudflareRuntime
			? (env as { DATABASE_DRIVER?: string } | undefined)?.DATABASE_DRIVER
			: process.env.DATABASE_DRIVER,
	};
	const storage = await resolveAdminStorageContext(bindings, cloudflareRuntime ? 'cloudflare' : 'node');
	return { bindings, storage, ctx };
}
