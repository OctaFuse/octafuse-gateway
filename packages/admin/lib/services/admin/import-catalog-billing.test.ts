import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parsePricingProfile } from '@octafuse/core/db/pricing-profile';
import { listStaticModelPresets, pickPresetPricingRawForBillingCurrency } from '@/lib/model-preset';
import { coerceModelPricingProfileInput } from './pricing-input';
import { listStaticModelPresetCatalogForAdmin } from './models-service';
import type { AdminStaticModelPresetCatalogItem } from './types';

describe('import catalog pricing preview follows billing currency', () => {
	it('USD branch uses $ and usd tier amounts', () => {
		const row = listStaticModelPresetCatalogForAdmin('USD').find((r) => r.id === 'qwen3.8-max');
		assert.ok(row);
		assert.equal(row!.pricing_label, '$2 / $6 /M');
		assert.match(row!.pricing_preview ?? '', /\$\/M/);
	});

	it('CNY branch uses ¥ and cny tier amounts', () => {
		const row = listStaticModelPresetCatalogForAdmin('CNY').find((r) => r.id === 'qwen3.8-max');
		assert.ok(row);
		assert.equal(row!.pricing_label, '¥12 / ¥36 /M');
		assert.match(row!.pricing_preview ?? '', /¥\/M/);
		assert.doesNotMatch(row!.pricing_preview ?? '', /\$\/M/);
	});

	it('includes glm-5.3 with GLM-5.2-aligned list prices', () => {
		const usd = listStaticModelPresetCatalogForAdmin('USD').find((r) => r.id === 'glm-5.3');
		const cny = listStaticModelPresetCatalogForAdmin('CNY').find((r) => r.id === 'glm-5.3');
		assert.ok(usd);
		assert.ok(cny);
		assert.equal(usd!.display_name, 'GLM-5.3');
		assert.equal(usd!.context_window, 1000000);
		assert.equal(usd!.max_tokens, 128000);
		assert.equal(usd!.pricing_label, '$1.4 / $4.4 /M');
		assert.equal(cny!.pricing_label, '¥8 / ¥28 /M');
	});

	it('includes glm-5.3-flash with official Z.AI and BigModel list prices', () => {
		const usd = listStaticModelPresetCatalogForAdmin('USD').find((r) => r.id === 'glm-5.3-flash');
		const cny = listStaticModelPresetCatalogForAdmin('CNY').find((r) => r.id === 'glm-5.3-flash');
		assert.ok(usd);
		assert.ok(cny);
		assert.equal(usd!.display_name, 'GLM-5.3-Flash');
		assert.equal(usd!.context_window, 1000000);
		assert.equal(usd!.max_tokens, 128000);
		assert.equal(usd!.pricing_label, '$0.15 / $0.5 /M');
		assert.equal(cny!.pricing_label, '¥0.8 / ¥2.8 /M');
	});

	it('includes glm-5.3-flashx with official Z.AI and BigModel list prices', () => {
		const usd = listStaticModelPresetCatalogForAdmin('USD').find((r) => r.id === 'glm-5.3-flashx');
		const cny = listStaticModelPresetCatalogForAdmin('CNY').find((r) => r.id === 'glm-5.3-flashx');
		assert.ok(usd);
		assert.ok(cny);
		assert.equal(usd!.display_name, 'GLM-5.3-FlashX');
		assert.equal(usd!.context_window, 1000000);
		assert.equal(usd!.max_tokens, 128000);
		assert.equal(usd!.pricing_label, '$0.37 / $1.25 /M');
		assert.equal(cny!.pricing_label, '¥2 / ¥7 /M');
	});

	it('includes hy4-preview with official TokenHub list prices', () => {
		const usd = listStaticModelPresetCatalogForAdmin('USD').find((r) => r.id === 'hy4-preview');
		const cny = listStaticModelPresetCatalogForAdmin('CNY').find((r) => r.id === 'hy4-preview');
		assert.ok(usd);
		assert.ok(cny);
		assert.equal(usd!.display_name, 'Hy4 preview');
		assert.equal(usd!.context_window, 1024000);
		assert.equal(usd!.max_tokens, 64000);
		assert.equal(usd!.pricing_label, '$0.834 / $2.501 /M');
		assert.equal(cny!.pricing_label, '¥6 / ¥18 /M');
	});

	it('includes gemini-4-argon at the post-intro list price, not the introductory rate', () => {
		const usd = listStaticModelPresetCatalogForAdmin('USD').find((r) => r.id === 'gemini-4-argon');
		const cny = listStaticModelPresetCatalogForAdmin('CNY').find((r) => r.id === 'gemini-4-argon');
		assert.ok(usd);
		assert.ok(cny);
		assert.equal(usd!.display_name, 'Gemini 4 Argon');
		assert.equal(usd!.context_window, 1000000);
		assert.equal(usd!.max_tokens, 64000);
		assert.equal(usd!.pricing_label, '$4 / $20 /M');
		assert.equal(cny!.pricing_label, '¥28 / ¥140 /M');
		const preset = listStaticModelPresets().find((p) => p.id === 'gemini-4-argon');
		assert.ok(preset);
		assert.equal(preset!.released, '2026-10-13');
		assert.deepEqual(preset!.modalities?.input, ['text', 'image', 'audio', 'video', 'file']);
		assert.deepEqual(preset!.modalities?.output, ['text']);
		const profile = parsePricingProfile(coerceModelPricingProfileInput(pickPresetPricingRawForBillingCurrency(preset!, 'USD'))!);
		assert.equal(profile?.tiers.length, 1);
		assert.equal(profile?.tiers[0]?.input_price, 4);
		assert.equal(profile?.tiers[0]?.output_price, 20);
		assert.equal(profile?.tiers[0]?.cache_read_price, 0.2);
		assert.equal(profile?.tiers[0]?.cache_write_price, null);
		const cnyProfile = parsePricingProfile(coerceModelPricingProfileInput(pickPresetPricingRawForBillingCurrency(preset!, 'CNY'))!);
		assert.equal(cnyProfile?.tiers[0]?.input_price, 28);
		assert.equal(cnyProfile?.tiers[0]?.output_price, 140);
		assert.equal(cnyProfile?.tiers[0]?.cache_read_price, 1.4);
		assert.equal(cnyProfile?.tiers[0]?.cache_write_price, null);
		assert.equal(listStaticModelPresets().some((p) => p.id === 'gemini-4-barium'), false);
	});

	it('includes gemini-3.8-flash with Gemini API Standard list prices', () => {
		const usd = listStaticModelPresetCatalogForAdmin('USD').find((r) => r.id === 'gemini-3.8-flash');
		const cny = listStaticModelPresetCatalogForAdmin('CNY').find((r) => r.id === 'gemini-3.8-flash');
		assert.ok(usd);
		assert.ok(cny);
		assert.equal(usd!.display_name, 'Gemini 3.8 Flash');
		assert.equal(usd!.context_window, 1000000);
		assert.equal(usd!.max_tokens, 64000);
		assert.equal(usd!.pricing_label, '$1.5 / $7.5 /M');
		assert.equal(cny!.pricing_label, '¥10.5 / ¥52.5 /M');
	});

	it('includes Qwen-Audio 3.1 ASR and TTS at official token list prices', () => {
		const asrUsd = listStaticModelPresetCatalogForAdmin('USD').find((r) => r.id === 'qwen-audio-3.1-asr-flash');
		const asrCny = listStaticModelPresetCatalogForAdmin('CNY').find((r) => r.id === 'qwen-audio-3.1-asr-flash');
		assert.ok(asrUsd);
		assert.ok(asrCny);
		assert.equal(asrUsd!.kind, 'asr');
		assert.equal(asrUsd!.context_window, 8192);
		assert.equal(asrUsd!.max_tokens, 1024);
		assert.equal(asrUsd!.pricing_label, '$0.15 / $0.47 /M');
		assert.equal(asrCny!.pricing_label, '¥0.8 / ¥2.7 /M');

		const ttsUsd = listStaticModelPresetCatalogForAdmin('USD').find((r) => r.id === 'qwen-audio-3.1-tts-flash');
		const ttsCny = listStaticModelPresetCatalogForAdmin('CNY').find((r) => r.id === 'qwen-audio-3.1-tts-flash');
		assert.ok(ttsUsd);
		assert.ok(ttsCny);
		assert.equal(ttsUsd!.kind, 'tts');
		assert.equal(ttsUsd!.pricing_label, '$0.23 / $1.87 /M');
		assert.equal(ttsCny!.pricing_label, '¥1.5 / ¥12 /M');
	});

	it('includes qwen3.8-flash with official Model Studio list prices', () => {
		const usd = listStaticModelPresetCatalogForAdmin('USD').find((r) => r.id === 'qwen3.8-flash');
		const cny = listStaticModelPresetCatalogForAdmin('CNY').find((r) => r.id === 'qwen3.8-flash');
		assert.ok(usd);
		assert.ok(cny);
		assert.equal(usd!.display_name, 'Qwen3.8 Flash');
		assert.equal(usd!.context_window, 1000000);
		assert.equal(usd!.max_tokens, 128000);
		assert.equal(usd!.pricing_label, '$0.15 / $0.47 /M');
		assert.equal(cny!.pricing_label, '¥0.8 / ¥2.7 /M');
	});

	it('includes claude-sonnet-5-5 at the same $2 / $10 list prices as Sonnet 5', () => {
		const usd = listStaticModelPresetCatalogForAdmin('USD').find((r) => r.id === 'claude-sonnet-5-5');
		const cny = listStaticModelPresetCatalogForAdmin('CNY').find((r) => r.id === 'claude-sonnet-5-5');
		assert.ok(usd);
		assert.ok(cny);
		assert.equal(usd!.display_name, 'Claude Sonnet 5.5');
		assert.equal(usd!.context_window, 1000000);
		assert.equal(usd!.max_tokens, 128000);
		assert.equal(usd!.pricing_label, '$2 / $10 /M');
		assert.equal(cny!.pricing_label, '¥14 / ¥70 /M');
		const preset = listStaticModelPresets().find((p) => p.id === 'claude-sonnet-5-5');
		assert.ok(preset);
		assert.equal(preset!.released, '2026-09-28');
		const profile = parsePricingProfile(coerceModelPricingProfileInput(pickPresetPricingRawForBillingCurrency(preset!, 'USD'))!);
		assert.equal(profile?.tiers.length, 1);
		assert.equal(profile?.tiers[0]?.input_price, 2);
		assert.equal(profile?.tiers[0]?.output_price, 10);
		assert.equal(profile?.tiers[0]?.cache_read_price, 0.1);
		assert.equal(profile?.tiers[0]?.cache_write_price, 2.5);
		const cnyProfile = parsePricingProfile(coerceModelPricingProfileInput(pickPresetPricingRawForBillingCurrency(preset!, 'CNY'))!);
		assert.equal(cnyProfile?.tiers[0]?.cache_read_price, 0.7);
	});

	it('includes claude-haiku-5-5 with two-tier pricing based on prompt length', () => {
		const usd = listStaticModelPresetCatalogForAdmin('USD').find((r) => r.id === 'claude-haiku-5-5');
		const cny = listStaticModelPresetCatalogForAdmin('CNY').find((r) => r.id === 'claude-haiku-5-5');
		assert.ok(usd);
		assert.ok(cny);
		assert.equal(usd!.display_name, 'Claude Haiku 5.5');
		assert.equal(usd!.context_window, 1000000);
		assert.equal(usd!.max_tokens, 128000);
		assert.equal(usd!.pricing_label, '$0.1 / $0.5 /M');
		assert.equal(cny!.pricing_label, '¥0.7 / ¥3.5 /M');
		const preset = listStaticModelPresets().find((p) => p.id === 'claude-haiku-5-5');
		assert.ok(preset);
		assert.equal(preset!.released, '2026-10-07');
		const profile = parsePricingProfile(coerceModelPricingProfileInput(pickPresetPricingRawForBillingCurrency(preset!, 'USD'))!);
		assert.equal(profile?.tiers.length, 2);
		assert.equal(profile?.tiers[0]?.upto, 100000);
		assert.equal(profile?.tiers[0]?.input_price, 0.1);
		assert.equal(profile?.tiers[0]?.output_price, 0.5);
		assert.equal(profile?.tiers[0]?.cache_read_price, 0.01);
		assert.equal(profile?.tiers[0]?.cache_write_price, 0.125);
		assert.equal(profile?.tiers[1]?.upto, null);
		assert.equal(profile?.tiers[1]?.input_price, 0.5);
		assert.equal(profile?.tiers[1]?.output_price, 2.5);
		assert.equal(profile?.tiers[1]?.cache_read_price, 0.05);
		assert.equal(profile?.tiers[1]?.cache_write_price, 0.625);
		const cnyProfile = parsePricingProfile(coerceModelPricingProfileInput(pickPresetPricingRawForBillingCurrency(preset!, 'CNY'))!);
		assert.equal(cnyProfile?.tiers[0]?.upto, 100000);
		assert.equal(cnyProfile?.tiers[0]?.input_price, 0.7);
		assert.equal(cnyProfile?.tiers[0]?.output_price, 3.5);
		assert.equal(cnyProfile?.tiers[0]?.cache_read_price, 0.07);
		assert.equal(cnyProfile?.tiers[0]?.cache_write_price, 0.875);
		assert.equal(cnyProfile?.tiers[1]?.input_price, 3.5);
		assert.equal(cnyProfile?.tiers[1]?.output_price, 17.5);
		assert.equal(cnyProfile?.tiers[1]?.cache_read_price, 0.35);
		assert.equal(cnyProfile?.tiers[1]?.cache_write_price, 4.375);
	});

	it('includes claude-sonnet-5 at the permanent $2 / $10 list prices', () => {
		const usd = listStaticModelPresetCatalogForAdmin('USD').find((r) => r.id === 'claude-sonnet-5');
		const cny = listStaticModelPresetCatalogForAdmin('CNY').find((r) => r.id === 'claude-sonnet-5');
		assert.ok(usd);
		assert.ok(cny);
		assert.equal(usd!.display_name, 'Claude Sonnet 5');
		assert.equal(usd!.context_window, 1000000);
		assert.equal(usd!.max_tokens, 128000);
		assert.equal(usd!.pricing_label, '$2 / $10 /M');
		assert.equal(cny!.pricing_label, '¥14 / ¥70 /M');
		const preset = listStaticModelPresets().find((p) => p.id === 'claude-sonnet-5');
		assert.ok(preset);
		const profile = parsePricingProfile(coerceModelPricingProfileInput(pickPresetPricingRawForBillingCurrency(preset!, 'USD'))!);
		assert.equal(profile?.tiers[0]?.input_price, 2);
		assert.equal(profile?.tiers[0]?.output_price, 10);
		assert.equal(profile?.tiers[0]?.cache_read_price, 0.2);
		assert.equal(profile?.tiers[0]?.cache_write_price, 2.5);
	});

	it('includes claude-fable-5-1 with cheaper cache-read list prices', () => {
		const usd = listStaticModelPresetCatalogForAdmin('USD').find((r) => r.id === 'claude-fable-5-1');
		const cny = listStaticModelPresetCatalogForAdmin('CNY').find((r) => r.id === 'claude-fable-5-1');
		assert.ok(usd);
		assert.ok(cny);
		assert.equal(usd!.display_name, 'Claude Fable 5.1');
		assert.equal(usd!.context_window, 1000000);
		assert.equal(usd!.max_tokens, 128000);
		assert.equal(usd!.pricing_label, '$10 / $50 /M');
		assert.equal(cny!.pricing_label, '¥70 / ¥350 /M');
		const preset = listStaticModelPresets().find((p) => p.id === 'claude-fable-5-1');
		assert.ok(preset);
		const profile = parsePricingProfile(coerceModelPricingProfileInput(pickPresetPricingRawForBillingCurrency(preset!, 'USD'))!);
		assert.equal(profile?.tiers[0]?.cache_read_price, 0.25);
		assert.equal(profile?.tiers[0]?.cache_write_price, 12.5);
	});

	it('includes gpt-5.6 terra and luna at the 2026-07-30 list prices, not the Sol promo', () => {
		const terraUsd = listStaticModelPresetCatalogForAdmin('USD').find((r) => r.id === 'gpt-5.6-terra');
		const terraCny = listStaticModelPresetCatalogForAdmin('CNY').find((r) => r.id === 'gpt-5.6-terra');
		const lunaUsd = listStaticModelPresetCatalogForAdmin('USD').find((r) => r.id === 'gpt-5.6-luna');
		const lunaCny = listStaticModelPresetCatalogForAdmin('CNY').find((r) => r.id === 'gpt-5.6-luna');
		assert.ok(terraUsd);
		assert.ok(terraCny);
		assert.ok(lunaUsd);
		assert.ok(lunaCny);
		assert.equal(terraUsd!.pricing_label, '$2 / $12 /M');
		assert.equal(terraCny!.pricing_label, '¥14 / ¥84 /M');
		assert.equal(lunaUsd!.pricing_label, '$0.2 / $1.2 /M');
		assert.equal(lunaCny!.pricing_label, '¥1.4 / ¥8.4 /M');

		const terra = listStaticModelPresets().find((p) => p.id === 'gpt-5.6-terra');
		const luna = listStaticModelPresets().find((p) => p.id === 'gpt-5.6-luna');
		assert.ok(terra);
		assert.ok(luna);
		const terraProfile = parsePricingProfile(coerceModelPricingProfileInput(pickPresetPricingRawForBillingCurrency(terra!, 'USD'))!);
		const lunaProfile = parsePricingProfile(coerceModelPricingProfileInput(pickPresetPricingRawForBillingCurrency(luna!, 'USD'))!);
		assert.equal(terraProfile?.tiers[0]?.upto, 272000);
		assert.equal(terraProfile?.tiers[0]?.input_price, 2);
		assert.equal(terraProfile?.tiers[0]?.output_price, 12);
		assert.equal(terraProfile?.tiers[0]?.cache_read_price, 0.2);
		assert.equal(terraProfile?.tiers[0]?.cache_write_price, 2.5);
		assert.equal(terraProfile?.tiers[1]?.input_price, 4);
		assert.equal(terraProfile?.tiers[1]?.output_price, 18);
		assert.equal(lunaProfile?.tiers[0]?.input_price, 0.2);
		assert.equal(lunaProfile?.tiers[0]?.output_price, 1.2);
		assert.equal(lunaProfile?.tiers[0]?.cache_read_price, 0.02);
		assert.equal(lunaProfile?.tiers[0]?.cache_write_price, 0.25);
		assert.equal(lunaProfile?.tiers[1]?.input_price, 0.4);
		assert.equal(lunaProfile?.tiers[1]?.output_price, 1.8);

		for (const id of ['gpt-5.6', 'gpt-5.6-sol']) {
			const usd = listStaticModelPresetCatalogForAdmin('USD').find((r) => r.id === id);
			assert.ok(usd, id);
			assert.equal(usd!.pricing_label, '$5 / $30 /M', `${id} stays on list price, not the Sol promo`);
		}
	});

	it('includes gpt-6 sol and luna at Standard list prices, including the 272K tier', () => {
		const solUsd = listStaticModelPresetCatalogForAdmin('USD').find((r) => r.id === 'gpt-6-sol');
		const solCny = listStaticModelPresetCatalogForAdmin('CNY').find((r) => r.id === 'gpt-6-sol');
		const lunaUsd = listStaticModelPresetCatalogForAdmin('USD').find((r) => r.id === 'gpt-6-luna');
		const lunaCny = listStaticModelPresetCatalogForAdmin('CNY').find((r) => r.id === 'gpt-6-luna');
		assert.ok(solUsd);
		assert.ok(solCny);
		assert.ok(lunaUsd);
		assert.ok(lunaCny);
		assert.equal(solUsd!.display_name, 'GPT-6 Sol');
		assert.equal(lunaUsd!.display_name, 'GPT-6 Luna');
		assert.equal(solUsd!.context_window, 1050000);
		assert.equal(solUsd!.max_tokens, 128000);
		assert.equal(solUsd!.pricing_label, '$2 / $10 /M');
		assert.equal(solCny!.pricing_label, '¥14 / ¥70 /M');
		assert.equal(lunaUsd!.pricing_label, '$0.1 / $0.5 /M');
		assert.equal(lunaCny!.pricing_label, '¥0.7 / ¥3.5 /M');

		const sol = listStaticModelPresets().find((p) => p.id === 'gpt-6-sol');
		const luna = listStaticModelPresets().find((p) => p.id === 'gpt-6-luna');
		assert.ok(sol);
		assert.ok(luna);
		const solProfile = parsePricingProfile(coerceModelPricingProfileInput(pickPresetPricingRawForBillingCurrency(sol!, 'USD'))!);
		const lunaProfile = parsePricingProfile(coerceModelPricingProfileInput(pickPresetPricingRawForBillingCurrency(luna!, 'USD'))!);
		assert.equal(solProfile?.tiers[0]?.upto, 272000);
		assert.equal(solProfile?.tiers[0]?.input_price, 2);
		assert.equal(solProfile?.tiers[0]?.output_price, 10);
		assert.equal(solProfile?.tiers[0]?.cache_read_price, 0.2);
		assert.equal(solProfile?.tiers[0]?.cache_write_price, 2.5);
		assert.equal(solProfile?.tiers[1]?.input_price, 4);
		assert.equal(solProfile?.tiers[1]?.output_price, 15);
		assert.equal(solProfile?.tiers[1]?.cache_read_price, 0.4);
		assert.equal(solProfile?.tiers[1]?.cache_write_price, 5);
		assert.equal(lunaProfile?.tiers[0]?.input_price, 0.1);
		assert.equal(lunaProfile?.tiers[0]?.output_price, 0.5);
		assert.equal(lunaProfile?.tiers[0]?.cache_read_price, 0.01);
		assert.equal(lunaProfile?.tiers[0]?.cache_write_price, 0.125);
		assert.equal(lunaProfile?.tiers[1]?.input_price, 0.2);
		assert.equal(lunaProfile?.tiers[1]?.output_price, 0.75);
		assert.equal(lunaProfile?.tiers[1]?.cache_read_price, 0.02);
		assert.equal(lunaProfile?.tiers[1]?.cache_write_price, 0.25);
	});

	it('includes gpt-6.1-sol at Standard list prices with 5% cached input', () => {
		const usd = listStaticModelPresetCatalogForAdmin('USD').find((r) => r.id === 'gpt-6.1-sol');
		const cny = listStaticModelPresetCatalogForAdmin('CNY').find((r) => r.id === 'gpt-6.1-sol');
		assert.ok(usd);
		assert.ok(cny);
		assert.equal(usd!.display_name, 'GPT-6.1 Sol');
		assert.equal(usd!.context_window, 1050000);
		assert.equal(usd!.max_tokens, 128000);
		assert.equal(usd!.pricing_label, '$2 / $10 /M');
		assert.equal(cny!.pricing_label, '¥14 / ¥70 /M');

		const preset = listStaticModelPresets().find((p) => p.id === 'gpt-6.1-sol');
		assert.ok(preset);
		const profile = parsePricingProfile(coerceModelPricingProfileInput(pickPresetPricingRawForBillingCurrency(preset!, 'USD'))!);
		assert.equal(profile?.tiers[0]?.upto, 272000);
		assert.equal(profile?.tiers[0]?.input_price, 2);
		assert.equal(profile?.tiers[0]?.output_price, 10);
		assert.equal(profile?.tiers[0]?.cache_read_price, 0.1);
		assert.equal(profile?.tiers[0]?.cache_write_price, 2.5);
		assert.equal(profile?.tiers[1]?.input_price, 4);
		assert.equal(profile?.tiers[1]?.output_price, 15);
		assert.equal(profile?.tiers[1]?.cache_read_price, 0.2);
		assert.equal(profile?.tiers[1]?.cache_write_price, 5);
	});

	it('includes claude-opus-5-5 at the $4 / $20 list price with 5-minute cache writes', () => {
		const usd = listStaticModelPresetCatalogForAdmin('USD').find((r) => r.id === 'claude-opus-5-5');
		const cny = listStaticModelPresetCatalogForAdmin('CNY').find((r) => r.id === 'claude-opus-5-5');
		assert.ok(usd);
		assert.ok(cny);
		assert.equal(usd!.display_name, 'Claude Opus 5.5');
		assert.equal(usd!.context_window, 1000000);
		assert.equal(usd!.max_tokens, 128000);
		assert.equal(usd!.pricing_label, '$4 / $20 /M');
		assert.equal(cny!.pricing_label, '¥28 / ¥140 /M');
		const preset = listStaticModelPresets().find((p) => p.id === 'claude-opus-5-5');
		assert.ok(preset);
		const profile = parsePricingProfile(coerceModelPricingProfileInput(pickPresetPricingRawForBillingCurrency(preset!, 'USD'))!);
		assert.equal(profile?.tiers.length, 1);
		assert.equal(profile?.tiers[0]?.input_price, 4);
		assert.equal(profile?.tiers[0]?.output_price, 20);
		assert.equal(profile?.tiers[0]?.cache_read_price, 0.2);
		assert.equal(profile?.tiers[0]?.cache_write_price, 5);
	});

	it('includes grok-4.7 at the same 200K list prices as grok-4.6', () => {
		const usd = listStaticModelPresetCatalogForAdmin('USD').find((r) => r.id === 'grok-4.7');
		const cny = listStaticModelPresetCatalogForAdmin('CNY').find((r) => r.id === 'grok-4.7');
		assert.ok(usd);
		assert.ok(cny);
		assert.equal(usd!.display_name, 'Grok 4.7');
		assert.equal(usd!.context_window, 500000);
		assert.equal(usd!.max_tokens, 128000);
		assert.equal(usd!.pricing_label, '$2 / $6 /M');
		assert.equal(cny!.pricing_label, '¥14 / ¥42 /M');
		const preset = listStaticModelPresets().find((p) => p.id === 'grok-4.7');
		assert.ok(preset);
		const profile = parsePricingProfile(coerceModelPricingProfileInput(pickPresetPricingRawForBillingCurrency(preset!, 'USD'))!);
		assert.equal(profile?.tiers[0]?.upto, 200000);
		assert.equal(profile?.tiers[0]?.input_price, 2);
		assert.equal(profile?.tiers[0]?.output_price, 6);
		assert.equal(profile?.tiers[0]?.cache_read_price, 0.5);
		assert.equal(profile?.tiers[0]?.cache_write_price, null);
		assert.equal(profile?.tiers[1]?.input_price, 4);
		assert.equal(profile?.tiers[1]?.output_price, 12);
		assert.equal(profile?.tiers[1]?.cache_read_price, 1);
	});

	it('includes grok-build-0.1 with 256K context and 200K tiered USD pricing', () => {
		const usd = listStaticModelPresetCatalogForAdmin('USD').find((r) => r.id === 'grok-build-0.1');
		assert.ok(usd);
		assert.equal(usd!.display_name, 'Grok Build 0.1');
		assert.equal(usd!.context_window, 256000);
		assert.equal(usd!.max_tokens, 128000);
		assert.equal(usd!.pricing_label, '$1 / $2 /M');
		const preset = listStaticModelPresets().find((p) => p.id === 'grok-build-0.1');
		assert.ok(preset);
		const profile = parsePricingProfile(coerceModelPricingProfileInput(pickPresetPricingRawForBillingCurrency(preset!, 'USD'))!);
		assert.equal(profile?.tiers[0]?.upto, 200000);
		assert.equal(profile?.tiers[0]?.input_price, 1);
		assert.equal(profile?.tiers[0]?.output_price, 2);
		assert.equal(profile?.tiers[0]?.cache_read_price, 0.2);
		assert.equal(profile?.tiers[1]?.input_price, 2);
		assert.equal(profile?.tiers[1]?.output_price, 4);
	});

	it('includes grok-4.20-0309-reasoning with 1M context at $1.25 / $2.50 list prices', () => {
		const usd = listStaticModelPresetCatalogForAdmin('USD').find((r) => r.id === 'grok-4.20-0309-reasoning');
		assert.ok(usd);
		assert.equal(usd!.display_name, 'Grok 4.20 Reasoning');
		assert.equal(usd!.context_window, 1000000);
		assert.equal(usd!.max_tokens, 128000);
		assert.equal(usd!.pricing_label, '$1.25 / $2.5 /M');
		const preset = listStaticModelPresets().find((p) => p.id === 'grok-4.20-0309-reasoning');
		assert.ok(preset);
		assert.equal(preset!.released, '2026-03-09');
		const profile = parsePricingProfile(coerceModelPricingProfileInput(pickPresetPricingRawForBillingCurrency(preset!, 'USD'))!);
		assert.equal(profile?.tiers[0]?.upto, 200000);
		assert.equal(profile?.tiers[0]?.input_price, 1.25);
		assert.equal(profile?.tiers[0]?.output_price, 2.5);
		assert.equal(profile?.tiers[1]?.input_price, 2.5);
		assert.equal(profile?.tiers[1]?.output_price, 5);
	});

	it('includes grok-4.20-0309-non-reasoning at the same prices as reasoning variant', () => {
		const usd = listStaticModelPresetCatalogForAdmin('USD').find((r) => r.id === 'grok-4.20-0309-non-reasoning');
		assert.ok(usd);
		assert.equal(usd!.display_name, 'Grok 4.20 Non-Reasoning');
		assert.equal(usd!.context_window, 1000000);
		assert.equal(usd!.pricing_label, '$1.25 / $2.5 /M');
	});

	it('includes gpt-6-astra with Standard short-context list prices', () => {
		const usd = listStaticModelPresetCatalogForAdmin('USD').find((r) => r.id === 'gpt-6-astra');
		const cny = listStaticModelPresetCatalogForAdmin('CNY').find((r) => r.id === 'gpt-6-astra');
		assert.ok(usd);
		assert.ok(cny);
		assert.equal(usd!.display_name, 'GPT-6 Astra');
		assert.equal(usd!.context_window, 1050000);
		assert.equal(usd!.max_tokens, 128000);
		assert.equal(usd!.pricing_label, '$10 / $50 /M');
		assert.equal(cny!.pricing_label, '¥70 / ¥350 /M');
		const preset = listStaticModelPresets().find((p) => p.id === 'gpt-6-astra');
		assert.ok(preset);
		const profile = parsePricingProfile(coerceModelPricingProfileInput(pickPresetPricingRawForBillingCurrency(preset!, 'USD'))!);
		assert.equal(profile?.tiers[0]?.upto, 272000);
		assert.equal(profile?.tiers[0]?.input_price, 10);
		assert.equal(profile?.tiers[0]?.output_price, 50);
		assert.equal(profile?.tiers[1]?.upto, null);
		assert.equal(profile?.tiers[1]?.input_price, 20);
		assert.equal(profile?.tiers[1]?.output_price, 75);
	});

	it('includes MiMo-V2.6 realtime list prices, not the batch half-price', () => {
		const expected = [
			{
				id: 'mimo-v2.6-pro',
				display_name: 'MiMo V2.6 Pro',
				usdLabel: '$0.435 / $0.87 /M',
				cnyLabel: '¥3 / ¥6 /M',
				usd: { input_price: 0.435, output_price: 0.87, cache_read_price: 0.0036 },
				cny: { input_price: 3, output_price: 6, cache_read_price: 0.025 },
			},
			{
				id: 'mimo-v2.6-flash',
				display_name: 'MiMo V2.6 Flash',
				usdLabel: '$0.14 / $0.28 /M',
				cnyLabel: '¥1 / ¥2 /M',
				usd: { input_price: 0.14, output_price: 0.28, cache_read_price: 0.0028 },
				cny: { input_price: 1, output_price: 2, cache_read_price: 0.02 },
			},
			{
				id: 'mimo-v2.6-pro-ultraspeed',
				display_name: 'MiMo V2.6 Pro UltraSpeed',
				usdLabel: '$4.35 / $8.7 /M',
				cnyLabel: '¥30 / ¥60 /M',
				usd: { input_price: 4.35, output_price: 8.7, cache_read_price: 0.036 },
				cny: { input_price: 30, output_price: 60, cache_read_price: 0.25 },
			},
		] as const;
		for (const row of expected) {
			const usd = listStaticModelPresetCatalogForAdmin('USD').find((item) => item.id === row.id);
			const cny = listStaticModelPresetCatalogForAdmin('CNY').find((item) => item.id === row.id);
			assert.ok(usd, row.id);
			assert.ok(cny, row.id);
			assert.equal(usd!.display_name, row.display_name);
			assert.equal(usd!.kind, 'llm');
			assert.equal(usd!.context_window, 1050000);
			assert.equal(usd!.max_tokens, 128000);
			assert.equal(usd!.pricing_label, row.usdLabel);
			assert.equal(cny!.pricing_label, row.cnyLabel);
			const preset = listStaticModelPresets().find((item) => item.id === row.id);
			assert.ok(preset, row.id);
			for (const billing of ['USD', 'CNY'] as const) {
				const profile = parsePricingProfile(
					coerceModelPricingProfileInput(pickPresetPricingRawForBillingCurrency(preset!, billing))!
				);
				assert.ok(profile, `${row.id} ${billing}`);
				assert.equal(profile!.tiers.length, 1);
				assert.equal(profile!.tiers[0]?.upto, null);
				assert.equal(profile!.tiers[0]?.cache_write_price, null);
				assert.deepEqual(profile!.schedule, []);
				const prices = billing === 'USD' ? row.usd : row.cny;
				assert.equal(profile!.tiers[0]?.input_price, prices.input_price);
				assert.equal(profile!.tiers[0]?.output_price, prices.output_price);
				assert.equal(profile!.tiers[0]?.cache_read_price, prices.cache_read_price);
			}
		}
	});

	it('includes deepseek-v4.1-flash and re-prices the Flash line at the 2026-09-10 off-peak list prices', () => {
		const v41 = listStaticModelPresetCatalogForAdmin('USD').find((r) => r.id === 'deepseek-v4.1-flash');
		assert.ok(v41);
		assert.equal(v41!.display_name, 'DeepSeek V4.1 Flash');
		assert.equal(v41!.context_window, 1000000);
		assert.equal(v41!.max_tokens, 384000);
		for (const id of ['deepseek-v4-flash', 'deepseek-v4.1-flash']) {
			const usd = listStaticModelPresetCatalogForAdmin('USD').find((r) => r.id === id);
			const cny = listStaticModelPresetCatalogForAdmin('CNY').find((r) => r.id === id);
			assert.ok(usd, id);
			assert.ok(cny, id);
			assert.equal(usd!.pricing_label, '$0.15 / $0.6 /M', `${id} USD`);
			assert.equal(cny!.pricing_label, '¥1 / ¥4 /M', `${id} CNY`);
		}
	});

	it('includes minimax-m2.7-highspeed with dual-currency official list prices', () => {
		const usd = listStaticModelPresetCatalogForAdmin('USD').find((r) => r.id === 'minimax-m2.7-highspeed');
		const cny = listStaticModelPresetCatalogForAdmin('CNY').find((r) => r.id === 'minimax-m2.7-highspeed');
		assert.ok(usd);
		assert.ok(cny);
		assert.equal(usd!.display_name, 'MiniMax M2.7 Highspeed');
		assert.equal(usd!.context_window, 200000);
		assert.equal(usd!.max_tokens, 128000);
		assert.equal(usd!.pricing_label, '$0.6 / $2.4 /M');
		assert.equal(cny!.pricing_label, '¥4.2 / ¥16.8 /M');
		const preset = listStaticModelPresets().find((p) => p.id === 'minimax-m2.7-highspeed');
		assert.ok(preset);
		const usdProfile = parsePricingProfile(coerceModelPricingProfileInput(pickPresetPricingRawForBillingCurrency(preset!, 'USD'))!);
		const cnyProfile = parsePricingProfile(coerceModelPricingProfileInput(pickPresetPricingRawForBillingCurrency(preset!, 'CNY'))!);
		assert.equal(usdProfile?.tiers[0]?.input_price, 0.6);
		assert.equal(usdProfile?.tiers[0]?.output_price, 2.4);
		assert.equal(usdProfile?.tiers[0]?.cache_read_price, 0.06);
		assert.equal(usdProfile?.tiers[0]?.cache_write_price, 0.375);
		assert.equal(cnyProfile?.tiers[0]?.input_price, 4.2);
		assert.equal(cnyProfile?.tiers[0]?.output_price, 16.8);
		assert.equal(cnyProfile?.tiers[0]?.cache_read_price, 0.42);
		assert.equal(cnyProfile?.tiers[0]?.cache_write_price, 2.625);
	});

	it('includes kimi-k3 with platform.kimi list prices including 5min cache_write_price', () => {
		const usd = listStaticModelPresetCatalogForAdmin('USD').find((r) => r.id === 'kimi-k3');
		const cny = listStaticModelPresetCatalogForAdmin('CNY').find((r) => r.id === 'kimi-k3');
		assert.ok(usd);
		assert.ok(cny);
		assert.equal(usd!.display_name, 'Kimi K3');
		assert.equal(usd!.context_window, 1000000);
		assert.equal(usd!.max_tokens, 1000000);
		assert.equal(usd!.pricing_label, '$3 / $15 /M');
		assert.equal(cny!.pricing_label, '¥20 / ¥100 /M');
		const preset = listStaticModelPresets().find((p) => p.id === 'kimi-k3');
		assert.ok(preset);
		const usdProfile = parsePricingProfile(coerceModelPricingProfileInput(pickPresetPricingRawForBillingCurrency(preset!, 'USD'))!);
		const cnyProfile = parsePricingProfile(coerceModelPricingProfileInput(pickPresetPricingRawForBillingCurrency(preset!, 'CNY'))!);
		assert.equal(usdProfile?.tiers[0]?.input_price, 3);
		assert.equal(usdProfile?.tiers[0]?.output_price, 15);
		assert.equal(usdProfile?.tiers[0]?.cache_read_price, 0.3);
		assert.equal(usdProfile?.tiers[0]?.cache_write_price, 3);
		assert.equal(cnyProfile?.tiers[0]?.input_price, 20);
		assert.equal(cnyProfile?.tiers[0]?.output_price, 100);
		assert.equal(cnyProfile?.tiers[0]?.cache_read_price, 2);
		assert.equal(cnyProfile?.tiers[0]?.cache_write_price, 20);
	});

	it('marks kimi-k2.5 retired on the official offline date', () => {
		const preset = listStaticModelPresets().find((p) => p.id === 'kimi-k2.5');
		assert.ok(preset);
		assert.equal(preset!.retired, '2026-08-31');
		assert.equal(preset!.context_window, 256000);
		assert.equal(preset!.max_tokens, 256000);
	});

	it('includes kimi-k2.7-code-highspeed with platform.kimi.ai USD and CNY list prices', () => {
		const usd = listStaticModelPresetCatalogForAdmin('USD').find((r) => r.id === 'kimi-k2.7-code-highspeed');
		const cny = listStaticModelPresetCatalogForAdmin('CNY').find((r) => r.id === 'kimi-k2.7-code-highspeed');
		assert.ok(usd);
		assert.ok(cny);
		assert.equal(usd!.display_name, 'Kimi K2.7 Code Highspeed');
		assert.equal(usd!.context_window, 256000);
		assert.equal(usd!.pricing_label, '$1.9 / $8 /M');
		assert.equal(cny!.pricing_label, '¥13 / ¥54 /M');
		const preset = listStaticModelPresets().find((p) => p.id === 'kimi-k2.7-code-highspeed');
		assert.ok(preset);
		const profile = parsePricingProfile(coerceModelPricingProfileInput(pickPresetPricingRawForBillingCurrency(preset!, 'USD'))!);
		assert.equal(profile?.tiers[0]?.input_price, 1.9);
		assert.equal(profile?.tiers[0]?.output_price, 8);
		assert.equal(profile?.tiers[0]?.cache_read_price, 0.38);
	});

	it('includes qwen3.8-2.4t-a95b open-source flagship with DashScope CNY list prices', () => {
		const usd = listStaticModelPresetCatalogForAdmin('USD').find((r) => r.id === 'qwen3.8-2.4t-a95b');
		const cny = listStaticModelPresetCatalogForAdmin('CNY').find((r) => r.id === 'qwen3.8-2.4t-a95b');
		assert.ok(usd);
		assert.ok(cny);
		assert.equal(usd!.display_name, 'Qwen3.8 2.4T-A95B');
		assert.equal(usd!.context_window, 1000000);
		assert.equal(usd!.max_tokens, 128000);
		assert.equal(cny!.pricing_label, '¥12 / ¥36 /M');
		const preset = listStaticModelPresets().find((p) => p.id === 'qwen3.8-2.4t-a95b');
		assert.ok(preset);
		assert.equal(preset!.released, '2026-08-01');
	});

	it('includes qwen3.8-27b multimodal Dense with DashScope list prices', () => {
		const usd = listStaticModelPresetCatalogForAdmin('USD').find((r) => r.id === 'qwen3.8-27b');
		const cny = listStaticModelPresetCatalogForAdmin('CNY').find((r) => r.id === 'qwen3.8-27b');
		assert.ok(usd);
		assert.ok(cny);
		assert.equal(usd!.display_name, 'Qwen3.8 27B');
		assert.equal(usd!.context_window, 1000000);
		assert.equal(cny!.pricing_label, '¥3 / ¥12 /M');
		const preset = listStaticModelPresets().find((p) => p.id === 'qwen3.8-27b');
		assert.ok(preset);
		const profile = parsePricingProfile(coerceModelPricingProfileInput(pickPresetPricingRawForBillingCurrency(preset!, 'CNY'))!);
		assert.equal(profile?.tiers[0]?.input_price, 3);
		assert.equal(profile?.tiers[0]?.output_price, 12);
		assert.equal(profile?.tiers[0]?.cache_read_price, 0.6);
		assert.equal(profile?.tiers[0]?.cache_write_price, 3.75);
	});

	it('includes qwen3.8-omni-flash multimodal model with DashScope list prices', () => {
		const usd = listStaticModelPresetCatalogForAdmin('USD').find((r) => r.id === 'qwen3.8-omni-flash');
		const cny = listStaticModelPresetCatalogForAdmin('CNY').find((r) => r.id === 'qwen3.8-omni-flash');
		assert.ok(usd);
		assert.ok(cny);
		assert.equal(usd!.display_name, 'Qwen3.8 Omni Flash');
		assert.equal(usd!.context_window, 1000000);
		assert.equal(cny!.pricing_label, '¥0.8 / ¥2.7 /M');
		const preset = listStaticModelPresets().find((p) => p.id === 'qwen3.8-omni-flash');
		assert.ok(preset);
		assert.deepEqual(preset!.modalities?.input, ['text', 'image', 'audio', 'video']);
	});

	it('includes qwen3.8-max-prime high-throughput variant with DashScope list prices', () => {
		const usd = listStaticModelPresetCatalogForAdmin('USD').find((r) => r.id === 'qwen3.8-max-prime');
		const cny = listStaticModelPresetCatalogForAdmin('CNY').find((r) => r.id === 'qwen3.8-max-prime');
		assert.ok(usd);
		assert.ok(cny);
		assert.equal(usd!.display_name, 'Qwen3.8 Max Prime');
		assert.equal(usd!.context_window, 1000000);
		assert.equal(cny!.pricing_label, '¥24 / ¥72 /M');
	});

	it('includes qwen-image-2.1-turbo with DashScope per-image list prices', () => {
		const usd = listStaticModelPresetCatalogForAdmin('USD').find((r) => r.id === 'qwen-image-2.1-turbo');
		const cny = listStaticModelPresetCatalogForAdmin('CNY').find((r) => r.id === 'qwen-image-2.1-turbo');
		assert.ok(usd);
		assert.ok(cny);
		assert.equal(usd!.display_name, 'Qwen Image 2.1 Turbo');
		assert.equal(usd!.kind, 'image');
		assert.equal(usd!.context_window, null);
		assert.equal(usd!.max_tokens, null);
		const preset = listStaticModelPresets().find((p) => p.id === 'qwen-image-2.1-turbo');
		assert.ok(preset);
		assert.equal(preset!.released, '2026-10-09');
		assert.deepEqual(preset!.modalities?.input, ['text', 'image']);
		assert.deepEqual(preset!.modalities?.output, ['image']);
		const usdPricing = pickPresetPricingRawForBillingCurrency(preset!, 'USD') as {
			image_billing_mode?: string;
			image?: { default?: number };
		};
		assert.ok(usdPricing);
		assert.equal(usdPricing.image_billing_mode, 'per_image');
		assert.equal(usdPricing.image?.default, 0.016);
		const cnyPricing = pickPresetPricingRawForBillingCurrency(preset!, 'CNY') as {
			image_billing_mode?: string;
			image?: { default?: number };
		};
		assert.ok(cnyPricing);
		assert.equal(cnyPricing.image_billing_mode, 'per_image');
		assert.equal(cnyPricing.image?.default, 0.1);
	});

	it('includes gemini-nano-banana-2.1 with Gemini API Standard list prices (CNY is USD × 7)', () => {
		const usd = listStaticModelPresetCatalogForAdmin('USD').find((r) => r.id === 'gemini-nano-banana-2.1');
		const cny = listStaticModelPresetCatalogForAdmin('CNY').find((r) => r.id === 'gemini-nano-banana-2.1');
		assert.ok(usd);
		assert.ok(cny);
		assert.equal(usd!.display_name, 'Gemini Nano Banana 2.1');
		assert.equal(usd!.kind, 'image');
		assert.equal(usd!.context_window, null);
		assert.equal(usd!.max_tokens, null);
		assert.equal(usd!.pricing_label, '$1.5 / $1.5 / $30 /M');
		assert.equal(cny!.pricing_label, '¥10.5 / ¥10.5 / ¥210 /M');
		const preset = listStaticModelPresets().find((p) => p.id === 'gemini-nano-banana-2.1');
		assert.ok(preset);
		assert.equal(preset!.released, '2026-10-06');
		assert.deepEqual(preset!.modalities?.input, ['text', 'image']);
		assert.deepEqual(preset!.modalities?.output, ['image']);
		const profile = parsePricingProfile(coerceModelPricingProfileInput(pickPresetPricingRawForBillingCurrency(preset!, 'USD'))!);
		assert.ok(profile);
		assert.equal(profile!.tiers.length, 1);
		assert.equal(profile!.tiers[0]?.input_price, 1.5);
		assert.equal(profile!.tiers[0]?.output_price, 7.5);
		assert.equal(profile!.tiers[0]?.cache_read_price, null);
		assert.equal(profile!.tiers[0]?.cache_write_price, null);
		assert.equal(profile!.tiers[0]?.image_input_price, 1.5);
		assert.equal(profile!.tiers[0]?.image_output_price, 30);
		const cnyProfile = parsePricingProfile(coerceModelPricingProfileInput(pickPresetPricingRawForBillingCurrency(preset!, 'CNY'))!);
		assert.ok(cnyProfile);
		assert.equal(cnyProfile!.tiers[0]?.input_price, 10.5);
		assert.equal(cnyProfile!.tiers[0]?.output_price, 52.5);
		assert.equal(cnyProfile!.tiers[0]?.image_input_price, 10.5);
		assert.equal(cnyProfile!.tiers[0]?.image_output_price, 210);
	});
});

