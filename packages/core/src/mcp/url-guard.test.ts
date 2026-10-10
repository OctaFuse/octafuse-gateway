import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assertMcpUpstreamUrl } from './url-guard';
import { maskMcpUrl } from './secrets';

describe('mcp url guard', () => {
	it('allows https and loopback http', () => {
		assert.equal(assertMcpUpstreamUrl('https://mcp.deepwiki.com/mcp').protocol, 'https:');
		assert.equal(assertMcpUpstreamUrl('http://127.0.0.1:8787/mcp').hostname, '127.0.0.1');
		assert.equal(assertMcpUpstreamUrl('http://localhost:9/mcp').hostname, 'localhost');
	});

	it('rejects cleartext public hosts, userinfo, and metadata hosts', () => {
		assert.throws(() => assertMcpUpstreamUrl('http://example.com/mcp'));
		assert.throws(() => assertMcpUpstreamUrl('https://user:secret@example.com/mcp'));
		assert.throws(() => assertMcpUpstreamUrl('https://metadata.google.internal/mcp'));
	});

	it('masks query secrets', () => {
		assert.equal(maskMcpUrl('https://api.example.com/mcp?key=super-secret'), 'https://api.example.com/mcp?key=***');
	});
});
