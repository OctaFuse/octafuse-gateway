import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	buildDisplayDiscountForRoute,
	buildDisplayDiscountsByRouteGroup,
	fillDailyScheduleGaps,
	formatDisplayDiscountLabel,
	pickRepresentativeRoute,
	applyUserChargedFactorToDisplayDiscounts,
} from './display-discount';

function profileWithSchedule(
	windows: Array<{ start: string; end: string; factor: number; days?: number[] }>
): string {
	return JSON.stringify({
		tiers: [{ upto: null, label: null, input_price: 1, output_price: 1 }],
		schedule: windows,
	});
}

describe('pickRepresentativeRoute', () => {
	const discountContext = { timezone: 'UTC', pricingProfileJson: null as string | null };

	it('picks highest priority then highest weight among active routes', () => {
		const picked = pickRepresentativeRoute([
			{ status: 'active', priority: 5, weight: 9, price_override: null },
			{ status: 'disabled', priority: 99, weight: 99, price_override: null },
			{ status: 'active', priority: 10, weight: 1, price_override: null },
			{ status: 'active', priority: 10, weight: 5, price_override: '{"charged_factor":0.7}' },
		]);
		assert.equal(picked?.weight, 5);
		assert.equal(picked?.price_override, '{"charged_factor":0.7}');
	});

	it('breaks equal priority and weight by lowest current composite_factor', () => {
		const cheaper = JSON.stringify({ charged_factor: 0.5 });
		const picked = pickRepresentativeRoute(
			[
				{ status: 'active', priority: 10, weight: 1, price_override: JSON.stringify({ charged_factor: 0.8 }) },
				{ status: 'active', priority: 10, weight: 1, price_override: cheaper },
			],
			discountContext
		);
		assert.equal(picked?.price_override, cheaper);
	});

	it('still prefers higher weight even when that route is more expensive', () => {
		const expensive = JSON.stringify({ charged_factor: 0.9 });
		const picked = pickRepresentativeRoute(
			[
				{ status: 'active', priority: 10, weight: 1, price_override: JSON.stringify({ charged_factor: 0.5 }) },
				{ status: 'active', priority: 10, weight: 3, price_override: expensive },
			],
			discountContext
		);
		assert.equal(picked?.weight, 3);
		assert.equal(picked?.price_override, expensive);
	});

	it('breaks equal priority and weight by current schedule composite', () => {
		const cheaperNow = JSON.stringify({
			charged_factor: 1,
			schedule: {
				mode: 'override',
				charged: [{ start: '00:00', end: '12:00', factor: 0.4 }],
			},
		});
		const later = JSON.stringify({ charged_factor: 0.8 });
		const ctx = {
			...discountContext,
			now: new Date('2026-08-28T06:00:00.000Z'),
		};
		const picked = pickRepresentativeRoute(
			[
				{ status: 'active', priority: 1, weight: 1, price_override: later },
				{ status: 'active', priority: 1, weight: 1, price_override: cheaperNow },
			],
			ctx
		);
		assert.equal(picked?.price_override, cheaperNow);
	});
});

describe('fillDailyScheduleGaps', () => {
	it('adds factor-1 windows for uncovered hours', () => {
		const filled = fillDailyScheduleGaps([{ start: '00:30', end: '08:30', factor: 0.5 }]);
		const gaps = filled.filter((w) => w.factor === 1);
		assert.equal(gaps.length, 2);
		assert.deepEqual(
			gaps.map((w) => `${w.start}-${w.end}`).sort(),
			['00:00-00:30', '08:30-24:00']
		);
	});

	it('fills weekday gaps and weekend full-day windows', () => {
		const src = [{ start: '00:30', end: '08:30', factor: 0.5, days: [1, 2, 3, 4, 5] }];
		const filled = fillDailyScheduleGaps(src);
		const weekdayMorning = filled.find((w) => w.start === '00:00' && w.end === '00:30');
		const weekdayRest = filled.find((w) => w.start === '08:30' && w.end === '24:00');
		const weekend = filled.find((w) => w.start === '00:00' && w.end === '24:00');
		assert.deepEqual(weekdayMorning?.days, [1, 2, 3, 4, 5]);
		assert.deepEqual(weekdayRest?.days, [1, 2, 3, 4, 5]);
		assert.deepEqual(weekend?.days, [6, 7]);
		assert.equal(weekdayMorning?.factor, 1);
		assert.equal(weekend?.factor, 1);
	});
});