describe('import catalog localized model metadata', () => {
	it('provides English, Chinese, Japanese, and Korean descriptions for every static preset', () => {
		const rows = listStaticModelPresetCatalogForAdmin('USD');
		assert.ok(rows.length > 0);
		for (const row of rows) {
			assert.ok(row.description?.trim(), `${row.id}: English fallback`);
			assert.ok(row.i18n?.en.trim(), `${row.id}: English catalog description`);
			assert.ok(row.i18n?.zh.trim(), `${row.id}: Chinese catalog description`);
			assert.match(row.i18n?.ja ?? '', /[ぁ-ん]/, `${row.id}: Japanese catalog description`);
			assert.match(row.i18n?.ko ?? '', /[가-힣]/, `${row.id}: Korean catalog description`);
			assert.notEqual(row.i18n?.ja, row.i18n?.en, `${row.id}: Japanese must not copy English`);
			assert.notEqual(row.i18n?.ko, row.i18n?.en, `${row.id}: Korean must not copy English`);
		}
	});
});

describe('static model presets do not seed tags', () => {
	it('omits tags so import does not write model_tags', () => {
		for (const preset of listStaticModelPresets()) {
			assert.equal(
				(preset as { tags?: unknown }).tags,
				undefined,
				`${preset.id}: presets must not include tags`
			);
		}
	});
});

