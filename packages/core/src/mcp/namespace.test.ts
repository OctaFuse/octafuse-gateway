import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assertMcpSlug, exposeMcpName, exposeResourceUri, parseExposedResourceUri } from './namespace';

describe('mcp namespace', () => {
	it('accepts a slug and rejects reserved or uppercase names', () => {
		assert.equal(assertMcpSlug('deep-wiki'), 'deep-wiki');
		assert.throws(() => assertMcpSlug('builtin'));
		assert.throws(() => assertMcpSlug('DeepWiki'));
	});

	it('prefixes tools and truncates long names with a stable hash', async () => {
		const used = new Set<string>();
		const shortName = await exposeMcpName('deepwiki', 'ask_question', used);
		assert.equal(shortName, 'deepwiki__ask_question');
		const longName = await exposeMcpName('deepwiki', 'a'.repeat(80), used);
		assert.equal(longName.length, 64);
		assert.match(longName, /^deepwiki__/);
		await assert.rejects(() => exposeMcpName('deepwiki', 'a'.repeat(80), new Set([longName])));
	});

	it('rewrites resource URIs and parses them back', () => {
		const exposed = exposeResourceUri('context7', 'docs://hono/middleware');
		assert.equal(exposed, `octafuse://context7/${encodeURIComponent('docs://hono/middleware')}`);
		assert.deepEqual(parseExposedResourceUri(exposed), { slug: 'context7', upstreamUri: 'docs://hono/middleware' });
	});
});
