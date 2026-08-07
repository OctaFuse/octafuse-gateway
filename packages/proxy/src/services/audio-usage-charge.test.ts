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

function mockRepos(): GatewayRepositories {
	return {
		systemConfig: { getConfig: async () => null },
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