const DEEPSEEK_V4_PEAK_SCHEDULE = [
	{ start: '09:00', end: '12:00', factor: 2, days: [1, 2, 3, 4, 5] },
	{ start: '14:00', end: '18:00', factor: 2, days: [1, 2, 3, 4, 5] },
];

describe('static preset import writes catalog schedule', () => {
	it('keeps DeepSeek V4 official peak windows on both currency branches', () => {
		for (const id of ['deepseek-v4-pro', 'deepseek-v4-flash', 'deepseek-v4.1-flash']) {
			const preset = listStaticModelPresets().find((p) => p.id === id);
			assert.ok(preset, id);
			for (const billing of ['USD', 'CNY'] as const) {
				const json = coerceModelPricingProfileInput(
					pickPresetPricingRawForBillingCurrency(preset!, billing)
				);
				assert.ok(json, `${id} ${billing}`);
				const profile = parsePricingProfile(json!);
				assert.ok(profile, `${id} ${billing} parsed`);
				assert.deepEqual(profile!.schedule, DEEPSEEK_V4_PEAK_SCHEDULE, `${id} ${billing}`);
			}
		}
	});

	it('does not invent a schedule for DeepSeek V3.2', () => {
		const preset = listStaticModelPresets().find((p) => p.id === 'deepseek-v3.2');
		assert.ok(preset);
		const json = coerceModelPricingProfileInput(pickPresetPricingRawForBillingCurrency(preset!, 'USD'));
		assert.ok(json);
		assert.deepEqual(parsePricingProfile(json!)?.schedule, []);
	});
});

