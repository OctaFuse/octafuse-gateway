/**
 * 管理路由：`/admin/routes` — `model_routes` 行 CRUD，委托 `model-routes-service`。
 */
import { Hono } from 'hono';
import type { AdminEnv } from '@/lib/admin-env';
import { requireMasterKey } from '@/lib/middleware/admin-auth';
import {
	createModelRouteService,
	deleteModelRouteService,
	getModelRouteService,
	listModelRoutesService,
	updateModelRouteService,
} from '@/lib/services/admin/model-routes-service';
import type { AdminModelRouteMutationInput } from '@/lib/services/admin/types';
import { handleAdminRouteError } from './error-response';
import { normalizeApiTimeFields } from '@octafuse/core/lib/time-format';
export const adminModelRoutes = new Hono<AdminEnv>();

adminModelRoutes.use('*', requireMasterKey);

/** 查询：model_id、provider_id 可选过滤。 */
adminModelRoutes.get('/', async (c) => {
	try {
		const repos = c.get('repositories');
		const routes = await listModelRoutesService(repos, {
			model_id: c.req.query('model_id') ?? undefined,
			provider_id: c.req.query('provider_id') ?? undefined,
		});
		return c.json(normalizeApiTimeFields({ success: true, data: routes, count: routes.length }));
	} catch (error) {
		return handleAdminRouteError(c, error, 'Failed to list model routes');
	}
});

/** 新建 model_routes 行。 */
adminModelRoutes.post('/', async (c) => {
	let body: AdminModelRouteMutationInput;
	try {
		body = await c.req.json();
	} catch {
		return c.json({ success: false, message: 'Invalid JSON body' }, 400);
	}
	try {
		const repos = c.get('repositories');
		const data = await createModelRouteService(repos, body);
		return c.json(normalizeApiTimeFields({ success: true, message: 'Route created successfully', data }));
	} catch (error) {
		return handleAdminRouteError(c, error, 'Failed to create route');
	}
});

/** `:id` 为 model_routes 行 id。 */
adminModelRoutes.get('/:id', async (c) => {
	const id = c.req.param('id');
	try {
		const repos = c.get('repositories');
		const route = await getModelRouteService(repos, id);
		return c.json(normalizeApiTimeFields({ success: true, data: route }));
	} catch (error) {
		return handleAdminRouteError(c, error, 'Failed to get route');
	}
});

/** 部分更新优先级、协议、计费因子等。 */
adminModelRoutes.patch('/:id', async (c) => {
	const id = c.req.param('id');
	let body: AdminModelRouteMutationInput;
	try {
		body = await c.req.json();
	} catch {
		return c.json({ success: false, message: 'Invalid JSON body' }, 400);
	}
	try {
		const repos = c.get('repositories');
		await updateModelRouteService(repos, id, body);
		return c.json({ success: true, message: 'Route updated successfully' });
	} catch (error) {
		return handleAdminRouteError(c, error, 'Failed to update route');
	}
});

/** 删除路由行。 */
adminModelRoutes.delete('/:id', async (c) => {
	const id = c.req.param('id');
	try {
		const repos = c.get('repositories');
		await deleteModelRouteService(repos, id);
		return c.json({ success: true, message: 'Route deleted successfully' });
	} catch (error) {
		return handleAdminRouteError(c, error, 'Failed to delete route');
	}
});
