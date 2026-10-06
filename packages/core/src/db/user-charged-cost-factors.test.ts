import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { roundGatewayMoney } from '../lib/money-precision';
import {
	applyUserChargedCostFactor,
	applyUserChargedCostToBreakdown,
	attachUserChargedFactorToPricingAudit,
	lookupUserChargedCostFactor,
	modelHasUserChargedCostFactor,
	normalizeUserChargedCostFactorsInput,
	parseUserChargedCostFactors,
	resolveCombinedChargedFactor,
	resolveUserChargedCostFactorMatch,
} from './user-charged-cost-factors';

describe('normalizeUserChargedCostFactorsInput', () => {
	it('accepts object and stores JSON', () => {
		const r = normalizeUserChargedCostFactorsInput({ 'claude-sonnet-4': 0.8, 'gpt-4o': 0 });
		assert.equal(r.ok, true);
		if (!r.ok) return;
		assert.deepEqual(r.value, { 'claude-sonnet-4': 0.8, 'gpt-4o': 0 });
		assert.equal(r.json, JSON.stringify({ 'claude-sonnet-4': 0.8, 'gpt-4o': 0 }));
	});

	it('treats null and empty object as NULL', () => {
		assert.deepEqual(normalizeUserChargedCostFactorsInput(null), { ok: true, value: null, json: null });
		assert.deepEqual(normalizeUserChargedCostFactorsInput({}), { ok: true, value: null, json: null });
	});

	it('rejects negatives, arrays, and empty keys', () => {
		assert.equal(normalizeUserChargedCostFactorsInput({ m: -0.1 }).ok, false);
		assert.equal(normalizeUserChargedCostFactorsInput([{ m: 1 }]).ok, false);
		assert.equal(normalizeUserChargedCostFactorsInput({ '': 1 }).ok, false);
		assert.equal(normalizeUserChargedCostFactorsInput({ m: Number.NaN }).ok, false);
	});

	it('stores per-group factors and folds a star-only map into a number', () => {
		const grouped = normalizeUserChargedCostFactorsInput({
			'gpt-5': { '*': 0.9, Web: 0.5, free: 0 },
		});
		assert.equal(grouped.ok, true);
		if (!grouped.ok) return;
		assert.deepEqual(grouped.value, { 'gpt-5': { '*': 0.9, web: 0.5, free: 0 } });

		const folded = normalizeUserChargedCostFactorsInput({ 'gpt-5': { '*': 0.9 } });
		assert.equal(folded.ok, true);
		if (!folded.ok) return;
		assert.deepEqual(folded.value, { 'gpt-5': 0.9 });
	});

	it('drops an empty group map and rejects duplicate groups', () => {
		const dropped = normalizeUserChargedCostFactorsInput({ 'gpt-5': {} });
		assert.deepEqual(dropped, { ok: true, value: null, json: null });
		assert.equal(normalizeUserChargedCostFactorsInput({ 'gpt-5': { Web: 0.5, web: 0.4 } }).ok, false);
		assert.equal(normalizeUserChargedCostFactorsInput({ 'gpt-5': { web: -1 } }).ok, false);
	});
});

describe('parseUserChargedCostFactors', () => {
	it('returns null for missing or invalid JSON', () => {
		assert.equal(parseUserChargedCostFactors(null), null);
		assert.equal(parseUserChargedCostFactors(''), null);
		assert.equal(parseUserChargedCostFactors('[]'), null);
		assert.equal(parseUserChargedCostFactors('{'), null);
	});

	it('drops invalid entries and keeps valid ones', () => {
		assert.deepEqual(parseUserChargedCostFactors('{"ok":0.5,"bad":-1,"":1}'), { ok: 0.5 });
	});

	it('keeps group maps and folds a star-only map', () => {
		assert.deepEqual(parseUserChargedCostFactors('{"gpt-5":{"*":0.9,"Web":0.5,"bad":-1}}'), {
			'gpt-5': { '*': 0.9, web: 0.5 },
		});
		assert.deepEqual(parseUserChargedCostFactors('{"gpt-5":{"*":0.9}}'), { 'gpt-5': 0.9 });
	});
});

