import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { GatewayRepositories } from '@octafuse/core';
import {
	estimateAudioSpeechBudgetPrecheck,
	estimateAudioSpeechCosts,
} from './audio-usage-charge';

const PROFILE = JSON.stringify({
	audio_billing_mode: 'per_character',
	audio: { price_per_character: 0.001, minimum_characters: 2 },
});

function mockRepos(timezone?: string): GatewayRepositories {
	return {
		systemConfig: {
			getConfig: async (key: string) =>
				key === 'BUSINESS_TIMEZONE' ? timezone ?? null : null,
		},
	} as unknown as GatewayRepositories;
}

describe('TTS per-character billing', () => {
	it('uses upstream characters and applies the route factor', async () => {
		const costs = await estimateAudioSpeechCosts(mockRepos(), {
			modelPricingProfileJson: PROFILE,
			routePriceOverrideJson: JSON.stringify({ metered_factor: 1.5, charged_factor: 2 }),
			characters: 5,
		});
		assert.equal(costs.billingKind, 'audio_per_character');
		assert.equal(costs.characters, 5);
		assert.equal(costs.billableCharacters, 5);
		assert.equal(costs.standardCost, 0.005);
		assert.equal(costs.meteredCost, 0.0075);
		assert.equal(costs.chargedCost, 0.01);
		assert.match(costs.pricingAuditJson, /"usage_source":"upstream"/);
	});

	it('does not replace missing upstream usage with the input length', async () => {
		const costs = await estimateAudioSpeechCosts(mockRepos(), {
			modelPricingProfileJson: PROFILE,
			characters: null,
		});
		assert.equal(costs.chargedCost, 0);
		assert.match(costs.pricingAuditJson, /missing_upstream_character_usage/);
	});

	it('applies user charged cost factor after route charged cost', async () => {
		const route = await estimateAudioSpeechCosts(mockRepos(), {
			modelPricingProfileJson: PROFILE,
			routePriceOverrideJson: JSON.stringify({ metered_factor: 1, charged_factor: 2 }),
			characters: 5,
			catalogModelId: 'qwen-tts',
		});
		const discounted = await estimateAudioSpeechCosts(mockRepos(), {
			modelPricingProfileJson: PROFILE,
			routePriceOverrideJson: JSON.stringify({ metered_factor: 1, charged_factor: 2 }),
			characters: 5,
			catalogModelId: 'qwen-tts',
			userChargedCostFactorsJson: JSON.stringify({ 'qwen-tts': 0.5 }),
		});
		assert.ok(Math.abs(discounted.chargedCost - route.chargedCost * 0.5) < 1e-9);
		assert.equal(discounted.meteredCost, route.meteredCost);
		const audit = JSON.parse(discounted.pricingAuditJson) as { user_charged_factor: number };
		assert.equal(audit.user_charged_factor, 0.5);
	});

	it('budget precheck uses the same user charged cost factor as the final charge', async () => {
		const override = JSON.stringify({ metered_factor: 1, charged_factor: 2 });
		const billing = {
			modelPricingProfileJson: PROFILE,
			catalogModelId: 'qwen-tts',
			userChargedCostFactorsJson: JSON.stringify({ 'qwen-tts': 0.5 }),
		};
		const precheck = await estimateAudioSpeechBudgetPrecheck(
			mockRepos(),
			{ ...billing, inputCharacters: 5 },
			[override]
		);
		const charge = await estimateAudioSpeechCosts(mockRepos(), {
			...billing,
			routePriceOverrideJson: override,
			characters: 5,
		});
		assert.equal(precheck.chargedCost, charge.chargedCost);
	});

	it('includes official catalog schedule in standard_cost', async () => {
		const profile = JSON.stringify({
			audio_billing_mode: 'per_character',
			audio: { price_per_character: 0.001, minimum_characters: 2 },
			schedule: [{ start: '09:00', end: '12:00', factor: 1.6, days: [1, 2, 3, 4, 5] }],
		});
		const route = JSON.stringify({
			charged_factor: 1,
			metered_factor: 1,
			schedule: {
				mode: 'override',
				charged: [{ start: '09:00', end: '12:00', factor: 0.5, days: [1, 2, 3, 4, 5] }],
				metered: [{ start: '09:00', end: '12:00', factor: 1, days: [1, 2, 3, 4, 5] }],
			},
		});
		const friday = await estimateAudioSpeechCosts(mockRepos('Asia/Shanghai'), {
			modelPricingProfileJson: profile,
			routePriceOverrideJson: route,
			characters: 5,
			requestStartedAtMs: Date.parse('2026-07-10T01:30:00.000Z'),
		});
		assert.equal(friday.standardCost, 0.008);
		assert.equal(friday.chargedCost, 0.004);
		assert.equal(friday.chargedCost / friday.standardCost, 0.5);
	});

	it('uses input length only for the budget precheck and takes the most expensive route factor', async () => {
		const costs = await estimateAudioSpeechBudgetPrecheck(
			mockRepos(),
			{ modelPricingProfileJson: PROFILE, inputCharacters: 5 },
			[
				JSON.stringify({ charged_factor: 1 }),
				JSON.stringify({ charged_factor: 3 }),
			]
		);
		assert.equal(costs.chargedCost, 0.015);
	});
});
