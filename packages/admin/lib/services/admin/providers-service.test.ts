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
		},
	} as unknown as GatewayRepositories;
	return { repos, row, patches };
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
