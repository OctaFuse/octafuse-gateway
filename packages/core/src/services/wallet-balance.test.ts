import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	applyLegacyWalletBackfill,
	canAffordTotalCost,
	computeTotalRemaining,
	computeWalletBalance,
	hasPositiveTotalBalance,
	splitChargeAcrossPools,
} from './wallet-balance';

test('computeWalletBalance is granted minus spent', () => {
	assert.equal(computeWalletBalance(10, 2.5), 7.5);
	assert.equal(computeWalletBalance(0.5, 0), 0.5);
});

test('splitChargeAcrossPools prefers period then wallet', () => {
	assert.deepEqual(splitChargeAcrossPools(3, 10), { fromBudget: 3, fromWallet: 0 });
	assert.deepEqual(splitChargeAcrossPools(10, 4), { fromBudget: 4, fromWallet: 6 });
	assert.deepEqual(splitChargeAcrossPools(5, 0), { fromBudget: 0, fromWallet: 5 });
	assert.deepEqual(splitChargeAcrossPools(5, null), { fromBudget: 5, fromWallet: 0 });
});

test('total remaining: null max is unlimited; otherwise period + wallet', () => {
	assert.equal(computeTotalRemaining(null, 99, 0, 0), null);
	assert.equal(hasPositiveTotalBalance(null, 99, 0, 0), true);
	assert.equal(computeTotalRemaining(40, 40, 2.54, 0), 2.54);
	assert.equal(hasPositiveTotalBalance(40, 40, 0, 0), false);
	assert.equal(canAffordTotalCost(40, 39, 1, 0, 2), true);
	assert.equal(canAffordTotalCost(40, 40, 1, 0, 2), false);
	// 0027 注册赠额：周期 max=0 但 wallet 仍有余额，不得按 spent>=max 判超额。
	assert.equal(computeTotalRemaining(0, 0, 0.5, 0), 0.5);
	assert.equal(hasPositiveTotalBalance(0, 0, 0.5, 0), true);
	assert.equal(canAffordTotalCost(0, 0, 0.5, 0, 0.01), true);
	assert.equal(hasPositiveTotalBalance(0, 0, 0, 0), false);
});

test('legacy backfill fixtures (base = 40)', () => {
	const cases = [
		{
			name: 'case1 leftover topup after spend',
			input: { budget_max: 50, budget_base: 40, budget_spent: 47.46 },
			want: { wallet_granted: 2.54, wallet_spent: 0, budget_max: 40, budget_spent: 40, skipped: false },
		},
		{
			name: 'case2 overspend with leftover max',
			input: { budget_max: 45, budget_base: 40, budget_spent: 47.46 },
			want: { wallet_granted: 0, wallet_spent: 0, budget_max: 40, budget_spent: 40, skipped: false },
		},
		{
			name: 'case3 overspend at base',
			input: { budget_max: 40, budget_base: 40, budget_spent: 47.46 },
			want: { wallet_granted: 0, wallet_spent: 0, budget_max: 40, budget_spent: 40, skipped: false },
		},
		{
			name: 'case4 unused period only',
			input: { budget_max: 40, budget_base: 40, budget_spent: 27.46 },
			want: { wallet_granted: 0, wallet_spent: 0, budget_max: 40, budget_spent: 27.46, skipped: false },
		},
		{
			name: 'signup bonus becomes wallet',
			input: { budget_max: 0.5, budget_base: 0, budget_spent: 0 },
			want: { wallet_granted: 0.5, wallet_spent: 0, budget_max: 0, budget_spent: 0, skipped: false },
		},
		{
			name: 'unlimited skipped',
			input: { budget_max: null, budget_base: 0, budget_spent: 12 },
			want: { wallet_granted: 0, wallet_spent: 0, budget_max: null, budget_spent: 12, skipped: true },
		},
		{
			name: 'expired max=0 period=none keeps max at 0',
			input: { budget_max: 0, budget_base: 20, budget_spent: 0, budget_period: 'none' },
			want: { wallet_granted: 0, wallet_spent: 0, budget_max: 0, budget_spent: 0, skipped: false },
		},
	] as const;

	for (const c of cases) {
		assert.deepEqual(applyLegacyWalletBackfill(c.input), c.want, c.name);
	}
});
