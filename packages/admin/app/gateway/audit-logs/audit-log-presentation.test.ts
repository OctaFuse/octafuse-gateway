import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { GatewayApiKeyBudgetAuditLog } from '@/lib/types';
import { auditDisplayExtras } from '@/lib/audit-log-display';
import { auditFinancialRows, auditRequestHref, auditUserEmail } from './audit-log-presentation';
const base: GatewayApiKeyBudgetAuditLog = {
  id: 'audit-1',
  user_id: null,
  api_key_id: null,
  event_type: 'admin_adjust',
  actor_type: 'admin',
  before_spent: 1,
  after_spent: 1,
  delta_spent: 0,
  before_budget_max: null,
  after_budget_max: null,
  before_budget_base: 0,
  after_budget_base: 0,
  request_log_id: null,
  change_payload: null,
  created_at: '2025-01-01T00:00:00Z',
};
test('unlimited-to-zero is a limit change and microcharges retain exact signed deltas', () => {
  const rows = auditFinancialRows({
    ...base,
    after_budget_max: 0,
    after_spent: 1.000013,
    delta_spent: 0.000013,
  }).cycle;
  assert.equal(rows.find((row) => row.key === 'max')?.changed, true);
  assert.equal(rows.find((row) => row.key === 'spent')?.changed, true);
  assert.equal(rows.find((row) => row.key === 'spent')?.delta, 0.000013);
  assert.equal(
    auditFinancialRows({ ...base, after_spent: 1.00000001 }).cycle.find(
      (row) => row.key === 'spent'
    )?.changed,
    false
  );
});
test('date formatting differences do not create reset changes, while explicit period transitions do', () => {
  const rows = auditFinancialRows({
    ...base,
    before_budget_reset_at: '2026-11-10T00:00:00Z',
    after_budget_reset_at: '2026-11-10T08:00:00+08:00',
    before_budget_period: 'none',
    after_budget_period: 'monthly',
  }).cycle;
  assert.equal(rows.find((row) => row.key === 'resetAt')?.changed, false);
  assert.equal(rows.find((row) => row.key === 'period')?.changed, true);
});
test('missing wallet fields are not invented as zero; recorded zero and actual credits are retained', () => {
  assert.deepEqual(auditFinancialRows(base).wallet, []);
  assert.deepEqual(
    auditFinancialRows({ ...base, after_user_snapshot: '{"email":"old@example.com"}' }).wallet,
    []
  );
  const rows = auditFinancialRows({
    ...base,
    before_user_snapshot: '{"wallet_granted":0,"wallet_spent":0}',
    after_user_snapshot: '{"wallet_granted":5,"wallet_spent":2}',
  }).wallet;
  assert.equal(rows.find((row) => row.key === 'granted')?.delta, 5);
  assert.equal(rows.find((row) => row.key === 'remaining')?.after, 3);
  assert.equal(
    auditFinancialRows({ ...base, after_user_snapshot: '{"wallet_granted":0,"wallet_spent":0}' })
      .wallet.length,
    3
  );
});
test('deleted users keep snapshot identity and request drill-downs explicitly include history', () => {
  assert.equal(
    auditUserEmail({ ...base, before_user_snapshot: '{"email":"archived@example.com"}' }),
    'archived@example.com'
  );
  assert.equal(auditUserEmail({ ...base, after_user_snapshot: 'broken' }), null);
  const url = new URL(
    auditRequestHref({ ...base, request_log_id: 'request/1' })!,
    'http://localhost'
  );
  assert.equal(url.searchParams.get('id'), 'request/1');
  assert.equal(url.searchParams.get('start_date'), '');
  assert.equal(url.searchParams.get('end_date'), '');
  assert.equal(auditRequestHref(base), null);
});
test('non-object legacy payloads cannot crash audit rendering', () => {
  for (const change_payload of ['null', '[]', '4', '"text"', '{']) {
    assert.equal(auditDisplayExtras({ ...base, change_payload }).actor_id, null);
    assert.equal(auditFinancialRows({ ...base, change_payload }).cycle.length, 5);
  }
});

test('missing reset period and explicit none have the same budget behavior', () => {
  assert.equal(
    auditFinancialRows({
      ...base,
      before_budget_period: null,
      after_budget_period: 'none',
    }).cycle.find((row) => row.key === 'period')?.changed,
    false
  );
});
