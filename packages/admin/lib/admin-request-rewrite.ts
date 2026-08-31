/**
 * Next `/api/admin/*` → Hono `/admin/*`。
 * CSRF 必须在 rewrite 前对原始浏览器 Request 判定：部分运行时 clone 会丢掉 Origin，
 * 且 `request.url` 的 origin 可能是内部 loopback，与页面 Origin / Host 不一致。
 */

const ADMIN_API_PREFIX = '/api/admin';

function firstForwarded(value: string | null): string | undefined {
	const part = value?.split(',')[0]?.trim();
	return part || undefined;
}

/** 页面公网 origin：优先转发头，避免反代后 `request.url` 变成内部 host。 */
export function publicOriginOf(request: Request): string {
	const url = new URL(request.url);
	const forwardedHost = firstForwarded(request.headers.get('x-forwarded-host'));
	const forwardedProto = firstForwarded(request.headers.get('x-forwarded-proto'));
	const host = forwardedHost || request.headers.get('host') || url.host;
	const proto = (forwardedProto || url.protocol.replace(/:$/, '')).toLowerCase();
	return `${proto}://${host}`;
}

/** 浏览器写请求：必须带 Origin，且与公网 origin 一致。缺 Origin 视为跨站，拒绝。 */
export function isSameOriginBrowserWrite(request: Request): boolean {
	const originHeader = request.headers.get('origin');
	if (!originHeader) return false;
	try {
		return new URL(originHeader).origin === publicOriginOf(request);
	} catch {
		return false;
	}
}

/**
 * Console 写 `/admin/access-keys` 的 CSRF。
 * 入口应在 rewrite 前写入 `ADMIN_CSRF_SAME_ORIGIN`；未注入时回退当前 Request（Worker 直 fetch 仍可能带 Origin）。
 */
export function isAccessKeysMutationSameOrigin(request: Request, csrfSameOrigin?: boolean): boolean {
	if (typeof csrfSameOrigin === 'boolean') return csrfSameOrigin;
	return isSameOriginBrowserWrite(request);
}

export function rewriteToInternalAdminPath(request: Request): Request {
	const url = new URL(request.url);
	if (!url.pathname.startsWith(ADMIN_API_PREFIX)) {
		return request;
	}
	const rest = url.pathname.slice(ADMIN_API_PREFIX.length);
	url.pathname = '/admin' + (rest === '' ? '' : rest);
	return new Request(url.toString(), request);
}