describe('buildDisplayDiscountForRoute', () => {
	it('returns flat charged factor when there is no schedule', () => {
		const group = buildDisplayDiscountForRoute({
			pricingProfileJson: JSON.stringify({
				tiers: [{ upto: null, label: null, input_price: 1, output_price: 1 }],
			}),
			priceOverrideJson: JSON.stringify({ charged_factor: 0.7 }),
			timezone: 'Asia/Shanghai',
			priority: 10,
			weight: 2,
		});
		assert.equal(group.kind, 'flat');
		assert.equal(group.windows[0]!.composite_factor, 0.7);
		assert.equal(group.current.composite_factor, 0.7);
		assert.equal(group.route.priority, 10);
		assert.equal(formatDisplayDiscountLabel(group.current.composite_factor), '-30%');
	});

	it('override mode: catalog off-peak times route window factor', () => {
		const group = buildDisplayDiscountForRoute({
			pricingProfileJson: profileWithSchedule([{ start: '00:30', end: '08:30', factor: 0.5 }]),
			priceOverrideJson: JSON.stringify({
				charged_factor: 1,
				schedule: {
					mode: 'override',
					charged: [
						{ start: '00:30', end: '08:30', factor: 0.9 },
						{ start: '08:30', end: '24:00', factor: 0.7 },
						{ start: '00:00', end: '00:30', factor: 0.7 },
					],
				},
			}),
			timezone: 'Asia/Shanghai',
			priority: 1,
			weight: 1,
			now: new Date('2026-08-28T00:00:00.000Z'),
		});
		assert.equal(group.kind, 'schedule');
		const offpeak = group.windows.find((w) => w.start === '00:30' && w.end === '08:30');
		assert.ok(offpeak);
		assert.equal(offpeak!.catalog_factor, 0.5);
		assert.equal(offpeak!.route_factor, 0.9);
		assert.equal(offpeak!.composite_factor, 0.45);
		const peakish = group.windows.find((w) => w.start === '08:30' && w.end === '24:00');
		assert.ok(peakish);
		assert.equal(peakish!.catalog_factor, 1);
		assert.equal(peakish!.route_factor, 0.7);
		assert.equal(peakish!.composite_factor, 0.7);
	});

	it('multiply mode stacks base charged with window factor', () => {
		const group = buildDisplayDiscountForRoute({
			pricingProfileJson: profileWithSchedule([{ start: '00:00', end: '08:00', factor: 0.5 }]),
			priceOverrideJson: JSON.stringify({
				charged_factor: 0.8,
				schedule: {
					mode: 'multiply',
					charged: [{ start: '00:00', end: '08:00', factor: 0.5 }],
				},
			}),
			timezone: 'UTC',
			priority: 0,
			weight: 1,
		});
		const night = group.windows.find((w) => w.start === '00:00' && w.end === '08:00');
		assert.ok(night);
		assert.equal(night!.catalog_factor, 0.5);
		assert.equal(night!.route_factor, 0.4);
		assert.equal(night!.composite_factor, 0.2);
	});

	it('applies route charged windows when catalog only locks business hours', () => {
		const group = buildDisplayDiscountForRoute({
			pricingProfileJson: profileWithSchedule([
				{ start: '09:00', end: '12:00', factor: 1 },
				{ start: '14:00', end: '18:00', factor: 1 },
			]),
			priceOverrideJson: JSON.stringify({
				charged_factor: 1,
				metered_factor: 0.5,
				schedule: {
					mode: 'override',
					charged: [
						{ start: '09:00', end: '12:00', factor: 0.8 },
						{ start: '14:00', end: '18:00', factor: 0.7 },
					],
				},
			}),
			timezone: 'Asia/Shanghai',
			priority: 2,
			weight: 1,
		});
		const morning = group.windows.find((w) => w.start === '09:00' && w.end === '12:00');
		const afternoon = group.windows.find((w) => w.start === '14:00' && w.end === '18:00');
		assert.ok(morning);
		assert.ok(afternoon);
		assert.equal(morning!.route_factor, 0.8);
		assert.equal(morning!.composite_factor, 0.8);
		assert.equal(afternoon!.route_factor, 0.7);
		assert.equal(afternoon!.composite_factor, 0.7);
		assert.equal(formatDisplayDiscountLabel(morning!.composite_factor), '-20%');
		assert.equal(formatDisplayDiscountLabel(afternoon!.composite_factor), '-30%');
	});

	it('keeps official weekday peak hours as schedule instead of flattening', () => {
		const group = buildDisplayDiscountForRoute({
			pricingProfileJson: profileWithSchedule([
				{ start: '09:00', end: '12:00', factor: 2, days: [1, 2, 3, 4, 5] },
				{ start: '14:00', end: '18:00', factor: 2, days: [1, 2, 3, 4, 5] },
			]),
			priceOverrideJson: JSON.stringify({ charged_factor: 0.8 }),
			timezone: 'Asia/Shanghai',
			priority: 8,
			weight: 1,
			now: new Date('2026-08-28T03:00:00.000Z'),
		});
		assert.equal(group.kind, 'schedule');
		const morning = group.windows.find((w) => w.start === '09:00' && w.end === '12:00');
		const noonGap = group.windows.find((w) => w.start === '12:00' && w.end === '14:00');
		assert.ok(morning);
		assert.ok(noonGap);
		assert.equal(morning!.catalog_factor, 2);
		assert.equal(morning!.composite_factor, 1.6);
		assert.equal(noonGap!.catalog_factor, 1);
		assert.equal(noonGap!.composite_factor, 0.8);
	});

	it('fills overnight catalog windows without inventing extra days', () => {
		const group = buildDisplayDiscountForRoute({
			pricingProfileJson: profileWithSchedule([{ start: '22:00', end: '06:00', factor: 0.5 }]),
			priceOverrideJson: JSON.stringify({ charged_factor: 1 }),
			timezone: 'UTC',
			priority: 0,
			weight: 1,
		});
		assert.equal(group.kind, 'schedule');
		const night = group.windows.find((w) => w.start === '22:00' && w.end === '06:00');
		assert.ok(night);
		assert.equal(night!.composite_factor, 0.5);
	});
});

