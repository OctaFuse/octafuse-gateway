/** Read-only MCP requests and presentation of the actual Proxy response. */
export const MCP_CATALOG_METHODS = ['tools/list', 'prompts/list', 'resources/list', 'initialize'] as const;
export type McpCatalogMethod = (typeof MCP_CATALOG_METHODS)[number];
export const MCP_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26'] as const;
export const MCP_CATALOG_PROXY_STORAGE = 'octafuse.mcp.catalog.proxyBaseUrl';
export const SIMULATOR_PROXY_STORAGE = 'octafuse.simulator.proxyBaseUrl';

type JsonObject = Record<string, unknown>;
export type McpCatalogEntry = JsonObject;
export type McpCatalogGroup = { slug: string | null; entries: McpCatalogEntry[] };
export type McpCatalogRequest = {
	url: string;
	method: 'POST';
	rpcMethod: McpCatalogMethod;
	slug: string;
	id: number;
	headers: Record<string, string>;
	bodyText: string;
};

export function mcpProxyBaseUrl(raw: string): string | null {
	try {
		if (!raw.trim()) return null;
		const url = new URL(raw.trim());
		if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
			return null;
		// The field accepts the Proxy base URL, not an already scoped MCP endpoint.
		if (/\/mcp(?:\/[^/]+)?\/?$/.test(url.pathname)) return null;
		return url.toString().replace(/\/+$/, '');
	} catch {
		return null;
	}
}

export function normalizeMcpApiKey(raw: string): string {
	return raw
		.trim()
		.replace(/^Bearer\s+/i, '')
		.trim();
}

export function buildMcpCatalogRequest(input: {
	baseUrl: string;
	slug: string;
	method: McpCatalogMethod;
	protocolVersion: string;
	apiKey: string;
	id: number;
}): McpCatalogRequest {
	const body = {
		jsonrpc: '2.0',
		id: input.id,
		method: input.method,
		params:
			input.method === 'initialize'
				? {
						protocolVersion: input.protocolVersion,
						capabilities: {},
						clientInfo: { name: 'octafuse-admin-catalog-test', version: '1.0.0' },
				  }
				: {},
	};
	return {
		url: `${input.baseUrl}/mcp${input.slug ? `/${encodeURIComponent(input.slug)}` : ''}`,
		method: 'POST',
		rpcMethod: input.method,
		slug: input.slug,
		id: input.id,
		headers: {
			'Content-Type': 'application/json',
			Accept: 'application/json, text/event-stream',
			Authorization: `Bearer ${normalizeMcpApiKey(input.apiKey)}`,
			'MCP-Protocol-Version': input.protocolVersion,
		},
		bodyText: JSON.stringify(body, null, 2),
	};
}

export function redactMcpRequest(request: McpCatalogRequest): McpCatalogRequest {
	return { ...request, headers: { ...request.headers, Authorization: 'Bearer ***' } };
}

function object(value: unknown): JsonObject | null {
	return value != null && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : null;
}

export function parseMcpCatalogResponse(
	raw: string,
	request: Pick<McpCatalogRequest, 'id' | 'rpcMethod'>
): {
	json: unknown;
	entries: McpCatalogEntry[] | null;
	rpcError: string | null;
	valid: boolean;
} {
	let json: unknown;
	try {
		json = JSON.parse(raw);
	} catch {
		return { json: null, entries: null, rpcError: null, valid: false };
	}
	const envelope = object(json);
	if (!envelope || envelope.jsonrpc !== '2.0' || envelope.id !== request.id)
		return { json, entries: null, rpcError: null, valid: false };
	const error = object(envelope.error);
	if (error)
		return {
			json,
			entries: null,
			rpcError: typeof error.message === 'string' ? error.message : JSON.stringify(error),
			valid: false,
		};
	const result = object(envelope.result);
	if (!result) return { json, entries: null, rpcError: null, valid: false };
	if (request.rpcMethod === 'initialize') {
		return {
			json,
			entries: null,
			rpcError: null,
			valid:
				typeof result.protocolVersion === 'string' &&
				object(result.capabilities) != null &&
				object(result.serverInfo) != null,
		};
	}
	const field =
		request.rpcMethod === 'tools/list'
			? 'tools'
			: request.rpcMethod === 'prompts/list'
			? 'prompts'
			: 'resources';
	const entries = result[field];
	const identity = field === 'resources' ? 'uri' : 'name';
	if (
		!Array.isArray(entries) ||
		entries.some((entry) => !object(entry) || typeof entry[identity] !== 'string')
	)
		return { json, entries: null, rpcError: null, valid: false };
	return { json, entries, rpcError: null, valid: true };
}

export function mcpEntrySlug(entry: McpCatalogEntry, method: McpCatalogMethod): string | null {
	if (method === 'resources/list') {
		try {
			const uri = new URL(String(entry.uri));
			return uri.protocol === 'octafuse:' && /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(uri.hostname)
				? uri.hostname
				: null;
		} catch {
			return null;
		}
	}
	const match =
		typeof entry.name === 'string' ? /^([a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?)__/.exec(entry.name) : null;
	return match?.[1] ?? null;
}

export function groupMcpCatalog(
	entries: McpCatalogEntry[],
	method: McpCatalogMethod,
	fallbackSlug = ''
): McpCatalogGroup[] {
	const groups = new Map<string | null, McpCatalogEntry[]>();
	for (const entry of entries) {
		const slug = mcpEntrySlug(entry, method) ?? (fallbackSlug || null);
		const group = groups.get(slug) ?? [];
		group.push(entry);
		groups.set(slug, group);
	}
	return Array.from(groups, ([slug, entries]) => ({ slug, entries }));
}

export function mcpRequestCurl(request: McpCatalogRequest): string {
	const quote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;
	// Copied examples always use a replacement token, never an operator's live key.
	const safe = {
		...redactMcpRequest(request),
		headers: { ...request.headers, Authorization: 'Bearer <YOUR_API_KEY>' },
	};
	return [
		`curl -X POST ${quote(safe.url)}`,
		...Object.entries(safe.headers).map(([key, value]) => `  -H ${quote(`${key}: ${value}`)}`),
		`  --data-raw ${quote(safe.bodyText)}`,
	].join(' \\\n');
}
