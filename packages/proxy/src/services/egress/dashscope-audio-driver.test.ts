import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { RouteResult } from '../model-router';
import type { NormalizedAudioTranscriptionRequest } from './openai-audio-driver';
import {
	audioUploadToDataUrl,
	buildDashScopeAsyncAsrBody,
	buildDashScopeFunAsrBody,
	buildDashScopeSyncAsrBody,
	dispatchDashScopeAsyncAsr,
	dispatchDashScopeSyncAsr,
	normalizeDashScopeAsyncAsrResult,
	normalizeDashScopeFunAsrResult,
	normalizeDashScopeSyncAsrResult,
	resolveDashScopeFunAsrFormat,
} from './dashscope-audio-driver';

function route(overrides: Partial<RouteResult> = {}): RouteResult {
	return {
		targetId: 'target-1',
		modelSurfaceId: 'surface-1',
		routePoolId: 'pool-1',
		providerId: 'aliyun',
		providerName: 'Aliyun',
		providerModelName: 'qwen3-asr-flash',
		upstreamProtocol: 'dashscope',
		upstreamOperation: 'audio.transcriptions.multimodal',
		adapter: 'dashscope-asr-qwen-file',
		providerEndpoints: {
			dashscope: { base: 'https://workspace.example/api/v1' },
		},
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

function request(overrides: Partial<NormalizedAudioTranscriptionRequest> = {}): NormalizedAudioTranscriptionRequest {
	return {
		file: {
			filename: 'sample.wav',
			mimeType: 'audio/wav',
			bytes: new Uint8Array([1, 2, 3]),
		},
		clientResponseFormat: 'json',
		...overrides,
	};
}

describe('DashScope ASR request mapping', () => {
	it('encodes uploaded audio as a Data URL for synchronous Qwen-ASR', () => {
		assert.equal(audioUploadToDataUrl(request().file), 'data:audio/wav;base64,AQID');
		const body = buildDashScopeSyncAsrBody(
			route({ customParams: { asr_options: { enable_itn: true } } }),
			request({ language: 'zh', prompt: 'Octafuse' }),
		);
		assert.deepEqual(body, {
			model: 'qwen3-asr-flash',
			input: {
				messages: [
					{ role: 'system', content: [{ text: 'Octafuse' }] },
					{ role: 'user', content: [{ audio: 'data:audio/wav;base64,AQID' }] },
				],
			},
			parameters: { asr_options: { enable_itn: true, language: 'zh' } },
		});
	});

	it('builds the documented Fun-ASR-Realtime non-streaming file request', () => {
		assert.equal(resolveDashScopeFunAsrFormat(request().file), 'wav');
		const body = buildDashScopeFunAsrBody(
			route({
				providerModelName: 'fun-asr-realtime',
				adapter: 'dashscope-asr-fun-file',
				customParams: { vad_enabled: false },
			}),
			request(),
		);
		assert.deepEqual(body, {
			model: 'fun-asr-realtime',
			input: {
				messages: [{ role: 'user', content: [{ audio: 'data:audio/wav;base64,AQID' }] }],
			},
			parameters: { vad_enabled: false, format: 'wav' },
			resources: [],
		});
	});

	it('rejects OpenAI fields that the Fun-ASR file API cannot represent', () => {
		assert.throws(
			() => buildDashScopeFunAsrBody(route({ adapter: 'dashscope-asr-fun-file' }), request({ language: 'zh' })),
			/OpenAI language field/,
		);
	});

	it('maps asynchronous models to file_urls and task parameters', () => {
		const body = buildDashScopeAsyncAsrBody(
			route({
				providerModelName: 'qwen3-asr-flash-filetrans',
				customParams: { enable_words: true, channel_id: [0] },
			}),
			'https://audio.example/sample.wav',
			request({ language: 'zh', prompt: 'Octafuse' }),
		);
		assert.deepEqual(body, {
			model: 'qwen3-asr-flash-filetrans',
			input: {
				file_urls: ['https://audio.example/sample.wav'],
				context: [
					{
						role: 'user',
						content: [{ type: 'input_text', text: 'Octafuse' }],
					},
				],
			},
			parameters: {
				enable_words: true,
				channel_id: [0],
				language_hints: ['zh'],
			},
		});
	});
});

describe('DashScope ASR response mapping', () => {
	it('normalizes synchronous multimodal output', () => {
		const normalized = normalizeDashScopeSyncAsrResult({
			output: {
				choices: [
					{
						message: {
							content: [{ text: '欢迎使用。' }],
							annotations: [{ language: 'zh', emotion: 'neutral' }],
						},
					},
				],
			},
			usage: { seconds: 1 },
		});
		assert.equal(normalized.text, '欢迎使用。');
		assert.equal(normalized.duration, 1);
		assert.equal(normalized.language, 'zh');
	});

	it('normalizes Fun-ASR-Realtime output and duration', () => {
		const normalized = normalizeDashScopeFunAsrResult({
			output: {
				text: '欢迎使用阿里云。',
				sentence: {
					sentence_id: 1,
					begin_time: 160,
					end_time: 1680,
					channel_id: 0,
					text: '欢迎使用阿里云。',
				},
			},
			usage: { duration: 2 },
		});
		assert.equal(normalized.text, '欢迎使用阿里云。');
		assert.equal(normalized.duration, 2);
		assert.deepEqual(normalized.segments, [
			{
				id: 1,
				start: 0.16,
				end: 1.68,
				text: '欢迎使用阿里云。',
				channel: 0,
			},
		]);
	});

	it('normalizes async transcripts and millisecond sentence timestamps', () => {
		const normalized = normalizeDashScopeAsyncAsrResult(
			{
				transcripts: [
					{
						channel_id: 0,
						text: '欢迎使用阿里云。',
						sentences: [
							{
								sentence_id: 0,
								begin_time: 0,
								end_time: 1440,
								language: 'zh',
								text: '欢迎使用阿里云。',
							},
						],
					},
				],
			},
			{ usage: { seconds: 3 } },
		);
		assert.equal(normalized.text, '欢迎使用阿里云。');
		assert.equal(normalized.duration, 3);
		assert.deepEqual(normalized.segments, [{ id: 0, start: 0, end: 1.44, text: '欢迎使用阿里云。', channel: 0 }]);
	});
});

describe('DashScope ASR dispatch', () => {
	it('calls the synchronous multimodal endpoint and returns OpenAI JSON', async () => {
		const calls: Array<{ url: string; init?: RequestInit }> = [];
		const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
			calls.push({ url: String(input), init });
			return new Response(
				JSON.stringify({
					request_id: 'req-sync',
					output: {
						choices: [{ message: { content: [{ text: '同步结果' }] } }],
					},
					usage: { seconds: 2 },
				}),
				{ status: 200, headers: { 'Content-Type': 'application/json' } },
			);
		};
		const result = await dispatchDashScopeSyncAsr(route(), request(), undefined, null, undefined, { fetchImpl });

		assert.equal(calls[0]?.url, 'https://workspace.example/api/v1/services/aigc/multimodal-generation/generation');
		assert.equal(new Headers(calls[0]?.init?.headers).get('Authorization'), 'Bearer sk-test');
		assert.deepEqual(await result.response.json(), { text: '同步结果' });
		assert.equal(result.meta.audioDurationSeconds, 2);
		assert.equal(result.meta.audioDurationSource, 'upstream');
		assert.equal(result.upstreamRequestId, 'req-sync');
	});

	it('uses the Fun-ASR request and response contracts selected by its adapter', async () => {
		let requestInit: RequestInit | undefined;
		const result = await dispatchDashScopeSyncAsr(
			route({
				providerModelName: 'fun-asr-realtime',
				adapter: 'dashscope-asr-fun-file',
			}),
			request(),
			undefined,
			null,
			undefined,
			{
				fetchImpl: async (_input, init) => {
					requestInit = init;
					return new Response(
						JSON.stringify({
							request_id: 'req-fun',
							output: { text: 'Fun-ASR 结果' },
							usage: { duration: 2 },
						}),
						{ status: 200 },
					);
				},
			},
		);

		const headers = new Headers(requestInit?.headers);
		assert.equal(headers.get('X-DashScope-SSE'), 'disable');
		assert.equal(
			(
				JSON.parse(String(requestInit?.body)) as {
					parameters: { format: string };
				}
			).parameters.format,
			'wav',
		);
		assert.deepEqual(await result.response.json(), { text: 'Fun-ASR 结果' });
		assert.equal(result.meta.audioDurationSeconds, 2);
		assert.equal(result.upstreamRequestId, 'req-fun');
	});

	it('submits, polls and downloads an asynchronous result', async () => {
		const calls: string[] = [];
		const responses = [
			new Response(
				JSON.stringify({
					request_id: 'req-submit',
					output: { task_id: 'task/1', task_status: 'PENDING' },
				}),
				{ status: 200 },
			),
			new Response(
				JSON.stringify({
					request_id: 'req-query',
					output: {
						task_id: 'task/1',
						task_status: 'SUCCEEDED',
						results: [
							{
								transcription_url: 'https://result.example/transcript.json',
								subtask_status: 'SUCCEEDED',
							},
						],
					},
					usage: { seconds: 3 },
				}),
				{ status: 200 },
			),
			new Response(
				JSON.stringify({
					transcripts: [{ channel_id: 0, text: '异步结果', sentences: [] }],
				}),
				{ status: 200 },
			),
		];
		const fetchImpl = async (input: string | URL | Request) => {
			calls.push(String(input));
			return responses.shift()!;
		};
		const result = await dispatchDashScopeAsyncAsr(
			route({
				providerModelName: 'qwen3-asr-flash-filetrans',
				upstreamOperation: 'audio.transcriptions.async',
				adapter: 'dashscope-asr-file-async',
			}),
			request({ fileSourceUrl: 'https://audio.example/sample.wav' }),
			undefined,
			null,
			undefined,
			{ fetchImpl, pollIntervalMs: 0 },
		);

		assert.deepEqual(calls, [
			'https://workspace.example/api/v1/services/audio/asr/transcription',
			'https://workspace.example/api/v1/tasks/task%2F1',
			'https://result.example/transcript.json',
		]);
		assert.deepEqual(await result.response.json(), { text: '异步结果' });
		assert.equal(result.meta.audioDurationSeconds, 3);
		assert.equal(result.upstreamRequestId, 'req-query');
	});
});
