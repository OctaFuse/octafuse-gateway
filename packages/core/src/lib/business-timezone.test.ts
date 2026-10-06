import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	getBusinessDayWindow,
	instantToZonedDatetimeLocalInput,
	utcApiToZonedInput,
	zonedDatetimeLocalInputToInstant,
	zonedInputToUtcApi,
} from './business-timezone';

describe('business timezone UTC ↔ wall clock', () => {
	it('roundtrips Shanghai wall clock through UTC API strings', () => {
		const utc = '2026-07-09 10:00:00';
		const local = utcApiToZonedInput(utc, 'Asia/Shanghai');
		assert.equal(local, '2026-07-09T18:00');
		assert.equal(zonedInputToUtcApi(local, 'Asia/Shanghai'), utc);
	});

	it('maps Shanghai midnight to previous-day UTC', () => {
		const local = '2026-07-09T00:00';
		assert.equal(zonedInputToUtcApi(local, 'Asia/Shanghai'), '2026-07-08 16:00:00');
	});

	it('keeps optional seconds on a business-timezone wall clock', () => {
		const local = '2026-07-09T18:00:30';
		const instant = zonedDatetimeLocalInputToInstant(local, 'Asia/Shanghai');
		assert.equal(instant?.toISOString(), '2026-07-09T10:00:30.000Z');
		assert.equal(instantToZonedDatetimeLocalInput(instant!, 'Asia/Shanghai', true), local);
		assert.equal(zonedDatetimeLocalInputToInstant('2026-07-09T18:00', 'Asia/Shanghai')?.toISOString(), '2026-07-09T10:00:00.000Z');
	});

	it('getBusinessDayWindow aligns with Shanghai date key', () => {
		const now = new Date('2026-07-09T08:00:00.000Z');
		const window = getBusinessDayWindow(now, 'Asia/Shanghai');
		assert.equal(window.dateKey, '2026-07-09');
		assert.equal(window.startUtcSql, '2026-07-08 16:00:00');
		assert.equal(window.endExclusiveUtcSql, '2026-07-09 16:00:00');
	});
});
