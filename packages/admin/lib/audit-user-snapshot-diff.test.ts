import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { summarizeWalletSnapshotDiff } from './audit-user-snapshot-diff';

describe('summarizeWalletSnapshotDiff', () => {
	it('returns hasSnapshot false when both snapshots are missing', () => {
		const diff = summarizeWalletSnapshotDiff(null, null);
		assert.equal(diff.hasSnapshot, false);
		assert.equal(diff.grantedChanged, false);
		assert.equal(diff.spentChanged, false);
		assert.equal(diff.remainingChanged, false);
	});

	it('detects granted change and derived remaining', () => {
		const before = JSON.stringify({ wallet_granted: 20.5, wallet_spent: 17.20157 });
		const after = JSON.stringify({ wallet_granted: 22, wallet_spent: 17.20157 });
		const diff = summarizeWalletSnapshotDiff(before, after);
		assert.equal(diff.hasSnapshot, true);
		assert.equal(diff.grantedChanged, true);
		assert.equal(diff.spentChanged, false);
		assert.equal(diff.remainingChanged, true);
		assert.equal(diff.beforeGranted, 20.5);
		assert.equal(diff.afterGranted, 22);
		assert.equal(diff.beforeRemaining, 20.5 - 17.20157);
		assert.equal(diff.afterRemaining, 22 - 17.20157);
	});

	it('treats equal money within 6 decimal places as unchanged', () => {
		const before = JSON.stringify({ wallet_granted: 1.0000004, wallet_spent: 0 });
		const after = JSON.stringify({ wallet_granted: 1.0000001, wallet_spent: 0 });
		const diff = summarizeWalletSnapshotDiff(before, after);
		assert.equal(diff.grantedChanged, false);
		assert.equal(diff.remainingChanged, false);
	});
});
