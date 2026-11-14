/** Shared, public Proxy address. Never put credentials or scoped API paths in this value. */
export const PROXY_BASE_URL_STORAGE = 'octafuse.proxy.baseUrl';
export const LEGACY_PROXY_URL_STORAGE = [
	'octafuse.tools.proxyBaseUrl',
	'octafuse.simulator.proxyBaseUrl',
	'octafuse.mcp.catalog.proxyBaseUrl',
] as const;
export const PROXY_BASE_URL_CHANGED = 'octafuse-proxy-url-changed';
export type ProxyUrlSource = 'browser' | 'deployment' | 'local' | 'unset';

export function normalizeProxyBaseUrl(raw: string): string | null {
	try {
		const url = new URL(raw.trim());
		if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
			return null;
		if (/\/(?:v1(?:\/.*)?|mcp(?:\/[^/]+)?)\/?$/.test(url.pathname)) return null;
		return url.toString().replace(/\/+$/, '');
	} catch {
		return null;
	}
}

export function resolveProxyBaseUrl(input: { override?: string; deployment?: string; origin?: string }): {
	url: string;
	source: ProxyUrlSource;
} {
	const override = normalizeProxyBaseUrl(input.override ?? '');
	if (override) return { url: override, source: 'browser' };
	const deployment = normalizeProxyBaseUrl(input.deployment ?? '');
	if (deployment) return { url: deployment, source: 'deployment' };
	try {
		const local = new URL(input.origin ?? '');
		if (['http:', 'https:'].includes(local.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(local.hostname)) {
			local.port = '8787';
			return { url: local.origin, source: 'local' };
		}
	} catch {
		/* Production deployments must explicitly supply their public Proxy URL. */
	}
	return { url: '', source: 'unset' };
}

export function readProxyUrlOverride(storage: Pick<Storage, 'getItem'>): string {
	for (const key of [PROXY_BASE_URL_STORAGE, ...LEGACY_PROXY_URL_STORAGE]) {
		const normalized = normalizeProxyBaseUrl(storage.getItem(key) ?? '');
		if (normalized) return normalized;
	}
	return '';
}
