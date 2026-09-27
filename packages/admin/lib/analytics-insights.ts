import type { AnalyticsRowCosts } from './types';

export type AnalyticsSummaryRow = AnalyticsRowCosts & {
  request_count: number;
  success_count?: number;
  success_rate: number;
  error_count: number;
};

/** Aggregate counts before computing rates; never average row percentages. */
export function summarizeAnalytics(rows: readonly AnalyticsSummaryRow[]) {
  const totals = rows.reduce((a, row) => ({
    requests: a.requests + row.request_count,
    successes: a.successes + (row.success_count ?? row.success_rate * row.request_count / 100),
    errors: a.errors + row.error_count,
    charged: a.charged + row.charged_cost,
    metered: a.metered + row.metered_cost,
    standard: a.standard + (row.standard_cost ?? 0),
  }), { requests: 0, successes: 0, errors: 0, charged: 0, metered: 0, standard: 0 });
  return {
    ...totals,
    successRate: totals.requests > 0 ? 100 * totals.successes / totals.requests : null,
    margin: totals.charged - totals.metered,
    marginRate: totals.charged > 0 ? 100 * (totals.charged - totals.metered) / totals.charged : null,
  };
}

export type AnalyticsView = 'overview' | 'cost' | 'performance' | 'budget' | 'all';

export function analyticsColumnVisible(key: string, view: AnalyticsView): boolean {
  if (view === 'all') return true;
  if (['model_id', 'provider_name', 'provider_kind', 'user_email', 'route_group', 'request_count'].includes(key)) return true;
  const columns: Record<Exclude<AnalyticsView, 'all'>, string[]> = {
    overview: ['charged_cost', 'success_rate', 'avg_effective_ttft_ms', 'failover_request_rate', 'distinct_models', 'last_active_at'],
    cost: ['standard_cost', 'charged_cost', 'metered_cost', 'avg_charged_per_request', 'input_tokens', 'output_tokens', 'cache_hit_rate'],
    performance: ['success_rate', 'avg_latency_ms', 'avg_effective_ttft_ms', 'avg_upstream_response_ms', 'stream_tokens_per_second', 'failover_request_rate', 'avg_attempts'],
    budget: ['budget_usage_rate', 'wallet_granted', 'last_active_at'],
  };
  return columns[view].includes(key);
}
