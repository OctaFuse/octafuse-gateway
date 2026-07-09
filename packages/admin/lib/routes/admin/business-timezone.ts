/**
 * 管理路由：`/admin/business-timezone` — 返回当前 `system_config.BUSINESS_TIMEZONE`。
 */
import { Hono } from 'hono';
import { getBusinessTimezone } from '@octafuse/core/lib/business-timezone';
import type { AdminEnv } from '@/lib/admin-env';
import { requireMasterKey } from '@/lib/middleware/admin-auth';
import { handleAdminRouteError } from './error-response';

export const adminBusinessTimezoneRoutes = new Hono<AdminEnv>();

adminBusinessTimezoneRoutes.use('*', requireMasterKey);

adminBusinessTimezoneRoutes.get('/', async (c) => {
	try {
		const repos = c.get('repositories');
		const business_timezone = await getBusinessTimezone(repos);
		return c.json({ success: true, data: { business_timezone } });
	} catch (error) {
		return handleAdminRouteError(c, error, 'Failed to get business timezone');
	}
});
