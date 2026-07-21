import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { GatewayRepositories } from '@octafuse/core';
import {
	estimateImageBudgetPrecheck,
	estimateImageCosts,
	withClientAbortPrecheckAudit,
	withUncertainResultAudit,
} from './image-usage-charge';

const TOKEN_PROFILE = JSON.stringify({
	tiers: [
		{
			upto: null,
			input_price: 5,
			output_price: 0,
			cache_read_price: 1.25,
			image_input_price: 8,
			image_input_cache_price: 2,
			image_output_price: 30,
		},
	],
});

const LEGACY_ONLY_PROFILE = JSON.stringify({
	tiers: [{ upto: null, input_price: 0, output_price: 0 }],
	image: {
		default: 0.053,
		by_quality_size: {
			'high:1536x1024': 0.165,
			'medium:1024x1024': 0.053,
		},
	},
});

const PER_IMAGE_PROFILE = JSON.stringify({
	image_billing_mode: 'per_image',
	image: {
		default: 0.04,
		by_quality_size: { 'high:1536x1024': 0.165 },
		input: {
			default: 0.01,
			by_quality_size: { 'high:1024x1024': 0.02 },
		},
	},
});

const LLM_PROFILE = JSON.stringify({
	tiers: [{ upto: null, input_price: 2, output_price: 12, cache_read_price: 0.2 }],
});

function mockRepos(): GatewayRepositories {
	return {
		systemConfig: {
			getConfig: async () => null,
		},
	} as unknown as GatewayRepositories;
}

describe('estimateImageCosts', () => {
	it('token path: actual usage dominates charged cost (not fixed per-image)', async () => {
		const costs = await estimateImageCosts(
			mockRepos(),
			{
				modelPricingProfileJson: TOKEN_PROFILE,
				routePriceOverrideJson: null,
				quality: 'high',
				size: '1536x1024',
				imageCount: 1,
			},
			{
				usage: {
					text_tokens: 20,
					cached_text_tokens: 0,
					image_input_tokens: 0,
					cached_image_input_tokens: 0,
					image_output_tokens: 5500,
					total_tokens: 5520,
					raw_usage: '{"output_tokens":5500}',
				},
			}
		);
		assert.equal(costs.billingKind, 'image_tokens');
		assert.ok(Math.abs(costs.chargedCost - 0.1651) < 1e-6);
		assert.equal(costs.logTokens.outputTokens, 5500);
		assert.equal(costs.logImageCounts?.outputImageCount, 0);
		assert.ok(costs.pricingAuditJson.includes('"kind":"image_tokens"'));
	});

	it('token path precheck is conservative vs short generations', async () => {
		const precheck = await estimateImageCosts(mockRepos(), {
			modelPricingProfileJson: TOKEN_PROFILE,
			routePriceOverrideJson: null,
			quality: 'high',
			size: '1536x1024',
			imageCount: 1,
			isEdit: false,
		});
		const shortGen = await estimateImageCosts(
			mockRepos(),
			{
				modelPricingProfileJson: TOKEN_PROFILE,
				routePriceOverrideJson: null,
				quality: 'high',
				size: '1536x1024',
				imageCount: 1,
			},
			{
				usage: {
					text_tokens: 15,
					cached_text_tokens: 0,
					image_input_tokens: 0,
					cached_image_input_tokens: 0,
					image_output_tokens: 5500,
					total_tokens: 5515,
					raw_usage: null,
				},
			}
		);
		assert.equal(precheck.billingKind, 'image_tokens');
		assert.ok(precheck.chargedCost >= shortGen.chargedCost);
	});

	it('legacy per-image-only profile no longer bills', async () => {
		const costs = await estimateImageCosts(mockRepos(), {
			modelPricingProfileJson: LEGACY_ONLY_PROFILE,
			routePriceOverrideJson: null,
			quality: 'high',
			size: '1536x1024',
			imageCount: 1,
		});
		assert.equal(costs.billingKind, 'image_tokens');
		assert.equal(costs.chargedCost, 0);
		assert.ok(costs.pricingAuditJson.includes('missing_image_pricing'));
	});

	it('explicit per_image mode bills by output count', async () => {
		const costs = await estimateImageCosts(mockRepos(), {
			modelPricingProfileJson: PER_IMAGE_PROFILE,
			routePriceOverrideJson: null,
			quality: 'high',
			size: '1536x1024',
			imageCount: 1,
			operation: 'generations',
		});
		assert.equal(costs.billingKind, 'image_per_image');
		assert.ok(Math.abs(costs.chargedCost - 0.165) < 1e-9);
		assert.equal(costs.unitPrice, 0.165);
		assert.equal(costs.logTokens.totalTokens, 0);
		assert.equal(costs.logImageCounts?.outputImageCount, 1);
		assert.equal(costs.logImageCounts?.inputImageCount, 0);
		assert.ok(costs.pricingAuditJson.includes('"kind":"image_per_image"'));
		assert.ok(costs.pricingAuditJson.includes('"output_unit_price":0.165'));
	});

	it('per_image adds input.default × referenceCount', async () => {
		const costs = await estimateImageCosts(mockRepos(), {
			modelPricingProfileJson: PER_IMAGE_PROFILE,
			routePriceOverrideJson: null,
			quality: 'high',
			size: '1536x1024',
			imageCount: 1,
			referenceCount: 2,
		});
		assert.equal(costs.billingKind, 'image_per_image');
		// output high:1536x1024 = 0.165; input 无匹配档 → default 0.01 × 2 refs
		assert.ok(Math.abs(costs.chargedCost - (0.165 + 0.01 * 2)) < 1e-9);
		assert.equal(costs.logImageCounts?.inputImageCount, 2);
		assert.equal(costs.logImageCounts?.outputImageCount, 1);
	});

	it('per_image applies charged_factor from route override', async () => {
		const base = await estimateImageCosts(mockRepos(), {
			modelPricingProfileJson: PER_IMAGE_PROFILE,
			routePriceOverrideJson: null,
			quality: 'auto',
			size: 'auto',
			imageCount: 1,
		});
		const doubled = await estimateImageCosts(mockRepos(), {
			modelPricingProfileJson: PER_IMAGE_PROFILE,
			routePriceOverrideJson: JSON.stringify({ charged_factor: 2, metered_factor: 1 }),
			quality: 'auto',
			size: 'auto',
			imageCount: 1,
		});
		assert.equal(base.billingKind, 'image_per_image');
		assert.ok(Math.abs(doubled.chargedCost - base.chargedCost * 2) < 1e-9);
	});

	it('LLM profile without image prices yields zero image cost', async () => {
		const costs = await estimateImageCosts(mockRepos(), {
			modelPricingProfileJson: LLM_PROFILE,
			routePriceOverrideJson: null,
			quality: 'auto',
			size: 'auto',
			imageCount: 1,
		});
		assert.equal(costs.chargedCost, 0);
	});

	it('budget precheck uses max charged_factor across failover routes', async () => {
		const cheap = JSON.stringify({ charged_factor: 1, metered_factor: 1 });
		const expensive = JSON.stringify({ charged_factor: 2, metered_factor: 1 });
		const withCheapOnly = await estimateImageCosts(mockRepos(), {
			modelPricingProfileJson: TOKEN_PROFILE,
			routePriceOverrideJson: cheap,
			quality: 'high',
			size: '1536x1024',
			imageCount: 1,
		});
		const precheck = await estimateImageBudgetPrecheck(
			mockRepos(),
			{
				modelPricingProfileJson: TOKEN_PROFILE,
				quality: 'high',
				size: '1536x1024',
				imageCount: 1,
			},
			[cheap, expensive]
		);
		assert.ok(precheck.chargedCost > withCheapOnly.chargedCost);
		assert.ok(Math.abs(precheck.chargedCost - withCheapOnly.chargedCost * 2) < 1e-6);
	});

	it('auto/unknown quality precheck uses upper-bound output tokens', async () => {
		const auto = await estimateImageCosts(mockRepos(), {
			modelPricingProfileJson: TOKEN_PROFILE,
			routePriceOverrideJson: null,
			quality: 'auto',
			size: '1024x1024',
			imageCount: 1,
		});
		const high = await estimateImageCosts(mockRepos(), {
			modelPricingProfileJson: TOKEN_PROFILE,
			routePriceOverrideJson: null,
			quality: 'high',
			size: '1024x1024',
			imageCount: 1,
		});
		const medium = await estimateImageCosts(mockRepos(), {
			modelPricingProfileJson: TOKEN_PROFILE,
			routePriceOverrideJson: null,
			quality: 'medium',
			size: '1024x1024',
			imageCount: 1,
		});
		assert.ok(Math.abs(auto.chargedCost - high.chargedCost) < 1e-9);
		assert.ok(auto.chargedCost > medium.chargedCost);
	});
});

