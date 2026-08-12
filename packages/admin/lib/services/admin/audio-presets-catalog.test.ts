import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ParsedPricingProfile } from '@octafuse/core/db/pricing-profile';
import { listStaticModelPresets } from '@/lib/model-preset';
import { listStaticModelPresetCatalogForAdmin } from './models-service';

/** 静态目录中已支持计费与路由的音频模型（不含日期快照）。 */
const EXPECTED_AUDIO_IDS = [
	'cosyvoice-v1',
	'cosyvoice-v2',
	'cosyvoice-v3-flash',
	'cosyvoice-v3-plus',
	'cosyvoice-v3.5-flash',
	'cosyvoice-v3.5-plus',
	'fun-asr',
	'fun-asr-realtime',
	'gpt-4o-mini-transcribe',
	'gpt-4o-transcribe',
	'gpt-4o-transcribe-diarize',
	'qwen-audio-3.0-asr-flash',
	'qwen-audio-3.0-asr-flash-filetrans',
	'qwen-audio-3.0-asr-flash-streaming',
	'qwen-audio-3.0-tts-flash',
	'qwen-audio-3.0-tts-plus',
	'qwen3-asr-flash',
	'qwen3-asr-flash-filetrans',
	'qwen3-asr-flash-realtime',
	'whisper-1',
].sort();

type PresetPricingJson = Partial<ParsedPricingProfile> & {
	tiers?: ParsedPricingProfile['tiers'];
};

const asPricing = (raw: unknown): PresetPricingJson => raw as PresetPricingJson;

function isAudioPresetPricing(usd: PresetPricingJson): boolean {
	if (usd.audio_billing_mode === 'per_second' && usd.audio != null) return true;
	if (usd.audio_billing_mode === 'per_character' && usd.audio != null) return true;
	if (usd.audio_billing_mode === 'token' && Array.isArray(usd.tiers) && usd.tiers.length > 0) {
		return true;
	}
	return false;
}

describe('static audio model presets (*-audio.json)', () => {
	it('every audio preset uses an explicit audio billing mode', () => {
		const audioRows = listStaticModelPresets().filter((r) =>
			isAudioPresetPricing(asPricing(r.pricing.usd))
		);
		assert.deepEqual(
			audioRows.map((r) => r.id).sort(),
			EXPECTED_AUDIO_IDS
		);
		for (const row of audioRows) {
			assert.ok(row.vendor, `vendor required for ${row.id}`);
			if (asPricing(row.pricing.usd).audio_billing_mode === 'per_character') {
				assert.equal((row.modalities?.output ?? []).includes('audio'), true);
			} else {
				assert.equal((row.modalities?.input ?? []).includes('audio'), true);
			}
		}
	});

	it('Admin import catalog marks audio kind for the same ids', () => {
		const audioCatalog = listStaticModelPresetCatalogForAdmin().filter((r) => r.kind === 'audio');
		assert.deepEqual(
			audioCatalog.map((r) => r.id).sort(),
			EXPECTED_AUDIO_IDS
		);
	});

	it('locks OpenAI transcription catalog unit prices (whisper per_second; 4o token; CNY ×7)', () => {
		const byId = new Map(listStaticModelPresets().map((r) => [r.id, r]));

		const whisper = byId.get('whisper-1')!;
		assert.equal(asPricing(whisper.pricing.usd).audio_billing_mode, 'per_second');
		assert.equal(asPricing(whisper.pricing.usd).audio?.price_per_second, 0.0001);
		assert.equal(asPricing(whisper.pricing.cny).audio?.price_per_second, 0.0007);

		const mini = byId.get('gpt-4o-mini-transcribe')!;
		assert.equal(asPricing(mini.pricing.usd).audio_billing_mode, 'token');
		assert.equal(asPricing(mini.pricing.usd).tiers?.[0]?.input_price, 1.25);
		assert.equal(asPricing(mini.pricing.usd).tiers?.[0]?.output_price, 5);
		assert.equal(asPricing(mini.pricing.cny).tiers?.[0]?.input_price, 8.75);
		assert.equal(asPricing(mini.pricing.cny).tiers?.[0]?.output_price, 35);

		const full = byId.get('gpt-4o-transcribe')!;
		assert.equal(asPricing(full.pricing.usd).audio_billing_mode, 'token');
		assert.equal(asPricing(full.pricing.usd).tiers?.[0]?.input_price, 2.5);
		assert.equal(asPricing(full.pricing.usd).tiers?.[0]?.output_price, 10);
		assert.equal(asPricing(full.pricing.cny).tiers?.[0]?.input_price, 17.5);
		assert.equal(asPricing(full.pricing.cny).tiers?.[0]?.output_price, 70);

		const diarize = byId.get('gpt-4o-transcribe-diarize')!;
		assert.equal(asPricing(diarize.pricing.usd).audio_billing_mode, 'token');
		assert.equal(asPricing(diarize.pricing.usd).tiers?.[0]?.input_price, 2.5);
		assert.equal(asPricing(diarize.pricing.usd).tiers?.[0]?.output_price, 10);
	});

	it('locks Alibaba audio catalog units to seconds for ASR and characters for TTS', () => {
		const byId = new Map(listStaticModelPresets().map((r) => [r.id, r]));

		const realtimeAsr = byId.get('qwen-audio-3.0-asr-flash-streaming')!;
		assert.equal(asPricing(realtimeAsr.pricing.cny).audio_billing_mode, 'per_second');
		assert.equal(asPricing(realtimeAsr.pricing.cny).audio?.price_per_second, 0.00033);

		const fileAsr = byId.get('fun-asr')!;
		assert.equal(asPricing(fileAsr.pricing.cny).audio_billing_mode, 'per_second');
		assert.equal(asPricing(fileAsr.pricing.cny).audio?.price_per_second, 0.00022);

		// 官方标价为「元/万字符」；目录存「每字符」单价，供 usage.characters × price 扣费。
		const tts = byId.get('qwen-audio-3.0-tts-plus')!;
		assert.equal(asPricing(tts.pricing.cny).audio_billing_mode, 'per_character');
		assert.equal(asPricing(tts.pricing.cny).audio?.price_per_character, 0.00014);
		assert.equal(asPricing(tts.pricing.usd).audio?.price_per_character, 0.00002);

		const cosy35 = byId.get('cosyvoice-v3.5-plus')!;
		assert.equal(asPricing(cosy35.pricing.cny).audio?.price_per_character, 0.00015);
		assert.equal(asPricing(cosy35.pricing.usd).audio?.price_per_character, 0.0000214285714);
	});
});
