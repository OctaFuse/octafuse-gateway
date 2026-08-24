import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isRouteAdapterCompatible, ROUTE_ADAPTERS } from '../route-topology';
import {
	ADAPTER_REGISTRY,
	getAdapterByPresetIntent,
	isConversionRouteAdapter,
	listConversionAdapters,
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
		assert.equal(listConversionAdapters().length, 9);
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
		]);
		assert.deepEqual(upstreamOperationsFromRegistry('dashscope', 'image'), [
			'images.generations.multimodal',
		]);
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
			requestSurfacePath('dashscope', 'audio.transcriptions.realtime.inference', 'my fun/asr'),
			'/v1/dashscope/realtime?model=my%20fun%2Fasr&operation=audio.transcriptions.realtime.inference',
		);
	});

	it('keeps option keys unique', () => {
		const keys = ADAPTER_REGISTRY.map((adapter) => adapter.optionKey);
		assert.equal(new Set(keys).size, keys.length);
	});
});
