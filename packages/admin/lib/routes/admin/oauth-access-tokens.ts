/**
 * `/admin/oauth-access-tokens` — OAuth 访问令牌（`oat_`）的全局管理：列表、统计、轮换、撤销、清理。
 * 按用户创建 / 列出见 `/admin/users/:id/oauth-access-tokens`。
 */
import { Hono } from 'hono';
import { normalizeApiTimeFields } from '@octafuse/core/lib/time-format';
import type { AdminEnv } from '@/lib/admin-env';
import { requireAdminPrincipal } from '@/lib/middleware/admin-auth';
import {
	cleanupOAuthAccessTokens,
	getOAuthAccessTokenStats,
	listOAuthAccessTokens,
	revokeOAuthAccessTokenById,
	revokeOAuthAccessTokensBy,
	rotateOAuthAccessToken,
} from '@/lib/services/admin/oauth-access-tokens-service';
import { handleAdminRouteError, jsonErr } from './error-response';

export const adminOAuthAccessTokensRoutes = new Hono<AdminEnv>();

adminOAuthAccessTokensRoutes.use('*', requireAdminPrincipal);

async function readJson(c: { req: { json: () => Promise<unknown> } }): Promise<Record<string, unknown> | null> {
	try {
		const body = await c.req.json();
		return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
	} catch {
		return null;
	}
}

adminOAuthAccessTokensRoutes.get('/', async (c) => {
	try {
		const data = await listOAuthAccessTokens(c.get('repositories'), {
			page: c.req.query('page'),
			page_size: c.req.query('page_size'),
			client_id: c.req.query('client_id'),
			user_id: c.req.query('user_id'),
			email: c.req.query('email'),
			status: c.req.query('status'),
		});
		return c.json(normalizeApiTimeFields({ success: true as const, data }));
	} catch (error) {
		return handleAdminRouteError(c, error, 'Failed to list access tokens');
	}
});

adminOAuthAccessTokensRoutes.get('/stats', async (c) => {
	try {
		return c.json(normalizeApiTimeFields({ success: true as const, data: await getOAuthAccessTokenStats(c.get('repositories')) }));
	} catch (error) {
		return handleAdminRouteError(c, error, 'Failed to load access token stats');
	}
});

adminOAuthAccessTokensRoutes.post('/cleanup', async (c) => {
	const body = (await readJson(c)) ?? {};
	try {
		return c.json({ success: true as const, data: await cleanupOAuthAccessTokens(c.get('repositories'), body) });
	} catch (error) {
		return handleAdminRouteError(c, error, 'Failed to clean up access tokens');
	}
});

adminOAuthAccessTokensRoutes.post('/revoke', async (c) => {
	const body = await readJson(c);
	if (!body) return jsonErr(c, 400, 'Invalid JSON body');
	try {
		return c.json({ success: true as const, data: await revokeOAuthAccessTokensBy(c.get('repositories'), body) });
	} catch (error) {
		return handleAdminRouteError(c, error, 'Failed to revoke access tokens');
	}
});

adminOAuthAccessTokensRoutes.post('/:id/rotate', async (c) => {
	const body = (await readJson(c)) ?? {};
	try {
		const data = await rotateOAuthAccessToken(c.get('repositories'), c.req.param('id'), body);
		return c.json(normalizeApiTimeFields({ success: true as const, data }));
	} catch (error) {
		return handleAdminRouteError(c, error, 'Failed to rotate access token');
	}
});

adminOAuthAccessTokensRoutes.post('/:id/revoke', async (c) => {
	try {
		await revokeOAuthAccessTokenById(c.get('repositories'), c.req.param('id'));
		return c.json({ success: true as const, message: 'Access token revoked' });
	} catch (error) {
		return handleAdminRouteError(c, error, 'Failed to revoke access token');
	}
});
