import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseMcpInvocationSummary, resolveInvocationSource } from './tool-invocation-detail';

describe('resolveInvocationSource', () => {
	it('classifies REST and MCP rows', () => {
		assert.equal(resolveInvocationSource({ provider_id: 'octafuse-tools', model_id: 'tool:web-search' }), 'rest');
		assert.equal(resolveInvocationSource({ provider_id: 'octafuse-mcp', model_id: 'mcp:deepwiki/ask' }), 'mcp');
		assert.equal(resolveInvocationSource({ model_id: 'mcp:mock/echo' }), 'mcp');
		assert.equal(resolveInvocationSource({ provider_id: 'openai', model_id: 'gpt-5' }), null);
	});
});

describe('parseMcpInvocationSummary', () => {
	it('reads the slug, tool name, and a short argument summary', () => {
		const summary = parseMcpInvocationSummary({
			model_id: 'mcp:deepwiki/read_wiki_structure',
			request_body: JSON.stringify({
				name: 'read_wiki_structure',
				arguments: { repoName: 'OctaFuse/octafuse-gateway', extra: { n: 1 } },
			}),
		});
		assert.equal(summary.slug, 'deepwiki');
		assert.equal(summary.tool, 'read_wiki_structure');
		assert.equal(summary.label, 'deepwiki / read_wiki_structure');
		assert.match(summary.argumentSummary ?? '', /repoName=OctaFuse\/octafuse-gateway/);
	});
});