/**
 * `/admin/oauth/*` — 内置 MCP OAuth 授权服务器的管理接口。
 *
 * - `authorization-requests/:id`（GET）、`.../accept`、`.../reject`：同意页使用，权限 `oauth.consent`。
 * - `apps*`、`clients`：应用目录、按应用统计与撤销，权限 `oauth.read` / `oauth.write`。
 * 按用户撤销见 `/admin/users/:id/oauth-access-tokens/revoke`，访问令牌明细见 `/admin/oauth-access-tokens`。
 */
import { Hono } from 'hono';
import { normalizeApiTimeFields } from '@octafuse/core/lib/time-format';
import type { AdminEnv } from '@/lib/admin-env';
import { requireAdminPrincipal } from '@/lib/middleware/admin-auth';
import {
	acceptOAuthAuthorizationRequest,
	createOAuthApp,
	deleteOAuthApp,
	getAuthorizationRequest,
	isOAuthAuthorizationRequestError,
	listOAuthApps,
	listOAuthClients,
	rejectOAuthAuthorizationRequest,
	revokeOAuthAppGrants,
	updateOAuthApp,
} from '@/lib/services/admin/oauth-server-service';
import { handleAdminRouteError, jsonErr } from './error-response';

export const adminOAuthRoutes = new Hono<AdminEnv>();

adminOAuthRoutes.use('*', requireAdminPrincipal);

async function readJson(c: { req: { json: () => Promise<unknown> } }): Promise<Record<string, unknown> | null> {
	try {
		const body = await c.req.json();
		return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
	} catch {
		return null;
	}
}

/** 授权请求的错误带稳定 `code`，同意页据此给用户合适的提示。 */
function handleRequestError(c: Parameters<typeof handleAdminRouteError>[0], error: unknown, fallback: string) {
	if (isOAuthAuthorizationRequestError(error)) {
		return new Response(JSON.stringify({ success: false as const, message: error.message, code: error.code }), {
			status: error.status,
			headers: { 'content-type': 'application/json; charset=utf-8' },
		});
	}
	return handleAdminRouteError(c, error, fallback);
}

adminOAuthRoutes.get('/authorization-requests/:id', async (c) => {
	try {
		const data = await getAuthorizationRequest(c.get('repositories'), c.req.param('id'));
		return c.json(normalizeApiTimeFields({ success: true as const, data }));
	} catch (error) {
		return handleRequestError(c, error, 'Failed to load authorization request');
	}
});

adminOAuthRoutes.post('/authorization-requests/:id/accept', async (c) => {
	const body = await readJson(c);
	if (!body) return jsonErr(c, 400, 'Invalid JSON body');
	try {
		const data = await acceptOAuthAuthorizationRequest(c.get('repositories'), c.req.param('id'), body);
		return c.json({ success: true as const, data });
	} catch (error) {
		return handleRequestError(c, error, 'Failed to accept authorization request');
	}
});

adminOAuthRoutes.post('/authorization-requests/:id/reject', async (c) => {
	try {
		const data = await rejectOAuthAuthorizationRequest(c.get('repositories'), c.req.param('id'));
		return c.json({ success: true as const, data });
	} catch (error) {
		return handleRequestError(c, error, 'Failed to reject authorization request');
	}
});

adminOAuthRoutes.get('/apps', async (c) => {
	try {
		return c.json(normalizeApiTimeFields({ success: true as const, data: await listOAuthApps(c.get('repositories')) }));
	} catch (error) {
		return handleAdminRouteError(c, error, 'Failed to list OAuth applications');
	}
});

adminOAuthRoutes.post('/apps', async (c) => {
	const body = await readJson(c);
	if (!body) return jsonErr(c, 400, 'Invalid JSON body');
	try {
		const data = await createOAuthApp(c.get('repositories'), body);
		return c.json(normalizeApiTimeFields({ success: true as const, data }), 201);
	} catch (error) {
		return handleAdminRouteError(c, error, 'Failed to create OAuth application');
	}
});

adminOAuthRoutes.patch('/apps/:id', async (c) => {
	const body = await readJson(c);
	if (!body) return jsonErr(c, 400, 'Invalid JSON body');
	try {
		const data = await updateOAuthApp(c.get('repositories'), c.req.param('id'), body);
		return c.json(normalizeApiTimeFields({ success: true as const, data }));
	} catch (error) {
		return handleAdminRouteError(c, error, 'Failed to update OAuth application');
	}
});

adminOAuthRoutes.delete('/apps/:id', async (c) => {
	try {
		const data = await deleteOAuthApp(c.get('repositories'), c.req.param('id'));
		return c.json({ success: true as const, data });
	} catch (error) {
		return handleAdminRouteError(c, error, 'Failed to delete OAuth application');
	}
});

adminOAuthRoutes.post('/apps/:id/revoke', async (c) => {
	const body = (await readJson(c)) ?? {};
	try {
		const data = await revokeOAuthAppGrants(c.get('repositories'), c.req.param('id'), body);
		return c.json({ success: true as const, data });
	} catch (error) {
		return handleAdminRouteError(c, error, 'Failed to revoke OAuth application grants');
	}
});

adminOAuthRoutes.get('/clients', async (c) => {
	try {
		const data = await listOAuthClients(c.get('repositories'), {
			app_id: c.req.query('app_id'),
			page: c.req.query('page'),
			page_size: c.req.query('page_size'),
		});
		return c.json(normalizeApiTimeFields({ success: true as const, data }));
	} catch (error) {
		return handleAdminRouteError(c, error, 'Failed to list OAuth clients');
	}
});