describe('import catalog embedding presets', () => {
	it('lists embedding models with kind=embedding and input-token-only list prices', () => {
		const usd = listStaticModelPresetCatalogForAdmin('USD').find((r) => r.id === 'text-embedding-3-small');
		const cny = listStaticModelPresetCatalogForAdmin('CNY').find((r) => r.id === 'text-embedding-3-small');
		assert.ok(usd);
		assert.ok(cny);
		assert.equal(usd!.kind, 'embedding');
		assert.equal(usd!.max_tokens, null);
		const preset = listStaticModelPresets().find((p) => p.id === 'text-embedding-3-small');
		assert.ok(preset);
		assert.deepEqual(preset!.modalities?.output, ['embedding']);
		const profile = parsePricingProfile(coerceModelPricingProfileInput(pickPresetPricingRawForBillingCurrency(preset!, 'USD'))!);
		assert.equal(profile!.tiers[0]?.input_price, 0.02);
		assert.equal(profile!.tiers[0]?.output_price, 0);
		assert.equal(profile!.tiers[0]?.cache_read_price, null);
	});

	it('includes Google and Alibaba Cloud embedding presets', () => {
		const ids = new Set(listStaticModelPresetCatalogForAdmin('USD').filter((r) => r.kind === 'embedding').map((r) => r.id));
		for (const id of ['text-embedding-3-large', 'gemini-embedding-2', 'text-embedding-v4', 'qwen3.7-text-embedding']) {
			assert.ok(ids.has(id), id);
		}
	});
});

