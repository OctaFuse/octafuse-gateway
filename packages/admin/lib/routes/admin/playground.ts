/**
 * 管理路由：`/admin/playground` — 管理员试调用。
 * - routeId 分支：直连单条 model_routes 上游（不计费、不写 logs、无 failover）
 * - toolId 分支：读 system_config catalog 直连工具引擎（可测非 Active；不计费、不写 logs）
 */
import { Hono } from 'hono';
import type { AdminEnv } from '@/lib/admin-env';
import { requireMasterKey } from '@/lib/middleware/admin-auth';
import type { GeminiContentAction } from '@octafuse/core/gemini-upstream-url';
import type { ImageOperation } from '@/lib/image-generations';
import { invokePlaygroundUpstream } from '@/lib/services/admin/playground-service';
import { invokePlaygroundTool } from '@/lib/services/admin/playground-tools-service';
import {
	dispatchPlaygroundDashScopeRealtime,
	PLAYGROUND_DASHSCOPE_REALTIME_OPERATIONS,
} from '@/lib/services/admin/playground-realtime-service';
import { handleAdminRouteError } from './error-response';

export const adminPlaygroundRoutes = new Hono<AdminEnv>();

adminPlaygroundRoutes.use('*', requireMasterKey);

adminPlaygroundRoutes.get('/realtime', async (c) => {
	if (c.req.header('Upgrade')?.toLowerCase() !== 'websocket') {
		return c.json({ success: false as const, message: 'Expected a WebSocket upgrade request' }, 426);
	}
	const routeId = c.req.query('routeId')?.trim() ?? '';
	const operation = c.req.query('operation')?.trim() ?? '';
	if (!routeId) return c.json({ success: false as const, message: 'routeId is required' }, 400);
	if (!(PLAYGROUND_DASHSCOPE_REALTIME_OPERATIONS as readonly string[]).includes(operation)) {
		return c.json({ success: false as const, message: `Unsupported realtime operation: ${operation || '(empty)'}` }, 400);
	}
	try {
		const result = await dispatchPlaygroundDashScopeRealtime(
			c.get('repositories'),
			{ routeId, operation },
			c.req.raw.signal
		);
		const headers = new Headers(result.response.headers);
		headers.set('x-playground-upstream-url', result.upstreamUrl);
		headers.set('x-playground-mode', 'realtime');
		return new Response(result.response.body, {
			status: result.response.status,
			statusText: result.response.statusText,
			headers,
			webSocket: result.response.webSocket,
		});
	} catch (error) {
		return handleAdminRouteError(c, error, 'Playground realtime invoke failed');
	}
});

type PlaygroundPostBody = {
	routeId?: unknown;
	toolId?: unknown;
	provider?: unknown;
	body?: unknown;
	geminiAction?: unknown;
	imageOperation?: unknown;
};

adminPlaygroundRoutes.post('/', async (c) => {
	let parsed: PlaygroundPostBody;
	try {
		parsed = (await c.req.json()) as PlaygroundPostBody;
	} catch {
		return c.json({ success: false as const, message: 'Invalid JSON body' }, 400);
	}

	const rawBody = parsed.body;
	if (rawBody == null || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
		return c.json({ success: false as const, message: 'body must be a JSON object' }, 400);
	}

	const toolId = typeof parsed.toolId === 'string' ? parsed.toolId.trim() : '';
	const routeId = typeof parsed.routeId === 'string' ? parsed.routeId.trim() : '';

	if (toolId && routeId) {
		return c.json(
			{ success: false as const, message: 'Provide either routeId or toolId, not both' },
			400
		);
	}

	if (toolId) {
		const provider = typeof parsed.provider === 'string' ? parsed.provider : '';
		try {
			const { response, upstreamUrlForHeader, latencyMs, upstreamWireBodyJson } =
				await invokePlaygroundTool(
					c.get('repositories'),
					{
						toolId,
						provider,
						body: rawBody as Record<string, unknown>,
					},
					c.req.raw.signal
				);

			const headers = new Headers(response.headers);
			headers.set('x-playground-latency-ms', String(latencyMs));
			headers.set('x-playground-upstream-status', String(response.status));
			headers.set('x-playground-upstream-url', upstreamUrlForHeader);
			headers.set('x-playground-request-body', encodeURIComponent(upstreamWireBodyJson));
			headers.set('x-playground-mode', 'tool');

			return new Response(response.body, {
				status: response.status,
				statusText: response.statusText,
				headers,
			});
		} catch (error) {
			return handleAdminRouteError(c, error, 'Playground tool invoke failed');
		}
	}

	if (!routeId) {
		return c.json(
			{ success: false as const, message: 'routeId or toolId is required' },
			400
		);
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

	let imageOperation: ImageOperation | undefined;
	if (parsed.imageOperation === 'generations' || parsed.imageOperation === 'edits') {
		imageOperation = parsed.imageOperation;
	} else if (parsed.imageOperation != null && parsed.imageOperation !== '') {
		return c.json(
			{ success: false as const, message: 'imageOperation must be generations or edits' },
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
					imageOperation,
				},
				c.req.raw.signal
			);

		const headers = new Headers(response.headers);
		headers.set('x-playground-latency-ms', String(latencyMs));
		headers.set('x-playground-upstream-status', String(response.status));
		headers.set('x-playground-upstream-url', upstreamUrlForHeader);
		headers.set('x-playground-request-body', encodeURIComponent(upstreamWireBodyJson));
		headers.set('x-playground-mode', 'route');

		return new Response(response.body, {
			status: response.status,
			statusText: response.statusText,
			headers,
		});
	} catch (error) {
		return handleAdminRouteError(c, error, 'Playground invoke failed');
	}
});
