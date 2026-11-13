import assert from 'node:assert/strict';
import test from 'node:test';
import { dashboardDelta, dashboardRefreshRange, dashboardStatsQuery, interpolateDashboardValue, shareDashboardRows } from './dashboard-live';
import { dashboardLogsHref } from './dashboard-links';
import { dashboardRefreshPreference, DASHBOARD_REFRESH_INTERVAL_OPTIONS, parseAutoRefreshInterval } from '@/lib/auto-refresh-preference';
import type { DashboardStats } from '@/lib/types';

function stats(): DashboardStats {
	return {
		gateway: { activeKeysCount: 1, keysTotal: 2, keysActive: 1, accountsTotal: 2, accountsActive: 1, todayRequestsCount: 10, todayCost: 1, todayTokens: 1200, errorRate: 0 },
		kpi: { totalRequests: 10, successRate: 100, totalCost: 1, meteredCost: 0.5, activeUsers: 1, errorRate: 0, rpm: 2, tpm: 300 },
		timeseries: [{ bucket: '2026-11-01', request_count: 10, input_tokens: 1000, output_tokens: 200, cache_read_tokens: 0, cache_write_tokens: 0, total_tokens: 1200, charged_cost: 1, avg_latency_ms: 200, cache_hit_rate: 0 }],
		modelDistribution: [{ model_id: 'test-model', request_count: 10, input_tokens: 1000, output_tokens: 200, total_tokens: 1200, charged_cost: 1, metered_cost: 0.5, standard_cost: 1 }],
		topUsers: [], recentLogs: [], recentErrors: [],
	};
}

test('a relative dashboard refresh advances the entire window and log drill-down together', () => {
	const range = dashboardRefreshRange({ preset: '1h', start_date: '2020-01-01 00:00:00', end_date: '2020-01-01 01:00:00' }, 'UTC');
	const params = dashboardStatsQuery(range);
	const logs = new URL(dashboardLogsHref(range), 'http://localhost').searchParams;
	assert.equal(params.get('start_date'), logs.get('start_date'));
	assert.equal(params.get('end_date'), logs.get('end_date'));
	const end = Date.parse(range.end_date.replace(' ', 'T') + 'Z');
	const start = Date.parse(range.start_date.replace(' ', 'T') + 'Z');
	assert.equal(end - start, 3_600_000);
	assert.ok(Math.abs(Date.now() - end) < 2000);
});

test('fixed historical windows remain fixed and do not become live preset queries', () => {
	const selected = { preset: 'custom', start_date: '2020-01-01 00:00:00', end_date: '2020-01-02 00:00:00' } as const;
	assert.deepEqual(dashboardRefreshRange(selected, 'Asia/Shanghai'), selected);
	assert.equal(dashboardStatsQuery(selected).has('range'), false);
});

test('idle polls retain chart and activity references without retaining stale KPI data', () => {
	const before = stats();
	const after = stats();
	after.kpi!.rpm = 4;
	const next = shareDashboardRows(before, after);
	assert.equal(next.timeseries, before.timeseries);
	assert.equal(next.modelDistribution, before.modelDistribution);
	assert.equal(next.recentLogs, before.recentLogs);
	assert.equal(next.kpi!.rpm, 4);
	assert.equal(before.kpi!.rpm, 2);
});

test('changed values and ordering get new references; cleared charts cannot retain old rows', () => {
	const before = stats();
	const after = stats();
	after.timeseries![0].request_count = 12;
	after.modelDistribution = [];
	const next = shareDashboardRows(before, after);
	assert.equal(next.timeseries, after.timeseries);
	assert.deepEqual(next.modelDistribution, []);
	assert.equal(before.timeseries![0].request_count, 10);
	assert.equal(shareDashboardRows(null, after), after);
});

test('delta precision suppresses noise, handles falling rolling totals, and excludes missing observations', () => {
	assert.equal(dashboardDelta(10, 10), null);
	assert.equal(dashboardDelta(10, null), null);
	assert.equal(dashboardDelta(NaN, 10), null);
	assert.equal(dashboardDelta(10, 12), -2);
	assert.equal(dashboardDelta(1.000001, 1, 0.00005), null);
	assert.ok(dashboardDelta(1.0001, 1, 0.00005)! > 0);
	assert.equal(dashboardDelta(94.01, 94, 0.05), null);
});

test('number interpolation stays bounded and monotonic for both increases and decreases', () => {
	for (const [from, to] of [[0, 1_000_000], [100, 0], [0.1234, 0.0001]]) {
		let previous = from;
		for (let tick = 0; tick <= 100; tick++) {
			const value = interpolateDashboardValue(from, to, tick / 100);
			assert.ok(value >= Math.min(from, to) && value <= Math.max(from, to));
			assert.ok(to >= from ? value >= previous : value <= previous);
			previous = value;
		}
		assert.equal(interpolateDashboardValue(from, to, -1), from);
		assert.ok(Math.abs(interpolateDashboardValue(from, to, 2) - to) < 1e-12);
	}
});

test('dashboard refresh defaults off and its short intervals require its own opt-in', () => {
	assert.equal(dashboardRefreshPreference.read(), 'off');
	assert.equal(parseAutoRefreshInterval(null, DASHBOARD_REFRESH_INTERVAL_OPTIONS), 'off');
	assert.equal(parseAutoRefreshInterval('10000', DASHBOARD_REFRESH_INTERVAL_OPTIONS), 10_000);
	assert.equal(parseAutoRefreshInterval('10000'), 'off');
});