describe('lookupUserChargedCostFactor', () => {
	it('matches catalog model id exactly and applies a number to every group', () => {
		const map = { 'claude-sonnet-4': 0.8 };
		assert.equal(lookupUserChargedCostFactor(map, 'claude-sonnet-4'), 0.8);
		assert.equal(lookupUserChargedCostFactor(map, 'claude-sonnet-4', 'web'), 0.8);
		assert.equal(lookupUserChargedCostFactor(map, 'claude-sonnet-4:free'), null);
		assert.equal(lookupUserChargedCostFactor(null, 'claude-sonnet-4'), null);
	});

	it('prefers the route group, then star, and treats a missing group as default', () => {
		const map = { 'gpt-5': { '*': 0.9, web: 0.5 } };
		assert.deepEqual(resolveUserChargedCostFactorMatch(map, 'gpt-5', 'web'), {
			factor: 0.5,
			routeGroup: 'web',
		});
		assert.deepEqual(resolveUserChargedCostFactorMatch(map, 'gpt-5', 'Web'), {
			factor: 0.5,
			routeGroup: 'web',
		});
		assert.deepEqual(resolveUserChargedCostFactorMatch(map, 'gpt-5', 'free'), {
			factor: 0.9,
			routeGroup: '*',
		});
		assert.deepEqual(resolveUserChargedCostFactorMatch(map, 'gpt-5'), {
			factor: 0.9,
			routeGroup: '*',
		});
		assert.equal(lookupUserChargedCostFactor({ 'gpt-5': { web: 0.5 } }, 'gpt-5', 'default'), null);
		assert.equal(modelHasUserChargedCostFactor(map, 'gpt-5'), true);
		assert.equal(modelHasUserChargedCostFactor(map, 'other'), false);
	});
});

describe('resolveCombinedChargedFactor', () => {
	it('returns null when the user factor is missing', () => {
		assert.equal(resolveCombinedChargedFactor(0.8, null, 'multiply'), null);
		assert.equal(resolveCombinedChargedFactor(0.8, null, 'min'), null);
	});

	it('multiplies or takes min when both factors exist', () => {
		assert.equal(resolveCombinedChargedFactor(0.8, 0.5, 'multiply'), 0.4);
		assert.equal(resolveCombinedChargedFactor(0.8, 0.5, 'min'), 0.5);
		assert.equal(resolveCombinedChargedFactor(0.3, 0.8, 'min'), 0.3);
	});
});

describe('applyUserChargedCostFactor', () => {
	it('leaves route charged unchanged when factor is missing', () => {
		assert.equal(applyUserChargedCostFactor(0.0045, null), 0.0045);
		assert.equal(applyUserChargedCostFactor(0.0045, null, { mode: 'min', routeEffectiveFactor: 0.8 }), 0.0045);
	});

	it('multiplies after route charged and rounds twice', () => {
		const route = roundGatewayMoney(0.1 / 3);
		assert.equal(applyUserChargedCostFactor(route, 0.5), roundGatewayMoney(route * 0.5));
		assert.equal(applyUserChargedCostFactor(0.0045, 0), 0);
	});

	it('min mode keeps route charged when the route factor is smaller or equal', () => {
		assert.equal(applyUserChargedCostFactor(0.8, 0.8, { mode: 'min', routeEffectiveFactor: 0.8 }), 0.8);
		assert.equal(applyUserChargedCostFactor(0.3, 0.8, { mode: 'min', routeEffectiveFactor: 0.3 }), 0.3);
	});

	it('min mode scales from route charged when the user factor is smaller', () => {
		assert.equal(
			applyUserChargedCostFactor(0.8, 0.5, { mode: 'min', routeEffectiveFactor: 0.8 }),
			roundGatewayMoney(0.8 * (0.5 / 0.8))
		);
	});

	it('min mode charges 0 when the route factor is 0', () => {
		assert.equal(applyUserChargedCostFactor(0, 0.5, { mode: 'min', routeEffectiveFactor: 0 }), 0);
	});
});

