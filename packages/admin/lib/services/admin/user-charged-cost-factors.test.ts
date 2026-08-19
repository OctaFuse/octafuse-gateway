import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { GatewayRepositories, ModelRow } from '@octafuse/core';
import { AdminServiceError } from './errors';
import {
	assertKnownChargedCostFactorModels,
	resolveAdminChargedCostFactorsInput,
} from './user-charged-cost-factors';

function mockRepos(knownIds: string[]): GatewayRepositories {
	const known = new Set(knownIds);
	return {
		modelRouting: {
			getModelById: async (id: string) => (known.has(id) ? ({ id } as ModelRow) : null),
		},
	} as unknown as GatewayRepositories;
}

describe('resolveAdminChargedCostFactorsInput', () => {
	it('rejects negative factors', async () => {
		await assert.rejects(
			() => resolveAdminChargedCostFactorsInput(mockRepos(['gpt-4o']), { 'gpt-4o': -1 }),
			(err: unknown) => err instanceof AdminServiceError && err.status === 400
		);
	});

	it('rejects unknown model ids', async () => {
		await assert.rejects(
			() => resolveAdminChargedCostFactorsInput(mockRepos(['gpt-4o']), { 'no-such-model': 0.5 }),
			(err: unknown) =>
				err instanceof AdminServiceError &&
				err.status === 400 &&
				err.message.includes('no-such-model')
		);
	});

	it('accepts known models and stores JSON', async () => {
		const json = await resolveAdminChargedCostFactorsInput(mockRepos(['gpt-4o']), { 'gpt-4o': 0.8 });
		assert.equal(json, JSON.stringify({ 'gpt-4o': 0.8 }));
	});

	it('stores null for empty object', async () => {
		assert.equal(await resolveAdminChargedCostFactorsInput(mockRepos([]), {}), null);
	});
});

describe('assertKnownChargedCostFactorModels', () => {
	it('passes when all keys exist', async () => {
		await assertKnownChargedCostFactorModels(mockRepos(['a', 'b']), { a: 1, b: 0 });
	});
});
