import assert from 'node:assert/strict';
import { it } from 'node:test';
import type { GatewayRepositories } from '@octafuse/core';
import { getModelAnalyticsService, getProviderAnalyticsService, getReliabilityAnalyticsService } from './dashboard-service';

const start = '2026-09-26 00:00:00';
const end = '2026-09-27 00:00:00';
const raw = {
  model_id: 'model-a', route_group: 'default', provider_id: 'provider-a', provider_name: 'Provider A',
  request_count: 3, success_count: 2, error_count: 1,
  input_tokens: 100, output_tokens: 9900, cache_read_tokens: 20, cache_write_tokens: 5,
  charged_cost: 5, metered_cost: 3, standard_cost: 7,
  tokens_per_second: 3300, stream_tokens_per_second: 50, stream_sample_count: 1,
  failover_rate: 400 / 3, failover_request_rate: 100 / 3, failover_request_count: 1,
};

it('model and provider APIs preserve legacy fields, filters and tags with additive quality metrics', async () => {
  const calls: unknown[] = [];
  const repos = { analytics: {
    queryModelAnalytics: async (options: unknown) => { calls.push(options); return [raw]; },
    queryProviderAnalytics: async (options: unknown) => { calls.push(options); return [raw]; },
    queryDistinctModelTags: async () => ['chat'],
  } } as unknown as GatewayRepositories;
  const models = await getModelAnalyticsService(repos, { start_date: start, end_date: end, user_email: 'a@example.com', api_key_id: 'key-a', tag: 'chat' });
  const providers = await getProviderAnalyticsService(repos, { start_date: start, end_date: end, model_id: 'model-a', route_group: 'default' });
  for (const result of [models, providers]) {
    assert.deepEqual(result.tags, ['chat']);
    const row = result.data[0];
    for (const key of ['request_count', 'input_tokens', 'output_tokens', 'charged_cost', 'metered_cost', 'standard_cost', 'success_count', 'error_count', 'tokens_per_second', 'failover_rate'] as const) {
      assert.equal(row[key], raw[key], key);
    }
    assert.ok(Math.abs(row.success_rate - 200 / 3) < 1e-10);
    assert.equal(row.cache_hit_rate, 20);
    assert.equal(row.stream_tokens_per_second, 50);
    assert.equal(row.failover_request_rate, 100 / 3);
  }
  assert.deepEqual(calls[0], { start, end, tag: 'chat', providerId: undefined, userEmail: 'a@example.com', userId: undefined, apiKeyId: 'key-a' });
  assert.deepEqual(calls[1], { start, end, tag: undefined, modelId: 'model-a', routeGroup: 'default' });
});

it('reliability errors use the selected range and retain the response envelope', async () => {
  const calls: unknown[] = [];
  const logs = [{ id: 'error-in-range' }];
  const repos = { analytics: {
    queryProviderReliability: async () => [raw], queryModelProviderReliability: async () => [raw],
  }, requestLogs: {
    getRecentErrors: async () => { throw new Error('Unbounded errors must not be used'); },
    getRequestLogs: async (options: unknown) => { calls.push(options); return { logs, total: 1 }; },
  } } as unknown as GatewayRepositories;
  const result = await getReliabilityAnalyticsService(repos, { start_date: start, end_date: end });
  assert.deepEqual(Object.keys(result).sort(), ['modelProviders', 'providers', 'recentErrors']);
  assert.deepEqual(result.recentErrors, logs);
  assert.deepEqual(calls, [{ page: 1, pageSize: 10, status: 'error', startDate: start, endDate: end }]);
});
