import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	callMcpUpstreamTool,
	clearMcpUpstreamSession,
	syncMcpUpstream,
	type McpUpstreamTarget,
} from './upstream-client';

const target: McpUpstreamTarget = {
	serverId: `test-${Date.now()}`,
	url: 'https://mcp.example.com/mcp',
	authHeaders: { 'X-API-Key': 'secret-key' },
	timeoutMs: 1000,
	maxResponseBytes: 1024,
};

function jsonResponse(body: unknown, init?: { status?: number; session?: string; contentType?: string }): Response {
	const headers = new Headers({ 'content-type': init?.contentType ?? 'application/json' });
	if (init?.session) headers.set('mcp-session-id', init.session);
	return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: init?.status ?? 200, headers });
}

describe('mcp upstream client', () => {
	it('paginates tools, treats a missing prompts method as empty, and keeps the auth header', async () => {
		clearMcpUpstreamSession(target.serverId);
		const seen: string[] = [];
		const fetchImpl: typeof fetch = async (_input, init) => {
			const headers = new Headers(init?.headers);
			assert.equal(headers.get('x-api-key'), 'secret-key');
			assert.equal(headers.get('authorization'), null);
			const message = JSON.parse(String(init?.body)) as { id?: number; method?: string; params?: { cursor?: string } };
			seen.push(message.method ?? '');
			if (message.method === 'notifications/initialized') return new Response(null, { status: 202 });
			if (message.method === 'initialize') {
				return jsonResponse({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: '2025-06-18', serverInfo: { name: 'demo' } } }, { session: 'sess' });
			}
			if (message.method === 'tools/list' && !message.params?.cursor) {
				return jsonResponse({ jsonrpc: '2.0', id: message.id, result: { tools: [{ name: 'one', description: '1' }], nextCursor: '2' } });
			}
			if (message.method === 'tools/list') {
				return jsonResponse({ jsonrpc: '2.0', id: message.id, result: { tools: [{ name: 'two', description: '2' }] } });
			}
			if (message.method === 'prompts/list') {
				return jsonResponse({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found' } });
			}
			return jsonResponse({ jsonrpc: '2.0', id: message.id, result: { resources: [{ uri: 'file://a', name: 'a' }] } });
		};
		const catalog = await syncMcpUpstream(target, fetchImpl);
		assert.deepEqual(catalog.entries.map((entry) => entry.upstreamKey), ['one', 'two', 'file://a']);
		assert.ok(seen.includes('notifications/initialized'));
	});

	it('parses an SSE tool result and retries once after a stale session', async () => {
		const serverId = `${target.serverId}-sse`;
		clearMcpUpstreamSession(serverId);
		let calls = 0;
		const fetchImpl: typeof fetch = async (_input, init) => {
			const message = JSON.parse(String(init?.body)) as { id?: number; method?: string };
			const session = new Headers(init?.headers).get('mcp-session-id');
			if (message.method === 'notifications/initialized') return new Response(null, { status: 202 });
			if (message.method === 'initialize') {
				return jsonResponse({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: '2025-03-26', serverInfo: { name: 'sse' } } }, { session: 'sess-a' });
			}
			calls += 1;
			if (calls === 1) return jsonResponse('missing', { status: 404 });
			assert.equal(session, 'sess-a');
			const payload = JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: 'from-sse' }], isError: false } });
			return jsonResponse(`data: ${payload}\n\n`, { contentType: 'text/event-stream' });
		};
		const result = await callMcpUpstreamTool({ ...target, serverId }, 'ask', {}, fetchImpl);
		assert.equal((result.result.content as Array<{ text: string }>)[0]?.text, 'from-sse');
		assert.equal(calls, 2);
	});

	it('treats an empty 202 or a mismatched id as a failed tool call, not a success', async () => {
		const serverId = `${target.serverId}-noresult`;
		const makeFetch = (toolResponse: (id: number) => Response): typeof fetch => async (_input, init) => {
			const message = JSON.parse(String(init?.body)) as { id?: number; method?: string };
			if (message.method === 'notifications/initialized') return new Response(null, { status: 202 });
			if (message.method === 'initialize') {
				return jsonResponse({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: '2025-06-18', serverInfo: {} } });
			}
			return toolResponse(message.id as number);
		};
		clearMcpUpstreamSession(serverId);
		await assert.rejects(
			() => callMcpUpstreamTool({ ...target, serverId }, 'ask', {}, makeFetch(() => new Response(null, { status: 202 }))),
			/no tool result/i,
		);
		clearMcpUpstreamSession(serverId);
		await assert.rejects(
			() => callMcpUpstreamTool({ ...target, serverId }, 'ask', {}, makeFetch((id) => jsonResponse({ jsonrpc: '2.0', id: id + 1000, result: { content: [] } }))),
			/mismatched/i,
		);
	});

	it('rejects redirects and oversized bodies', async () => {
		const redirectTarget = { ...target, serverId: `${target.serverId}-redirect` };
		await assert.rejects(
			() => syncMcpUpstream(redirectTarget, async () => jsonResponse('', { status: 302 })),
			/redirect/i,
		);
		const hugeTarget = { ...target, serverId: `${target.serverId}-huge`, maxResponseBytes: 20 };
		await assert.rejects(
			() => syncMcpUpstream(hugeTarget, async () => jsonResponse({ jsonrpc: '2.0', id: 1, result: { padding: 'x'.repeat(100) } })),
			/too large/i,
		);
	});
});
