/**
 * 管理路由：`/admin/routes` — `model_routes` 行 CRUD，委托 `model-routes-service`。
 */
import { Hono } from 'hono';
import type { AdminEnv } from '@/lib/admin-env';
import { requireAdminPrincipal } from '@/lib/middleware/admin-auth';
import {
	createModelRouteService,
	deleteModelRouteService,
	forceClearStickyBindingService,
	getModelRouteService,
	getStickyBindingsSummaryService,
	listModelRoutesService,
	lookupStickyBindingService,
	resetStickyBindingsService,
	updateModelRouteService,
	updateRoutePoolPolicyService,
} from '@/lib/services/admin/model-routes-service';
import type { AdminModelRouteMutationInput } from '@/lib/services/admin/types';
import { handleAdminRouteError } from './error-response';
import { normalizeApiTimeFields } from '@octafuse/core/lib/time-format';
export const adminModelRoutes = new Hono<AdminEnv>();

adminModelRoutes.use('*', requireAdminPrincipal);

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

/** Pool-level strategy / per-tier overrides. Kept under `/routes` so existing Admin proxy/auth wiring is reused. */
adminModelRoutes.patch('/pools/:poolId', async (c) => {
	let body: { strategy?: unknown; tier_strategies?: unknown; sticky_routing?: unknown };
	try {
		body = await c.req.json();
	} catch {
		return c.json({ success: false, message: 'Invalid JSON body' }, 400);
	}
	try {
		const repos = c.get('repositories');
		await updateRoutePoolPolicyService(repos, c.req.param('poolId'), body);
		return c.json({ success: true, message: 'Route pool policy updated successfully' });
	} catch (error) {
		return handleAdminRouteError(c, error, 'Failed to update route pool policy');
	}
});

/** Active sticky binding distribution for a pool. */
adminModelRoutes.get('/pools/:poolId/sticky/bindings/summary', async (c) => {
	try {
		const repos = c.get('repositories');
		const data = await getStickyBindingsSummaryService(repos, c.req.param('poolId'));
		return c.json(normalizeApiTimeFields({ success: true, data }));
	} catch (error) {
		return handleAdminRouteError(c, error, 'Failed to get sticky bindings summary');
	}
});

/** Lookup sticky binding for one user (by user_id or email) on a pool. */
adminModelRoutes.get('/pools/:poolId/sticky/bindings/lookup', async (c) => {
	try {
		const repos = c.get('repositories');
		const data = await lookupStickyBindingService(repos, c.req.param('poolId'), {
			user_id: c.req.query('user_id'),
			email: c.req.query('email'),
			model_id: c.req.query('model_id'),
			route_group: c.req.query('route_group'),
			protocol: c.req.query('protocol'),
			request_operation: c.req.query('request_operation'),
		});
		return c.json(normalizeApiTimeFields({ success: true, data }));
	} catch (error) {
		return handleAdminRouteError(c, error, 'Failed to lookup sticky binding');
	}
});

/** Force-clear one sticky binding by affinity hash (no token CAS). */
adminModelRoutes.delete('/pools/:poolId/sticky/bindings/:affinityHash', async (c) => {
	try {
		const repos = c.get('repositories');
		const data = await forceClearStickyBindingService(
			repos,
			c.req.param('poolId'),
			c.req.param('affinityHash')
		);
		return c.json({
			success: true,
			message: data.cleared ? 'Sticky binding cleared' : 'No sticky binding found',
			data,
		});
	} catch (error) {
		return handleAdminRouteError(c, error, 'Failed to clear sticky binding');
	}
});

/** Bump sticky_epoch to invalidate all bindings for this pool. */
adminModelRoutes.post('/pools/:poolId/sticky/reset', async (c) => {
	try {
		const repos = c.get('repositories');
		const data = await resetStickyBindingsService(repos, c.req.param('poolId'));
		return c.json({
			success: true,
			message: 'Sticky bindings invalidated (epoch bumped)',
			data,
		});
	} catch (error) {
		return handleAdminRouteError(c, error, 'Failed to reset sticky bindings');
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
