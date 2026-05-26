/**
 * Public catalog discovery (no API key): runtime model capabilities from active routes.
 */
import { Hono } from 'hono';
import type { Env } from '../app';
import { parseCatalogRouteGroupsQuery } from '../lib/model-list-parse';
import { listCatalogDiscoveryModels } from '../services/catalog-discovery';

export const catalogRoutes = new Hono<Env>();

/**
 * `GET /catalog/models`
 *
 * Optional query:
 * - `route_groups` — CSV filter (case-insensitive). Omitted → all active route groups.
 */
catalogRoutes.get('/models', async (c) => {
	const repos = c.get('repositories');
	const routeGroups = parseCatalogRouteGroupsQuery(c.req.query('route_groups'));
	const data = await listCatalogDiscoveryModels(repos, { routeGroups });

	return c.json({
		object: 'list',
		data,
		generated_at: new Date().toISOString(),
	});
});
