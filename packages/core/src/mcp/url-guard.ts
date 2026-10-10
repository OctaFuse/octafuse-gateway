const BLOCKED_HOSTS = new Set(['metadata.google.internal', 'metadata.google.com']);

function isLocalHost(hostname: string): boolean {
	const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
	return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

/** https everywhere; http only for loopback, so local mock upstreams work in development. */
export function assertMcpUpstreamUrl(raw: string): URL {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		throw new Error('MCP upstream URL is invalid');
	}
	if (url.username || url.password) {
		throw new Error('Put MCP credentials in auth headers, not the URL userinfo');
	}
	const host = url.hostname.toLowerCase();
	if (BLOCKED_HOSTS.has(host)) {
		throw new Error('MCP upstream host is not allowed');
	}
	if (url.protocol === 'https:') {
		return url;
	}
	if (url.protocol === 'http:' && isLocalHost(host)) {
		return url;
	}
	throw new Error('MCP upstream URL must use https');
}
