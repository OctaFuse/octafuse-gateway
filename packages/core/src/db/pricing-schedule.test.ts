import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	coerceRoutePricingScheduleInput,
	findDailyWindowOverlap,
	formatIsoWeekdaysHint,
	formatLocalHhMm,
	formatLocalIsoWeekday,
	mergeScheduleSidesToSharedWindows,
	parseHhMmToMinutes,
	parseRouteBaseFactors,
	parseRoutePricingSchedule,
	resolveDailyScheduleFactor,
	resolveEffectiveRouteFactor,
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
		assert.deepEqual(parseRoutePricingSchedule('{}'), { mode: 'multiply', charged: [], metered: [] });
		assert.deepEqual(parseRoutePricingSchedule('{"metered":{"tiers":[]}}'), {
			mode: 'multiply',
			charged: [],
			metered: [],
		});
	});

	it('parses override mode', () => {
		const sch = parseRoutePricingSchedule(
			JSON.stringify({
				schedule: {
					mode: 'override',
					charged: [{ start: '09:00', end: '12:00', factor: 2 }],
				},
			})
		);
		assert.equal(sch.mode, 'override');
		assert.equal(sch.charged[0]!.factor, 2);
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

	it('parses optional ISO days and treats a full week as every day', () => {
		const sch = parseRoutePricingSchedule(
			JSON.stringify({
				schedule: {
					charged: [{ start: '00:00', end: '24:00', factor: 1.2, days: [1, 2, 3, 4, 5] }],
					metered: [{ start: '00:00', end: '24:00', factor: 0.8, days: [1, 2, 3, 4, 5, 6, 7] }],
				},
			})
		);
		assert.deepEqual(sch.charged[0]!.days, [1, 2, 3, 4, 5]);
		assert.equal(sch.metered[0]!.days, undefined);
	});

	it('drops windows with empty or out-of-range days', () => {
		const sch = parseRoutePricingSchedule(
			JSON.stringify({
				schedule: {
					charged: [
						{ start: '00:00', end: '08:00', factor: 0.5, days: [] },
						{ start: '08:00', end: '12:00', factor: 0.5, days: [0] },
						{ start: '12:00', end: '18:00', factor: 0.5, days: [8] },
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

	it('treats omitted days as every weekday', () => {
		const now = new Date('2026-07-11T00:00:00.000Z'); // Sat 08:00 Asia/Shanghai
		assert.equal(formatLocalIsoWeekday(now, 'Asia/Shanghai'), 6);
		const r = resolveDailyScheduleFactor(windows, now, 'Asia/Shanghai');
		assert.equal(r.factor, 1.2);
		assert.equal(r.localWeekday, 6);
	});

	it('matches weekday-only and weekend-only all-day windows', () => {
		const split = [
			{ start: '00:00', end: '24:00', factor: 1.2, days: [1, 2, 3, 4, 5] },
			{ start: '00:00', end: '24:00', factor: 0.8, days: [6, 7] },
		];
		const friday = resolveDailyScheduleFactor(
			split,
			new Date('2026-07-10T00:00:00.000Z'),
			'Asia/Shanghai'
		);
		assert.equal(friday.localWeekday, 5);
		assert.equal(friday.factor, 1.2);
		const saturday = resolveDailyScheduleFactor(
			split,
			new Date('2026-07-11T00:00:00.000Z'),
			'Asia/Shanghai'
		);
		assert.equal(saturday.localWeekday, 6);
		assert.equal(saturday.factor, 0.8);
	});

	it('anchors overnight days to the start weekday', () => {
		const fridayNight = [{ start: '22:00', end: '06:00', factor: 0.3, days: [5] }];
		const fridayLate = resolveDailyScheduleFactor(
			fridayNight,
			new Date('2026-07-10T14:30:00.000Z'), // Fri 22:30 Asia/Shanghai
			'Asia/Shanghai'
		);
		assert.equal(fridayLate.localTime, '22:30');
		assert.equal(fridayLate.factor, 0.3);
		const saturdayEarly = resolveDailyScheduleFactor(
			fridayNight,
			new Date('2026-07-10T19:00:00.000Z'), // Sat 03:00 Asia/Shanghai
			'Asia/Shanghai'
		);
		assert.equal(saturdayEarly.localWeekday, 6);
		assert.equal(saturdayEarly.factor, 0.3);
		const saturdayLate = resolveDailyScheduleFactor(
			fridayNight,
			new Date('2026-07-11T14:30:00.000Z'), // Sat 22:30 Asia/Shanghai
			'Asia/Shanghai'
		);
		assert.equal(saturdayLate.factor, 1);
		assert.equal(saturdayLate.window, null);
	});
});

describe('scaleBillingPrices', () => {
	it('scales finite prices and keeps null', () => {
		assert.deepEqual(
			scaleBillingPrices(
				{
					input_price: 1,
					output_price: 2,
					cache_read_price: null,
					cache_write_price: 0.5,
					image_input_price: 8,
					image_input_cache_price: null,
					image_output_price: 30,
				},
				0.5
			),
			{
				input_price: 0.5,
				output_price: 1,
				cache_read_price: null,
				cache_write_price: 0.25,
				image_input_price: 4,
				image_input_cache_price: null,
				image_output_price: 15,
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
			assert.equal(r.schedule.mode, 'multiply');
			assert.equal(r.persistMode, false);
		}
	});

	it('coerce persists override mode and rejects unknown mode', () => {
		const ok = coerceRoutePricingScheduleInput({
			mode: 'override',
			charged: [{ start: '09:00', end: '12:00', factor: 2 }],
		});
		assert.equal(ok.ok, true);
		if (ok.ok) {
			assert.equal(ok.schedule.mode, 'override');
			assert.equal(ok.persistMode, true);
		}
		const bad = coerceRoutePricingScheduleInput({ mode: 'divide' });
		assert.equal(bad.ok, false);
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

	it('allows weekday and weekend all-day windows on the same side', () => {
		const r = coerceRoutePricingScheduleInput({
			mode: 'override',
			charged: [
				{ start: '00:00', end: '24:00', factor: 1.2, days: [1, 2, 3, 4, 5] },
				{ start: '00:00', end: '24:00', factor: 0.8, days: [6, 7] },
			],
		});
		assert.equal(r.ok, true);
		if (r.ok) {
			assert.deepEqual(r.schedule.charged[0]!.days, [1, 2, 3, 4, 5]);
			assert.deepEqual(r.schedule.charged[1]!.days, [6, 7]);
		}
	});

	it('rejects a weekday window that overlaps a daily window', () => {
		const r = coerceRoutePricingScheduleInput({
			charged: [
				{ start: '09:00', end: '18:00', factor: 2, days: [1, 2, 3, 4, 5] },
				{ start: '10:00', end: '12:00', factor: 1.5 },
			],
		});
		assert.equal(r.ok, false);
		if (!r.ok) {
			assert.match(r.message, /overlapping/);
		}
	});

	it('rejects empty, out-of-range, and duplicate-invalid days', () => {
		assert.equal(
			coerceRoutePricingScheduleInput({
				charged: [{ start: '00:00', end: '08:00', factor: 1, days: [] }],
			}).ok,
			false
		);
		assert.equal(
			coerceRoutePricingScheduleInput({
				charged: [{ start: '00:00', end: '08:00', factor: 1, days: [0] }],
			}).ok,
			false
		);
		assert.equal(
			coerceRoutePricingScheduleInput({
				charged: [{ start: '00:00', end: '08:00', factor: 1, days: [8] }],
			}).ok,
			false
		);
		const deduped = coerceRoutePricingScheduleInput({
			charged: [{ start: '00:00', end: '08:00', factor: 1, days: [1, 1, 2] }],
		});
		assert.equal(deduped.ok, true);
		if (deduped.ok) {
			assert.deepEqual(deduped.schedule.charged[0]!.days, [1, 2]);
		}
	});

	it('omits a full-week days array when coercing', () => {
		const r = coerceRoutePricingScheduleInput({
			charged: [{ start: '00:00', end: '08:00', factor: 1, days: [1, 2, 3, 4, 5, 6, 7] }],
		});
		assert.equal(r.ok, true);
		if (r.ok) {
			assert.equal(r.schedule.charged[0]!.days, undefined);
		}
	});
});

describe('formatIsoWeekdaysHint', () => {
	it('returns compact weekday labels', () => {
		assert.equal(formatIsoWeekdaysHint(undefined), null);
		assert.equal(formatIsoWeekdaysHint([1, 2, 3, 4, 5]), 'Mon–Fri');
		assert.equal(formatIsoWeekdaysHint([6, 7]), 'Sat–Sun');
		assert.equal(formatIsoWeekdaysHint([1, 3, 5]), 'Mon, Wed, Fri');
	});
});

describe('resolveEffectiveRouteFactor', () => {
	const hit = {
		factor: 2,
		localTime: '10:00',
		localWeekday: 5,
		timezone: 'Asia/Shanghai',
		evaluatedAtUtc: '2026-07-10T02:00:00.000Z',
		window: { start: '09:00', end: '12:00', factor: 2 },
	};
	const miss = {
		factor: 1,
		localTime: '08:00',
		localWeekday: 5,
		timezone: 'Asia/Shanghai',
		evaluatedAtUtc: '2026-07-10T00:00:00.000Z',
		window: null,
	};

	it('multiplies on legacy mode and overrides on override mode', () => {
		assert.equal(resolveEffectiveRouteFactor(1.2, hit, 'multiply'), 2.4);
		assert.equal(resolveEffectiveRouteFactor(1.2, hit, 'override'), 2);
		assert.equal(resolveEffectiveRouteFactor(1.2, miss, 'multiply'), 1.2);
		assert.equal(resolveEffectiveRouteFactor(1.2, miss, 'override'), 1.2);
	});
});

describe('mergeScheduleSidesToSharedWindows', () => {
	it('bakes multiply factors so open-save keeps the same effective rate', () => {
		const rows = mergeScheduleSidesToSharedWindows(
			[{ start: '09:00', end: '12:00', factor: 0.5 }],
			[{ start: '09:00', end: '12:00', factor: 0.5 }],
			{ mode: 'multiply', chargedBase: 1.2, meteredBase: 1 }
		);
		assert.deepEqual(rows, [
			{ start: '09:00', end: '12:00', charged_factor: 0.6, metered_factor: 0.5 },
		]);
	});

	it('keeps override window factors as-is', () => {
		const rows = mergeScheduleSidesToSharedWindows(
			[{ start: '09:00', end: '12:00', factor: 2 }],
			[{ start: '09:00', end: '12:00', factor: 2 }],
			{ mode: 'override', chargedBase: 1, meteredBase: 1 }
		);
		assert.deepEqual(rows, [
			{ start: '09:00', end: '12:00', charged_factor: 2, metered_factor: 2 },
		]);
	});

	it('splits asymmetric windows and fills the missing side with the default', () => {
		const rows = mergeScheduleSidesToSharedWindows(
			[{ start: '09:00', end: '12:00', factor: 2 }],
			[{ start: '09:00', end: '18:00', factor: 1.5 }],
			{ mode: 'multiply', chargedBase: 1, meteredBase: 1 }
		);
		assert.deepEqual(rows, [
			{ start: '09:00', end: '12:00', charged_factor: 2, metered_factor: 1.5 },
			{ start: '12:00', end: '18:00', charged_factor: 1, metered_factor: 1.5 },
		]);
	});

	it('rejoins overnight segments that share factors', () => {
		const rows = mergeScheduleSidesToSharedWindows(
			[{ start: '22:00', end: '06:00', factor: 0.5 }],
			[{ start: '22:00', end: '06:00', factor: 0.5 }],
			{ mode: 'override', chargedBase: 1, meteredBase: 1 }
		);
		assert.deepEqual(rows, [
			{ start: '22:00', end: '06:00', charged_factor: 0.5, metered_factor: 0.5 },
		]);
	});

	it('keeps weekday and weekend windows on separate rows', () => {
		const rows = mergeScheduleSidesToSharedWindows(
			[
				{ start: '00:00', end: '24:00', factor: 1.2, days: [1, 2, 3, 4, 5] },
				{ start: '00:00', end: '24:00', factor: 0.8, days: [6, 7] },
			],
			[
				{ start: '00:00', end: '24:00', factor: 1.2, days: [1, 2, 3, 4, 5] },
				{ start: '00:00', end: '24:00', factor: 0.8, days: [6, 7] },
			],
			{ mode: 'override', chargedBase: 1, meteredBase: 1 }
		);
		assert.deepEqual(rows, [
			{ start: '00:00', end: '24:00', charged_factor: 1.2, metered_factor: 1.2, days: [1, 2, 3, 4, 5] },
			{ start: '00:00', end: '24:00', charged_factor: 0.8, metered_factor: 0.8, days: [6, 7] },
		]);
	});

	it('does not bake weekday-only charged into a weekend metered row', () => {
		const rows = mergeScheduleSidesToSharedWindows(
			[{ start: '09:00', end: '18:00', factor: 2, days: [1, 2, 3, 4, 5] }],
			[{ start: '09:00', end: '18:00', factor: 1.5, days: [6, 7] }],
			{ mode: 'override', chargedBase: 1, meteredBase: 1 }
		);
		assert.deepEqual(rows, [
			{ start: '09:00', end: '18:00', charged_factor: 2, metered_factor: 1, days: [1, 2, 3, 4, 5] },
			{ start: '09:00', end: '18:00', charged_factor: 1, metered_factor: 1.5, days: [6, 7] },
		]);
	});
});
