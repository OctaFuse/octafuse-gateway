/**
 * 管理 API：`/api/admin/*` → 内部重写为 `/admin/*` 后交给 Hono（与 Gateway Worker 原路径一致）。
 * - 浏览器：持久化 Session Cookie → console principal。
 * - 外部：具名 Bearer Admin API Key → api_key principal。
 */
import { authenticateAdminRequest } from '@/lib/auth';
import type { AdminBindings } from '@/lib/admin-env';
import { getAdminApp } from '@/lib/admin-app';
import { handleGatewayApiError } from '@/lib/api-error';
import { resolveAdminRequestRuntime } from '@/lib/admin-request-runtime';
import { isSameOriginBrowserWrite, rewriteToInternalAdminPath } from '@/lib/admin-request-rewrite';
import { getBearerKeyPrefix, logAdminAuthEvent } from '@/lib/security-log';

export const dynamic = 'force-dynamic';

async function handle(request: Request): Promise<Response> {
	try {
		const { bindings: runtimeBindings, storage, ctx } = await resolveAdminRequestRuntime(request);
		const { repositories } = storage;
		const principal = await authenticateAdminRequest(request, repositories);
		if (!principal) {
			logAdminAuthEvent('admin.auth.unauthorized', request, {
				keyPrefix: getBearerKeyPrefix(request),
				method: request.method,
				path: new URL(request.url).pathname,
			});
			return Response.json({ success: false, message: 'Unauthorized' }, { status: 401 });
		}

		const internalReq = rewriteToInternalAdminPath(request);
		const app = getAdminApp();
		const appBindings: AdminBindings = {
			...runtimeBindings,
			STORAGE_CONTEXT: storage,
			ADMIN_PRINCIPAL: principal,
			ADMIN_CSRF_SAME_ORIGIN: isSameOriginBrowserWrite(request),
		};
		if (ctx) {
			return app.fetch(internalReq, appBindings, ctx);
		}
		return app.fetch(internalReq, appBindings);
	} catch (error) {
		return handleGatewayApiError({ route: 'admin.catch-all', error });
	}
}

export const GET = (request: Request) => handle(request);
export const POST = (request: Request) => handle(request);
export const PUT = (request: Request) => handle(request);
export const PATCH = (request: Request) => handle(request);
export const DELETE = (request: Request) => handle(request);
export const OPTIONS = (request: Request) => handle(request);