describe('static model presets always carry both USD and CNY pricing', () => {
	it('every preset with pricing.usd also has pricing.cny (USD × 7 placeholder when no official CNY)', () => {
		const missing = listStaticModelPresets()
			.filter((p) => {
				const pricing = p.pricing as { usd?: unknown; cny?: unknown } | null | undefined;
				return pricing?.usd != null && pricing.cny == null;
			})
			.map((p) => p.id);
		assert.deepEqual(missing, []);
	});

	it('fills xAI Grok Build / Grok 4.20 CNY as USD × 7', () => {
		const cny = listStaticModelPresetCatalogForAdmin('CNY');
		assert.equal(cny.find((r) => r.id === 'grok-build-0.1')!.pricing_label, '¥7 / ¥14 /M');
		assert.equal(cny.find((r) => r.id === 'grok-4.20-0309-reasoning')!.pricing_label, '¥8.75 / ¥17.5 /M');
		assert.equal(cny.find((r) => r.id === 'grok-4.20-0309-non-reasoning')!.pricing_label, '¥8.75 / ¥17.5 /M');
	});
});

const TOKEN_TIER_KEYS = ['cache_read_price', 'cache_write_price', 'input_price', 'output_price', 'upto'];

function doubaoPreset(id: string) {
	const preset = listStaticModelPresets().find((p) => p.id === id);
	assert.ok(preset, id);
	return preset!;
}

