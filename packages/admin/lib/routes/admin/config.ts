/**
 * 管理路由：`/admin/config` — 读写 `system_config`（如 MASTER_KEY）。
 */
import { Hono } from 'hono';
import type { AdminEnv } from '@/lib/admin-env';
import { requireMasterKey } from '@/lib/middleware/admin-auth';
import { listAdminSystemConfigService, updateAdminSystemConfigService } from '@/lib/services/admin/dashboard-service';
import type { AdminConfigUpdateInput } from '@/lib/services/admin/types';
import { handleAdminRouteError } from './error-response';
export const adminConfigRoutes = new Hono<AdminEnv>();

adminConfigRoutes.use('*', requireMasterKey);

/** 列出全部 system_config 行。 */
adminConfigRoutes.get('/', async (c) => {
	try {
		const repos = c.get('repositories');
		const data = await listAdminSystemConfigService(repos);
		return c.json({ success: true, data });
	} catch (error) {
		return handleAdminRouteError(c, error, 'Failed to get config');
	}
});

/** 单键 upsert：body `{ key, value }`。 */
adminConfigRoutes.put('/', async (c) => {
	let body: AdminConfigUpdateInput;
	try {
		body = await c.req.json();
	} catch {
		return c.json({ success: false, message: 'Invalid JSON body' }, 400);
	}
	try {
		const repos = c.get('repositories');
		await updateAdminSystemConfigService(repos, body);
		return c.json({ success: true, message: 'Config updated' });
	} catch (error) {
		return handleAdminRouteError(c, error, 'Failed to update config');
	}
});
