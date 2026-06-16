import { describe, expect, it } from 'vitest';
import {
	resetProviderKeyCooldownStateForTests,
	selectProviderKeysForAttempt,
} from './provider-key-scheduler';

describe('provider-key-scheduler', () => {
	it('returns all keys in weighted-random order within the same priority', () => {
		resetProviderKeyCooldownStateForTests();
		const keys = [
			{ id: 'a', label: 'a', api_key: 'k1', weight: 1, priority: 0 },
			{ id: 'b', label: 'b', api_key: 'k2', weight: 1, priority: 0 },
		];
		const ordered = selectProviderKeysForAttempt(keys);
		expect(ordered).toHaveLength(2);
		expect(new Set(ordered.map((k) => k.id))).toEqual(new Set(['a', 'b']));
	});

	it('orders higher priority keys before lower priority keys', () => {
		resetProviderKeyCooldownStateForTests();
		const keys = [
			{ id: 'low', label: 'low', api_key: 'k1', weight: 1, priority: 0 },
			{ id: 'high', label: 'high', api_key: 'k2', weight: 1, priority: 10 },
		];
		const ordered = selectProviderKeysForAttempt(keys);
		expect(ordered.map((k) => k.id)).toEqual(['high', 'low']);
	});

	it('returns empty array when no keys', () => {
		expect(selectProviderKeysForAttempt([])).toEqual([]);
	});
});
