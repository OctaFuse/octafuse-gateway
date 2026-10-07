import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { isRouteAdapterCompatible, ROUTE_ADAPTERS } from '../route-topology';
import {
	ADAPTER_REGISTRY,
	getAdapterByOptionKey,
	getAdapterByPresetIntent,
	isConversionRouteAdapter,
	listConversionAdapters,
	matchAdapterUpstreamModel,
	requestOperationsFromRegistry,
	requestSurfacePath,
	ROUTE_ADAPTER_MAPPINGS,
	upstreamOperationsFromRegistry,
} from './registry';

describe('adapter registry', () => {
	it('derives the historical adapter whitelist in order', () => {
		assert.deepEqual([...ROUTE_ADAPTERS], [
			'passthrough',
			'dashscope-asr-qwen-file',
			'dashscope-asr-qwen-audio-file',
			'dashscope-asr-fun-file',
			'dashscope-asr-file-async',
			'dashscope-tts-speech',
			'dashscope-tts-qwen',
			'dashscope-tts-minimax',
			'dashscope-image-qwen',
			'dashscope-image-wan',
			'minimax-asr-file',
		]);
	});

	it('treats only mapped adapters as conversion adapters', () => {
		assert.equal(isConversionRouteAdapter('passthrough'), false);
		assert.equal(isConversionRouteAdapter('dashscope-image-wan'), true);
		assert.equal(isConversionRouteAdapter('not-an-adapter'), false);
	});

	it('keeps conversion mappings identical to the previous topology table', () => {
		assert.deepEqual(ROUTE_ADAPTER_MAPPINGS['dashscope-asr-qwen-audio-file'], {
			requestProtocol: 'openai',
			requestOperation: 'audio.transcriptions',
			upstreamProtocol: 'dashscope',
			upstreamOperation: 'audio.transcriptions.multimodal',
		});
		assert.deepEqual(ROUTE_ADAPTER_MAPPINGS['dashscope-tts-minimax'], {
			requestProtocol: 'openai',
			requestOperation: 'audio.speech',
			upstreamProtocol: 'dashscope',
			upstreamOperation: 'audio.speech.multimodal',
		});
		assert.deepEqual(ROUTE_ADAPTER_MAPPINGS['minimax-asr-file'], {
			requestProtocol: 'openai',
			requestOperation: 'audio.transcriptions',
			upstreamProtocol: 'minimax',
			upstreamOperation: 'audio.transcriptions',
		});
		assert.equal(listConversionAdapters().length, 10);
	});

	it('every conversion adapter is compatible with its own mapping', () => {
		for (const adapter of listConversionAdapters()) {
			assert.equal(
				isRouteAdapterCompatible({
					adapter: adapter.id,
					requestProtocol: adapter.request.protocol,
					requestOperation: adapter.request.operation,
					upstreamProtocol: adapter.upstream.protocol,
					upstreamOperation: adapter.upstream.operations[0]!,
				}),
				true,
			);
		}
	});

	it('lists request and upstream operations by model kind', () => {
		assert.deepEqual(requestOperationsFromRegistry('openai', 'llm'), ['chat', 'responses']);
		assert.deepEqual(requestOperationsFromRegistry('openai', 'image'), [
			'images.generations',
			'images.edits',
		]);
		assert.deepEqual(requestOperationsFromRegistry('dashscope', 'audio.transcription'), [
			'audio.transcriptions.multimodal',
			'audio.transcriptions.realtime.inference',
			'audio.transcriptions.realtime.session',
			'audio.transcriptions.async',
		]);
		assert.deepEqual(requestOperationsFromRegistry('dashscope', 'audio.speech'), [
			'audio.speech.realtime.inference',
			'audio.speech',
			'audio.speech.stream',
			'audio.speech.multimodal',
			'audio.speech.realtime.session',
		]);
		assert.deepEqual(requestOperationsFromRegistry('dashscope', 'image'), [
			'images.generations.multimodal',
		]);
		assert.deepEqual(upstreamOperationsFromRegistry('dashscope', 'audio.transcription'), [
			'audio.transcriptions.multimodal',
			'audio.transcriptions.realtime.inference',
			'audio.transcriptions.realtime.session',
			'audio.transcriptions.async',
		]);
		assert.deepEqual(upstreamOperationsFromRegistry('dashscope', 'audio.speech'), [
			'audio.speech.realtime.inference',
			'audio.speech',
			'audio.speech.stream',
			'audio.speech.multimodal',
			'audio.speech.realtime.session',
		]);
		assert.deepEqual(upstreamOperationsFromRegistry('dashscope', 'image'), [
			'images.generations.multimodal',
		]);
		assert.deepEqual(requestOperationsFromRegistry('minimax', 'audio.transcription'), [
			'audio.transcriptions',
		]);
		assert.deepEqual(upstreamOperationsFromRegistry('minimax', 'audio.transcription'), [
			'audio.transcriptions',
		]);
		assert.deepEqual(requestOperationsFromRegistry('minimax', 'audio.speech'), ['audio.speech']);
		assert.deepEqual(requestOperationsFromRegistry('minimax', 'image'), ['images.generations']);
	});

	it('resolves DashScope presets from registry intents', () => {
		assert.equal(getAdapterByPresetIntent('dashscope-asr-flash-convert')?.id, 'dashscope-asr-qwen-audio-file');
		assert.equal(getAdapterByPresetIntent('dashscope-asr-flash-passthrough')?.id, 'passthrough');
		assert.equal(getAdapterByPresetIntent('dashscope-asr-filetrans')?.id, 'dashscope-asr-file-async');
		assert.equal(getAdapterByPresetIntent('dashscope-tts-nonrealtime')?.id, 'dashscope-tts-speech');
		assert.equal(getAdapterByPresetIntent('dashscope-tts-realtime')?.id, 'passthrough');
		assert.equal(getAdapterByPresetIntent('dashscope-image-qwen')?.id, 'dashscope-image-qwen');
		assert.equal(getAdapterByPresetIntent('dashscope-image-wan')?.id, 'dashscope-image-wan');
	});

	it('maps public surface paths from registry metadata', () => {
		assert.equal(requestSurfacePath('openai', 'chat'), '/v1/chat/completions');
		assert.equal(
			requestSurfacePath('dashscope', 'audio.transcriptions.multimodal'),
			'/v1/dashscope/services/aigc/multimodal-generation/generation',
		);
		assert.equal(
			requestSurfacePath('minimax', 'audio.transcriptions'),
			'/v1/minimax/speech_to_text',
		);
		assert.equal(requestSurfacePath('minimax', 'audio.speech'), '/v1/minimax/t2a_v2');
		assert.equal(
			requestSurfacePath('minimax', 'images.generations'),
			'/v1/minimax/image_generation',
		);
		assert.equal(
			requestSurfacePath('dashscope', 'audio.transcriptions.realtime.inference', 'my fun/asr'),
			'/v1/dashscope/realtime?model=my%20fun%2Fasr&operation=audio.transcriptions.realtime.inference',
		);
	});

	it('keeps option keys unique', () => {
		const keys = ADAPTER_REGISTRY.map((adapter) => adapter.optionKey);
		assert.equal(new Set(keys).size, keys.length);
	});

	it('matches provider model names with wildcards, case, and exclusions', () => {
		const speech = getAdapterByOptionKey('dashscope-tts-speech');
		const qwenTts = getAdapterByOptionKey('dashscope-tts-qwen');
		const qwenTtsSession = getAdapterByOptionKey('passthrough:dashscope:audio.speech.realtime.session');
		const qwenAsr = getAdapterByOptionKey('dashscope-asr-qwen-file');
		const asyncAsr = getAdapterByOptionKey('dashscope-asr-file-async');
		const openaiAsr = getAdapterByOptionKey('passthrough:openai:audio.transcriptions');
		assert.ok(speech && qwenTts && qwenTtsSession && qwenAsr && asyncAsr && openaiAsr);

		assert.equal(matchAdapterUpstreamModel(speech, 'Qwen-Audio-3.0-TTS-Plus'), 'match');
		assert.equal(matchAdapterUpstreamModel(speech, 'cosyvoice-v3.5-flash'), 'match');
		assert.equal(matchAdapterUpstreamModel(speech, 'qwen3-tts-flash'), 'mismatch');
		assert.equal(matchAdapterUpstreamModel(speech, ''), 'generic');
		assert.equal(matchAdapterUpstreamModel(speech, '   '), 'generic');

		assert.equal(matchAdapterUpstreamModel(qwenTts, 'qwen3-tts-flash'), 'match');
		assert.equal(matchAdapterUpstreamModel(qwenTts, 'qwen-tts-flash'), 'match');
		assert.equal(matchAdapterUpstreamModel(qwenTts, 'qwen3-tts-flash-realtime'), 'mismatch');
		assert.equal(matchAdapterUpstreamModel(qwenTtsSession, 'qwen3-tts-flash-realtime'), 'match');
		assert.equal(matchAdapterUpstreamModel(qwenTtsSession, 'qwen-tts-realtime'), 'match');
		assert.equal(matchAdapterUpstreamModel(qwenTtsSession, 'qwen3-tts-flash'), 'mismatch');

		assert.equal(matchAdapterUpstreamModel(qwenAsr, 'qwen3-asr-flash'), 'match');
		assert.equal(matchAdapterUpstreamModel(qwenAsr, 'qwen3-asr-flash-2025-09-08'), 'match');
		assert.equal(matchAdapterUpstreamModel(qwenAsr, 'qwen3-asr-flash-realtime'), 'mismatch');
		assert.equal(matchAdapterUpstreamModel(qwenAsr, 'qwen3-asr-flash-filetrans'), 'mismatch');
		assert.equal(matchAdapterUpstreamModel(asyncAsr, 'qwen3-asr-flash-filetrans'), 'match');
		assert.equal(matchAdapterUpstreamModel(asyncAsr, 'fun-asr'), 'match');
		assert.equal(matchAdapterUpstreamModel(asyncAsr, 'fun-asr-realtime'), 'mismatch');
		assert.equal(matchAdapterUpstreamModel(openaiAsr, 'qwen3-asr-flash'), 'generic');
	});

	it('every Aliyun ASR, TTS, and image preset matches at least one adapter', () => {
		const presetDir = join(dirname(fileURLToPath(import.meta.url)), '../../../admin/lib/model-presets');
		const rows = (file: string) =>
			JSON.parse(readFileSync(join(presetDir, file), 'utf8')) as Array<{
				id: string;
				pricing?: { usd?: { audio_billing_mode?: string } };
			}>;
		const audioIds = rows('aliyun.json')
			.filter((row) => {
				const mode = row.pricing?.usd?.audio_billing_mode;
				return mode === 'per_second' || mode === 'per_character';
			})
			.map((row) => row.id);
		const imageIds = rows('aliyun-image.json').map((row) => row.id);
		assert.ok(audioIds.length > 0);
		assert.ok(imageIds.length > 0);
		for (const id of [...audioIds, ...imageIds]) {
			const matched = ADAPTER_REGISTRY.filter(
				(adapter) => matchAdapterUpstreamModel(adapter, id) === 'match',
			).map((adapter) => adapter.optionKey);
			assert.ok(matched.length > 0, `${id} matched no adapter`);
		}
	});
});
