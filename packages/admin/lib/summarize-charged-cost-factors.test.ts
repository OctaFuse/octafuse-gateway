import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { summarizeChargedCostFactors } from './summarize-charged-cost-factors';

describe('summarizeChargedCostFactors', () => {
	it('treats missing or empty factors as empty', () => {
		assert.equal(summarizeChargedCostFactors(null).empty, true);
		assert.equal(summarizeChargedCostFactors({}).empty, true);
		assert.equal(summarizeChargedCostFactors('').empty, true);
	});

	it('shows the first model factor and a remainder count', () => {
		const one = summarizeChargedCostFactors({ 'gemini-2.5-flash': 0.8 });
		assert.equal(one.empty, false);
		assert.equal(one.summary, 'gemini-2.5-flash ×0.8');
		assert.equal(one.count, 1);

		const many = summarizeChargedCostFactors({
			'z-model': 1,
			'a-model': 0.5,
		});
		assert.equal(many.summary, 'a-model ×0.5 · +1');
		assert.equal(many.count, 2);
		assert.match(many.full, /"a-model": 0.5/);
	});

	it('accepts a JSON string without importing core', () => {
		const fromJson = summarizeChargedCostFactors('{"gemini-2.5-flash":0.8}');
		assert.equal(fromJson.summary, 'gemini-2.5-flash ×0.8');
		assert.equal(summarizeChargedCostFactors('{').empty, true);
	});

	it('expands route-group factors and counts each group', () => {
		const grouped = summarizeChargedCostFactors({
			'gpt-5': { web: 0.5, '*': 0.9, free: 0 },
		});
		assert.equal(grouped.summary, 'gpt-5 * ×0.9 · +2');
		assert.equal(grouped.count, 3);
		assert.match(grouped.full, /"web": 0.5/);
	});
});
