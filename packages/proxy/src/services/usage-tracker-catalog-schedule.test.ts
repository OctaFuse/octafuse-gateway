import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	parsePricingProfile,
	parseRouteBaseFactors,
	parseRoutePricingSchedule,
	resolveChargedBillingPrices,
	resolveDailyScheduleFactor,
	resolveEffectiveRouteFactor,
	resolveStandardBillingPrices,
	resolveSupplierBillingPrices,
	scaleBillingPrices,
	toScheduleAudit,
} from '@octafuse/core';
import { computeMeteredCost } from './usage-tracker';

const PROFILE = JSON.stringify({
	tiers: [{ upto: null, input_price: 4, output_price: 12 }],
	schedule: [
		{ start: '23:00', end: '02:00', factor: 0.5 },
		{ start: '09:00', end: '12:00', factor: 1.6, days: [1, 2, 3, 4, 5] },
	],
});

const ROUTE = JSON.stringify({
	charged_factor: 1,
	metered_factor: 1,
	schedule: {
		mode: 'override',
		charged: [
			{ start: '23:00', end: '02:00', factor: 0.8 },
			{ start: '09:00', end: '12:00', factor: 1.1, days: [1, 2, 3, 4, 5] },
		],
		metered: [
			{ start: '23:00', end: '02:00', factor: 1.2 },
			{ start: '09:00', end: '12:00', factor: 0.9, days: [1, 2, 3, 4, 5] },
		],
	},
});

const USAGE = {
	input_tokens: 1_000_000,
	output_tokens: 0,
	cache_read_tokens: 0,
	cache_write_tokens: 0,
};

function settleAt(utcIso: string) {
	const pricingAtUtc = new Date(utcIso);
	const businessTimezone = 'Asia/Shanghai';
	const profile = parsePricingProfile(PROFILE);
	assert.ok(profile);
	const catalogSch = resolveDailyScheduleFactor(profile.schedule, pricingAtUtc, businessTimezone);
	const catalogSchedule = toScheduleAudit(catalogSch);
	const baseFactors = parseRouteBaseFactors(ROUTE);
	const schedule = parseRoutePricingSchedule(ROUTE);
	const chargedSch = resolveDailyScheduleFactor(schedule.charged, pricingAtUtc, businessTimezone);
	const meteredSch = resolveDailyScheduleFactor(schedule.metered, pricingAtUtc, businessTimezone);
	const standard = resolveStandardBillingPrices({
		basisInputTokens: USAGE.input_tokens,
		modelPricingProfileJson: PROFILE,
		catalogScheduleFactor: catalogSch.factor,
		catalogSchedule,
	});
	const supplier = resolveSupplierBillingPrices({
		basisInputTokens: USAGE.input_tokens,
		modelPricingProfileJson: PROFILE,
		catalogScheduleFactor: catalogSch.factor,
		catalogSchedule,
	});
	const charged = resolveChargedBillingPrices({
		basisInputTokens: USAGE.input_tokens,
		modelPricingProfileJson: PROFILE,
		catalogScheduleFactor: catalogSch.factor,
		catalogSchedule,
	});
	const meteredPrices = scaleBillingPrices(
		supplier.prices,
		resolveEffectiveRouteFactor(baseFactors.meteredFactor, meteredSch, schedule.mode)
	);
	const chargedPrices = scaleBillingPrices(
		charged.prices,
		resolveEffectiveRouteFactor(baseFactors.chargedFactor, chargedSch, schedule.mode)
	);
	const standardCost = computeMeteredCost(
		USAGE,
		standard.prices.input_price,
		standard.prices.output_price,
		standard.prices.cache_read_price,
		standard.prices.cache_write_price
	);
	const meteredCost = computeMeteredCost(
		USAGE,
		meteredPrices.input_price,
		meteredPrices.output_price,
		meteredPrices.cache_read_price,
		meteredPrices.cache_write_price
	);
	const chargedCost = computeMeteredCost(
		USAGE,
		chargedPrices.input_price,
		chargedPrices.output_price,
		chargedPrices.cache_read_price,
		chargedPrices.cache_write_price
	);
	return { catalogSch, chargedSch, meteredSch, standardCost, meteredCost, chargedCost };
}

describe('usage-tracker catalog schedule stacking', () => {
	it('includes official overnight factor in standard_cost; charged/standard is route-only', () => {
		const hit = settleAt('2026-07-10T15:30:00.000Z'); // Fri 23:30 Asia/Shanghai
		assert.equal(hit.catalogSch.localTime, '23:30');
		assert.equal(hit.catalogSch.factor, 0.5);
		assert.equal(hit.standardCost, 2);
		assert.equal(hit.chargedCost, 1.6);
		assert.equal(hit.meteredCost, 2.4);
		assert.equal(hit.chargedCost / hit.standardCost, 0.8);
		assert.equal(hit.meteredCost / hit.standardCost, 1.2);

		const miss = settleAt('2026-07-10T18:30:00.000Z'); // Sat 02:30 Asia/Shanghai
		assert.equal(miss.catalogSch.factor, 1);
		assert.equal(miss.standardCost, 4);
		assert.equal(miss.chargedCost, 4);
	});

	it('applies weekday-only official windows and leaves weekend at catalog 1', () => {
		const friday = settleAt('2026-07-10T01:30:00.000Z'); // Fri 09:30 Asia/Shanghai
		assert.equal(friday.catalogSch.localWeekday, 5);
		assert.equal(friday.catalogSch.factor, 1.6);
		assert.ok(Math.abs(friday.standardCost - 6.4) < 1e-12);
		assert.ok(Math.abs(friday.chargedCost - 7.04) < 1e-12);
		assert.ok(Math.abs(friday.chargedCost / friday.standardCost - 1.1) < 1e-12);

		const saturday = settleAt('2026-07-11T01:30:00.000Z'); // Sat 09:30 Asia/Shanghai
		assert.equal(saturday.catalogSch.localWeekday, 6);
		assert.equal(saturday.catalogSch.factor, 1);
		assert.equal(saturday.standardCost, 4);
		assert.equal(saturday.chargedCost, 4);
	});
});
