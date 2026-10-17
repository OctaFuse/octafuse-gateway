import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	DASHSCOPE_FILE_TRANSCRIPTION_PATH,
	DASHSCOPE_MULTIMODAL_GENERATION_PATH,
	DASHSCOPE_REALTIME_INFERENCE_PATH,
	DASHSCOPE_REALTIME_SESSION_PATH,
	DASHSCOPE_SPEECH_SYNTHESIZER_PATH,
	DASHSCOPE_TASKS_PATH,
	isRouteAdapterCompatible,
	LEGACY_DASHSCOPE_FILE_TRANSCRIPTION_PATH,
	LEGACY_DASHSCOPE_MULTIMODAL_GENERATION_PATH,
	LEGACY_DASHSCOPE_REALTIME_PATH,
	LEGACY_DASHSCOPE_SPEECH_SYNTHESIZER_PATH,
	LEGACY_DASHSCOPE_TASKS_PATH,
	LEGACY_MINIMAX_IMAGE_GENERATION_PATH,
	LEGACY_MINIMAX_SPEECH_TO_TEXT_PATH,
	LEGACY_MINIMAX_T2A_PATH,
	LEGACY_VOLCENGINE_IMAGE_GENERATIONS_PATH,
	MINIMAX_IMAGE_GENERATION_PATH,
	MINIMAX_SPEECH_TO_TEXT_PATH,
	MINIMAX_T2A_PATH,
	ROUTE_ADAPTERS,
	VOLCENGINE_IMAGE_GENERATIONS_PATH,
} from '../route-topology';
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
	SURFACE_PATH_MODEL_PLACEHOLDER,
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
			'minimax-tts',
			'minimax-image',
			'volcengine-image',
			'gemini-image',
			'elevenlabs-tts',
			'elevenlabs-asr-file',
		]);
	});

	it('matches ElevenLabs model families', () => {
		const tts = getAdapterByOptionKey('elevenlabs-tts')!;
		assert.equal(matchAdapterUpstreamModel(tts, 'eleven_multilingual_v2'), 'match');
		assert.equal(matchAdapterUpstreamModel(tts, 'eleven_v3'), 'match');
		assert.equal(matchAdapterUpstreamModel(tts, 'eleven_v4_turbo'), 'match');
		assert.equal(matchAdapterUpstreamModel(tts, 'eleven_flash_v2'), 'match');
		assert.equal(matchAdapterUpstreamModel(tts, 'eleven_multilingual_ttv_v2'), 'mismatch');
		assert.equal(matchAdapterUpstreamModel(tts, 'eleven_ttv_v3'), 'mismatch');
		assert.equal(matchAdapterUpstreamModel(tts, 'eleven_multilingual_sts_v2'), 'mismatch');
		assert.equal(matchAdapterUpstreamModel(tts, 'scribe_v2'), 'mismatch');
		const asr = getAdapterByOptionKey('elevenlabs-asr-file')!;
		assert.equal(matchAdapterUpstreamModel(asr, 'scribe_v2'), 'match');
		assert.equal(matchAdapterUpstreamModel(asr, 'scribe_v2_realtime'), 'mismatch');
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
		assert.equal(listConversionAdapters().length, 16);
		assert.deepEqual(ROUTE_ADAPTER_MAPPINGS['minimax-tts'], {
			requestProtocol: 'openai',
			requestOperation: 'audio.speech',
			upstreamProtocol: 'minimax',
			upstreamOperation: 'audio.speech',
		});
		assert.deepEqual(ROUTE_ADAPTER_MAPPINGS['minimax-image'], {
			requestProtocol: 'openai',
			requestOperation: 'images.generations',
			upstreamProtocol: 'minimax',
			upstreamOperation: 'images.generations',
		});
		assert.deepEqual(ROUTE_ADAPTER_MAPPINGS['volcengine-image'], {
			requestProtocol: 'openai',
			requestOperation: 'images.generations',
			upstreamProtocol: 'volcengine',
			upstreamOperation: 'images.generations',
		});
		assert.deepEqual(ROUTE_ADAPTER_MAPPINGS['elevenlabs-tts'], {
			requestProtocol: 'openai',
			requestOperation: 'audio.speech',
			upstreamProtocol: 'elevenlabs',
			upstreamOperation: 'audio.speech',
		});
		assert.deepEqual(ROUTE_ADAPTER_MAPPINGS['elevenlabs-asr-file'], {
			requestProtocol: 'openai',
			requestOperation: 'audio.transcriptions',
			upstreamProtocol: 'elevenlabs',
			upstreamOperation: 'audio.transcriptions',
		});
		assert.deepEqual(ROUTE_ADAPTER_MAPPINGS['gemini-image'], {
			requestProtocol: 'openai',
			requestOperation: 'images.generations',
			upstreamProtocol: 'gemini',
			upstreamOperation: 'models.generate',
		});
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
		assert.deepEqual(requestOperationsFromRegistry('dashscope', 'asr'), [
			'audio.transcriptions.multimodal',
			'audio.transcriptions.realtime.inference',
			'audio.transcriptions.realtime.session',
			'audio.transcriptions.async',
		]);
		assert.deepEqual(requestOperationsFromRegistry('dashscope', 'tts'), [
			'audio.speech.realtime.inference',
			'audio.speech',
			'audio.speech.stream',
			'audio.speech.multimodal',
			'audio.speech.realtime.session',
		]);
		assert.deepEqual(requestOperationsFromRegistry('dashscope', 'image'), [
			'images.generations.multimodal',
		]);
		assert.deepEqual(upstreamOperationsFromRegistry('dashscope', 'asr'), [
			'audio.transcriptions.multimodal',
			'audio.transcriptions.realtime.inference',
			'audio.transcriptions.realtime.session',
			'audio.transcriptions.async',
		]);
		assert.deepEqual(upstreamOperationsFromRegistry('dashscope', 'tts'), [
			'audio.speech.realtime.inference',
			'audio.speech',
			'audio.speech.stream',
			'audio.speech.multimodal',
			'audio.speech.realtime.session',
		]);
		assert.deepEqual(upstreamOperationsFromRegistry('dashscope', 'image'), [
			'images.generations.multimodal',
		]);
		assert.deepEqual(requestOperationsFromRegistry('minimax', 'asr'), [
			'audio.transcriptions',
		]);
		assert.deepEqual(upstreamOperationsFromRegistry('minimax', 'asr'), [
			'audio.transcriptions',
		]);
		assert.deepEqual(requestOperationsFromRegistry('minimax', 'tts'), ['audio.speech']);
		assert.deepEqual(requestOperationsFromRegistry('minimax', 'image'), ['images.generations']);
		assert.deepEqual(requestOperationsFromRegistry('elevenlabs', 'asr'), ['audio.transcriptions']);
		assert.deepEqual(requestOperationsFromRegistry('elevenlabs', 'tts'), ['audio.speech']);
		assert.deepEqual(upstreamOperationsFromRegistry('elevenlabs', 'tts'), ['audio.speech']);
		assert.deepEqual(requestOperationsFromRegistry('gemini', 'llm'), ['models.generate']);
		assert.deepEqual(requestOperationsFromRegistry('gemini', 'image'), ['models.generate']);
		assert.deepEqual(upstreamOperationsFromRegistry('gemini', 'image'), ['models.generate']);
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
			'/dashscope/api/v1/services/aigc/multimodal-generation/generation',
		);
		assert.equal(
			requestSurfacePath('minimax', 'audio.transcriptions'),
			'/minimax/v1/speech_to_text',
		);
		assert.equal(requestSurfacePath('minimax', 'audio.speech'), '/minimax/v1/t2a_v2');
		assert.equal(
			requestSurfacePath('elevenlabs', 'audio.speech'),
			'/elevenlabs/v1/text-to-speech/{voice_id}',
		);
		assert.equal(
			requestSurfacePath('elevenlabs', 'audio.transcriptions'),
			'/elevenlabs/v1/speech-to-text',
		);
		assert.equal(
			requestSurfacePath('minimax', 'images.generations'),
			'/minimax/v1/image_generation',
		);
		assert.equal(
			requestSurfacePath('volcengine', 'images.generations'),
			'/volcengine/api/v3/images/generations',
		);
		assert.equal(
			requestSurfacePath('dashscope', 'audio.transcriptions.realtime.inference', 'my fun/asr'),
			'/dashscope/api-ws/v1/inference',
		);
	});

	it('maps realtime operations to the official-style WebSocket paths', () => {
		// inference（run-task）：模型在帧里，路径不带任何查询参数。
		for (const operation of [
			'audio.transcriptions.realtime.inference',
			'audio.speech.realtime.inference',
		]) {
			assert.equal(requestSurfacePath('dashscope', operation, 'any-model'), '/dashscope/api-ws/v1/inference');
			assert.equal(requestSurfacePath('dashscope', operation), '/dashscope/api-ws/v1/inference');
		}
		// session：官方用 `?model=`，不再有 `operation` 参数。
		assert.equal(
			requestSurfacePath('dashscope', 'audio.transcriptions.realtime.session', 'qwen3-asr-flash-realtime'),
			'/dashscope/api-ws/v1/realtime?model=qwen3-asr-flash-realtime',
		);
		assert.equal(
			requestSurfacePath('dashscope', 'audio.speech.realtime.session', 'my tts/model'),
			'/dashscope/api-ws/v1/realtime?model=my%20tts%2Fmodel',
		);
		assert.equal(
			requestSurfacePath('dashscope', 'audio.speech.realtime.session'),
			`/dashscope/api-ws/v1/realtime?model=${SURFACE_PATH_MODEL_PLACEHOLDER}`,
		);
	});

	it('builds vendor paths as /{vendor} + the official endpoint path', () => {
		assert.equal(DASHSCOPE_MULTIMODAL_GENERATION_PATH, '/dashscope/api/v1/services/aigc/multimodal-generation/generation');
		assert.equal(DASHSCOPE_SPEECH_SYNTHESIZER_PATH, '/dashscope/api/v1/services/audio/tts/SpeechSynthesizer');
		assert.equal(DASHSCOPE_FILE_TRANSCRIPTION_PATH, '/dashscope/api/v1/services/audio/asr/transcription');
		assert.equal(DASHSCOPE_TASKS_PATH, '/dashscope/api/v1/tasks');
		assert.equal(DASHSCOPE_REALTIME_INFERENCE_PATH, '/dashscope/api-ws/v1/inference');
		assert.equal(DASHSCOPE_REALTIME_SESSION_PATH, '/dashscope/api-ws/v1/realtime');
		assert.equal(MINIMAX_SPEECH_TO_TEXT_PATH, '/minimax/v1/speech_to_text');
		assert.equal(MINIMAX_T2A_PATH, '/minimax/v1/t2a_v2');
		assert.equal(MINIMAX_IMAGE_GENERATION_PATH, '/minimax/v1/image_generation');
		assert.equal(VOLCENGINE_IMAGE_GENERATIONS_PATH, '/volcengine/api/v3/images/generations');
	});

	it('keeps the legacy /v1/{vendor} paths as aliases', () => {
		assert.equal(LEGACY_DASHSCOPE_MULTIMODAL_GENERATION_PATH, '/v1/dashscope/services/aigc/multimodal-generation/generation');
		assert.equal(LEGACY_DASHSCOPE_SPEECH_SYNTHESIZER_PATH, '/v1/dashscope/services/audio/tts/SpeechSynthesizer');
		assert.equal(LEGACY_DASHSCOPE_FILE_TRANSCRIPTION_PATH, '/v1/dashscope/services/audio/asr/transcription');
		assert.equal(LEGACY_DASHSCOPE_TASKS_PATH, '/v1/dashscope/tasks');
		assert.equal(LEGACY_DASHSCOPE_REALTIME_PATH, '/v1/dashscope/realtime');
		assert.equal(LEGACY_MINIMAX_SPEECH_TO_TEXT_PATH, '/v1/minimax/speech_to_text');
		assert.equal(LEGACY_MINIMAX_T2A_PATH, '/v1/minimax/t2a_v2');
		assert.equal(LEGACY_MINIMAX_IMAGE_GENERATION_PATH, '/v1/minimax/image_generation');
		assert.equal(LEGACY_VOLCENGINE_IMAGE_GENERATIONS_PATH, '/v1/volcengine/images/generations');
	});

	it('matches Seedream provider model names to the volcengine image passthrough', () => {
		const adapter = ADAPTER_REGISTRY.find(
			(item) => item.optionKey === 'passthrough:volcengine:images.generations',
		);
		assert.ok(adapter);
		assert.equal(matchAdapterUpstreamModel(adapter, 'doubao-seedream-5-0-flash-260915'), 'match');
		assert.equal(matchAdapterUpstreamModel(adapter, 'dola-seedream-5-0-flash-260915'), 'match');
		assert.equal(matchAdapterUpstreamModel(adapter, 'seedream-4-0-250828'), 'match');
		assert.equal(matchAdapterUpstreamModel(adapter, 'doubao-seedance-1-0'), 'mismatch');
		assert.equal(adapter.protectedUpstreamPaths, undefined);
		const conversion = getAdapterByOptionKey('volcengine-image');
		assert.ok(conversion);
		assert.equal(matchAdapterUpstreamModel(conversion, 'doubao-seedream-5-0-260128'), 'match');
		assert.equal(matchAdapterUpstreamModel(conversion, 'seedream-4-0-250828'), 'match');
		assert.equal(matchAdapterUpstreamModel(conversion, 'doubao-seedance-1-0'), 'mismatch');
		assert.equal(
			isRouteAdapterCompatible({
				adapter: 'volcengine-image',
				requestProtocol: 'openai',
				requestOperation: 'images.generations',
				upstreamProtocol: 'volcengine',
				upstreamOperation: 'images.generations',
			}),
			true,
		);
		assert.equal(
			isRouteAdapterCompatible({
				adapter: 'volcengine-image',
				requestProtocol: 'volcengine',
				requestOperation: 'images.generations',
				upstreamProtocol: 'volcengine',
				upstreamOperation: 'images.generations',
			}),
			false,
		);
	});

	it('matches Gemini image provider model names to the image passthrough only', () => {
		const image = ADAPTER_REGISTRY.find(
			(item) => item.optionKey === 'passthrough:gemini:models.generate:image',
		);
		const llm = ADAPTER_REGISTRY.find((item) => item.optionKey === 'passthrough:gemini:models.generate');
		assert.ok(image);
		assert.ok(llm);
		assert.equal(image.modelKind, 'image');
		assert.equal(image.billing, 'tokens');
		assert.equal(llm.modelKind, 'llm');
		for (const name of [
			'gemini-3.1-flash-image',
			'gemini-3-pro-image-preview',
			'gemini-nano-banana-2.1',
			'gemini-2.5-flash-image',
		]) {
			assert.equal(matchAdapterUpstreamModel(image, name), 'match', name);
		}
		assert.equal(matchAdapterUpstreamModel(image, 'gemini-2.5-pro'), 'mismatch');
		assert.equal(matchAdapterUpstreamModel(llm, 'gemini-3.1-flash-image'), 'generic');
		const conversion = getAdapterByOptionKey('gemini-image');
		assert.ok(conversion);
		assert.equal(conversion.billing, 'tokens');
		assert.equal(matchAdapterUpstreamModel(conversion, 'gemini-nano-banana-2.1'), 'match');
		assert.equal(matchAdapterUpstreamModel(conversion, 'gemini-2.5-pro'), 'mismatch');
		const presetDir = join(dirname(fileURLToPath(import.meta.url)), '../../../admin/lib/model-presets');
		const rows = JSON.parse(readFileSync(join(presetDir, 'google-image.json'), 'utf8')) as Array<{ id: string }>;
		assert.ok(rows.length > 0);
		for (const row of rows) {
			assert.equal(matchAdapterUpstreamModel(image, row.id), 'match', row.id);
		}
	});

	it('declares protected upstream paths for OpenAI image and audio conversion adapters', () => {
		for (const adapter of listConversionAdapters()) {
			if (adapter.request.protocol !== 'openai') continue;
			if (adapter.modality !== 'image' && adapter.modality !== 'audio') continue;
			assert.notEqual(
				adapter.protectedUpstreamPaths,
				undefined,
				`${adapter.id} must declare protectedUpstreamPaths`,
			);
		}
	});

	it('reserves lossyFeatures for capabilities the upstream API does not provide', () => {
		const features = Object.fromEntries(
			listConversionAdapters().map((adapter) => [adapter.id, adapter.lossyFeatures ?? []]),
		);
		assert.deepEqual(features['dashscope-asr-file-async'], []);
		assert.deepEqual(features['dashscope-tts-minimax'], []);
		assert.deepEqual(features['minimax-tts'], ['response_format_aac', 'openai_speed_range']);
		assert.deepEqual(features['elevenlabs-tts'], [
			'response_format_aac',
			'response_format_flac',
			'openai_speed_range',
			'instructions',
		]);
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

	it('registers embedding passthrough entries for OpenAI and Gemini', () => {
		assert.deepEqual(requestOperationsFromRegistry('openai', 'embedding'), ['embeddings']);
		assert.deepEqual(upstreamOperationsFromRegistry('openai', 'embedding'), ['embeddings']);
		assert.deepEqual(requestOperationsFromRegistry('gemini', 'embedding'), ['models.embed']);
		assert.deepEqual(upstreamOperationsFromRegistry('gemini', 'embedding'), ['models.embed']);
		assert.equal(requestSurfacePath('openai', 'embeddings'), '/v1/embeddings');
		assert.equal(
			requestSurfacePath('gemini', 'models.embed', 'gemini-embedding-001'),
			'/v1beta/models/gemini-embedding-001:{embedContent|batchEmbedContents}',
		);
		const openai = getAdapterByOptionKey('passthrough:openai:embeddings');
		assert.ok(openai);
		assert.equal(openai.modality, 'embedding');
		assert.equal(openai.billing, 'tokens');
		assert.equal(openai.exchange, 'unary');
		assert.deepEqual(openai.requiredUpstreamCapabilities, ['embeddings']);
		const gemini = getAdapterByOptionKey('passthrough:gemini:models.embed');
		assert.ok(gemini);
		assert.deepEqual(gemini.requiredUpstreamCapabilities, ['models.embed']);
		assert.equal(
			isRouteAdapterCompatible({
				adapter: 'passthrough',
				requestProtocol: 'openai',
				requestOperation: 'embeddings',
				upstreamProtocol: 'openai',
				upstreamOperation: 'embeddings',
			}),
			true,
		);
	});
});
