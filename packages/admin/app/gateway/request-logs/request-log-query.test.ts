import assert from 'node:assert/strict';
import { test } from 'node:test';
import { utcApiToZonedInput } from '@/lib/business-timezone-client';
import {
	customLogRange,
	readRequestLogFilters,
	requestLogDuration,
	requestLogQuery,
} from './request-log-query';

test('default today starts at midnight in the configured business timezone', () => {
	for (const timezone of ['Asia/Shanghai', 'America/New_York']) {
		const filters = readRequestLogFilters('', timezone);
		assert.equal(filters.range.preset, 'today');
		assert.match(utcApiToZonedInput(filters.range.start_date, timezone), /T00:00$/);
	}
});
test('unbounded, one-sided and historical exact-ID lookups survive URL round trips', () => {
	for (const search of [
		'?start_date=&end_date=',
		'?start_date=2025-01-01+00%3A00%3A00',
		'?end_date=2025-01-01+00%3A00%3A00',
		'?id=historical%2Frequest',
	]) {
		const filters = readRequestLogFilters(search, 'Asia/Shanghai');
		const reloaded = readRequestLogFilters(requestLogQuery(filters).toString(), 'Asia/Shanghai');
		assert.deepEqual(reloaded, filters);
		assert.equal(filters.range.preset, 'custom');
	}
	assert.deepEqual(readRequestLogFilters('?id=old', 'Asia/Shanghai').range, {
		preset: 'custom',
		start_date: '',
		end_date: '',
	});
});
test('URL and API queries retain every filter including encoded identity and pagination', () => {
	const filters = readRequestLogFilters(
		'?page=2&status=error&model_id=model%2F1&provider_id=provider%2B1&user_email=a%2Bb%40example.com&api_key_id=key%2F1&id=log%2B1&route_group=free&protocol=gemini&start_date=&end_date=',
		'Asia/Shanghai'
	);
	const query = requestLogQuery(filters);
	assert.equal(query.get('page_size'), '50');
	assert.equal(query.get('user_email'), 'a+b@example.com');
	assert.equal(query.get('provider_id'), 'provider+1');
	assert.deepEqual(readRequestLogFilters(query.toString(), 'Asia/Shanghai'), filters);
	for (const page of ['0', '-1', 'NaN', '1.5'])
		assert.equal(readRequestLogFilters(`?page=${page}`, 'UTC').page, 1);
});
test('custom bounds convert business wall time to UTC and reject reversed or malformed ranges', () => {
	assert.deepEqual(customLogRange('2026-11-10T00:00', '2026-11-10T01:00', 'Asia/Shanghai'), {
		preset: 'custom',
		start_date: '2026-11-09 16:00:00',
		end_date: '2026-11-09 17:00:00',
	});
	assert.deepEqual(customLogRange('', '', 'Asia/Shanghai'), {
		preset: 'custom',
		start_date: '',
		end_date: '',
	});
	assert.equal(customLogRange('2026-11-10T01:00', '2026-11-10T00:00', 'Asia/Shanghai'), null);
	assert.equal(customLogRange('broken', '', 'UTC'), null);
	assert.equal(customLogRange('', '2026-11-10T00:00', 'Asia/Shanghai')?.start_date, '');
});
test('duration formatting distinguishes missing observations, zero, milliseconds and seconds', () => {
	for (const value of [null, undefined, -1, NaN, Infinity, '12'])
		assert.equal(requestLogDuration(value), '—');
	assert.equal(requestLogDuration(0), '0 ms');
	assert.equal(requestLogDuration(999), '999 ms');
	assert.equal(requestLogDuration(1000), '1 s');
	assert.equal(requestLogDuration(13432), '13.43 s');
});

test('round-trips invocation source sets and MCP service prefixes', () => {
	const filters = readRequestLogFilters(
		'?provider_ids=octafuse-tools,octafuse-mcp&model_id_prefix=mcp%3Adocs%2F&start_date=&end_date=',
		'Asia/Shanghai'
	);
	const params = requestLogQuery(filters);
	assert.equal(params.get('provider_ids'), 'octafuse-tools,octafuse-mcp');
	assert.equal(params.get('model_id_prefix'), 'mcp:docs/');
	assert.equal(params.get('start_date'), '');
});
