/**
 * 管理路由：`/admin/request-logs` — 全站 `api_key_request_logs` 多维筛选分页（运维排障）。
 */
import { Hono } from 'hono';
import type { AdminEnv } from '@/lib/admin-env';
import { requireMasterKey } from '@/lib/middleware/admin-auth';
import { listAdminGlobalRequestLogsService } from '@/lib/services/admin/dashboard-service';
import { handleAdminRouteError } from './error-response';
import { normalizeApiTimeFields } from '@octafuse/core/lib/time-format';
export const adminRequestLogsRoutes = new Hono<AdminEnv>();

adminRequestLogsRoutes.use('*', requireMasterKey);

/** 查询参数与 `listAdminGlobalRequestLogsService` 一致：page、page_size、api_key_id、user_email、model_id、provider_id、route_group、protocol、status、start_date、end_date。 */
adminRequestLogsRoutes.get('/', async (c) => {
	try {
		const repos = c.get('repositories');
		const result = await listAdminGlobalRequestLogsService(repos, {
			page: c.req.query('page') ?? undefined,
			page_size: c.req.query('page_size') ?? undefined,
			api_key_id: c.req.query('api_key_id') ?? undefined,
			user_email: c.req.query('user_email') ?? undefined,
			model_id: c.req.query('model_id') ?? undefined,
			provider_id: c.req.query('provider_id') ?? undefined,
			route_group: c.req.query('route_group') ?? undefined,
			protocol: c.req.query('protocol') ?? undefined,
			status: c.req.query('status') ?? undefined,
			start_date: c.req.query('start_date') ?? undefined,
			end_date: c.req.query('end_date') ?? undefined,
		});
		return c.json(normalizeApiTimeFields({ success: true, data: result.logs, total: result.total, page: result.page, page_size: result.page_size }));
	} catch (error) {
		return handleAdminRouteError(c, error, 'Failed to get request logs');
	}
});
