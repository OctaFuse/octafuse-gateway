import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	apiUtcSqlStringToMs,
	clampAnalyticsRange,
	msToApiUtcSqlString,
} from './shared';

describe('apiUtcSqlStringToMs', () => {
	it('parses SQL UTC string as UTC, not local timezone', () => {
		const ms = apiUtcSqlStringToMs('2026-05-19 13:00:00');
		assert.equal(ms, Date.parse('2026-05-19T13:00:00.000Z'));
	});

	it('parses ISO strings with T separator', () => {
		assert.equal(apiUtcSqlStringToMs('2026-05-19T13:00:00Z'), Date.parse('2026-05-19T13:00:00.000Z'));
	});
});

describe('clampAnalyticsRange', () => {
	it('preserves UTC boundaries when start/end are SQL UTC strings (no local shift)', () => {
		const start = '2026-05-19 05:00:00';
		const end = '2026-05-19 13:00:00';
		const result = clampAnalyticsRange(start, end);
		assert.equal(result.start, start);
		assert.equal(result.end, end);
	});

	it('does not shift end by 8h compared to legacy local Date parsing', () => {
		const end = '2026-05-19 13:00:00';
		const legacyLocalEnd = new Date(end).toISOString().slice(0, 19).replace('T', ' ');
		const fixed = clampAnalyticsRange('2026-05-19 05:00:00', end).end;
		// In UTC+8, legacy path would produce 05:00:00 instead of 13:00:00
		if (legacyLocalEnd !== end) {
			assert.notEqual(fixed, legacyLocalEnd);
		}
		assert.equal(fixed, end);
	});

	it('clamps start to at most 180 days before end', () => {
		const end = '2026-05-19 13:00:00';
		const endMs = apiUtcSqlStringToMs(end);
		const result = clampAnalyticsRange('2020-01-01 00:00:00', end);
		const startMs = apiUtcSqlStringToMs(result.start);
		const maxStartMs = endMs - 180 * 24 * 60 * 60 * 1000;
		assert.ok(startMs >= maxStartMs - 1000);
		assert.equal(result.end, end);
	});

	it('defaults to 7-day window when start is omitted', () => {
		const end = '2026-05-19 13:00:00';
		const endMs = apiUtcSqlStringToMs(end);
		const result = clampAnalyticsRange(undefined, end);
		const startMs = apiUtcSqlStringToMs(result.start);
		assert.equal(result.end, end);
		assert.equal(startMs, endMs - 7 * 24 * 60 * 60 * 1000);
	});
});

describe('msToApiUtcSqlString', () => {
	it('formats UTC ms as SQL string', () => {
		const ms = Date.parse('2026-05-19T13:00:00.000Z');
		assert.equal(msToApiUtcSqlString(ms), '2026-05-19 13:00:00');
	});
});
