import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	parseAndNormalizeProviderCustomParams,
	resolveEffectiveCustomParams,
	serializeProviderCustomParams,
	validateAndNormalizeProviderCustomParams,
} from './provider-custom-params';

describe('validateAndNormalizeProviderCustomParams', () => {
	it('treats null/undefined/empty string as unconfigured', () => {
		assert.deepEqual(validateAndNormalizeProviderCustomParams(null), {});
		assert.deepEqual(validateAndNormalizeProviderCustomParams(undefined), {});
		assert.deepEqual(validateAndNormalizeProviderCustomParams(''), {});
		assert.deepEqual(validateAndNormalizeProviderCustomParams('  '), {});
		assert.deepEqual(validateAndNormalizeProviderCustomParams({}), {});
	});

	it('accepts a JSON string or an already-parsed object', () => {
		const expected = { openai: { body: { max_tokens: 4096 } } };
		assert.deepEqual(validateAndNormalizeProviderCustomParams(JSON.stringify(expected)), expected);
		assert.deepEqual(validateAndNormalizeProviderCustomParams(expected), expected);
	});

	it('rejects malformed JSON strings', () => {
		assert.throws(() => validateAndNormalizeProviderCustomParams('{not json'), /valid JSON/);
	});

	it('rejects a non-object top level value', () => {
		assert.throws(() => validateAndNormalizeProviderCustomParams([1, 2, 3]), /keyed by upstream protocol/);
	});

	it('rejects unknown protocol keys', () => {
		assert.throws(
			() => validateAndNormalizeProviderCustomParams({ openai_v2: { body: { a: 1 } } }),
			/unknown protocol key/
		);
	});

	it('rejects protected headers', () => {
		assert.throws(
			() =>
				validateAndNormalizeProviderCustomParams({
					openai: { headers: { Authorization: 'Bearer x' } },
				}),
			/protected header/
		);
	});

	it('rejects invalid header names', () => {
		assert.throws(
			() => validateAndNormalizeProviderCustomParams({ openai: { headers: { 'bad header': 'x' } } }),
			/invalid header name/
		);
	});

	it('drops empty protocol groups', () => {
		assert.deepEqual(validateAndNormalizeProviderCustomParams({ openai: {}, gemini: { headers: {} } }), {});
	});
});

describe('serializeProviderCustomParams / parseAndNormalizeProviderCustomParams', () => {
	it('serializes an empty map as null', () => {
		assert.equal(serializeProviderCustomParams({}), null);
		assert.equal(parseAndNormalizeProviderCustomParams(null), null);
		assert.equal(parseAndNormalizeProviderCustomParams(undefined), null);
		assert.equal(parseAndNormalizeProviderCustomParams({}), null);
	});

	it('round-trips a configured map', () => {
		const input = { openai: { headers: { 'X-Title': 'App' }, body: { max_tokens: 4096 } } };
		const serialized = parseAndNormalizeProviderCustomParams(input);
		assert.equal(typeof serialized, 'string');
		assert.deepEqual(JSON.parse(serialized as string), input);
	});

	it('rejects a payload serializing beyond the 32KB limit', () => {
		const hugeBody: Record<string, string> = {};
		for (let i = 0; i < 5000; i += 1) {
			hugeBody[`field_${i}`] = 'x'.repeat(20);
		}
		assert.throws(
			() => parseAndNormalizeProviderCustomParams({ openai: { body: hugeBody } }),
			/too large/
		);
	});
});

describe('resolveEffectiveCustomParams', () => {
	it('returns null when both sides are unconfigured (regression baseline)', () => {
		assert.equal(resolveEffectiveCustomParams(null, null, 'openai'), null);
		assert.equal(resolveEffectiveCustomParams(undefined, undefined, 'openai'), null);
	});

	it('uses only the provider default when the route has none', () => {
		const providerJson = JSON.stringify({
			openai: { headers: { 'X-Title': 'App' }, body: { max_tokens: 4096 } },
		});
		const effective = resolveEffectiveCustomParams(providerJson, null, 'openai');
		assert.deepEqual(effective, {
			headers: { 'X-Title': 'App' },
			body: { max_tokens: 4096 },
		});
	});

	it('uses only the route value when the provider has none', () => {
		const routeJson = JSON.stringify({ body: { temperature: 0.5 } });
		const effective = resolveEffectiveCustomParams(null, routeJson, 'openai');
		assert.deepEqual(effective, { body: { temperature: 0.5 } });
	});

	it('merges provider defaults under route overrides, route wins on conflicts', () => {
		const providerJson = JSON.stringify({
			openai: { body: { max_tokens: 4096, temperature: 0.1 } },
		});
		const routeJson = JSON.stringify({ body: { temperature: 0.9 } });
		const effective = resolveEffectiveCustomParams(providerJson, routeJson, 'openai');
		assert.deepEqual(effective, { body: { max_tokens: 4096, temperature: 0.9 } });
	});

	it('does not apply a provider group configured for a different protocol', () => {
		const providerJson = JSON.stringify({ gemini: { body: { generationConfig: { maxOutputTokens: 8192 } } } });
		const effective = resolveEffectiveCustomParams(providerJson, null, 'openai');
		assert.equal(effective, null);
	});

	it('degrades invalid provider JSON to unconfigured instead of throwing', () => {
		assert.doesNotThrow(() => resolveEffectiveCustomParams('{not json', null, 'openai'));
		assert.equal(resolveEffectiveCustomParams('{not json', null, 'openai'), null);
		// A bad provider payload must not take down a route that has its own valid custom_params.
		const routeJson = JSON.stringify({ body: { temperature: 0.5 } });
		assert.deepEqual(resolveEffectiveCustomParams('{not json', routeJson, 'openai'), {
			body: { temperature: 0.5 },
		});
	});

	it('degrades invalid route JSON to unconfigured, same as current behavior', () => {
		const providerJson = JSON.stringify({ openai: { body: { max_tokens: 4096 } } });
		const effective = resolveEffectiveCustomParams(providerJson, '{not json', 'openai');
		assert.deepEqual(effective, { body: { max_tokens: 4096 } });
	});

	it('dedupes headers that differ only by case, route wins and keeps a single key', () => {
		const providerJson = JSON.stringify({ openai: { headers: { 'x-title': 'from-provider' } } });
		const routeJson = JSON.stringify({ headers: { 'X-Title': 'from-route' } });
		const effective = resolveEffectiveCustomParams(providerJson, routeJson, 'openai') as Record<string, unknown>;
		const headers = effective.headers as Record<string, string>;
		assert.deepEqual(Object.keys(headers), ['X-Title']);
		assert.equal(headers['X-Title'], 'from-route');
	});

	it('force_override.body on the route forces the whole merged body, including provider defaults, over the client body', () => {
		// This assertion documents the chosen semantics (plan §3.2 "方案 A"): force_override is NOT
		// scoped to only the route's own keys. Client-provided fields can still be overridden by a
		// provider default once the route opts into force_override.body — downstream `mergeRouteRequestBody`
		// is what actually performs the client-vs-route merge; this test only checks the route-visible
		// shape produced by resolveEffectiveCustomParams carries the provider default through force_override.
		const providerJson = JSON.stringify({ openai: { body: { max_tokens: 4096 } } });
		const routeJson = JSON.stringify({
			body: { temperature: 0.5 },
			force_override: { body: true },
		});
		const effective = resolveEffectiveCustomParams(providerJson, routeJson, 'openai') as Record<string, unknown>;
		assert.deepEqual(effective.body, { max_tokens: 4096, temperature: 0.5 });
		assert.deepEqual(effective.force_override, { body: true });
	});
});
