import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { RouteResult } from '../model-router';
import {
	buildDashScopeTtsBody,
	dispatchDashScopeMiniMaxTts,
	dispatchDashScopeQwenTts,
	dispatchDashScopeSpeechSynthesizer,
	dispatchOpenAiAudioSpeech,
	type NormalizedAudioSpeechRequest,
} from './audio-speech-driver';

function route(overrides: Partial<RouteResult> = {}): RouteResult {
	return {
		targetId: 'target-tts',
		modelSurfaceId: 'surface-tts',
		routePoolId: 'pool-tts',
		providerId: 'aliyun',
		providerName: 'Aliyun',
		providerModelName: 'cosyvoice-v3-flash',
		upstreamProtocol: 'dashscope',
		upstreamOperation: 'audio.speech',
		adapter: 'dashscope-tts-speech',
		providerEndpoints: { dashscope: { base: 'https://workspace.example/api/v1' } },
		providerApiKey: 'sk-test',
		priceOverrideRaw: null,
		routeMeteredProfileJson: null,
		routeChargedProfileJson: null,
		customParams: null,
		routeGroup: 'default',
		routePriority: 1,
		routeWeight: 1,
		...overrides,
	};
}

function request(overrides: Partial<NormalizedAudioSpeechRequest> = {}): NormalizedAudioSpeechRequest {
	return {
		input: '你好',
		voice: 'longxiaochun',
		responseFormat: 'mp3',
		speed: 1,
		streamFormat: 'audio',
		...overrides,
	};
}

function sse(...events: unknown[]): Response {
	return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), {
		status: 200,
		headers: { 'Content-Type': 'text/event-stream' },
	});
}

describe('DashScope TTS request mapping', () => {
	it('maps SpeechSynthesizer fields and keeps nested route defaults', () => {
		assert.deepEqual(
			buildDashScopeTtsBody(
				route({ customParams: { input: { sample_rate: 24000, volume: 60 } } }),
				request({ responseFormat: 'wav', speed: 1.2, instructions: '温柔一些' }),
				'speech'
			),
			{
				model: 'cosyvoice-v3-flash',
				input: {
					sample_rate: 24000,
					volume: 60,
					text: '你好',
					voice: 'longxiaochun',
					format: 'wav',
					rate: 1.2,
					instruction: '温柔一些',
				},
			}
		);
	});

	it('uses distinct Qwen and MiniMax body shapes', () => {
		assert.deepEqual(
			buildDashScopeTtsBody(
				route({ providerModelName: 'qwen3-tts-flash' }),
				request({ responseFormat: 'wav', voice: { id: 'Cherry' }, instructions: 'cheerful' }),
				'qwen'
			),
			{
				model: 'qwen3-tts-flash',
				input: { text: '你好', voice: 'Cherry', instructions: 'cheerful' },
			}
		);
		assert.deepEqual(
			buildDashScopeTtsBody(
				route({ providerModelName: 'MiniMax/speech-2.8-hd' }),
				request({ responseFormat: 'flac', voice: 'male-qn-qingse', speed: 1.1 }),
				'minimax'
			),
			{
				model: 'MiniMax/speech-2.8-hd',
				input: {
					text: '你好',
					voice_setting: { voice_id: 'male-qn-qingse', speed: 1.1 },
					audio_setting: { format: 'flac' },
					stream_options: { exclude_aggregated_audio: true },
				},
			}
		);
	});
});

describe('DashScope TTS streaming conversion', () => {
	it('decodes SpeechSynthesizer Base64 chunks and captures characters', async () => {
		let upstreamBody: unknown;
		const result = await dispatchDashScopeSpeechSynthesizer(
			route(),
			request(),
			undefined,
			null,
			undefined,
			{
				fetchImpl: async (_input, init) => {
					upstreamBody = JSON.parse(String(init?.body));
					return sse(
						{
							request_id: 'req-tts',
							output: { finish_reason: 'null', audio: { data: 'AQI=' } },
							usage: { characters: 2 },
						},
						{
							request_id: 'req-tts',
							output: { finish_reason: 'stop', audio: { data: '' } },
							usage: { characters: 2 },
						}
					);
				},
			}
		);
		assert.equal(result.upstreamRequestId, 'req-tts');
		assert.deepEqual(new Uint8Array(await result.response.arrayBuffer()), new Uint8Array([1, 2]));
		assert.equal((await result.usagePromise).audio_characters, 2);
		assert.equal((upstreamBody as { model: string }).model, 'cosyvoice-v3-flash');
	});

	it('converts MiniMax hex chunks into OpenAI speech SSE events without tail duplication', async () => {
		const result = await dispatchDashScopeMiniMaxTts(
			route({
				providerModelName: 'MiniMax/speech-2.8-hd',
				upstreamOperation: 'audio.speech.multimodal',
				adapter: 'dashscope-tts-minimax',
			}),
			request({ streamFormat: 'sse' }),
			undefined,
			null,
			undefined,
			{
				fetchImpl: async () =>
					sse(
						{
							output: {
								base_resp: { status_code: 0, status_msg: 'success' },
								data: { audio: '0102', status: 1 },
							},
							usage: { characters: 2 },
						},
						{
							output: {
								base_resp: { status_code: 0, status_msg: 'success' },
								data: { audio: '', status: 2 },
							},
							usage: { characters: 2 },
						}
					),
			}
		);
		const text = await result.response.text();
		assert.match(text, /"type":"speech\.audio\.delta","audio":"AQI="/);
		assert.match(text, /"type":"speech\.audio\.done"/);
		assert.equal((await result.usagePromise).audio_characters, 2);
	});

	it('turns a first-frame Qwen application error into an HTTP failure before streaming', async () => {
		const result = await dispatchDashScopeQwenTts(
			route({
				providerModelName: 'qwen3-tts-flash',
				upstreamOperation: 'audio.speech.multimodal',
				adapter: 'dashscope-tts-qwen',
			}),
			request({ responseFormat: 'wav' }),
			undefined,
			null,
			undefined,
			{ fetchImpl: async () => sse({ code: 'InvalidParameter', message: 'bad voice' }) }
		);
		assert.equal(result.response.status, 502);
		assert.match(await result.response.text(), /bad voice/);
	});
});

describe('OpenAI speech passthrough', () => {
	it('preserves SSE bytes while extracting the done-event token usage', async () => {
		const upstream = [
			{ type: 'speech.audio.delta', audio: 'AQI=' },
			{ type: 'speech.audio.done', usage: { input_tokens: 3, output_tokens: 5, total_tokens: 8 } },
		];
		const result = await dispatchOpenAiAudioSpeech(
			route({
				upstreamProtocol: 'openai',
				upstreamOperation: 'audio.speech',
				adapter: 'passthrough',
				providerEndpoints: { openai: { base: 'https://openai.example/v1' } },
			}),
			request({ streamFormat: 'sse' }),
			undefined,
			null,
			undefined,
			{ fetchImpl: async () => sse(...upstream) }
		);
		assert.deepEqual(
			(await result.response.text()).trim().split('\n\n'),
			upstream.map((event) => `data: ${JSON.stringify(event)}`)
		);
		assert.deepEqual(await result.usagePromise, {
			input_tokens: 3,
			output_tokens: 5,
			cache_read_tokens: 0,
			cache_write_tokens: 0,
			reasoning_tokens: 0,
			total_tokens: 8,
			raw_usage: JSON.stringify(upstream[1]!.usage),
		});
	});
});
