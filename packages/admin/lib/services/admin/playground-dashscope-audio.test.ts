import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
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
