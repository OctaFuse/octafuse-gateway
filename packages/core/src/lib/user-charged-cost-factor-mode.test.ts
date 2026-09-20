import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { GatewayRepositories } from '../storage/repositories-types';
import {
	DEFAULT_USER_CHARGED_COST_FACTOR_MODE,
	USER_CHARGED_COST_FACTOR_MODE_KEY,
	getUserChargedCostFactorMode,
	isUserChargedCostFactorMode,
	normalizeUserChargedCostFactorMode,
	resetUserChargedCostFactorModeCacheForTests,
} from './user-charged-cost-factor-mode';

describe('normalizeUserChargedCostFactorMode', () => {
	it('accepts multiply and min', () => {
		assert.equal(normalizeUserChargedCostFactorMode('multiply'), 'multiply');
		assert.equal(normalizeUserChargedCostFactorMode('MIN'), 'min');
		assert.equal(isUserChargedCostFactorMode('multiply'), true);
		assert.equal(isUserChargedCostFactorMode('min'), true);
	});

	it('falls back to multiply for empty or illegal values', () => {
		assert.equal(normalizeUserChargedCostFactorMode(null), DEFAULT_USER_CHARGED_COST_FACTOR_MODE);
		assert.equal(normalizeUserChargedCostFactorMode(''), 'multiply');
		assert.equal(normalizeUserChargedCostFactorMode('stack'), 'multiply');
	});
});

describe('getUserChargedCostFactorMode', () => {
	it('reads system_config and caches the result', async () => {
		resetUserChargedCostFactorModeCacheForTests();
		let reads = 0;
		const repos = {
			systemConfig: {
				getConfig: async (key: string) => {
					reads += 1;
					assert.equal(key, USER_CHARGED_COST_FACTOR_MODE_KEY);
					return 'min';
				},
			},
		} as unknown as GatewayRepositories;
		assert.equal(await getUserChargedCostFactorMode(repos), 'min');
		assert.equal(await getUserChargedCostFactorMode(repos), 'min');
		assert.equal(reads, 1);
		resetUserChargedCostFactorModeCacheForTests();
	});
});
