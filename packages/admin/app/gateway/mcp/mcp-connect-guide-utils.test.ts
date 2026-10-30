import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	MCP_KEY_PLACEHOLDER,
	buildMcpConnectSnippets,
	buildMcpOAuthSnippets,
	mcpConnectEndpoint,
	mcpConnectServerName,
} from './mcp-connect-guide-utils';

const base = 'https://gateway.example.com';

test('endpoint is /mcp for all services and /mcp/{slug} for a scoped one', () => {
	assert.equal(mcpConnectEndpoint(base, ''), `${base}/mcp`);
	assert.equal(mcpConnectEndpoint(base, 'exa'), `${base}/mcp/exa`);
	assert.equal(mcpConnectServerName(''), 'octafuse');
	assert.equal(mcpConnectServerName('exa'), 'octafuse-exa');
});

test('every sample targets the endpoint and only carries the key placeholder', () => {
	for (const slug of ['', 'exa']) {
		const snippets = buildMcpConnectSnippets({ baseUrl: base, slug });
		assert.equal(snippets.length, 5);
		for (const snippet of snippets) {
			assert.ok(snippet.code.includes(mcpConnectEndpoint(base, slug)), snippet.client);
			assert.ok(snippet.code.includes(MCP_KEY_PLACEHOLDER), snippet.client);
		}
	}
});

test('JSON samples are valid and use each client schema', () => {
	const byClient = Object.fromEntries(
		buildMcpConnectSnippets({ baseUrl: base, slug: 'exa' }).map((s) => [s.client, s])
	);
	const cursor = JSON.parse(byClient.cursor.code);
	assert.equal(cursor.mcpServers['octafuse-exa'].url, `${base}/mcp/exa`);
	assert.equal(cursor.mcpServers['octafuse-exa'].headers.Authorization, `Bearer ${MCP_KEY_PLACEHOLDER}`);
	const vscode = JSON.parse(byClient.vscode.code);
	assert.equal(vscode.servers['octafuse-exa'].type, 'http');
	assert.match(byClient['claude-code'].code, /^claude mcp add --transport http octafuse-exa /);
	assert.match(byClient.codex.code, /\[mcp_servers\.octafuse-exa\]/);
});

test('OAuth samples target the endpoint and never carry a key or auth header', () => {
	for (const slug of ['', 'exa']) {
		const snippets = buildMcpOAuthSnippets({ baseUrl: base, slug });
		assert.deepEqual(
			snippets.map((s) => s.client),
			['chatgpt', 'cursor', 'vscode', 'claude-code', 'codex', 'curl']
		);
		for (const snippet of snippets) {
			assert.ok(snippet.code.includes(mcpConnectEndpoint(base, slug)), snippet.client);
			assert.ok(!snippet.code.includes(MCP_KEY_PLACEHOLDER), snippet.client);
			assert.ok(!/authorization|bearer|bearer_token_env_var/i.test(snippet.code), snippet.client);
		}
	}
});

test('OAuth samples keep each client schema and point at the sign-in step', () => {
	const byClient = Object.fromEntries(
		buildMcpOAuthSnippets({ baseUrl: base, slug: 'exa' }).map((s) => [s.client, s])
	);
	assert.equal(byClient.chatgpt.code, `${base}/mcp/exa`);
	assert.deepEqual(JSON.parse(byClient.cursor.code), { mcpServers: { 'octafuse-exa': { url: `${base}/mcp/exa` } } });
	assert.deepEqual(JSON.parse(byClient.vscode.code), {
		servers: { 'octafuse-exa': { type: 'http', url: `${base}/mcp/exa` } },
	});
	assert.match(byClient['claude-code'].code, /^claude mcp add --transport http octafuse-exa /);
	assert.match(byClient.codex.code, /# codex mcp login octafuse-exa$/);
	assert.match(byClient.curl.code, /^curl -i -X POST /);
});
