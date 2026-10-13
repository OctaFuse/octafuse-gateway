import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_PRICING_DRAFT } from '../app/gateway/mcp/mcp-pricing-draft';
import { applyMcpImport, parseMcpClientConfig, slugFromMcpName } from './mcp-config-import';

const baseForm = {
	slug: '',
	name: '',
	description: 'keep me',
	url: '',
	headers: [{ key: '', value: '' }],
	pricing: { ...DEFAULT_PRICING_DRAFT, metered: '1', standard: '2', charged: '3' },
	timeoutMs: '30000',
	maxResponseBytes: '1048576',
};

describe('parseMcpClientConfig', () => {
	it('accepts a remote URL and keeps the query secret', () => {
		const parsed = parseMcpClientConfig('https://mcp.tavily.com/mcp/?tavilyApiKey=tvly-test');
		assert.equal(parsed.ok, true);
		if (!parsed.ok) return;
		assert.equal(parsed.servers[0]?.url, 'https://mcp.tavily.com/mcp/?tavilyApiKey=tvly-test');
		assert.deepEqual(parsed.servers[0]?.headers, []);
	});

	it('reads Cursor and VS Code server maps, including headers', () => {
		const cursor = parseMcpClientConfig(JSON.stringify({
			mcpServers: {
				'tavily-remote-mcp': {
					url: 'https://mcp.tavily.com/mcp/',
					headers: { Authorization: 'Bearer tvly-test' },
				},
			},
		}));
		assert.equal(cursor.ok, true);
		if (!cursor.ok) return;
		assert.equal(cursor.servers[0]?.slug, 'tavily-remote-mcp');
		assert.deepEqual(cursor.servers[0]?.headers, [{ key: 'Authorization', value: 'Bearer tvly-test' }]);

		const vscode = parseMcpClientConfig(JSON.stringify({
			servers: {
				deepwiki: { type: 'http', url: 'https://mcp.deepwiki.com/mcp' },
			},
		}));
		assert.equal(vscode.ok, true);
		if (!vscode.ok) return;
		assert.equal(vscode.servers[0]?.url, 'https://mcp.deepwiki.com/mcp');
		assert.equal(vscode.servers[0]?.name, 'deepwiki');
	});

	it('reads an OpenAI remote MCP object', () => {
		const parsed = parseMcpClientConfig(JSON.stringify({
			type: 'mcp',
			server_label: 'Tavily Remote',
			server_url: 'https://mcp.tavily.com/mcp/?tavilyApiKey=tvly-test',
			headers: { 'X-API-Key': 'tvly-test' },
		}));
		assert.equal(parsed.ok, true);
		if (!parsed.ok) return;
		assert.equal(parsed.servers[0]?.name, 'Tavily Remote');
		assert.equal(parsed.servers[0]?.slug, 'tavily-remote');
		assert.equal(parsed.servers[0]?.headers[0]?.key, 'X-API-Key');
	});

	it('extracts the URL from an mcp-remote command or args', () => {
		const command = parseMcpClientConfig(JSON.stringify({
			mcpServers: {
				tavily: {
					command: 'npx -y mcp-remote https://mcp.tavily.com/mcp/?tavilyApiKey=tvly-test',
					env: { TAVILY_API_KEY: 'do-not-copy' },
				},
			},
		}));
		assert.equal(command.ok, true);
		if (!command.ok) return;
		assert.equal(command.servers[0]?.url, 'https://mcp.tavily.com/mcp/?tavilyApiKey=tvly-test');
		assert.deepEqual(command.servers[0]?.headers, []);

		const args = parseMcpClientConfig(JSON.stringify({
			command: 'npx',
			args: ['-y', 'mcp-remote', 'https://mcp.context7.com/mcp'],
			env: { SECRET: 'do-not-copy' },
		}));
		assert.equal(args.ok, true);
		if (!args.ok) return;
		assert.equal(args.servers[0]?.url, 'https://mcp.context7.com/mcp');
		assert.equal(JSON.stringify(args).includes('do-not-copy'), false);
	});

	it('returns every importable server when a file contains several', () => {
		const parsed = parseMcpClientConfig(JSON.stringify({
			mcpServers: {
				deepwiki: { url: 'https://mcp.deepwiki.com/mcp' },
				context7: { url: 'https://mcp.context7.com/mcp' },
			},
		}));
		assert.equal(parsed.ok, true);
		if (!parsed.ok) return;
		assert.deepEqual(parsed.servers.map((server) => server.slug), ['deepwiki', 'context7']);
	});

	it('rejects local processes, legacy SSE, and OAuth without a URL', () => {
		const stdio = parseMcpClientConfig(JSON.stringify({
			command: 'npx',
			args: ['-y', 'tavily-mcp'],
			env: { TAVILY_API_KEY: 'do-not-copy' },
		}));
		assert.deepEqual(stdio, { ok: false, reason: 'stdio' });
		assert.equal(JSON.stringify(stdio).includes('do-not-copy'), false);

		const sse = parseMcpClientConfig(JSON.stringify({
			type: 'sse',
			url: 'https://example.com/sse',
		}));
		assert.deepEqual(sse, { ok: false, reason: 'sse' });

		const oauth = parseMcpClientConfig(JSON.stringify({ auth: { type: 'oauth' } }));
		assert.deepEqual(oauth, { ok: false, reason: 'oauth' });
	});

	it('rejects empty and unreadable input', () => {
		assert.deepEqual(parseMcpClientConfig('  '), { ok: false, reason: 'empty' });
		assert.deepEqual(parseMcpClientConfig('{'), { ok: false, reason: 'invalid' });
	});
});

describe('slugFromMcpName', () => {
	it('normalizes a display name and rejects the reserved slug', () => {
		assert.equal(slugFromMcpName('Tavily Remote MCP'), 'tavily-remote-mcp');
		assert.equal(slugFromMcpName('builtin'), '');
	});
});

describe('applyMcpImport', () => {
	it('fills the URL and headers without changing gateway prices or an existing slug', () => {
		const created = applyMcpImport(baseForm, {
			name: 'Tavily',
			slug: 'tavily',
			url: 'https://mcp.tavily.com/mcp/?tavilyApiKey=tvly-test',
			headers: [{ key: 'Authorization', value: 'Bearer tvly-test' }],
		}, 'create');
		assert.equal(created.slug, 'tavily');
		assert.equal(created.name, 'Tavily');
		assert.equal(created.url, 'https://mcp.tavily.com/mcp/?tavilyApiKey=tvly-test');
		assert.equal(created.pricing.metered, '1');
		assert.equal(created.timeoutMs, '30000');
		assert.equal(created.description, 'keep me');

		const edited = applyMcpImport({ ...baseForm, slug: 'kept', name: 'Kept' }, {
			name: 'Other',
			slug: 'other',
			url: 'https://mcp.deepwiki.com/mcp',
			headers: [],
		}, 'edit');
		assert.equal(edited.slug, 'kept');
		assert.equal(edited.name, 'Kept');
		assert.equal(edited.url, 'https://mcp.deepwiki.com/mcp');
		assert.deepEqual(edited.headers, [{ key: '', value: '' }]);
	});
});
