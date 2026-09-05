import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { UserRow } from '../types';
import { buildWalletCreditAuditRow, walletCreditResult } from './wallet-credit';

const user: UserRow = {
	id: 'user-1',
	email: 'wallet@example.com',
	budget_max: 40,
	budget_base: 40,
	budget_spent: 10,
	budget_period: 'monthly',
	budget_reset_at: null,
	wallet_granted: 2,
	wallet_spent: 0.5,
	status: 'active',
	metadata: null,
	rate_limit: null,
	charged_cost_factors: null,
	external_system: 'soloent',
	external_user_id: 'ext-1',
	created_at: '2026-01-01T00:00:00Z',
	updated_at: '2026-01-01T00:00:00Z',
};

test('buildWalletCreditAuditRow writes wallet_credit with dedup_key', () => {
	const { audit, afterGranted } = buildWalletCreditAuditRow(
		user,
		{
			userId: user.id,
			amount: 10,
			kind: 'topup',
			externalRef: 'stripe_session_abc',
			reason: 'stripe:topup',
		},
		'audit-1'
	);
	assert.equal(afterGranted, 12);
	assert.equal(audit.eventType, 'wallet_credit');
	assert.equal(audit.source, 'admin_wallet');
	assert.equal(audit.dedupKey, 'stripe_session_abc');
	assert.equal(audit.reasonCode, 'wallet_credit_topup');
	const payload = JSON.parse(String(audit.changePayload ?? '{}')) as {
		amount: number;
		kind: string;
		external_ref: string;
	};
	assert.equal(payload.amount, 10);
	assert.equal(payload.kind, 'topup');
	assert.equal(payload.external_ref, 'stripe_session_abc');
	const after = JSON.parse(String(audit.afterUserSnapshot ?? '{}')) as { wallet_granted: number };
	assert.equal(after.wallet_granted, 12);
});

test('same external_ref produces the same dedup_key for replay', () => {
	const first = buildWalletCreditAuditRow(
		user,
		{ userId: user.id, amount: 10, kind: 'topup', externalRef: 'order-1' },
		'audit-a'
	);
	const second = buildWalletCreditAuditRow(
		user,
		{ userId: user.id, amount: 10, kind: 'topup', externalRef: 'order-1' },
		'audit-b'
	);
	assert.equal(first.audit.dedupKey, second.audit.dedupKey);
	assert.equal(first.audit.dedupKey, 'order-1');
	assert.notEqual(first.audit.id, second.audit.id);
});

test('walletCreditResult marks applied vs duplicate', () => {
	assert.deepEqual(walletCreditResult('applied', 12, 0.5), {
		status: 'applied',
		walletGranted: 12,
		walletSpent: 0.5,
		walletBalance: 11.5,
	});
	assert.equal(walletCreditResult('duplicate', 12, 0.5).status, 'duplicate');
});
