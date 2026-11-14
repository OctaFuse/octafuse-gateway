import assert from 'node:assert/strict';
import { test } from 'node:test';
import { activateSavedToolProvider, providerActivationBlock } from './tool-provider-activation';
import type { ProviderCardStatusFlags } from './components/provider-card-state';

const status: ProviderCardStatusFlags = {
	isActive: false,
	isSelected: false,
	isDirty: false,
	isConfigured: true,
	isImplemented: true,
	isLossPricing: false,
};
test('activation requires saved credentials, an implementation, and no unsaved changes', () => {
	assert.equal(providerActivationBlock({ savedConfigured: true, status }), null);
	assert.equal(providerActivationBlock({ savedConfigured: false, status }), 'missing');
	assert.equal(providerActivationBlock({ savedConfigured: true, status: { ...status, isDirty: true } }), 'unsaved');
	assert.equal(
		providerActivationBlock({ savedConfigured: true, status: { ...status, isImplemented: false } }),
		'unavailable'
	);
});
const base = { providerId: 'tavily', activeKey: 'WEB_SEARCH_ACTIVE', catalogKey: 'WEB_SEARCH_CATALOG' };

test('switching an existing catalog writes only the active provider', async () => {
	const writes: [string, string][] = [];
	const result = await activateSavedToolProvider({
		...base,
		hasSavedCatalog: true,
		savedCatalog: 'must-not-be-written',
		write: async (key, value) => {
			writes.push([key, value]);
			return { ok: true };
		},
	});
	assert.equal(result.ok, true);
	assert.equal(result.catalogInitialized, false);
	assert.deepEqual(writes, [['WEB_SEARCH_ACTIVE', 'tavily']]);
});
test('legacy initialization seeds only the supplied saved snapshot, then switches', async () => {
	const savedSnapshot = JSON.stringify({ tavily: { apiKey: 'saved-example', standard: 0.001 } });
	const writes: [string, string][] = [];
	const result = await activateSavedToolProvider({
		...base,
		hasSavedCatalog: false,
		savedCatalog: savedSnapshot,
		write: async (key, value) => {
			writes.push([key, value]);
			return { ok: true };
		},
	});
	assert.equal(result.ok, true);
	assert.equal(result.catalogInitialized, true);
	assert.deepEqual(writes, [
		['WEB_SEARCH_CATALOG', savedSnapshot],
		['WEB_SEARCH_ACTIVE', 'tavily'],
	]);
});
test('failed catalog initialization never attempts activation', async () => {
	const writes: string[] = [];
	const result = await activateSavedToolProvider({
		...base,
		hasSavedCatalog: false,
		savedCatalog: '{}',
		write: async (key) => {
			writes.push(key);
			return { ok: false, message: 'save rejected' };
		},
	});
	assert.equal(result.ok, false);
	assert.equal(result.catalogInitialized, false);
	assert.deepEqual(writes, ['WEB_SEARCH_CATALOG']);
});
test('activation failure preserves knowledge that legacy initialization succeeded', async () => {
	const result = await activateSavedToolProvider({
		...base,
		hasSavedCatalog: false,
		savedCatalog: '{}',
		write: async (key) => (key === base.catalogKey ? { ok: true } : { ok: false, message: 'activation rejected' }),
	});
	assert.equal(result.ok, false);
	assert.equal(result.catalogInitialized, true);
	assert.equal(result.message, 'activation rejected');
});
test('invalid saved snapshots and network errors report failure', async () => {
	let calls = 0;
	assert.equal(
		(
			await activateSavedToolProvider({
				...base,
				hasSavedCatalog: false,
				savedCatalog: null,
				write: async () => {
					calls++;
					return { ok: true };
				},
			})
		).ok,
		false
	);
	assert.equal(calls, 0);
	assert.equal(
		(
			await activateSavedToolProvider({
				...base,
				hasSavedCatalog: true,
				savedCatalog: null,
				write: async () => {
					throw new Error('network');
				},
			})
		).ok,
		false
	);
});
