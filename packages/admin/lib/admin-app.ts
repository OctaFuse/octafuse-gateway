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
import { adminAccessKeysRoutes } from '@/lib/routes/admin/access-keys';
import { getAdminAuthorizationDecision } from '@/lib/admin-permissions';
import { hasAdminPermission } from '@/lib/admin-principal';

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
		const principal = c.env.ADMIN_PRINCIPAL;
		if (!principal) return c.json({ success: false, message: 'Unauthorized' }, 401);
		c.set('principal', principal);
		await next();
	});

	app.use('/admin/*', async (c, next) => {
		const principal = c.get('principal');
		const decision = getAdminAuthorizationDecision(c.req.method, c.req.path);
		if (decision.kind === 'console_only') {
			if (principal.type !== 'console') {
				return c.json({ success: false, message: 'Forbidden', required_permission: 'console_session' }, 403);
			}
			if (c.req.path.startsWith('/admin/access-keys') && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(c.req.method.toUpperCase())) {
				const origin = c.req.header('origin');
				if (!origin || origin !== new URL(c.req.url).origin) {
					return c.json({ success: false, message: 'Forbidden: invalid Origin' }, 403);
				}
			}
			return next();
		}
		if (decision.kind === 'authenticated') return next();
		if (decision.kind === 'deny') {
			return c.json({ success: false, message: 'Forbidden: admin route is not registered' }, 403);
		}
		if (!hasAdminPermission(principal, decision.permission)) {
			return c.json({ success: false, message: 'Forbidden', required_permission: decision.permission }, 403);
		}
		return next();
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
	app.route('/admin/access-keys', adminAccessKeysRoutes);

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
