/**
 * 管理路由：`/admin/maintenance` — 维护模式开关。
 * GET 需要 `maintenance.read`，PUT 需要 `maintenance.write`（见 `admin-permissions.ts`）。
 */
import { Hono } from 'hono';
import type { AdminEnv } from '@/lib/admin-env';
import { requireAdminPrincipal } from '@/lib/middleware/admin-auth';
import { getMaintenanceStatusService, setMaintenanceService } from '@/lib/services/admin/maintenance-service';
import { handleAdminRouteError, jsonErr } from './error-response';

export const adminMaintenanceRoutes = new Hono<AdminEnv>();

adminMaintenanceRoutes.use('*', requireAdminPrincipal);

adminMaintenanceRoutes.get('/', async (c) => {
	try {
		const data = await getMaintenanceStatusService(c.get('repositories'));
		return c.json({ success: true, data });
	} catch (error) {
		return handleAdminRouteError(c, error, 'Failed to get maintenance status');
	}
});

/**
 * body：`{ enabled, message?, messages?, duration_minutes? | expected_end_at?, block_admin_writes? }`。
 * 关闭时只需 `{ enabled: false }`。
 */
adminMaintenanceRoutes.put('/', async (c) => {
	let body: unknown;
	try {
		body = await c.req.json();
	} catch {
		return jsonErr(c, 400, 'Invalid JSON body');
	}
	try {
		const data = await setMaintenanceService(c.get('repositories'), body as Record<string, unknown>);
		return c.json({ success: true, data });
	} catch (error) {
		return handleAdminRouteError(c, error, 'Failed to update maintenance status');
	}
});
