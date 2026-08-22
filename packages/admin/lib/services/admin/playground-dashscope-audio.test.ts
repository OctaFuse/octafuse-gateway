import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	buildPlaygroundDashScopeAsyncAsrRequest,
	buildPlaygroundDashScopeSpeechRequest,
	buildPlaygroundDashScopeSyncAsrRequest,
	type PlaygroundResolvedRoute,
} from './playground-service';

function route(
	adapter: PlaygroundResolvedRoute['adapter'],
	overrides: Partial<PlaygroundResolvedRoute> = {},
): PlaygroundResolvedRoute {
	return {
		upstreamProtocol: 'dashscope',
		upstreamOperation: 'audio.transcriptions.multimodal',
		adapter,
		providerEndpoints: {
			dashscope: { base: 'https://dashscope.aliyuncs.com/api/v1' },
		},
		providerId: 'p1',
		providerApiKey: 'sk-test',
		providerModelName: 'fun-asr-realtime',
		customParams: { vad_enabled: true },
		isImageModel: false,
		isAudioModel: true,
		...overrides,
	};
}

describe('buildPlaygroundDashScopeSyncAsrRequest', () => {
	it('builds the Fun-ASR Base64 request used by the direct Playground call', () => {
		const request = buildPlaygroundDashScopeSyncAsrRequest(route('dashscope-asr-fun-file'), {
			file: 'data:audio/wav;base64,UklGRg==',
			file_name: 'speech.wav',
			language: '',
			response_format: 'json',
		});
		assert.equal(request.url, 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation');
		assert.equal(request.headers['X-DashScope-SSE'], 'disable');
		assert.doesNotMatch(request.wireBodyJson, /UklGRg==/);
		assert.match(request.wireBodyJson, /speech\.wav \(4 bytes, audio\/wav\)/);
		assert.deepEqual(JSON.parse(request.bodyText), {
			model: 'fun-asr-realtime',
			input: {
				messages: [
					{
						role: 'user',
						content: [{ audio: 'data:audio/wav;base64,UklGRg==' }],
					},
				],
			},
			parameters: { vad_enabled: true, format: 'wav' },
			resources: [],
		});
	});

	it('builds the Qwen-Audio-3.0 official input_audio request', () => {
		const request = buildPlaygroundDashScopeSyncAsrRequest(
			route('dashscope-asr-qwen-audio-file', { providerModelName: 'qwen-audio-3.0-asr-flash' }),
			{
				file: 'data:audio/wav;base64,UklGRg==',
				file_name: 'speech.wav',
				language: 'zh',
				prompt: '会议',
			},
		);
		assert.equal(request.headers['X-DashScope-SSE'], 'disable');
		assert.doesNotMatch(request.wireBodyJson, /UklGRg==/);
		assert.deepEqual(JSON.parse(request.bodyText), {
			model: 'qwen-audio-3.0-asr-flash',
			input: {
				messages: [
					{
						role: 'user',
						content: [
							{ type: 'input_text', text: '会议' },
							{ type: 'input_audio', input_audio: { data: 'data:audio/wav;base64,UklGRg==' } },
						],
					},
				],
			},
			parameters: { vad_enabled: true, format: 'wav', language_hints: ['zh'] },
		});
	});

	it('forwards passthrough JSON and redacts data URLs in the wire preview', () => {
		const request = buildPlaygroundDashScopeSyncAsrRequest(route('passthrough', { providerModelName: 'qwen-audio-3.0-asr-flash' }), {
			model: 'public-asr',
			input: {
				messages: [
					{
						role: 'user',
						content: [{ type: 'input_audio', input_audio: { data: 'data:audio/wav;base64,UklGRg==' } }],
					},
				],
			},
			parameters: { format: 'wav' },
		});
		assert.doesNotMatch(request.wireBodyJson, /UklGRg==/);
		assert.equal(JSON.parse(request.bodyText).model, 'qwen-audio-3.0-asr-flash');
	});

	it('builds the official async filetrans submit body from file_url', () => {
		const request = buildPlaygroundDashScopeAsyncAsrRequest(
			route('dashscope-asr-file-async', {
				upstreamOperation: 'audio.transcriptions.async',
				providerModelName: 'qwen-audio-3.0-asr-flash-filetrans',
			}),
			{ file_url: 'https://audio.example/sample.wav', language: 'zh' },
		);
		assert.equal(request.url, 'https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription');
		assert.equal(request.headers['X-DashScope-Async'], 'enable');
		assert.deepEqual(JSON.parse(request.bodyText), {
			model: 'qwen-audio-3.0-asr-flash-filetrans',
			input: { file_urls: ['https://audio.example/sample.wav'] },
			parameters: { vad_enabled: true, language_hints: ['zh'] },
		});
	});

	it('rejects unsupported OpenAI language instead of dropping it', () => {
		assert.throws(
			() =>
				buildPlaygroundDashScopeSyncAsrRequest(route('dashscope-asr-fun-file'), {
					file: 'data:audio/wav;base64,UklGRg==',
					file_name: 'speech.wav',
					language: 'zh',
				}),
			/DashScope Fun-ASR file API does not support the OpenAI language field/,
		);
	});
});

describe('buildPlaygroundDashScopeSpeechRequest', () => {
	it('builds the non-streaming SpeechSynthesizer request', () => {
		const request = buildPlaygroundDashScopeSpeechRequest(
			route('dashscope-tts-speech', {
				upstreamOperation: 'audio.speech',
				providerModelName: 'cosyvoice-v1',
				customParams: { input: { sample_rate: 22050, volume: 50 } },
			}),
			{
				input: '你好',
				voice: 'longanlingxi',
				response_format: 'wav',
				speed: 1.1,
			},
		);
		assert.equal(request.url, 'https://dashscope.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer');
		assert.equal(request.headers.Authorization, 'Bearer sk-test');
		assert.deepEqual(JSON.parse(request.bodyText), {
			input: {
				sample_rate: 22050,
				volume: 50,
				text: '你好',
				voice: 'longanlingxi',
				format: 'wav',
				rate: 1.1,
			},
			model: 'cosyvoice-v1',
		});
	});
});
