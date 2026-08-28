import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	buildDisplayDiscountForRoute,
	buildDisplayDiscountsByRouteGroup,
	fillDailyScheduleGaps,
	formatDisplayDiscountLabel,
	isDisplayDiscountTag,
	mergeDerivedDiscountTags,
	pickRepresentativeRoute,
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

	it('does not fill when windows are weekday-restricted', () => {
		const src = [{ start: '00:30', end: '08:30', factor: 0.5, days: [1, 2, 3, 4, 5] }];
		assert.deepEqual(fillDailyScheduleGaps(src), src);
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

describe('buildDisplayDiscountsByRouteGroup + tags', () => {
	it('groups by route_group and injects Discount.<group> from current composite', () => {
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
		const tags = mergeDerivedDiscountTags(['Hot', 'Discount:0.3', 'Discount.free:0.9'], discounts);
		assert.deepEqual(tags, ['Hot', 'Discount.default:0.7', 'Discount.free:0.5']);
	});

	it('skips derived tags when composite is full price', () => {
		const discounts = buildDisplayDiscountsByRouteGroup({
			routes: [{ status: 'active', priority: 0, weight: 1, route_group: 'default', price_override: null }],
			pricingProfileJson: null,
			timezone: 'UTC',
		});
		assert.equal(discounts.default?.current.composite_factor, 1);
		assert.deepEqual(mergeDerivedDiscountTags(['pro'], discounts), ['pro']);
	});

	it('recognizes legacy discount tags', () => {
		assert.equal(isDisplayDiscountTag('Discount:0.3'), true);
		assert.equal(isDisplayDiscountTag('Discount.free:0.5'), true);
		assert.equal(isDisplayDiscountTag('Hot'), false);
	});
});
