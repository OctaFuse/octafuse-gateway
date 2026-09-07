import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { GatewayRepositories, UserRow } from '@octafuse/core';
import { updateAdminUser } from './users-service';

const USER_ID = '8c523806-1959-41eb-bfd7-8c5bd307e99a';

function baseUser(overrides: Partial<UserRow> = {}): UserRow {
	return {
		id: USER_ID,
		email: 'ops@example.com',
		budget_max: 9.9,
		budget_base: 9.9,
		budget_spent: 0,
		budget_period: 'none',
		budget_reset_at: null,
		wallet_granted: 20.5,
		wallet_spent: 17.20157,
		status: 'active',
		metadata: null,
		rate_limit: null,
		charged_cost_factors: null,
		external_system: 'soloent',
		external_user_id: USER_ID,
		created_at: '2026-08-26T12:19:56.000Z',
		updated_at: '2026-08-26T12:19:56.000Z',
		...overrides,
	};
}

function mockRepos(initial: UserRow) {
	const current: UserRow = { ...initial };
	const audits: Array<{
		eventType: string;
		reasonCode?: string | null;
		source?: string | null;
		reasonText?: string | null;
		changedFields?: string | null;
	}> = [];
	const repos = {
		users: {
			getById: async (id: string) => (id === current.id ? { ...current } : null),
			updateUserPlan: async (
				id: string,
				budget_max: number | null,
				budget_period: string,
				budget_reset_at: string | null,
				resetBudget = true,
				metadata?: string | null,
				budget_spent_override?: number | null,
				budget_base?: number | null,
				wallet_granted?: number | null,
				wallet_spent?: number | null
			) => {
				if (id !== current.id) return false;
				current.budget_max = budget_max;
				current.budget_period = budget_period;
				current.budget_reset_at = budget_reset_at;
				if (budget_spent_override !== undefined) {
					current.budget_spent = budget_spent_override ?? 0;
				} else if (resetBudget) {
					current.budget_spent = 0;
				}
				if (budget_base !== undefined) current.budget_base = budget_base ?? 0;
				if (wallet_granted !== undefined) current.wallet_granted = wallet_granted ?? 0;
				if (wallet_spent !== undefined) current.wallet_spent = wallet_spent ?? 0;
				if (metadata !== undefined) current.metadata = metadata;
				return true;
			},
		},
		userAuditLogs: {
			insertUserAuditLog: async (params: {
				eventType: string;
				reasonCode?: string | null;
				source?: string | null;
				reasonText?: string | null;
				changedFields?: string | null;
			}) => {
				audits.push(params);
			},
		},
	} as unknown as GatewayRepositories;
	return { repos, audits };
}

describe('updateAdminUser audit', () => {
	it('writes admin_patch_wallet when only wallet fields change', async () => {
		const { repos, audits } = mockRepos(baseUser());
		await updateAdminUser(
			repos,
			USER_ID,
			{ wallet_granted: 22, wallet_spent: 17.20157, reason: 'pa:gw:8c523806' },
			'admin_key:test'
		);
		assert.equal(audits.length, 1);
		assert.equal(audits[0].eventType, 'admin_adjust');
		assert.equal(audits[0].reasonCode, 'admin_patch_wallet');
		assert.equal(audits[0].source, 'admin_users');
		assert.equal(audits[0].reasonText, 'pa:gw:8c523806');
		const changed = JSON.parse(String(audits[0].changedFields ?? '[]')) as string[];
		assert.deepEqual(changed, ['wallet_granted']);
	});

	it('writes admin_patch_budget when only budget_max changes', async () => {
		const { repos, audits } = mockRepos(baseUser());
		await updateAdminUser(repos, USER_ID, { budget_max: 19.8, reason: 'raise budget' }, 'admin_key:test');
		assert.equal(audits.length, 1);
		assert.equal(audits[0].reasonCode, 'admin_patch_budget');
		const changed = JSON.parse(String(audits[0].changedFields ?? '[]')) as string[];
		assert.ok(changed.includes('budget_max'));
		assert.ok(!changed.includes('wallet_granted'));
		assert.ok(!changed.includes('wallet_spent'));
	});

	it('does not insert audit when wallet and budget values are unchanged', async () => {
		const { repos, audits } = mockRepos(baseUser());
		await updateAdminUser(
			repos,
			USER_ID,
			{ wallet_granted: 20.5, wallet_spent: 17.20157, budget_max: 9.9 },
			'admin_key:test'
		);
		assert.equal(audits.length, 0);
	});
});