function doubaoTiers(id: string, billing: 'USD' | 'CNY') {
	const preset = doubaoPreset(id);
	const json = coerceModelPricingProfileInput(pickPresetPricingRawForBillingCurrency(preset, billing));
	assert.ok(json, `${id} ${billing}`);
	const profile = parsePricingProfile(json!);
	assert.ok(profile, `${id} ${billing} parsed`);
	return profile!.tiers;
}

describe('MiniMax M3 catalog list prices', () => {
	it('records the current official standard tiers, not the struck list or Priority', () => {
		const preset = listStaticModelPresets().find((p) => p.id === 'minimax-m3');
		assert.ok(preset);
		const expected = {
			USD: [
				{ upto: 512000, input_price: 0.3, output_price: 1.2, cache_read_price: 0.06, cache_write_price: null },
				{ upto: null, input_price: 0.6, output_price: 2.4, cache_read_price: 0.12, cache_write_price: null },
			],
			CNY: [
				{ upto: 512000, input_price: 2.1, output_price: 8.4, cache_read_price: 0.42, cache_write_price: null },
				{ upto: null, input_price: 4.2, output_price: 16.8, cache_read_price: 0.84, cache_write_price: null },
			],
		};
		for (const billing of ['USD', 'CNY'] as const) {
			const profile = parsePricingProfile(
				coerceModelPricingProfileInput(pickPresetPricingRawForBillingCurrency(preset, billing))!,
			);
			assert.deepEqual(
				profile?.tiers.map((tier) =>
					Object.fromEntries(TOKEN_TIER_KEYS.map((key) => [key, tier[key as keyof typeof tier]])),
				),
				expected[billing],
			);
		}
	});
});

