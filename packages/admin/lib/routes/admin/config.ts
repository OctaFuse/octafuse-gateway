/**
 * 管理路由：`/admin/config` — 读写可管理的 `system_config`（禁止写入已移除的 MASTER_KEY）。
 */
import { Hono } from 'hono';
import type { AdminEnv } from '@/lib/admin-env';
import { requireAdminPrincipal } from '@/lib/middleware/admin-auth';
import { listAdminSystemConfigService, updateAdminSystemConfigService } from '@/lib/services/admin/dashboard-service';
import type { AdminConfigUpdateInput } from '@/lib/services/admin/types';
import { handleAdminRouteError } from './error-response';
import { hasAdminPermission } from '@/lib/admin-principal';
import { prepareAdminConfigRows } from '@/lib/admin-config-secrets';
export const adminConfigRoutes = new Hono<AdminEnv>();

adminConfigRoutes.use('*', requireAdminPrincipal);

/** 列出全部 system_config 行。 */
adminConfigRoutes.get('/', async (c) => {
	try {
		const repos = c.get('repositories');
		const data = prepareAdminConfigRows(
			await listAdminSystemConfigService(repos),
			hasAdminPermission(c.get('principal'), 'config.secrets.read')
		);
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
