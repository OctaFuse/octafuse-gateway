import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	explainModelKind,
	modelKindMatchesFilter,
	resolveModelKind,
	validateModelKindConsistency,
	type ModelKind,
	type ModelKindFields,
	type ModelKindSource,
} from './model-kind';

const tokenTiers = [{ upto: null, input_price: 1, output_price: 2 }];
const profile = (o: Record<string, unknown>) => JSON.stringify(o);

const asrSecond = profile({ audio_billing_mode: 'per_second', audio: { price_per_second: 0.0001 } });
const asrToken = profile({ audio_billing_mode: 'token', tiers: tokenTiers });
const ttsChar = profile({ audio_billing_mode: 'per_character', audio: { price_per_character: 0.0001 } });
const legacyImage = profile({ tiers: tokenTiers, image: { default: 0.04 } });
const llmTiers = profile({ tiers: tokenTiers });

type Case = {
	name: string;
	fields: ModelKindFields;
	kind: ModelKind;
	source: ModelKindSource;
};

const cases: Case[] = [
	{ name: 'embedding by output', fields: { output_modalities: ['embedding'], input_modalities: ['text'] }, kind: 'embedding', source: 'output_modalities' },
	{ name: 'embedding wins over image pricing', fields: { output_modalities: ['embedding'], pricing_profile: legacyImage }, kind: 'embedding', source: 'output_modalities' },
	{ name: 'image by output', fields: { output_modalities: JSON.stringify(['text', 'image']), pricing_profile: llmTiers }, kind: 'image', source: 'output_modalities' },
	{ name: 'legacy image pricing when output missing', fields: { pricing_profile: legacyImage }, kind: 'image', source: 'legacy_pricing' },
	{ name: 'multimodal LLM with image pricing is llm', fields: { output_modalities: ['text'], pricing_profile: legacyImage }, kind: 'llm', source: 'default' },
	{ name: 'ASR per_second without modalities', fields: { pricing_profile: asrSecond }, kind: 'asr', source: 'billing' },
	{ name: 'ASR token', fields: { input_modalities: ['audio', 'text'], output_modalities: ['text'], pricing_profile: asrToken }, kind: 'asr', source: 'billing' },
	{ name: 'TTS per_character', fields: { input_modalities: ['text'], output_modalities: ['audio'], pricing_profile: ttsChar }, kind: 'tts', source: 'billing' },
	{ name: 'TTS token', fields: { input_modalities: ['text'], output_modalities: ['audio'], pricing_profile: asrToken }, kind: 'tts', source: 'billing' },
	{ name: 'ASR by signature without pricing', fields: { input_modalities: ['audio'], output_modalities: ['text'] }, kind: 'asr', source: 'modality_signature' },
	{ name: 'ASR by signature with audio+text input', fields: { input_modalities: ['audio', 'text'], output_modalities: ['text'], pricing_profile: llmTiers }, kind: 'asr', source: 'modality_signature' },
	{ name: 'TTS by signature without pricing', fields: { input_modalities: ['text'], output_modalities: ['audio'] }, kind: 'tts', source: 'modality_signature' },
	{ name: 'TTS by signature without input modalities', fields: { output_modalities: ['audio'] }, kind: 'tts', source: 'modality_signature' },
	{ name: 'omni model (text+audio out) is llm', fields: { input_modalities: ['text', 'image', 'audio', 'video'], output_modalities: ['text', 'audio'], pricing_profile: llmTiers }, kind: 'llm', source: 'default' },
	{ name: 'omni model (text out) is llm', fields: { input_modalities: ['text', 'image', 'audio', 'video'], output_modalities: ['text'] }, kind: 'llm', source: 'default' },
	{ name: 'text LLM', fields: { input_modalities: ['text'], output_modalities: ['text'], pricing_profile: llmTiers }, kind: 'llm', source: 'default' },
	{ name: 'audio+image input is llm', fields: { input_modalities: ['audio', 'image'], output_modalities: ['text'] }, kind: 'llm', source: 'default' },
	{ name: 'unknown / empty', fields: {}, kind: 'llm', source: 'default' },
	{ name: 'billing mode without payload falls through to signature', fields: { input_modalities: ['text'], output_modalities: ['audio'], pricing_profile: profile({ audio_billing_mode: 'per_character', tiers: tokenTiers }) }, kind: 'tts', source: 'modality_signature' },
	{ name: 'audio billing wins over llm-looking modalities', fields: { input_modalities: ['text'], output_modalities: ['text'], pricing_profile: ttsChar }, kind: 'tts', source: 'billing' },
];

describe('resolveModelKind / explainModelKind', () => {
	for (const c of cases) {
		it(c.name, () => {
			assert.deepEqual(explainModelKind(c.fields), { kind: c.kind, source: c.source });
			assert.equal(resolveModelKind(c.fields), c.kind);
		});
	}
});

describe('modelKindMatchesFilter', () => {
	it('audio is an alias for asr + tts and all matches everything', () => {
		assert.equal(modelKindMatchesFilter('asr', 'audio'), true);
		assert.equal(modelKindMatchesFilter('tts', 'audio'), true);
		assert.equal(modelKindMatchesFilter('llm', 'audio'), false);
		assert.equal(modelKindMatchesFilter('asr', 'tts'), false);
		assert.equal(modelKindMatchesFilter('tts', 'tts'), true);
		assert.equal(modelKindMatchesFilter('image', 'all'), true);
		assert.equal(modelKindMatchesFilter('embedding', 'llm'), false);
	});
});

describe('validateModelKindConsistency', () => {
	const ok: ModelKindFields[] = [
		{},
		{ pricing_profile: asrSecond },
		{ input_modalities: ['audio'], output_modalities: ['text'], pricing_profile: asrSecond },
		{ input_modalities: ['text'], output_modalities: ['audio'], pricing_profile: ttsChar },
		{ input_modalities: ['text'], output_modalities: ['audio'], pricing_profile: asrToken },
		{ input_modalities: ['text'], output_modalities: ['embedding'] },
		{ input_modalities: ['text', 'image'], output_modalities: ['text'], pricing_profile: llmTiers },
	];
	for (const [i, fields] of ok.entries()) {
		it(`accepts consistent config #${i}`, () => {
			assert.equal(validateModelKindConsistency(fields), null);
		});
	}

	const bad: Array<[string, ModelKindFields, RegExp]> = [
		['TTS without audio output', { input_modalities: ['text'], output_modalities: ['text'], pricing_profile: ttsChar }, /per_character.*output_modalities/],
		['ASR with audio output', { output_modalities: ['text', 'audio'], pricing_profile: asrToken }, /ASR.*audio/],
		['ASR without audio input', { input_modalities: ['text'], output_modalities: ['text'], pricing_profile: asrSecond }, /requires input_modalities/],
		['audio billing with image output', { output_modalities: ['image'], pricing_profile: asrSecond }, /conflicts/],
		['audio billing with embedding output', { output_modalities: ['embedding'], pricing_profile: ttsChar }, /conflicts/],
		['embedding + image', { output_modalities: ['embedding', 'image'] }, /embedding/],
		['embedding + audio', { output_modalities: ['embedding', 'audio'] }, /embedding/],
	];
	for (const [name, fields, re] of bad) {
		it(`rejects ${name}`, () => {
			assert.match(validateModelKindConsistency(fields) ?? '', re);
		});
	}
});