describe('MiniMax M3.1 Flash catalog specs', () => {
	it('records the official single-tier list price and drops the preview id', () => {
		const preset = listStaticModelPresets().find((p) => p.id === 'minimax-m3.1-flash');
		assert.ok(preset);
		assert.equal(listStaticModelPresets().some((p) => p.id === 'minimax-m3.1-flash-preview'), false);
		assert.equal(preset.display_name, 'MiniMax M3.1 Flash');
		assert.equal(preset.vendor, 'minimax');
		assert.equal(preset.context_window, 1000000);
		assert.equal(preset.max_tokens, 512000);
		assert.equal(preset.released, '2026-10-19');
		assert.equal(preset.retired, undefined);
		assert.deepEqual(preset.modalities?.input, ['text', 'image', 'video']);
		assert.deepEqual(preset.modalities?.output, ['text']);
		assert.match(preset.description ?? '', /tunable thinking depth/);
		assert.match(preset.i18n?.zh ?? '', /Frontier Coding/);
		assert.match(preset.i18n?.ja ?? '', /Frontier Coding/);
		assert.match(preset.i18n?.ko ?? '', /Frontier Coding/);
		const expected = {
			USD: [{ upto: null, input_price: 0.15, output_price: 0.6, cache_read_price: 0.015, cache_write_price: null }],
			CNY: [{ upto: null, input_price: 1, output_price: 4, cache_read_price: 0.1, cache_write_price: null }],
		};
		for (const billing of ['USD', 'CNY'] as const) {
			const row: AdminStaticModelPresetCatalogItem | undefined =
				listStaticModelPresetCatalogForAdmin(billing).find((item) => item.id === preset.id);
			assert.ok(row, billing);
			assert.equal(row.kind, 'llm');
			assert.equal(row.pricing_available, true);
			assert.equal(row.context_window, 1000000);
			assert.equal(row.max_tokens, 512000);
			const profile = parsePricingProfile(
				coerceModelPricingProfileInput(pickPresetPricingRawForBillingCurrency(preset, billing))!,
			);
			assert.deepEqual(
				profile?.tiers.map((tier) =>
					Object.fromEntries(TOKEN_TIER_KEYS.map((key) => [key, tier[key as keyof typeof tier]])),
				),
				expected[billing],
			);
		}
	});
});

