/**
 * 管理路由：`/admin/playground` — 管理员按单条 `model_routes` 直连上游试调用。
 * 不写 `api_key_request_logs`、不扣 API Key 预算、无 failover；仅用于验证 provider / 模型连通性。
 */
import { Hono } from 'hono';
import type { AdminEnv } from '@/lib/admin-env';
import { requireMasterKey } from '@/lib/middleware/admin-auth';
import type { GeminiContentAction } from '@octafuse/core';
import { invokePlaygroundUpstream } from '@/lib/services/admin/playground-service';
import { handleAdminRouteError } from './error-response';

export const adminPlaygroundRoutes = new Hono<AdminEnv>();

adminPlaygroundRoutes.use('*', requireMasterKey);

type PlaygroundPostBody = {
	routeId?: unknown;
	body?: unknown;
	geminiAction?: unknown;
	providerKeyId?: unknown;
};

adminPlaygroundRoutes.post('/', async (c) => {
	let parsed: PlaygroundPostBody;
	try {
		parsed = (await c.req.json()) as PlaygroundPostBody;
	} catch {
		return c.json({ success: false as const, message: 'Invalid JSON body' }, 400);
	}

	const routeId = typeof parsed.routeId === 'string' ? parsed.routeId : '';
	const rawBody = parsed.body;
	if (rawBody == null || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
		return c.json({ success: false as const, message: 'body must be a JSON object' }, 400);
	}

	let geminiAction: GeminiContentAction | undefined;
	if (parsed.geminiAction === 'generateContent' || parsed.geminiAction === 'streamGenerateContent') {
		geminiAction = parsed.geminiAction;
	} else if (parsed.geminiAction != null && parsed.geminiAction !== '') {
		return c.json(
			{ success: false as const, message: 'geminiAction must be generateContent or streamGenerateContent' },
			400
		);
	}

	try {
		const { response, upstreamUrlForHeader, latencyMs, upstreamWireBodyJson } =
			await invokePlaygroundUpstream(
				c.get('repositories'),
				{
					routeId,
					body: rawBody as Record<string, unknown>,
					geminiAction,
					providerKeyId: typeof parsed.providerKeyId === 'string' ? parsed.providerKeyId : undefined,
				},
				c.req.raw.signal
			);

		const headers = new Headers(response.headers);
		headers.set('x-playground-latency-ms', String(latencyMs));
		headers.set('x-playground-upstream-status', String(response.status));
		headers.set('x-playground-upstream-url', upstreamUrlForHeader);
		headers.set('x-playground-request-body', encodeURIComponent(upstreamWireBodyJson));

		return new Response(response.body, {
			status: response.status,
			statusText: response.statusText,
			headers,
		});
	} catch (error) {
		return handleAdminRouteError(c, error, 'Playground invoke failed');
	}
});