describe('buildDisplayDiscountsByRouteGroup', () => {
	it('groups by route_group from current composite', () => {
		const discounts = buildDisplayDiscountsByRouteGroup({
			routes: [
				{
					status: 'active',
					priority: 1,
					weight: 1,
					route_group: 'default',
					price_override: JSON.stringify({ charged_factor: 0.7 }),
				},
				{
					status: 'active',
					priority: 1,
					weight: 1,
					route_group: 'free',
					price_override: JSON.stringify({ charged_factor: 0.5 }),
				},
			],
			pricingProfileJson: JSON.stringify({
				tiers: [{ upto: null, label: null, input_price: 1, output_price: 1 }],
			}),
			timezone: 'UTC',
			allowedRouteGroups: ['default', 'free'],
		});
		assert.equal(discounts.default?.current.composite_factor, 0.7);
		assert.equal(discounts.free?.current.composite_factor, 0.5);
	});

	it('picks the cheapest current composite when priority and weight are tied', () => {
		const discounts = buildDisplayDiscountsByRouteGroup({
			routes: [
				{
					status: 'active',
					priority: 10,
					weight: 1,
					route_group: 'default',
					price_override: JSON.stringify({ charged_factor: 0.8 }),
				},
				{
					status: 'active',
					priority: 10,
					weight: 1,
					route_group: 'default',
					price_override: JSON.stringify({ charged_factor: 0.5 }),
				},
			],
			pricingProfileJson: null,
			timezone: 'UTC',
		});
		assert.equal(discounts.default?.current.composite_factor, 0.5);
		assert.equal(discounts.default?.route.priority, 10);
		assert.equal(discounts.default?.route.weight, 1);
	});

	it('keeps full-price composite at 1', () => {
		const discounts = buildDisplayDiscountsByRouteGroup({
			routes: [{ status: 'active', priority: 0, weight: 1, route_group: 'default', price_override: null }],
			pricingProfileJson: null,
			timezone: 'UTC',
		});
		assert.equal(discounts.default?.current.composite_factor, 1);
	});
});

describe('applyUserChargedFactorToDisplayDiscounts', () => {
	const catalog = {
		default: {
			timezone: 'Asia/Shanghai',
			kind: 'flat' as const,
			schedule_mode: 'multiply' as const,
			route: { priority: 10, weight: 1 },
			current: { catalog_factor: 1.6, route_factor: 0.8, composite_factor: 1.28 },
			windows: [{ catalog_factor: 1.6, route_factor: 0.8, composite_factor: 1.28 }],
		},
	};

	it('leaves catalog discounts unchanged when the user factor is missing', () => {
		assert.equal(applyUserChargedFactorToDisplayDiscounts(catalog, null, 'min'), catalog);
		assert.equal(applyUserChargedFactorToDisplayDiscounts(catalog, undefined, 'multiply'), catalog);
	});

	it('multiplies the route factor and keeps the official catalog factor', () => {
		const out = applyUserChargedFactorToDisplayDiscounts(catalog, 0.5, 'multiply');
		assert.equal(out.default?.current.catalog_factor, 1.6);
		assert.equal(out.default?.current.route_factor, 0.4);
		assert.equal(out.default?.current.composite_factor, 0.64);
		assert.equal(out.default?.windows[0]?.composite_factor, 0.64);
	});

	it('takes the smaller charged factor in min mode', () => {
		const cheaperUser = applyUserChargedFactorToDisplayDiscounts(catalog, 0.5, 'min');
		assert.equal(cheaperUser.default?.current.catalog_factor, 1.6);
		assert.equal(cheaperUser.default?.current.route_factor, 0.5);
		assert.equal(cheaperUser.default?.current.composite_factor, 0.8);

		const cheaperRoute = applyUserChargedFactorToDisplayDiscounts(catalog, 0.9, 'min');
		assert.equal(cheaperRoute.default?.current.route_factor, 0.8);
		assert.equal(cheaperRoute.default?.current.composite_factor, 1.28);
	});
});
