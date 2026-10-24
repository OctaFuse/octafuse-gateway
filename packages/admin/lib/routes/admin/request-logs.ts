/**
 * 管理路由：`/admin/request-logs` — 全站 `api_key_request_logs` 多维筛选分页（运维排障）。
 */
import { Hono } from 'hono';
import type { AdminEnv } from '@/lib/admin-env';
import { requireAdminPrincipal } from '@/lib/middleware/admin-auth';
import {
	getRequestLogSummaryService,
	listAdminGlobalRequestLogsService,
} from '@/lib/services/admin/dashboard-service';
import { handleAdminRouteError } from './error-response';
import { normalizeApiTimeFields } from '@octafuse/core/lib/time-format';
export const adminRequestLogsRoutes = new Hono<AdminEnv>();

adminRequestLogsRoutes.use('*', requireAdminPrincipal);

/**
 * 精确汇总：按维度聚合区间内的请求条数、Token 与四项金额（门户对账等核对场景，不必分页拉明细）。
 * 查询参数：start / end（必填，带时区的 ISO 8601，半开区间 [start, end)）、group_by（provider 默认 | model | provider,model | route_group | status）、
 * 筛选 provider_ids（逗号分隔，最多 10 个）、model_id、model_id_prefix、route_group、status；无 provider_ids 时至少带一个筛选条件。
 */
adminRequestLogsRoutes.get('/summary', async (c) => {
	try {
		const repos = c.get('repositories');
		const result = await getRequestLogSummaryService(repos, {
			group_by: c.req.query('group_by') ?? undefined,
			provider_ids: c.req.query('provider_ids') ?? undefined,
			model_id: c.req.query('model_id') ?? undefined,
			model_id_prefix: c.req.query('model_id_prefix') ?? undefined,
			route_group: c.req.query('route_group') ?? undefined,
			status: c.req.query('status') ?? undefined,
			start: c.req.query('start') ?? undefined,
			end: c.req.query('end') ?? undefined,
		});
		return c.json({ success: true, data: result.groups, group_by: result.group_by, start: result.start, end: result.end });
	} catch (error) {
		return handleAdminRouteError(c, error, 'Failed to summarize request logs');
	}
});

/** 查询参数与 `listAdminGlobalRequestLogsService` 一致：page、page_size、id、api_key_id、user_email、model_id、provider_id、provider_ids、model_id_prefix、route_group、protocol、status、start_date、end_date。 */
adminRequestLogsRoutes.get('/', async (c) => {
	try {
		const repos = c.get('repositories');
		const result = await listAdminGlobalRequestLogsService(repos, {
			page: c.req.query('page') ?? undefined,
			page_size: c.req.query('page_size') ?? undefined,
			id: c.req.query('id') ?? undefined,
			api_key_id: c.req.query('api_key_id') ?? undefined,
			user_email: c.req.query('user_email') ?? undefined,
			model_id: c.req.query('model_id') ?? undefined,
			provider_id: c.req.query('provider_id') ?? undefined,
			provider_ids: c.req.query('provider_ids') ?? undefined,
			model_id_prefix: c.req.query('model_id_prefix') ?? undefined,
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
