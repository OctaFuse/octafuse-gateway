/**
 * In-process MCP upstream for tests. Speaks JSON-RPC over fetch and can
 * delay, fail a session once, paginate, or return an isError tool result.
 */
export type MockMcpTool = {
	name: string;
	description: string;
	inputSchema?: Record<string, unknown>;
};

export type MockMcpUpstreamOptions = {
	tools?: MockMcpTool[];
	prompts?: Array<{ name: string; description?: string }>;
	resources?: Array<{ uri: string; name?: string; description?: string }>;
	callText?: string;
	isError?: boolean;
	failSessionOnce?: boolean;
	delayMs?: number;
	pageSize?: number;
	statusCode?: number;
};

export function createMockMcpUpstream(options: MockMcpUpstreamOptions = {}) {
	const tools = options.tools ?? [{ name: 'echo', description: 'Echo', inputSchema: { type: 'object', properties: {} } }];
	const prompts = options.prompts ?? [];
	const resources = options.resources ?? [];
	const calls: Array<{ method: string; session: string | null; authorization: string | null }> = [];
	let failedSession = false;

	const fetchImpl: typeof fetch = async (_input, init) => {
		if (options.delayMs) {
			await new Promise((resolve) => setTimeout(resolve, options.delayMs));
		}
		const headers = new Headers(init?.headers);
		const session = headers.get('mcp-session-id');
		const body = JSON.parse(String(init?.body ?? '{}')) as { id?: number; method?: string; params?: Record<string, unknown> };
		calls.push({
			method: body.method ?? '',
			session,
			authorization: headers.get('authorization'),
		});
		if (options.failSessionOnce && session && !failedSession) {
			failedSession = true;
			return new Response('missing session', { status: 404 });
		}
		if (body.method === 'notifications/initialized') {
			return new Response(null, { status: 202 });
		}
		const id = body.id ?? null;
		if (body.method === 'initialize') {
			return json({
				jsonrpc: '2.0',
				id,
				result: { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'mock', version: '0' } },
			}, { 'mcp-session-id': 'sess-1' });
		}
		if (body.method === 'tools/list') {
			const cursor = typeof body.params?.cursor === 'string' ? body.params.cursor : '';
			const pageSize = options.pageSize ?? tools.length;
			const start = cursor ? Number(cursor) : 0;
			const slice = tools.slice(start, start + pageSize);
			const next = start + pageSize < tools.length ? String(start + pageSize) : undefined;
			return json({ jsonrpc: '2.0', id, result: { tools: slice, ...(next ? { nextCursor: next } : {}) } });
		}
		if (body.method === 'prompts/list') {
			if (prompts.length === 0 && options.prompts === undefined) {
				return json({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } });
			}
			return json({ jsonrpc: '2.0', id, result: { prompts } });
		}
		if (body.method === 'resources/list') {
			return json({ jsonrpc: '2.0', id, result: { resources } });
		}
		if (body.method === 'tools/call') {
			return json({
				jsonrpc: '2.0',
				id,
				result: {
					content: [{ type: 'text', text: options.callText ?? 'ok' }],
					isError: options.isError === true,
				},
			}, undefined, options.statusCode);
		}
		return json({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } });
	};

	return { fetchImpl, calls };
}

function json(body: unknown, extra?: Record<string, string>, status = 200): Response {
	const headers = new Headers({ 'content-type': 'application/json' });
	for (const [key, value] of Object.entries(extra ?? {})) {
		headers.set(key, value);
	}
	return new Response(JSON.stringify(body), { status, headers });
}
