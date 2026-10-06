const userFieldToFormField = {
  email: 'email',
  status: 'status',
  budget_max: 'budget_max',
  budget_base: 'budget_base',
  budget_spent: 'budget_spent',
  budget_period: 'budget_period',
  budget_reset_at: 'budget_reset_at',
  wallet_granted: 'wallet_granted',
  wallet_spent: 'wallet_spent',
  rate_limit: 'rateLimitRpm',
  external_system: 'external_system',
  external_user_id: 'external_user_id',
  metadata_replace: 'metadata',
  charged_cost_factors: 'chargedCostFactorRows',
} as const;

/** Do not send stale usage counters when saving unrelated account settings. */
export function pickChangedUserFields(
  payload: Record<string, unknown>,
  current: Record<string, unknown>,
  saved: Record<string, unknown>
): Record<string, unknown> {
  const patch: Record<string, unknown> = { reason: payload.reason };
  for (const [field, formField] of Object.entries(userFieldToFormField)) {
    if (
      Object.prototype.hasOwnProperty.call(payload, field) &&
      JSON.stringify(current[formField]) !== JSON.stringify(saved[formField])
    ) {
      patch[field] = payload[field];
    }
  }
  // Changing a cycle or reset date must not implicitly reset accumulated usage.
  if ('budget_period' in patch || 'budget_reset_at' in patch) patch.reset_budget = false;
  return patch;
}
