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

/** 查询参数 `range`：1h | 1d | 24h | 7d | 14d | 30d | 90d，默认 7d。 */
adminStatsRoutes.get('/', async (c) => {
	try {
		const repos = c.get('repositories');
		const data = await getAdminStatsService(repos, c.req.query('range') ?? '7d');
		return c.json(normalizeApiTimeFields({ success: true, data }));
	} catch (error) {
		return handleAdminRouteError(c, error, 'Failed to get stats');
	}
});
