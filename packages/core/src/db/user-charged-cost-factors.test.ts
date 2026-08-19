import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { roundGatewayMoney } from '../lib/money-precision';
import {
	applyUserChargedCostFactor,
	applyUserChargedCostToBreakdown,
	attachUserChargedFactorToPricingAudit,
	lookupUserChargedCostFactor,
	normalizeUserChargedCostFactorsInput,
	parseUserChargedCostFactors,
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
});

describe('lookupUserChargedCostFactor', () => {
	it('matches catalog model id exactly', () => {
		const map = { 'claude-sonnet-4': 0.8 };
		assert.equal(lookupUserChargedCostFactor(map, 'claude-sonnet-4'), 0.8);
		assert.equal(lookupUserChargedCostFactor(map, 'claude-sonnet-4:free'), null);
		assert.equal(lookupUserChargedCostFactor(null, 'claude-sonnet-4'), null);
	});
});

describe('applyUserChargedCostFactor', () => {
	it('leaves route charged unchanged when factor is missing', () => {
		assert.equal(applyUserChargedCostFactor(0.0045, null), 0.0045);
	});

	it('multiplies after route charged and rounds twice', () => {
		const route = roundGatewayMoney(0.1 / 3);
		assert.equal(applyUserChargedCostFactor(route, 0.5), roundGatewayMoney(route * 0.5));
		assert.equal(applyUserChargedCostFactor(0.0045, 0), 0);
	});
});

describe('applyUserChargedCostToBreakdown', () => {
	it('applies factor and writes user_charged_factor on user_charge', () => {
		const audit = JSON.stringify({
			v: 4,
			snapshot: { user_charge: { source: 'model_x_factor', effective_factor: 1.2 } },
		});
		const out = applyUserChargedCostToBreakdown(
			{ chargedCost: 0.01, pricingAuditJson: audit },
			'{"gpt-4o":0.5}',
			'gpt-4o',
			{ warnInvalidJson: false }
		);
		assert.equal(out.chargedCost, 0.005);
		const parsed = JSON.parse(out.pricingAuditJson) as {
			user_charged_factor: number;
			snapshot: { user_charge: { user_charged_factor: number } };
		};
		assert.equal(parsed.user_charged_factor, 0.5);
		assert.equal(parsed.snapshot.user_charge.user_charged_factor, 0.5);
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
	});
});

describe('attachUserChargedFactorToPricingAudit', () => {
	it('returns original string when JSON is invalid', () => {
		assert.equal(attachUserChargedFactorToPricingAudit('{', 1), '{');
	});
});
