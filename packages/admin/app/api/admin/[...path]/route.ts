/**
 * 管理 API：`/api/admin/*` → 内部重写为 `/admin/*` 后交给 Hono（与 Gateway Worker 原路径一致）。
 * - 浏览器：须带有效 `admin_session` Cookie，服务端注入 `Authorization: Bearer <MASTER_KEY>`。
 * - 外部（如 your-account-portal）：直接 `Authorization: Bearer`，须与存储中的 `system_config.MASTER_KEY` 一致。
 */
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { checkAuth } from '@/lib/auth';
import type { AdminBindings } from '@/lib/admin-env';
import { getAdminApp } from '@/lib/admin-app';
import { getCloudflareEnv } from '@/lib/cloudflare';
import { handleGatewayApiError } from '@/lib/api-error';
import { getMasterKey } from '@/lib/services/admin/master-key-service';
import { resolveAdminStorageContext } from '@/lib/storage-context';

export const dynamic = 'force-dynamic';

interface RequestWithCloudflare extends Request {
	ctx?: {
		cloudflare?: {
			env?: CloudflareEnv;
		};
	};
	env?: CloudflareEnv;
}

function rewriteToInternalAdminPath(request: Request): Request {
	const u = new URL(request.url);
	const prefix = '/api/admin';
	if (!u.pathname.startsWith(prefix)) {
		return request;
	}
	const rest = u.pathname.slice(prefix.length);
	u.pathname = '/admin' + (rest === '' ? '' : rest);
	return new Request(u.toString(), request);
}

function isCloudflareRuntime(
	request: Request,
	hasCloudflareContext: boolean,
	env?: CloudflareEnv
): boolean {
	if (hasCloudflareContext) {
		return true;
	}
	if (env?.DB || env?.ASSETS) {
		return true;
	}
	const reqWithCf = request as RequestWithCloudflare;
	if (reqWithCf.ctx?.cloudflare?.env || reqWithCf.env?.DB || reqWithCf.env?.ASSETS) {
		return true;
	}
	return false;
}

async function handle(request: Request): Promise<Response> {
	try {
		let env: CloudflareEnv | undefined;
		let ctx: ExecutionContext | undefined;
		let hasCloudflareContext = false;
		try {
			const cf = getCloudflareContext();
			env = cf.env as CloudflareEnv;
			ctx = cf.ctx;
			hasCloudflareContext = true;
		} catch {
			env = getCloudflareEnv(request);
		}

		const cloudflareRuntime = isCloudflareRuntime(request, hasCloudflareContext, env);
		if (cloudflareRuntime && !env?.DB) {
			return Response.json(
				{
					success: false,
					message:
						'Cloudflare runtime requires D1 binding `DB`. For Node/self-hosted deployment, run Admin with DATABASE_URL outside Cloudflare.',
				},
				{ status: 500 }
			);
		}

		const runtimeBindings: AdminBindings = {
			DB: env?.DB,
			ASSETS: env?.ASSETS,
			DATABASE_URL: cloudflareRuntime ? undefined : process.env.DATABASE_URL,
			DATABASE_DRIVER: cloudflareRuntime
				? (env as { DATABASE_DRIVER?: string } | undefined)?.DATABASE_DRIVER
				: process.env.DATABASE_DRIVER,
		};
		const storage = await resolveAdminStorageContext(
			runtimeBindings,
			cloudflareRuntime ? 'cloudflare' : 'node'
		);
		const { repositories } = storage;
		const masterKey = await getMasterKey(repositories);
		if (masterKey == null || masterKey === '') {
			return Response.json({ error: 'Server configuration error: MASTER_KEY not set' }, { status: 500 });
		}

		let outbound: Request;
		if (checkAuth(request)) {
			const h = new Headers(request.headers);
			h.set('Authorization', `Bearer ${masterKey}`);
			outbound = new Request(request.url, {
				method: request.method,
				headers: h,
				body: request.body,
				duplex: 'half',
			} as RequestInit);
		} else {
			const auth = request.headers.get('Authorization');
			const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
			if (!token || token !== masterKey) {
				return Response.json({ success: false, message: 'Unauthorized' }, { status: 401 });
			}
			outbound = request;
		}

		const internalReq = rewriteToInternalAdminPath(outbound);
		const app = getAdminApp();
		const appBindings: AdminBindings = {
			...runtimeBindings,
			STORAGE_CONTEXT: storage,
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
