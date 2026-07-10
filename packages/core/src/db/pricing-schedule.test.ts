import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	coerceRoutePricingScheduleInput,
	findDailyWindowOverlap,
	formatLocalHhMm,
	parseHhMmToMinutes,
	parseRouteBaseFactors,
	parseRoutePricingSchedule,
	resolveDailyScheduleFactor,
	scaleBillingPrices,
} from './pricing-schedule';

describe('parseHhMmToMinutes', () => {
	it('parses HH:mm and 24:00', () => {
		assert.equal(parseHhMmToMinutes('00:00'), 0);
		assert.equal(parseHhMmToMinutes('08:30'), 8 * 60 + 30);
		assert.equal(parseHhMmToMinutes('24:00'), 24 * 60);
		assert.equal(parseHhMmToMinutes('25:00'), null);
	});
});

describe('parseRouteBaseFactors', () => {
	it('defaults to 1 and falls back provider_factor for metered', () => {
		assert.deepEqual(parseRouteBaseFactors(null), { chargedFactor: 1, meteredFactor: 1 });
		assert.deepEqual(parseRouteBaseFactors('{"charged_factor":1.2,"metered_factor":0.8}'), {
			chargedFactor: 1.2,
			meteredFactor: 0.8,
		});
		assert.deepEqual(parseRouteBaseFactors('{"provider_factor":0.5}'), {
			chargedFactor: 1,
			meteredFactor: 0.5,
		});
	});
});

describe('parseRoutePricingSchedule', () => {
	it('returns empty sides when missing', () => {
		assert.deepEqual(parseRoutePricingSchedule('{}'), { charged: [], metered: [] });
		assert.deepEqual(parseRoutePricingSchedule('{"metered":{"tiers":[]}}'), {
			charged: [],
			metered: [],
		});
	});

	it('parses valid windows', () => {
		const sch = parseRoutePricingSchedule(
			JSON.stringify({
				schedule: {
					charged: [{ start: '00:00', end: '08:00', factor: 0.5 }],
					metered: [{ start: '22:00', end: '06:00', factor: 0.8 }],
				},
			})
		);
		assert.equal(sch.charged.length, 1);
		assert.equal(sch.metered[0]!.factor, 0.8);
	});

	it('drops invalid 24:00 starts and zero-duration windows defensively', () => {
		const sch = parseRoutePricingSchedule(
			JSON.stringify({
				schedule: {
					charged: [
						{ start: '24:00', end: '08:00', factor: 0.5 },
						{ start: '08:00', end: '08:00', factor: 0.5 },
					],
				},
			})
		);
		assert.deepEqual(sch.charged, []);
	});
});

describe('resolveDailyScheduleFactor', () => {
	const windows = [
		{ start: '00:00', end: '08:00', factor: 0.5 },
		{ start: '08:00', end: '24:00', factor: 1.2 },
	];

	it('matches daytime window in Asia/Shanghai', () => {
		const now = new Date('2026-07-10T00:00:00.000Z');
		assert.equal(formatLocalHhMm(now, 'Asia/Shanghai'), '08:00');
		const r = resolveDailyScheduleFactor(windows, now, 'Asia/Shanghai');
		assert.equal(r.factor, 1.2);
		assert.equal(r.window?.start, '08:00');
		assert.equal(r.evaluatedAtUtc, now.toISOString());
	});

	it('matches early window', () => {
		const now = new Date('2026-07-09T16:30:00.000Z');
		const r = resolveDailyScheduleFactor(windows, now, 'Asia/Shanghai');
		assert.equal(r.localTime, '00:30');
		assert.equal(r.factor, 0.5);
	});

	it('returns 1 when no windows', () => {
		const r = resolveDailyScheduleFactor([], new Date(), 'UTC');
		assert.equal(r.factor, 1);
		assert.equal(r.window, null);
	});

	it('handles overnight windows', () => {
		const overnight = [{ start: '22:00', end: '06:00', factor: 0.3 }];
		const late = resolveDailyScheduleFactor(
			overnight,
			new Date('2026-07-10T15:00:00.000Z'),
			'Asia/Shanghai'
		);
		assert.equal(late.factor, 0.3);
		const mid = resolveDailyScheduleFactor(
			overnight,
			new Date('2026-07-10T04:00:00.000Z'),
			'Asia/Shanghai'
		);
		assert.equal(mid.factor, 1);
	});
});

describe('scaleBillingPrices', () => {
	it('scales finite prices and keeps null', () => {
		assert.deepEqual(
			scaleBillingPrices(
				{ input_price: 1, output_price: 2, cache_read_price: null, cache_write_price: 0.5 },
				0.5
			),
			{
				input_price: 0.5,
				output_price: 1,
				cache_read_price: null,
				cache_write_price: 0.25,
			}
		);
	});
});

describe('findDailyWindowOverlap / coerce', () => {
	it('detects overlap', () => {
		const msg = findDailyWindowOverlap([
			{ start: '00:00', end: '10:00', factor: 1 },
			{ start: '09:00', end: '12:00', factor: 1 },
		]);
		assert.match(msg ?? '', /overlapping/);
	});

	it('coerce rejects overlap', () => {
		const r = coerceRoutePricingScheduleInput({
			charged: [
				{ start: '00:00', end: '10:00', factor: 1 },
				{ start: '09:00', end: '12:00', factor: 1 },
			],
		});
		assert.equal(r.ok, false);
	});

	it('coerce accepts valid schedule', () => {
		const r = coerceRoutePricingScheduleInput({
			charged: [{ start: '00:00', end: '08:00', factor: 0.5 }],
			metered: [],
		});
		assert.equal(r.ok, true);
		if (r.ok) {
			assert.equal(r.schedule.charged.length, 1);
		}
	});

	it('coerce rejects 24:00 as start and accepts it as end', () => {
		const invalid = coerceRoutePricingScheduleInput({
			charged: [{ start: '24:00', end: '00:00', factor: 1 }],
		});
		assert.equal(invalid.ok, false);

		const valid = coerceRoutePricingScheduleInput({
			charged: [{ start: '08:00', end: '24:00', factor: 1 }],
		});
		assert.equal(valid.ok, true);
	});
});
