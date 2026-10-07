import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { RouteResult } from '../model-router';
import type { NormalizedAudioSpeechRequest } from './audio-speech-driver';
import { dispatchMiniMaxOpenAiImage, dispatchMiniMaxOpenAiSpeech } from './minimax-openai-driver';

function route(adapter: 'minimax-tts' | 'minimax-image', providerModelName: string): RouteResult {
	return {
		targetId: 'target-1',
		modelSurfaceId: 'surface-1',
		routePoolId: 'pool-1',
		providerId: 'minimax-official',
		providerName: 'didi',
		providerModelName,
		upstreamProtocol: 'minimax',
		upstreamOperation: adapter === 'minimax-tts' ? 'audio.speech' : 'images.generations',
		adapter,
		providerEndpoints: { minimax: { base: 'https://api.minimaxi.com/v1' } },
		providerApiKey: 'sk-test',
		priceOverrideRaw: null,
		routeMeteredProfileJson: null,
		routeChargedProfileJson: null,
		customParams: null,
		routeGroup: 'default',
		routePriority: 0,
		routeWeight: 1,
	};
}

function speech(overrides: Partial<NormalizedAudioSpeechRequest> = {}): NormalizedAudioSpeechRequest {
	return {
		input: '你好',
		voice: 'male-qn-qingse',
		responseFormat: 'mp3',
		speed: 1,
		streamFormat: 'audio',
		...overrides,
	};
}

describe('MiniMax OpenAI speech driver', () => {
	it('decodes non-stream hex audio and bills usage_characters', async () => {
		let posted: { url: string; body: Record<string, unknown> } | null = null;
		const result = await dispatchMiniMaxOpenAiSpeech(route('minimax-tts', 'speech-2.8-turbo'), speech(), undefined, null, undefined, {
			fetchImpl: async (input, init) => {
				posted = { url: String(input), body: JSON.parse(String(init?.body)) as Record<string, unknown> };
				return new Response(
					JSON.stringify({
						data: { audio: '6869', status: 2 },
						extra_info: { audio_format: 'mp3', usage_characters: 4 },
						base_resp: { status_code: 0, status_msg: 'success' },
						trace_id: 'trace-speech',
					}),
					{ status: 200, headers: { 'Content-Type': 'application/json' } },
				);
			},
		});
		assert.equal(posted?.url, 'https://api.minimaxi.com/v1/t2a_v2');
		assert.equal(posted?.body.model, 'speech-2.8-turbo');
		assert.equal(posted?.body.text, '你好');
		assert.equal(posted?.body.stream, false);
		assert.equal(result.response.status, 200);
		assert.equal(result.response.headers.get('content-type'), 'audio/mpeg');
		assert.deepEqual(Array.from(new Uint8Array(await result.response.arrayBuffer())), [0x68, 0x69]);
		assert.equal((await result.usagePromise).audio_characters, 4);
		assert.equal(result.upstreamRequestId, 'trace-speech');
	});

	it('maps a non-zero base_resp onto an OpenAI error and does not bill', async () => {
		const result = await dispatchMiniMaxOpenAiSpeech(route('minimax-tts', 'speech-2.8-turbo'), speech(), undefined, null, undefined, {
			fetchImpl: async () =>
				new Response(
					JSON.stringify({
						base_resp: { status_code: 2013, status_msg: 'invalid params' },
						trace_id: 'trace-bad',
					}),
					{ status: 200, headers: { 'Content-Type': 'application/json' } },
				),
		});
		assert.equal(result.response.status, 400);
		const body = (await result.response.json()) as { error: { message: string; code: string } };
		assert.equal(body.error.message, 'invalid params');
		assert.equal(body.error.code, '2013');
		assert.equal((await result.usagePromise).audio_characters, undefined);
	});

	it('converts speech SSE into OpenAI delta events without the aggregated tail', async () => {
		const encoder = new TextEncoder();
		const frame = (payload: unknown) => encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);
		const result = await dispatchMiniMaxOpenAiSpeech(
			route('minimax-tts', 'speech-2.8-turbo'),
			speech({ streamFormat: 'sse' }),
			undefined,
			null,
			undefined,
			{
				fetchImpl: async (_input, init) => {
					const body = JSON.parse(String(init?.body)) as { stream_options?: { exclude_aggregated_audio?: boolean } };
					assert.equal(body.stream_options?.exclude_aggregated_audio, true);
					return new Response(
						new ReadableStream({
							start(controller) {
								controller.enqueue(
									frame({
										data: { audio: '6869', status: 1 },
										extra_info: { usage_characters: 2 },
										base_resp: { status_code: 0 },
										trace_id: 'trace-sse',
									}),
								);
								controller.enqueue(
									frame({
										data: { audio: '', status: 2 },
										extra_info: { usage_characters: 2 },
										base_resp: { status_code: 0 },
										trace_id: 'trace-sse',
									}),
								);
								controller.close();
							},
						}),
						{ status: 200, headers: { 'Content-Type': 'text/event-stream' } },
					);
				},
			},
		);
		assert.equal(result.response.headers.get('content-type'), 'text/event-stream; charset=utf-8');
		assert.equal(result.response.headers.get('content-length'), null);
		const text = await result.response.text();
		assert.match(text, /speech\.audio\.delta/);
		assert.match(text, /aGk=/);
		assert.match(text, /speech\.audio\.done/);
		assert.equal((await result.usagePromise).audio_characters, 2);
		assert.equal(result.upstreamRequestId, 'trace-sse');
	});

	it('rejects opus before calling MiniMax', async () => {
		let called = false;
		const result = await dispatchMiniMaxOpenAiSpeech(
			route('minimax-tts', 'speech-2.8-turbo'),
			speech({ responseFormat: 'opus' }),
			undefined,
			null,
			undefined,
			{
				fetchImpl: async () => {
					called = true;
					return new Response('nope');
				},
			},
		);
		assert.equal(called, false);
		assert.equal(result.response.status, 400);
	});
});

describe('MiniMax OpenAI image driver', () => {
	it('maps size to aspect_ratio and rewrites image_urls into OpenAI data', async () => {
		let posted: Record<string, unknown> | null = null;
		const result = await dispatchMiniMaxOpenAiImage(
			route('minimax-image', 'image-01'),
			{ prompt: 'a red lantern', n: 1, size: '1024x1024', quality: 'low', response_format: 'url' },
			undefined,
			null,
			undefined,
			{
				fetchImpl: async (input, init) => {
					assert.equal(String(input), 'https://api.minimaxi.com/v1/image_generation');
					posted = JSON.parse(String(init?.body)) as Record<string, unknown>;
					return new Response(
						JSON.stringify({
							data: { image_urls: ['https://cdn.example/lantern.jpg'] },
							metadata: { success_count: '1' },
							base_resp: { status_code: 0, status_msg: 'success' },
							trace_id: 'trace-image',
						}),
						{ status: 200, headers: { 'Content-Type': 'application/json' } },
					);
				},
			},
		);
		assert.equal(posted?.model, 'image-01');
		assert.equal(posted?.aspect_ratio, '1:1');
		assert.equal(posted?.quality, undefined);
		assert.equal(result.response.status, 200);
		const body = (await result.response.json()) as { data: Array<{ url: string }> };
		assert.deepEqual(body.data, [{ url: 'https://cdn.example/lantern.jpg' }]);
		assert.deepEqual((result.meta.parsedBody as { data: unknown }).data, body.data);
		assert.equal(result.upstreamRequestId, 'trace-image');
	});
});
