/**
 * 管理路由：`/admin/budget-audit-logs` — 全站 API 密钥预算审计日志（多维筛选分页）。
 */
import { Hono } from 'hono';
import type { AdminEnv } from '@/lib/admin-env';
import { requireMasterKey } from '@/lib/middleware/admin-auth';
import {
	listAdminGlobalBudgetAuditLogFilterOptionsService,
	listAdminGlobalBudgetAuditLogsService,
} from '@/lib/services/admin/dashboard-service';
import { handleAdminRouteError } from './error-response';
import { normalizeApiTimeFields } from '@octafuse/core/lib/time-format';
export const adminBudgetAuditLogsRoutes = new Hono<AdminEnv>();

adminBudgetAuditLogsRoutes.use('*', requireMasterKey);

adminBudgetAuditLogsRoutes.get('/filters', async (c) => {
	try {
		const repos = c.get('repositories');
		const result = await listAdminGlobalBudgetAuditLogFilterOptionsService(repos);
		return c.json({ success: true as const, data: result });
	} catch (error) {
		return handleAdminRouteError(c, error, 'Failed to get budget audit log filter options');
	}
});

/** 查询参数：page、page_size、user_id、api_key_id、user_email、event_type（可重复）、actor_type（可重复）、reason_code（可重复）、source（可重复）、correlation_id、start_date、end_date。 */
adminBudgetAuditLogsRoutes.get('/', async (c) => {
	try {
		const repos = c.get('repositories');
		const searchParams = new URL(c.req.url, 'http://localhost').searchParams;
		const eventTypes = searchParams.getAll('event_type');
		const actorTypes = searchParams.getAll('actor_type');
		const reasonCodes = searchParams.getAll('reason_code');
		const sources = searchParams.getAll('source');
		const result = await listAdminGlobalBudgetAuditLogsService(repos, {
			page: c.req.query('page') ?? undefined,
			page_size: c.req.query('page_size') ?? undefined,
			user_id: c.req.query('user_id') ?? undefined,
			api_key_id: c.req.query('api_key_id') ?? undefined,
			user_email: c.req.query('user_email') ?? undefined,
			event_type: eventTypes.length > 0 ? eventTypes : undefined,
			actor_type: actorTypes.length > 0 ? actorTypes : undefined,
			reason_code: reasonCodes.length > 0 ? reasonCodes : undefined,
			source: sources.length > 0 ? sources : undefined,
			correlation_id: c.req.query('correlation_id') ?? undefined,
			start_date: c.req.query('start_date') ?? undefined,
			end_date: c.req.query('end_date') ?? undefined,
		});
		return c.json(
			normalizeApiTimeFields({
				success: true as const,
				data: result.logs,
				total: result.total,
				page: result.page,
				page_size: result.page_size,
			})
		);
	} catch (error) {
		return handleAdminRouteError(c, error, 'Failed to get budget audit logs');
	}
});
