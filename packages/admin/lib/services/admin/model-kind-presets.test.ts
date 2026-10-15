import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveModelKind, validateModelKindConsistency } from '@octafuse/core/db/model-kind';
import { pickPresetPricingRawForBillingCurrency, listStaticModelPresets } from '@/lib/model-preset';
import { listStaticModelPresetCatalogForAdmin } from './models-service';

/** 规则见 docs/developers/reference/model-kinds.md；新增预设若触发矛盾，应先修预设而不是放宽校验。 */
describe('static model presets × model kind rules', () => {
	for (const billing of ['USD', 'CNY'] as const) {
		it(`every preset passes consistency validation (${billing})`, () => {
			const problems: string[] = [];
			for (const preset of listStaticModelPresets()) {
				const raw = pickPresetPricingRawForBillingCurrency(preset, billing);
				const problem = validateModelKindConsistency({
					input_modalities: preset.modalities?.input ?? null,
					output_modalities: preset.modalities?.output ?? null,
					pricing_profile: raw != null && typeof raw === 'object' ? JSON.stringify(raw) : null,
				});
				if (problem) problems.push(`${preset.id}: ${problem}`);
			}
			assert.deepEqual(problems, []);
		});
	}

	it('admin catalog kind matches resolveModelKind for every preset', () => {
		const byId = new Map(listStaticModelPresets().map((p) => [String(p.id), p]));
		for (const row of listStaticModelPresetCatalogForAdmin('USD')) {
			const preset = byId.get(row.id);
			assert.ok(preset, `preset ${row.id}`);
			const raw = pickPresetPricingRawForBillingCurrency(preset, 'USD');
			assert.equal(
				row.kind,
				resolveModelKind({
					input_modalities: preset.modalities?.input ?? null,
					output_modalities: preset.modalities?.output ?? null,
					pricing_profile: raw != null && typeof raw === 'object' ? JSON.stringify(raw) : null,
				}),
				row.id
			);
		}
	});

	it('splits audio presets into asr and tts without leaving any in llm', () => {
		const kindById = new Map(listStaticModelPresetCatalogForAdmin('USD').map((r) => [r.id, r.kind]));
		for (const id of ['whisper-1', 'gpt-4o-transcribe', 'fun-asr', 'minimax-asr-1.0']) {
			if (kindById.has(id)) assert.equal(kindById.get(id), 'asr', id);
		}
		for (const id of ['cosyvoice-v2', 'minimax-speech-2.8-hd', 'qwen-audio-3.0-tts-flash']) {
			if (kindById.has(id)) assert.equal(kindById.get(id), 'tts', id);
		}
		const counts = { llm: 0, image: 0, asr: 0, tts: 0, embedding: 0 };
		for (const kind of kindById.values()) counts[kind] += 1;
		assert.ok(counts.asr > 0, 'expected at least one asr preset');
		assert.ok(counts.tts > 0, 'expected at least one tts preset');
		assert.ok(counts.llm > 0 && counts.image > 0 && counts.embedding > 0);
	});

	it('omni models with audio output stay llm', () => {
		const kindById = new Map(listStaticModelPresetCatalogForAdmin('USD').map((r) => [r.id, r.kind]));
		for (const [id, kind] of kindById) {
			if (/omni/i.test(id)) assert.equal(kind, 'llm', id);
		}
	});
});
