import assert from 'node:assert/strict';
import test from 'node:test';
import { incomingRequestLogIds, requestLogRefreshQuery, shouldQueueRequestLogs, uniqueRequestLogs } from './request-log-feed';
import { readRequestLogFilters, requestLogQuery } from './request-log-query';
import { REQUEST_LOG_REFRESH_INTERVAL_OPTIONS, parseAutoRefreshInterval } from '@/lib/auto-refresh-preference';

const rows = (...ids: string[]) => ids.map(id => ({ id }));

test('only incoming leading rows animate; repeated rows and older backfills do not', () => {
	assert.deepEqual(incomingRequestLogIds(rows('3', '2'), rows('5', '4', '3', '2', '1')), ['5', '4']);
	assert.deepEqual(incomingRequestLogIds(rows('3', '2'), rows('3', '2', '1')), []);
	assert.deepEqual(incomingRequestLogIds([], rows('2', '1')), ['2', '1']);
	assert.deepEqual(incomingRequestLogIds(rows('old'), rows('new3', 'new3', 'new2', 'new1')), ['new3', 'new2', 'new1']);
});

test('a full page of new traffic stays bounded and preserves server ordering', () => {
	const incoming = Array.from({ length: 50 }, (_, id) => ({ id: `new-${id}` }));
	assert.deepEqual(incomingRequestLogIds(rows('old'), incoming), incoming.map(row => row.id));
	assert.deepEqual(uniqueRequestLogs(rows('2', '1', '2', '1')), rows('2', '1'));
});

test('automatic arrivals wait while reading; explicit refresh always applies immediately', () => {
	assert.equal(shouldQueueRequestLogs('automatic', 3, true), true);
	assert.equal(shouldQueueRequestLogs('automatic', 3, false), false);
	assert.equal(shouldQueueRequestLogs('automatic', 0, true), false);
	assert.equal(shouldQueueRequestLogs('manual', 3, true), false);
	assert.equal(shouldQueueRequestLogs('query', 3, true), false);
});

test('live refresh advances relative windows without losing any query filters', () => {
	const before = 'page=1&page_size=50&user_email=a%2Bb%40example.com&model_id=m&status=error&start_date=2000-01-01&end_date=2000-01-02';
	const next = requestLogRefreshQuery(before, '1h', 'Asia/Shanghai');
	for (const [key,value] of new URLSearchParams(before)) if (!key.endsWith('_date')) assert.equal(next.get(key), value);
	const end = Date.parse(next.get('end_date')!.replace(' ', 'T') + 'Z');
	const start = Date.parse(next.get('start_date')!.replace(' ', 'T') + 'Z');
	assert.equal(end-start, 3_600_000);
	assert.ok(Math.abs(Date.now()-end) < 2000);
	assert.equal(new URLSearchParams(before).get('end_date'), '2000-01-02');
});

test('fixed, empty and one-sided custom ranges remain unchanged', () => {
	for (const query of ['page=1&start_date=&end_date=', 'page=2&start_date=2025-01-01&end_date=', 'page=1&start_date=&end_date=2025-01-02']) {
		assert.equal(requestLogRefreshQuery(query, 'custom', 'UTC').toString(), new URLSearchParams(query).toString());
	}
});

test('calendar and rolling presets retain their identity across URL reloads', () => {
	for (const preset of ['today', 'this_week', 'this_month', '1h', '7d'] as const) {
		const filters = readRequestLogFilters(`?range_preset=${preset}`, 'Asia/Shanghai');
		assert.equal(filters.range.preset, preset);
		assert.equal(readRequestLogFilters(requestLogQuery(filters).toString(), 'Asia/Shanghai').range.preset, preset);
	}
	assert.equal(readRequestLogFilters('?range_preset=invalid&start_date=&end_date=', 'UTC').range.preset, 'custom');
});

test('short polling intervals are opt-in and scoped to request logs', () => {
	for (const value of ['10000', '30000']) {
		assert.equal(parseAutoRefreshInterval(value), 'off');
		assert.equal(parseAutoRefreshInterval(value, REQUEST_LOG_REFRESH_INTERVAL_OPTIONS), Number(value));
	}
	assert.equal(parseAutoRefreshInterval(null, REQUEST_LOG_REFRESH_INTERVAL_OPTIONS), 'off');
});
