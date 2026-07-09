/**
 * 管理 API Hono 子应用：内部路由为 `/admin/*`；由 Next 对外暴露为 `/api/admin/*`。
 */
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import type { AdminEnv } from '@/lib/admin-env';
import { resolveAdminStorageContext } from '@/lib/storage-context';
import { adminAppVersion } from '@/lib/app-version';
import { adminAnalyticsRoutes } from '@/lib/routes/admin/analytics';
import { adminBudgetAuditLogsRoutes } from '@/lib/routes/admin/budget-audit-logs';
import { adminBusinessTimezoneRoutes } from '@/lib/routes/admin/business-timezone';
import { adminConfigRoutes } from '@/lib/routes/admin/config';
import { adminKeysRoutes } from '@/lib/routes/admin/keys';
import { adminUsersRoutes } from '@/lib/routes/admin/users';
import { adminModelRoutes } from '@/lib/routes/admin/model-routes';
import { adminModelsRoutes } from '@/lib/routes/admin/models';
import { adminPlaygroundRoutes } from '@/lib/routes/admin/playground';
import { adminProvidersRoutes } from '@/lib/routes/admin/providers';
import { adminRequestLogsRoutes } from '@/lib/routes/admin/request-logs';
import { adminStatsRoutes } from '@/lib/routes/admin/stats';

export function createAdminApp(): Hono<AdminEnv> {
	const app = new Hono<AdminEnv>();

	app.use('*', logger());
	app.use(
		'*',
		cors({
			origin: '*',
			allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
			allowHeaders: ['Content-Type', 'Authorization'],
		})
	);

	app.use('*', async (c, next) => {
		const { repositories } = await resolveAdminStorageContext(c.env);
		c.set('repositories', repositories);
		await next();
	});

	app.route('/admin/users', adminUsersRoutes);
	app.route('/admin/keys', adminKeysRoutes);
	app.route('/admin/providers', adminProvidersRoutes);
	app.route('/admin/models', adminModelsRoutes);
	app.route('/admin/routes', adminModelRoutes);
	app.route('/admin/playground', adminPlaygroundRoutes);
	app.route('/admin/stats', adminStatsRoutes);
	app.route('/admin/config', adminConfigRoutes);
	app.route('/admin/request-logs', adminRequestLogsRoutes);
	app.route('/admin/budget-audit-logs', adminBudgetAuditLogsRoutes);
	app.route('/admin/business-timezone', adminBusinessTimezoneRoutes);
	app.route('/admin/analytics', adminAnalyticsRoutes);

	app.get('/admin', (c) => c.json({ name: 'octafuse-admin-api', version: adminAppVersion }));

	return app;
}

let cached: ReturnType<typeof createAdminApp> | undefined;

export function getAdminApp(): Hono<AdminEnv> {
	if (!cached) {
		cached = createAdminApp();
	}
	return cached;
}
