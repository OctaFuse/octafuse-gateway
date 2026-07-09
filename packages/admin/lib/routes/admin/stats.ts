/**
 * 管理路由：`/admin/stats` — 仪表盘 KPI（活跃密钥、今日请求/费用、近期日志与错误等）。
 */
import { Hono } from 'hono';
import type { AdminEnv } from '@/lib/admin-env';
import { requireMasterKey } from '@/lib/middleware/admin-auth';
import { getAdminStatsService } from '@/lib/services/admin/dashboard-service';
import { handleAdminRouteError } from './error-response';
import { normalizeApiTimeFields } from '@octafuse/core/lib/time-format';
export const adminStatsRoutes = new Hono<AdminEnv>();

adminStatsRoutes.use('*', requireMasterKey);

/** 查询参数：`start_date` + `end_date`（UTC，与 Request Logs / Analytics 一致）优先；否则 `range` 预设，默认 `1d`。 */
adminStatsRoutes.get('/', async (c) => {
	try {
		const repos = c.get('repositories');
		const data = await getAdminStatsService(repos, {
			range: c.req.query('range') ?? undefined,
			startDate: c.req.query('start_date') ?? undefined,
			endDate: c.req.query('end_date') ?? undefined,
		});
		return c.json(normalizeApiTimeFields({ success: true, data }));
	} catch (error) {
		return handleAdminRouteError(c, error, 'Failed to get stats');
	}
});
