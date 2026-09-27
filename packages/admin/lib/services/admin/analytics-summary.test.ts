import assert from 'node:assert/strict';
import { it } from 'node:test';
import { summarizeAnalytics } from '../../analytics-insights';
import { calendarRangeToParams } from '../../analytics-range';

it('weights success rates by traffic and does not classify cancelled requests as errors', () => {
  const result = summarizeAnalytics([
    { request_count: 99, success_count: 98, success_rate: 98 / 99 * 100, error_count: 0, charged_cost: 10, metered_cost: 12 },
    { request_count: 1, success_count: 0, success_rate: 0, error_count: 1, charged_cost: 0, metered_cost: 0 },
  ]);
  assert.equal(result.successRate, 98);
  assert.equal(result.errors, 1);
  assert.equal(result.requests - result.successes - result.errors, 1);
  assert.equal(result.margin, -2);
  assert.equal(result.marginRate, -20);
  assert.equal(summarizeAnalytics([]).successRate, null);
  assert.equal(summarizeAnalytics([]).marginRate, null);
});

it('calendar windows include midnight in the business timezone', () => {
  const range = calendarRangeToParams('today', 'Asia/Shanghai', new Date('2026-09-27T06:00:00Z'));
  assert.deepEqual(range, { start_date: '2026-09-26 16:00:00', end_date: '2026-09-27 06:00:00' });
});
