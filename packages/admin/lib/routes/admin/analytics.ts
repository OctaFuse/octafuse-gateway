/**
 * 管理路由：`/admin/analytics/*` — 按模型、用户、供应商/模型维度的用量与可靠性统计。
 */
import { Hono } from 'hono';
import type { AdminEnv } from '@/lib/admin-env';
import { requireMasterKey } from '@/lib/middleware/admin-auth';
import {
	getModelAnalyticsService,
	getProviderAnalyticsService,
	getReliabilityAnalyticsService,
	getUserAnalyticsService,
} from '@/lib/services/admin/dashboard-service';
import { handleAdminRouteError } from './error-response';
import { normalizeApiTimeFields } from '@octafuse/core/lib/time-format';
export const adminAnalyticsRoutes = new Hono<AdminEnv>();

adminAnalyticsRoutes.use('*', requireMasterKey);

/** 查询参数：start_date、end_date、tag（模型标签筛选）、provider_id（供应商筛选）。 */
adminAnalyticsRoutes.get('/models', async (c) => {
	try {
		const repos = c.get('repositories');
		const result = await getModelAnalyticsService(repos, {
			start_date: c.req.query('start_date') ?? undefined,
			end_date: c.req.query('end_date') ?? undefined,
			tag: c.req.query('tag') ?? undefined,
			provider_id: c.req.query('provider_id') ?? undefined,
		});
		return c.json(normalizeApiTimeFields({ success: true, data: result.data, tags: result.tags }));
	} catch (error) {
		return handleAdminRouteError(c, error, 'Failed to get model analytics');
	}
});

/** 查询参数：start_date、end_date、tag（模型标签筛选）。 */
adminAnalyticsRoutes.get('/providers', async (c) => {
	try {
		const repos = c.get('repositories');
		const result = await getProviderAnalyticsService(repos, {
			start_date: c.req.query('start_date') ?? undefined,
			end_date: c.req.query('end_date') ?? undefined,
			tag: c.req.query('tag') ?? undefined,
		});
		return c.json(normalizeApiTimeFields({ success: true, data: result.data, tags: result.tags }));
	} catch (error) {
		return handleAdminRouteError(c, error, 'Failed to get provider analytics');
	}
});

/** 查询参数：start_date、end_date、email（模糊）。 */
adminAnalyticsRoutes.get('/users', async (c) => {
	try {
		const repos = c.get('repositories');
		const data = await getUserAnalyticsService(repos, {
			start_date: c.req.query('start_date') ?? undefined,
			end_date: c.req.query('end_date') ?? undefined,
			email: c.req.query('email') ?? undefined,
		});
		return c.json(normalizeApiTimeFields({ success: true, data }));
	} catch (error) {
		return handleAdminRouteError(c, error, 'Failed to get user analytics');
	}
});

/** 查询参数：start_date、end_date。 */
adminAnalyticsRoutes.get('/reliability', async (c) => {
	try {
		const repos = c.get('repositories');
		const data = await getReliabilityAnalyticsService(repos, {
			start_date: c.req.query('start_date') ?? undefined,
			end_date: c.req.query('end_date') ?? undefined,
		});
		return c.json(normalizeApiTimeFields({ success: true, data }));
	} catch (error) {
		return handleAdminRouteError(c, error, 'Failed to get reliability analytics');
	}
});
