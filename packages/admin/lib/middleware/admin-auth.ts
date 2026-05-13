/**
 * 管理接口鉴权：`Authorization: Bearer` 须与存储中的 `system_config.MASTER_KEY` 完全一致。
 */
import { createMiddleware } from 'hono/factory';
import { getMasterKey } from '@/lib/services/admin/master-key-service';
import type { AdminEnv } from '@/lib/admin-env';

export const requireMasterKey = createMiddleware<AdminEnv>(async (c, next) => {
	const repos = c.get('repositories');
	const masterKey = await getMasterKey(repos);
	if (masterKey == null || masterKey === '') {
		return c.json({ error: 'Server configuration error: MASTER_KEY not set' }, 500);
	}
	const auth = c.req.header('Authorization');
	const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
	if (!token || token !== masterKey) {
		return c.json({ error: 'Unauthorized' }, 401);
	}
	await next();
});