describe('applyUserChargedCostToBreakdown', () => {
	it('applies factor and writes user_charged_factor on user_charge', () => {
		const audit = JSON.stringify({
			v: 4,
			snapshot: { user_charge: { source: 'model_x_factor', effective_factor: 1.2 } },
		});
		const out = applyUserChargedCostToBreakdown(
			{ chargedCost: 0.01, chargedFactor: 1.2, pricingAuditJson: audit },
			'{"gpt-4o":0.5}',
			'gpt-4o',
			{ warnInvalidJson: false }
		);
		assert.equal(out.chargedCost, 0.005);
		const parsed = JSON.parse(out.pricingAuditJson) as {
			user_charged_factor: number;
			user_charged_factor_mode: string;
			combined_charged_factor: number;
			snapshot: { user_charge: { user_charged_factor: number; combined_charged_factor: number } };
		};
		assert.equal(parsed.user_charged_factor, 0.5);
		assert.equal(parsed.user_charged_factor_mode, 'multiply');
		assert.equal(parsed.combined_charged_factor, 0.6);
		assert.equal(parsed.user_charged_factor_route_group, null);
		assert.equal(parsed.snapshot.user_charge.user_charged_factor, 0.5);
		assert.equal(parsed.snapshot.user_charge.combined_charged_factor, 0.6);
	});

	it('uses the route group factor and records the matched group', () => {
		const out = applyUserChargedCostToBreakdown(
			{ chargedCost: 0.01, chargedFactor: 1, pricingAuditJson: '{}' },
			'{"gpt-4o":{"*":0.9,"web":0.5}}',
			'gpt-4o',
			{ warnInvalidJson: false, routeGroup: 'web' }
		);
		assert.equal(out.chargedCost, 0.005);
		const parsed = JSON.parse(out.pricingAuditJson) as {
			user_charged_factor: number;
			user_charged_factor_route_group: string;
		};
		assert.equal(parsed.user_charged_factor, 0.5);
		assert.equal(parsed.user_charged_factor_route_group, 'web');
	});

	it('min mode writes combined_charged_factor as the smaller factor', () => {
		const audit = JSON.stringify({
			v: 5,
			snapshot: { user_charge: { source: 'model_x_factor', effective_factor: 2 } },
		});
		const out = applyUserChargedCostToBreakdown(
			{ chargedCost: 0.02, chargedFactor: 2, pricingAuditJson: audit },
			'{"gpt-4o":0.5}',
			'gpt-4o',
			{ warnInvalidJson: false, mode: 'min' }
		);
		assert.equal(out.chargedCost, 0.005);
		const parsed = JSON.parse(out.pricingAuditJson) as {
			user_charged_factor_mode: string;
			combined_charged_factor: number;
		};
		assert.equal(parsed.user_charged_factor_mode, 'min');
		assert.equal(parsed.combined_charged_factor, 0.5);
	});

	it('attaches null factor when model is not listed', () => {
		const out = applyUserChargedCostToBreakdown(
			{ chargedCost: 0.01, pricingAuditJson: '{}' },
			'{"gpt-4o":0.5}',
			'other',
			{ warnInvalidJson: false }
		);
		assert.equal(out.chargedCost, 0.01);
		assert.equal(JSON.parse(out.pricingAuditJson).user_charged_factor, null);
		assert.equal(JSON.parse(out.pricingAuditJson).combined_charged_factor, null);
	});
});

describe('attachUserChargedFactorToPricingAudit', () => {
	it('returns original string when JSON is invalid', () => {
		assert.equal(attachUserChargedFactorToPricingAudit('{', 1), '{');
	});
});
