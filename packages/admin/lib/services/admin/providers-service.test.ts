import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { GatewayRepositories } from '@octafuse/core';
import {
	createProviderService,
	revealProviderApiKeyService,
	updateProviderService,
} from './providers-service';
import { AdminServiceError } from './errors';

function repositories() {
	const row: Record<string, unknown> = {
		id: 'p1',
		name: 'Provider',
		api_key: 'original-key',
		status: 'active',
	};
	const patches: Record<string, unknown>[] = [];
	const inserted: Record<string, unknown>[] = [];
	const repos = {
		providers: {
			getProviderRowById: async (id: string) =>
				id === 'p1' ? { ...row } : null,
			getProviderApiKeyPlaintext: async () => ({ api_key: row.api_key }),
			updateProviderByPatch: async (
				id: string,
				patch: Record<string, unknown>
			) => {
				assert.equal(id, 'p1');
				patches.push(patch);
				Object.assign(row, patch);
				return 1;
			},
			insertProvider: async (params: Record<string, unknown>) => {
				inserted.push(params);
			},
			providerIdExists: async () => false,
		},
	} as unknown as GatewayRepositories;
	return { repos, row, patches, inserted };
}

describe('provider API key update semantics', () => {
	it('preserves the credential when the PATCH omits api_key', async () => {
		const { repos, row, patches } = repositories();
		await updateProviderService(repos, 'p1', { name: 'Renamed' });
		assert.equal(row.api_key, 'original-key');
		assert.equal(row.name, 'Renamed');
		assert.equal(Object.hasOwn(patches[0], 'api_key'), false);
	});

	for (const value of ['', '  \n\t ', null]) {
		it(`clears an explicitly provided ${JSON.stringify(
			value
		)} credential`, async () => {
			const { repos, row, patches } = repositories();
			await updateProviderService(repos, 'p1', { api_key: value });
			assert.deepEqual(patches, [{ api_key: '' }]);
			assert.equal(row.api_key, '');
			assert.equal(row.status, 'active');
		});
	}

	it('trims and replaces a non-empty credential', async () => {
		const { repos, row } = repositories();
		await updateProviderService(repos, 'p1', {
			api_key: '  replacement-key  ',
		});
		assert.equal(row.api_key, 'replacement-key');
	});

	it('can read back an explicitly cleared credential as an empty string', async () => {
		const { repos } = repositories();
		await updateProviderService(repos, 'p1', { api_key: '' });
		assert.deepEqual(await revealProviderApiKeyService(repos, 'p1'), {
			api_key: '',
		});
	});

	it('keeps an empty PATCH as a no-op', async () => {
		const { repos, patches } = repositories();
		await updateProviderService(repos, 'p1', {});
		assert.deepEqual(patches, []);
	});

	it('returns 404 for an unknown provider without writing anything', async () => {
		const { repos, patches } = repositories();
		await assert.rejects(
			updateProviderService(repos, 'missing', { api_key: '' }),
			(error: unknown) =>
				error instanceof AdminServiceError && error.status === 404
		);
		assert.deepEqual(patches, []);
	});

	it('still requires a non-empty credential when creating a provider', async () => {
		const { repos, patches } = repositories();
		await assert.rejects(
			createProviderService(repos, {
				name: 'New',
				kind: '__custom__',
				api_key: '',
			}),
			/api_key is required/
		);
		assert.deepEqual(patches, []);
	});
});

describe('provider custom_params write/read semantics', () => {
	it('normalizes and persists a valid per-protocol custom_params on create', async () => {
		const { repos, inserted } = repositories();
		await createProviderService(repos, {
			name: 'New',
			kind: '__custom__',
			api_key: 'sk-test',
			custom_params: {
				openai: { headers: { 'X-Title': 'App' }, body: { max_tokens: 4096 } },
			},
		});
		assert.equal(inserted.length, 1);
		assert.deepEqual(
			JSON.parse(inserted[0].customParams as string),
			{ openai: { headers: { 'X-Title': 'App' }, body: { max_tokens: 4096 } } }
		);
	});

	it('omits custom_params on create when not provided', async () => {
		const { repos, inserted } = repositories();
		await createProviderService(repos, { name: 'New', kind: '__custom__', api_key: 'sk-test' });
		assert.equal(inserted[0].customParams, null);
	});

	it('leaves custom_params untouched when the PATCH omits it', async () => {
		const { repos, patches } = repositories();
		await updateProviderService(repos, 'p1', { name: 'Renamed' });
		assert.equal(Object.hasOwn(patches[0], 'custom_params'), false);
	});

	it('clears custom_params when the PATCH sets it to null', async () => {
		const { repos, patches } = repositories();
		await updateProviderService(repos, 'p1', { custom_params: null });
		assert.deepEqual(patches, [{ custom_params: null }]);
	});

	it('rejects a protected header in custom_params with a 400', async () => {
		const { repos } = repositories();
		await assert.rejects(
			updateProviderService(repos, 'p1', {
				custom_params: { openai: { headers: { Authorization: 'Bearer x' } } },
			}),
			(error: unknown) => error instanceof AdminServiceError && error.status === 400
		);
	});

	it('rejects an unknown protocol key in custom_params with a 400', async () => {
		const { repos } = repositories();
		await assert.rejects(
			updateProviderService(repos, 'p1', {
				custom_params: { not_a_protocol: { body: { a: 1 } } },
			}),
			(error: unknown) => error instanceof AdminServiceError && error.status === 400
		);
	});
});
