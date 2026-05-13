/**
 * 管理路由：`/admin/budget-audit-logs` — 全站 API 密钥预算审计日志（多维筛选分页）。
 */
import { Hono } from 'hono';
import type { AdminEnv } from '@/lib/admin-env';
import { requireMasterKey } from '@/lib/middleware/admin-auth';
import { listAdminGlobalBudgetAuditLogsService } from '@/lib/services/admin/dashboard-service';
import { handleAdminRouteError } from './error-response';
import { normalizeApiTimeFields } from '@octafuse/core/lib/time-format';
export const adminBudgetAuditLogsRoutes = new Hono<AdminEnv>();

adminBudgetAuditLogsRoutes.use('*', requireMasterKey);

/** 查询参数：page、page_size、api_key_id、user_email、event_type、actor_type、start_date、end_date。 */
adminBudgetAuditLogsRoutes.get('/', async (c) => {
	try {
		const repos = c.get('repositories');
		const result = await listAdminGlobalBudgetAuditLogsService(repos, {
			page: c.req.query('page') ?? undefined,
			page_size: c.req.query('page_size') ?? undefined,
			api_key_id: c.req.query('api_key_id') ?? undefined,
			user_email: c.req.query('user_email') ?? undefined,
			event_type: c.req.query('event_type') ?? undefined,
			actor_type: c.req.query('actor_type') ?? undefined,
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
