import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { GatewayRepositories } from '@octafuse/core';
import { USER_CHARGED_COST_FACTOR_MODE_KEY } from '@octafuse/core/lib/user-charged-cost-factor-mode';
import { AdminServiceError } from './errors';
import { updateAdminSystemConfigService } from './dashboard-service';

function mockRepos(): GatewayRepositories {
	return {
		systemConfig: {
			upsertSystemConfigValue: async () => undefined,
		},
	} as unknown as GatewayRepositories;
}

describe('updateAdminSystemConfigService USER_CHARGED_COST_FACTOR_MODE', () => {
	it('rejects illegal mode values with 400', async () => {
		await assert.rejects(
			() =>
				updateAdminSystemConfigService(mockRepos(), {
					key: USER_CHARGED_COST_FACTOR_MODE_KEY,
					value: 'stack',
				}),
			(err: unknown) =>
				err instanceof AdminServiceError &&
				err.status === 400 &&
				err.message.includes('USER_CHARGED_COST_FACTOR_MODE')
		);
	});

	it('accepts multiply and min', async () => {
		const repos = mockRepos();
		await updateAdminSystemConfigService(repos, {
			key: USER_CHARGED_COST_FACTOR_MODE_KEY,
			value: 'MIN',
		});
		await updateAdminSystemConfigService(repos, {
			key: USER_CHARGED_COST_FACTOR_MODE_KEY,
			value: 'multiply',
		});
	});
});
