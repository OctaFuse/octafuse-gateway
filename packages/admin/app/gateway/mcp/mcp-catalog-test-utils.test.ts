import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	buildMcpCatalogRequest,
	groupMcpCatalog,
	mcpProxyBaseUrl,
	mcpRequestCurl,
	normalizeMcpApiKey,
	parseMcpCatalogResponse,
	redactMcpRequest,
	type McpCatalogMethod,
} from './mcp-catalog-test-utils';

const request = (method: McpCatalogMethod = 'tools/list', slug = '') =>
	buildMcpCatalogRequest({
		baseUrl: 'http://localhost:8787',
		slug,
		method,
		protocolVersion: '2025-06-18',
		apiKey: 'secret-example',
		id: 7,
	});
const envelope = (result: unknown, id: unknown = 7) => JSON.stringify({ jsonrpc: '2.0', id, result });

test('base URL preserves deployment prefixes and rejects endpoint/credential URLs', () => {
	assert.equal(mcpProxyBaseUrl(' https://gateway.example.com/proxy/ '), 'https://gateway.example.com/proxy');
	assert.equal(mcpProxyBaseUrl('http://[::1]:8787/'), 'http://[::1]:8787');
	for (const value of [
		'',
		'not-url',
		'ftp://example.com',
		'https://user:secret@example.com',
		'https://example.com?token=x',
		'https://example.com/#x',
		'https://example.com/mcp',
		'https://example.com/mcp/context7/',
	])
		assert.equal(mcpProxyBaseUrl(value), null);
});

test('both MCP scopes send a JSON-RPC request with the required transport headers', () => {
	assert.equal(request().url, 'http://localhost:8787/mcp');
	const scoped = request('prompts/list', 'context7');
	assert.equal(scoped.url, 'http://localhost:8787/mcp/context7');
	assert.equal(scoped.headers.Accept, 'application/json, text/event-stream');
	assert.equal(scoped.headers['MCP-Protocol-Version'], '2025-06-18');
	assert.deepEqual(JSON.parse(scoped.bodyText), {
		jsonrpc: '2.0',
		id: 7,
		method: 'prompts/list',
		params: {},
	});
	assert.equal(normalizeMcpApiKey('  Bearer secret-example  '), 'secret-example');
});

test('initialize requests negotiate protocol and report client capabilities', () => {
	const body = JSON.parse(request('initialize').bodyText);
	assert.equal(body.params.protocolVersion, '2025-06-18');
	assert.deepEqual(body.params.capabilities, {});
	assert.equal(body.params.clientInfo.name, 'octafuse-admin-catalog-test');
});

test('previews and copied cURL never expose the real key, and shell values are quoted', () => {
	const original = request();
	const safe = redactMcpRequest(original);
	assert.equal(safe.headers.Authorization, 'Bearer ***');
	assert.equal(original.headers.Authorization, 'Bearer secret-example');
	const curl = mcpRequestCurl({ ...original, url: "https://example.com/a'b/mcp" });
	assert.ok(!curl.includes('secret-example'));
	assert.ok(curl.includes('Bearer <YOUR_API_KEY>'));
	assert.ok(curl.includes("'https://example.com/a'\\''b/mcp'"));
	assert.ok(curl.includes(' \\\n'));
});

test('empty directory is a successful list, missing list is invalid', () => {
	assert.deepEqual(parseMcpCatalogResponse(envelope({ tools: [] }), request()).entries, []);
	assert.equal(parseMcpCatalogResponse(envelope({}), request()).valid, false);
	assert.equal(parseMcpCatalogResponse(envelope({ tools: {} }), request()).valid, false);
	assert.equal(parseMcpCatalogResponse(envelope({ tools: [null] }), request()).valid, false);
	assert.equal(parseMcpCatalogResponse(envelope({ tools: [{ name: 1 }] }), request()).valid, false);
});

test('incorrect IDs, non-JSON bodies and non-MCP envelopes are kept out of grouping', () => {
	for (const body of [
		'<html>Not found</html>',
		'{',
		envelope({ tools: [] }, 8),
		JSON.stringify({ success: true, data: [] }),
	]) {
		const result = parseMcpCatalogResponse(body, request());
		assert.equal(result.valid, false);
		assert.equal(result.entries, null);
	}
});

test('JSON-RPC errors retain their messages and raw structure', () => {
	const json = { jsonrpc: '2.0', id: 7, error: { code: -32601, message: 'Unknown method' } };
	const result = parseMcpCatalogResponse(JSON.stringify(json), request());
	assert.equal(result.valid, false);
	assert.equal(result.rpcError, 'Unknown method');
	assert.deepEqual(result.json, json);
});

test('each directory validates its own identity and initialize validates capabilities', () => {
	assert.equal(
		parseMcpCatalogResponse(envelope({ prompts: [{ name: 'mock__help' }] }), request('prompts/list')).valid,
		true
	);
	assert.equal(
		parseMcpCatalogResponse(
			envelope({ resources: [{ uri: 'octafuse://mock/a' }] }),
			request('resources/list')
		).valid,
		true
	);
	assert.equal(
		parseMcpCatalogResponse(envelope({ resources: [{ name: 'a' }] }), request('resources/list')).valid,
		false
	);
	assert.equal(
		parseMcpCatalogResponse(
			envelope({
				protocolVersion: '2025-06-18',
				capabilities: {},
				serverInfo: { name: 'OctaFuse', version: '2' },
			}),
			request('initialize')
		).valid,
		true
	);
	assert.equal(
		parseMcpCatalogResponse(envelope({ protocolVersion: '2025-06-18' }), request('initialize')).valid,
		false
	);
});

test('tools and prompts group by full service slug, preserving names and billing metadata', () => {
	const entries = [
		{ name: 'my-service__get__docs', _meta: { octafuse: { metered: true } } },
		{ name: 'context7__search' },
		{ name: 'my-service__search' },
	];
	const groups = groupMcpCatalog(entries, 'tools/list');
	assert.deepEqual(
		groups.map((g) => [g.slug, g.entries.length]),
		[
			['my-service', 2],
			['context7', 1],
		]
	);
	assert.equal(groups[0].entries[0], entries[0]);
	assert.equal(groupMcpCatalog(entries, 'prompts/list')[0].slug, 'my-service');
});

test('resources group using octafuse URI hosts without decoding or altering the resource URI', () => {
	const uri = 'octafuse://my-service/https%3A%2F%2Fexample.com%2F%E4%B8%AD%E6%96%87';
	const entries = [
		{ name: 'manual', uri },
		{ name: 'readme', uri: 'octafuse://context7/readme' },
	];
	const groups = groupMcpCatalog(entries, 'resources/list');
	assert.deepEqual(
		groups.map((g) => g.slug),
		['my-service', 'context7']
	);
	assert.equal(groups[0].entries[0].uri, uri);
});

test('unknown entries remain visible and only fall back to scope for single-service requests', () => {
	const entries = [{ name: 'unprefixed' }, { name: 'UPPER__name' }];
	assert.equal(groupMcpCatalog(entries, 'tools/list')[0].slug, null);
	assert.equal(groupMcpCatalog(entries, 'tools/list', 'mock')[0].slug, 'mock');
	assert.deepEqual(groupMcpCatalog([], 'tools/list'), []);
	assert.equal(groupMcpCatalog([{ uri: 'https://mock.example.com/readme' }], 'resources/list')[0].slug, null);
});
