import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pickChangedUserFields } from './user-detail-form';

test('profile edits do not overwrite budget and wallet usage loaded earlier', () => {
  const saved = { email: 'old@example.com', budget_spent: '2', wallet_spent: '3', wallet_granted: '10' };
  const current = { ...saved, email: 'new@example.com' };
  assert.deepEqual(
    pickChangedUserFields(
      { email: current.email, budget_spent: 2, wallet_spent: 3, wallet_granted: 10, reason: 'edit' },
      current,
      saved
    ),
    { email: 'new@example.com', reason: 'edit' }
  );
});

test('cycle edits preserve usage unless the spent field was explicitly edited', () => {
  const saved = { budget_period: 'none', budget_spent: '2' };
  assert.deepEqual(
    pickChangedUserFields(
      { budget_period: 'monthly', budget_spent: 0 },
      { budget_period: 'monthly', budget_spent: '0' },
      saved
    ),
    { reason: undefined, budget_period: 'monthly', budget_spent: 0, reset_budget: false }
  );
  assert.deepEqual(
    pickChangedUserFields({ budget_period: 'monthly', budget_spent: 2 }, { ...saved, budget_period: 'monthly' }, saved),
    { reason: undefined, budget_period: 'monthly', reset_budget: false }
  );
});

test('clearing limits and removing all model multipliers sends explicit null', () => {
  const saved = { budget_max: '10', rateLimitRpm: '20', chargedCostFactorRows: [{ modelId: 'model', factor: '0.5' }] };
  const current = { budget_max: '', rateLimitRpm: '', chargedCostFactorRows: [] };
  assert.deepEqual(
    pickChangedUserFields({ budget_max: null, rate_limit: null, charged_cost_factors: null }, current, saved),
    { reason: undefined, budget_max: null, rate_limit: null, charged_cost_factors: null }
  );
});

test('zero RPM and metadata replacement survive alongside a wallet correction', () => {
  const saved = { rateLimitRpm: '', metadata: '{}', wallet_granted: '10' };
  const current = { rateLimitRpm: '0', metadata: '{"team":"ops"}', wallet_granted: '15' };
  assert.deepEqual(
    pickChangedUserFields(
      { rate_limit: { rpm: 0 }, metadata_replace: current.metadata, wallet_granted: 15 },
      current,
      saved
    ),
    { reason: undefined, rate_limit: { rpm: 0 }, metadata_replace: current.metadata, wallet_granted: 15 }
  );
});

test('blank metadata remains unchanged and equal multiplier drafts are omitted', () => {
  const saved = { metadata: '{}', chargedCostFactorRows: [{ modelId: 'model', factor: '0.5' }] };
  const current = { metadata: '', chargedCostFactorRows: [{ modelId: 'model', factor: '0.5' }] };
  assert.deepEqual(pickChangedUserFields({ charged_cost_factors: { model: 0.5 }, reason: 'edit' }, current, saved), {
    reason: 'edit',
  });
});