describe('missing upstream usage fallback', () => {
	it('precheck fallback bills conservatively and audits reason', async () => {
		const fallback = await estimateImageCosts(
			mockRepos(),
			{
				modelPricingProfileJson: TOKEN_PROFILE,
				routePriceOverrideJson: null,
				quality: 'high',
				size: '1536x1024',
				imageCount: 1,
			},
			{
				auditExtra: { usage_source: 'precheck_fallback', error: 'missing_upstream_usage' },
			}
		);
		assert.ok(fallback.chargedCost > 0);
		assert.ok(fallback.pricingAuditJson.includes('missing_upstream_usage'));
		assert.ok(fallback.pricingAuditJson.includes('precheck_fallback'));
	});
});

describe('uncertain result precheck audit', () => {
	it('tags budget precheck with client_abort_precheck without changing cost', async () => {
		const precheck = await estimateImageBudgetPrecheck(
			mockRepos(),
			{
				modelPricingProfileJson: TOKEN_PROFILE,
				quality: 'high',
				size: '1024x1024',
				imageCount: 1,
				isEdit: false,
			},
			[null]
		);
		assert.ok(precheck.chargedCost > 0);
		const audited = withClientAbortPrecheckAudit(precheck);
		assert.equal(audited.chargedCost, precheck.chargedCost);
		assert.equal(audited.meteredCost, precheck.meteredCost);
		assert.ok(audited.pricingAuditJson.includes('client_abort_precheck'));
	});

	it('supports gateway_timeout_precheck audit source', async () => {
		const precheck = await estimateImageCosts(mockRepos(), {
			modelPricingProfileJson: PER_IMAGE_PROFILE,
			routePriceOverrideJson: null,
			quality: 'auto',
			size: 'auto',
			imageCount: 1,
		});
		const audited = withUncertainResultAudit(precheck, 'gateway_timeout_precheck');
		assert.equal(audited.chargedCost, precheck.chargedCost);
		assert.ok(audited.pricingAuditJson.includes('gateway_timeout_precheck'));
	});
});
