/**
 * Admin Worker 的原生 WebSocket 入口。
 * OpenNext 的 Next Server Function 只转发 HTTP 状态和 body，会丢失 Response.webSocket，
 * 因此实时调试请求必须在最外层 Worker 中直接交给 Hono。
 */
import { authenticateAdminRequest } from './auth';
import { handleGatewayApiError } from './api-error';
import type { AdminBindings } from './admin-env';
import { getAdminApp } from './admin-app';
import { isSameOriginBrowserWrite, rewriteToInternalAdminPath } from './admin-request-rewrite';
import { resolveAdminStorageContext } from './storage-context';

/** 处理调试台原生 DashScope WebSocket，保留 Cloudflare 的 `webSocket` 响应对象。 */
export async function handleAdminRealtimeUpgrade(
	request: Request,
	env: CloudflareEnv,
	ctx: ExecutionContext,
): Promise<Response> {
	try {
		const runtimeBindings: AdminBindings = {
			DB: env.DB,
			ASSETS: env.ASSETS,
		};
		const storage = await resolveAdminStorageContext(runtimeBindings, 'cloudflare');
		const principal = await authenticateAdminRequest(request, storage.repositories);
		if (!principal) return Response.json({ success: false, message: 'Unauthorized' }, { status: 401 });

		const appBindings: AdminBindings = {
			...runtimeBindings,
			STORAGE_CONTEXT: storage,
			ADMIN_PRINCIPAL: principal,
			ADMIN_CSRF_SAME_ORIGIN: isSameOriginBrowserWrite(request),
		};
		return getAdminApp().fetch(rewriteToInternalAdminPath(request), appBindings, ctx);
	} catch (error) {
		return handleGatewayApiError({ route: 'admin.realtime.worker', error });
	}
}
