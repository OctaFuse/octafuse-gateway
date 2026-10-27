import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildAffinityKey, parseAffinityKey } from './route-affinity-key';

describe('parseAffinityKey', () => {
	it('round-trips buildAffinityKey', () => {
		const key = buildAffinityKey('user-1', 'gpt-5', 'default', 'openai');
		assert.deepEqual(parseAffinityKey(key), {
			userId: 'user-1',
			modelId: 'gpt-5',
			routeGroup: 'default',
			protocol: 'openai',
		});
	});

	it('keeps pipes inside the model id', () => {
		const parsed = parseAffinityKey(buildAffinityKey('u', 'a|b', 'vip', 'anthropic'));
		assert.equal(parsed?.modelId, 'a|b');
		assert.equal(parsed?.routeGroup, 'vip');
		assert.equal(parsed?.protocol, 'anthropic');
	});

	it('returns null for missing or malformed keys', () => {
		assert.equal(parseAffinityKey(null), null);
		assert.equal(parseAffinityKey(''), null);
		assert.equal(parseAffinityKey('only|three|parts'), null);
		assert.equal(parseAffinityKey('|model|default|openai'), null);
	});
});