describe('Doubao Seed catalog list prices', () => {
	it('adds doubao-seed-2-1-pro-260915 with CNY only', () => {
		const preset = doubaoPreset('doubao-seed-2-1-pro-260915');
		assert.equal(preset.display_name, 'Doubao Seed 2.1 Pro (260915)');
		assert.equal(preset.context_window, 1024000);
		assert.equal(preset.max_tokens, 256000);
		assert.equal(preset.released, '2026-09-15');
		assert.equal(preset.retired, undefined);
		assert.deepEqual(preset.modalities?.input, ['text', 'image', 'video']);
		assert.deepEqual(preset.modalities?.output, ['text']);
		assert.equal(
			(preset as { suggested_provider_model_name?: unknown }).suggested_provider_model_name,
			undefined
		);
		const pricing = preset.pricing as { usd?: unknown; cny?: { tiers: Array<Record<string, unknown>> } };
		assert.equal(pricing.usd, undefined);
		assert.deepEqual(Object.keys(pricing.cny!.tiers[0]!).sort(), TOKEN_TIER_KEYS);

		const usd = listStaticModelPresetCatalogForAdmin('USD').find((r) => r.id === preset.id);
		const cny = listStaticModelPresetCatalogForAdmin('CNY').find((r) => r.id === preset.id);
		assert.ok(usd);
		assert.ok(cny);
		assert.equal(usd!.context_window, 1024000);
		assert.equal(usd!.max_tokens, 256000);
		assert.equal(usd!.pricing_available, false);
		assert.equal(usd!.pricing_label, null);
		assert.equal(cny!.pricing_label, '¥6 / ¥30 /M');
		assert.equal(cny!.context_window, 1024000);
		assert.equal(cny!.max_tokens, 256000);

		const tiers = doubaoTiers(preset.id, 'CNY');
		assert.equal(tiers.length, 1);
		assert.equal(tiers[0]?.upto, null);
		assert.equal(tiers[0]?.input_price, 6);
		assert.equal(tiers[0]?.output_price, 30);
		assert.equal(tiers[0]?.cache_read_price, 1.2);
		assert.equal(tiers[0]?.cache_write_price, 0.017);
	});

	it('adds doubao-seed-2-1-lite-260915 with CNY only', () => {
		const preset = doubaoPreset('doubao-seed-2-1-lite-260915');
		assert.equal(preset.display_name, 'Doubao Seed 2.1 Lite (260915)');
		assert.equal(preset.context_window, 1024000);
		assert.equal(preset.max_tokens, 256000);
		assert.equal(preset.released, '2026-09-15');
		assert.equal(preset.retired, undefined);
		assert.deepEqual(preset.modalities?.input, ['text', 'image', 'video', 'audio']);
		assert.deepEqual(preset.modalities?.output, ['text']);
		assert.match(preset.description ?? '', /not stored/i);
		assert.match(preset.i18n?.zh ?? '', /未写入/);
		assert.match(preset.i18n?.ja ?? '', /料金ティアに入れていません/);
		assert.match(preset.i18n?.ko ?? '', /가격 구간에 넣지 않았습니다/);
		assert.equal(
			(preset as { suggested_provider_model_name?: unknown }).suggested_provider_model_name,
			undefined
		);
		const pricing = preset.pricing as { usd?: unknown; cny?: { tiers: Array<Record<string, unknown>> } };
		assert.equal(pricing.usd, undefined);
		assert.deepEqual(Object.keys(pricing.cny!.tiers[0]!).sort(), TOKEN_TIER_KEYS);

		const usd = listStaticModelPresetCatalogForAdmin('USD').find((r) => r.id === preset.id);
		const cny = listStaticModelPresetCatalogForAdmin('CNY').find((r) => r.id === preset.id);
		assert.ok(usd);
		assert.ok(cny);
		assert.equal(usd!.context_window, 1024000);
		assert.equal(usd!.max_tokens, 256000);
		assert.equal(usd!.pricing_available, false);
		assert.equal(usd!.pricing_label, null);
		assert.equal(cny!.pricing_label, '¥0.8 / ¥2.7 /M');
		assert.equal(cny!.context_window, 1024000);
		assert.equal(cny!.max_tokens, 256000);

		const tiers = doubaoTiers(preset.id, 'CNY');
		assert.equal(tiers.length, 1);
		assert.equal(tiers[0]?.upto, null);
		assert.equal(tiers[0]?.input_price, 0.8);
		assert.equal(tiers[0]?.output_price, 2.7);
		assert.equal(tiers[0]?.cache_read_price, 0.16);
		assert.equal(tiers[0]?.cache_write_price, 0.017);
	});

	it('raises doubao-seed-evolving context window to 1024k without changing prices', () => {
		const preset = doubaoPreset('doubao-seed-evolving');
		assert.equal(preset.context_window, 1000000);
		assert.equal(preset.max_tokens, 256000);
		assert.deepEqual(preset.modalities?.input, ['text', 'image', 'video']);
		const usdRow = listStaticModelPresetCatalogForAdmin('USD').find((r) => r.id === preset.id);
		const cnyRow = listStaticModelPresetCatalogForAdmin('CNY').find((r) => r.id === preset.id);
		assert.equal(usdRow!.context_window, 1000000);
		assert.equal(usdRow!.max_tokens, 256000);
		assert.equal(usdRow!.pricing_label, '$1 / $5 /M');
		assert.equal(cnyRow!.pricing_label, '¥6 / ¥30 /M');
		const usd = doubaoTiers(preset.id, 'USD');
		const cny = doubaoTiers(preset.id, 'CNY');
		assert.equal(usd.length, 1);
		assert.equal(usd[0]?.upto, null);
		assert.equal(usd[0]?.input_price, 1);
		assert.equal(usd[0]?.output_price, 5);
		assert.equal(usd[0]?.cache_read_price, 0.2);
		assert.equal(usd[0]?.cache_write_price, null);
		assert.equal(cny[0]?.input_price, 6);
		assert.equal(cny[0]?.output_price, 30);
		assert.equal(cny[0]?.cache_read_price, 1.2);
		assert.equal(cny[0]?.cache_write_price, 0.017);
	});

	it('drops audio from doubao-seed-2-1-pro-260628 input modalities', () => {
		const preset = doubaoPreset('doubao-seed-2-1-pro-260628');
		assert.equal(preset.context_window, 256000);
		assert.equal(preset.max_tokens, 256000);
		assert.deepEqual(preset.modalities?.input, ['text', 'image', 'video']);
		assert.deepEqual(preset.modalities?.output, ['text']);
		const cny = doubaoTiers(preset.id, 'CNY');
		assert.equal(cny[0]?.input_price, 6);
		assert.equal(cny[0]?.output_price, 30);
		assert.equal(cny[0]?.cache_read_price, 1.2);
		assert.equal(cny[0]?.cache_write_price, 0.017);
	});

	it('corrects doubao-seed-2-0-mini-260215 USD cache-hit prices', () => {
		const preset = doubaoPreset('doubao-seed-2-0-mini-260215');
		assert.equal(preset.retired, '2026-10-22');
		assert.equal(preset.context_window, 256000);
		assert.equal(preset.max_tokens, 128000);
		const usd = doubaoTiers(preset.id, 'USD');
		assert.equal(usd.length, 2);
		assert.equal(usd[0]?.upto, 128000);
		assert.equal(usd[0]?.input_price, 0.1);
		assert.equal(usd[0]?.output_price, 0.4);
		assert.equal(usd[0]?.cache_read_price, 0.02);
		assert.equal(usd[0]?.cache_write_price, null);
		assert.equal(usd[1]?.upto, null);
		assert.equal(usd[1]?.input_price, 0.2);
		assert.equal(usd[1]?.output_price, 0.8);
		assert.equal(usd[1]?.cache_read_price, 0.04);
		assert.equal(usd[1]?.cache_write_price, null);
		const cny = doubaoTiers(preset.id, 'CNY');
		assert.equal(cny[0]?.input_price, 0.2);
		assert.equal(cny[0]?.cache_read_price, 0.04);
		assert.equal(cny[2]?.input_price, 0.8);
		assert.equal(cny[2]?.cache_read_price, 0.16);
	});

	it('adds doubao-seed-2-0-lite-260428 with tiered CNY and USD list prices', () => {
		const preset = doubaoPreset('doubao-seed-2-0-lite-260428');
		assert.equal(preset.display_name, 'Doubao Seed 2.0 Lite (260428)');
		assert.equal(preset.context_window, 256000);
		assert.equal(preset.max_tokens, 128000);
		assert.equal(preset.released, '2026-04-28');
		assert.deepEqual(preset.modalities?.input, ['text', 'image', 'video', 'audio']);
		assert.deepEqual(preset.modalities?.output, ['text']);
		assert.match(preset.description ?? '', /not stored/i);
		assert.match(preset.i18n?.zh ?? '', /未写入/);
		assert.match(preset.i18n?.ja ?? '', /料金ティアに入れていません/);
		assert.match(preset.i18n?.ko ?? '', /가격 구간에 넣지 않았습니다/);
		assert.equal(
			(preset as { suggested_provider_model_name?: unknown }).suggested_provider_model_name,
			undefined
		);
		const usdRow = listStaticModelPresetCatalogForAdmin('USD').find((r) => r.id === preset.id);
		const cnyRow = listStaticModelPresetCatalogForAdmin('CNY').find((r) => r.id === preset.id);
		assert.equal(usdRow!.pricing_label, '$0.25 / $2 /M');
		assert.equal(cnyRow!.pricing_label, '¥0.6 / ¥3.6 /M');
		assert.equal(usdRow!.context_window, 256000);
		assert.equal(usdRow!.max_tokens, 128000);

		const cnyRaw = preset.pricing.cny as { tiers: Array<Record<string, unknown>> };
		assert.deepEqual(Object.keys(cnyRaw.tiers[0]!).sort(), TOKEN_TIER_KEYS);
		const cny = doubaoTiers(preset.id, 'CNY');
		assert.deepEqual(
			cny.map((tier) => [tier.upto, tier.input_price, tier.output_price, tier.cache_read_price, tier.cache_write_price]),
			[
				[32000, 0.6, 3.6, 0.12, 0.017],
				[128000, 0.9, 5.4, 0.18, 0.017],
				[null, 1.8, 10.8, 0.36, 0.017],
			]
		);
		const usd = doubaoTiers(preset.id, 'USD');
		assert.deepEqual(
			usd.map((tier) => [tier.upto, tier.input_price, tier.output_price, tier.cache_read_price, tier.cache_write_price]),
			[
				[128000, 0.25, 2, 0.05, null],
				[null, 0.5, 4, 0.1, null],
			]
		);
	});

	it('adds doubao-seed-2-0-mini-260428 with tiered CNY and USD list prices', () => {
		const preset = doubaoPreset('doubao-seed-2-0-mini-260428');
		assert.equal(preset.display_name, 'Doubao Seed 2.0 Mini (260428)');
		assert.equal(preset.context_window, 256000);
		assert.equal(preset.max_tokens, 128000);
		assert.equal(preset.released, '2026-04-28');
		assert.deepEqual(preset.modalities?.input, ['text', 'image', 'video', 'audio']);
		assert.deepEqual(preset.modalities?.output, ['text']);
		assert.match(preset.description ?? '', /not stored/i);
		assert.match(preset.i18n?.zh ?? '', /未写入/);
		assert.match(preset.i18n?.ja ?? '', /料金ティアに入れていません/);
		assert.match(preset.i18n?.ko ?? '', /가격 구간에 넣지 않았습니다/);
		const usdRow = listStaticModelPresetCatalogForAdmin('USD').find((r) => r.id === preset.id);
		const cnyRow = listStaticModelPresetCatalogForAdmin('CNY').find((r) => r.id === preset.id);
		assert.equal(usdRow!.pricing_label, '$0.1 / $0.4 /M');
		assert.equal(cnyRow!.pricing_label, '¥0.2 / ¥2 /M');
		assert.equal(usdRow!.context_window, 256000);
		assert.equal(cnyRow!.max_tokens, 128000);

		const cny = doubaoTiers(preset.id, 'CNY');
		assert.deepEqual(
			cny.map((tier) => [tier.upto, tier.input_price, tier.output_price, tier.cache_read_price, tier.cache_write_price]),
			[
				[32000, 0.2, 2, 0.04, 0.017],
				[128000, 0.4, 4, 0.08, 0.017],
				[null, 0.8, 8, 0.16, 0.017],
			]
		);
		const usd = doubaoTiers(preset.id, 'USD');
		assert.deepEqual(
			usd.map((tier) => [tier.upto, tier.input_price, tier.output_price, tier.cache_read_price, tier.cache_write_price]),
			[
				[128000, 0.1, 0.4, 0.02, null],
				[null, 0.2, 0.8, 0.04, null],
			]
		);
	});
});
