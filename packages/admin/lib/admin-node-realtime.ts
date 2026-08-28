/**
 * Admin Node 的原生 WebSocket 入口。
 * Next App Router 无法完成 101 握手，因此实时调试请求必须在自定义 HTTP 入口拦截 Upgrade，
 * 鉴权后直接交给 Hono，并注入 Node `ws` dispatch。
 */
import type { IncomingMessage } from 'node:http';
import { authenticateAdminRequest } from './auth';
import { handleGatewayApiError } from './api-error';
import type { AdminBindings } from './admin-env';
import { getAdminApp } from './admin-app';
import { resolveAdminStorageContext } from './storage-context';
import {
	createPlaygroundNodeRealtimeDispatch,
	type NodeWebSocket,
} from './playground-node-realtime';

function rewriteToInternalAdminPath(request: Request): Request {
	const url = new URL(request.url);
	const prefix = '/api/admin';
	url.pathname = '/admin' + url.pathname.slice(prefix.length);
	return new Request(url, request);
}

export function incomingMessageToFetchRequest(request: IncomingMessage): Request {
	const protocol = (request.socket as { encrypted?: boolean }).encrypted ? 'https' : 'http';
	const url = `${protocol}://${request.headers.host ?? '127.0.0.1'}${request.url ?? '/'}`;
	const headers = new Headers();
	for (const [key, value] of Object.entries(request.headers)) {
		if (typeof value === 'string') headers.set(key, value);
		else if (Array.isArray(value)) headers.set(key, value.join(', '));
	}
	if (!headers.has('upgrade')) headers.set('upgrade', 'websocket');
	return new Request(url, { method: 'GET', headers });
}

/** 处理调试台 Node 实时 WebSocket：管理员会话鉴权后注入 `ws` 上游桥。 */
export async function handleAdminNodeRealtimeUpgrade(
	request: Request,
	client: NodeWebSocket,
): Promise<Response> {
	try {
		const storage = await resolveAdminStorageContext(
			{
				DATABASE_URL: process.env.DATABASE_URL,
				DATABASE_DRIVER: process.env.DATABASE_DRIVER,
			},
			'node',
		);
		const principal = await authenticateAdminRequest(request, storage.repositories);
		if (!principal) return Response.json({ success: false, message: 'Unauthorized' }, { status: 401 });

		const appBindings: AdminBindings = {
			STORAGE_CONTEXT: storage,
			ADMIN_PRINCIPAL: principal,
			NODE_PLAYGROUND_REALTIME_DISPATCH: createPlaygroundNodeRealtimeDispatch(client),
		};
		return getAdminApp().fetch(rewriteToInternalAdminPath(request), appBindings);
	} catch (error) {
		return handleGatewayApiError({ route: 'admin.realtime.node', error });
	}
}
