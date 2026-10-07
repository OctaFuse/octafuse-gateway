import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { RouteResult } from '../model-router';
import { dispatchMiniMaxJsonPassthrough } from './minimax-json-passthrough';

function route(operation: 'audio.speech' | 'images.generations', providerModelName: string): RouteResult {
	return {
		targetId: 'route-1',
		modelSurfaceId: 'surface-1',
		routePoolId: 'pool-1',
		providerId: 'minimax',
		providerName: 'MiniMax',
		providerModelName,
		upstreamProtocol: 'minimax',
		upstreamOperation: operation,
		adapter: 'passthrough',
		providerEndpoints: { minimax: { base: 'https://api.minimaxi.com/v1' } },
		providerApiKey: 'sk-test',
		priceOverrideRaw: null,
		routeMeteredProfileJson: null,
		routeChargedProfileJson: null,
		customParams: null,
		routeGroup: 'default',
		routePriority: 0,
		routeWeight: 1,
		providerKeyId: null,
		providerKeyLabel: null,
		providerKeyFingerprint: null,
	};
}

describe('MiniMax JSON passthrough', () => {
	it('replaces the speech model and bills usage_characters', async () => {
		let seenUrl = '';
		let seenBody = '';
		const upstream = {
			data: { audio: '4869', status: 2 },
			extra_info: { usage_characters: 26, audio_format: 'mp3' },
			trace_id: 'trace-1',
			base_resp: { status_code: 0, status_msg: 'success' },
		};
		const result = await dispatchMiniMaxJsonPassthrough(
			route('audio.speech', 'speech-2.8-turbo'),
			'audio.speech',
			{ model: 'gateway-tts', text: '你好', stream: false },
			undefined,
			null,
			undefined,
			{
				fetchImpl: async (url, init) => {
					seenUrl = String(url);
					seenBody = String(init?.body ?? '');
					return new Response(JSON.stringify(upstream), {
						status: 200,
						headers: { 'Content-Type': 'application/json', 'x-request-id': 'hdr-1' },
					});
				},
			},
		);
		assert.equal(seenUrl, 'https://api.minimaxi.com/v1/t2a_v2');
		assert.equal(JSON.parse(seenBody).model, 'speech-2.8-turbo');
		assert.equal(result.response.status, 200);
		assert.equal(await result.response.text(), JSON.stringify(upstream));
		assert.equal((await result.usagePromise).audio_characters, 26);
		assert.equal(result.upstreamRequestId, 'hdr-1');
	});

	it('rewrites HTTP 200 business errors and does not bill them', async () => {
		const upstream = {
			base_resp: { status_code: 1004, status_msg: 'auth failed' },
		};
		const result = await dispatchMiniMaxJsonPassthrough(
			route('audio.speech', 'speech-2.8-turbo'),
			'audio.speech',
			{ model: 'gateway-tts', text: 'hi' },
			undefined,
			null,
			undefined,
			{
				fetchImpl: async () =>
					new Response(JSON.stringify(upstream), {
						status: 200,
						headers: { 'Content-Type': 'application/json' },
					}),
			},
		);
		assert.equal(result.response.status, 401);
		assert.deepEqual(JSON.parse(await result.response.text()), upstream);
		assert.equal((await result.usagePromise).audio_characters, undefined);
	});

	it('counts images from metadata.success_count', async () => {
		const upstream = {
			data: { image_urls: ['https://cdn.example/a.png'] },
			metadata: { success_count: 2, failed_count: 0 },
			base_resp: { status_code: 0, status_msg: 'success' },
			trace_id: 'img-1',
		};
		const result = await dispatchMiniMaxJsonPassthrough(
			route('images.generations', 'image-01'),
			'images.generations',
			{ model: 'gateway-image', prompt: 'a cat', n: 2 },
			undefined,
			null,
			undefined,
			{
				fetchImpl: async (url, init) => {
					assert.equal(String(url), 'https://api.minimaxi.com/v1/image_generation');
					assert.equal(JSON.parse(String(init?.body)).model, 'image-01');
					return new Response(JSON.stringify(upstream), {
						status: 200,
						headers: { 'Content-Type': 'application/json' },
					});
				},
			},
		);
		assert.equal(result.response.status, 200);
		assert.equal(result.meta?.imageCount, 2);
		assert.equal(result.upstreamRequestId, 'img-1');
	});

	it('streams speech SSE and reads the final usage_characters', async () => {
		const result = await dispatchMiniMaxJsonPassthrough(
			route('audio.speech', 'speech-2.8-hd'),
			'audio.speech',
			{ model: 'gateway-tts', text: 'hi', stream: true },
			undefined,
			null,
			undefined,
			{
				fetchImpl: async () => {
					const stream = new ReadableStream({
						start(controller) {
							const encoder = new TextEncoder();
							controller.enqueue(
								encoder.encode('data: {"data":{"audio":"aa","status":1},"base_resp":{"status_code":0}}\n\n'),
							);
							controller.enqueue(
								encoder.encode(
									'data: {"data":{"audio":"bb","status":2},"extra_info":{"usage_characters":18},"base_resp":{"status_code":0}}\n\n',
								),
							);
							controller.close();
						},
					});
					return new Response(stream, {
						status: 200,
						headers: {
							'Content-Type': 'text/event-stream',
							'Content-Length': '999',
							'Content-Encoding': 'gzip',
							'Transfer-Encoding': 'chunked',
						},
					});
				},
			},
		);
		assert.equal(result.response.headers.get('content-type'), 'text/event-stream');
		assert.equal(result.response.headers.get('content-length'), null);
		assert.equal(result.response.headers.get('content-encoding'), null);
		assert.equal(result.response.headers.get('transfer-encoding'), null);
		const text = await result.response.text();
		assert.match(text, /usage_characters":18/);
		assert.equal((await result.usagePromise).audio_characters, 18);
		assert.equal((await result.usagePromise).stream_error, undefined);
	});

	it('records a stream_error when the first SSE frame carries a business error', async () => {
		const result = await dispatchMiniMaxJsonPassthrough(
			route('audio.speech', 'speech-2.8-hd'),
			'audio.speech',
			{ model: 'gateway-tts', text: 'hi', stream: true },
			undefined,
			null,
			undefined,
			{
				fetchImpl: async () => {
					const stream = new ReadableStream({
						start(controller) {
							controller.enqueue(
								new TextEncoder().encode(
									'data: {"base_resp":{"status_code":2013,"status_msg":"bad param"}}\n\n',
								),
							);
							controller.close();
						},
					});
					return new Response(stream, {
						status: 200,
						headers: { 'Content-Type': 'text/event-stream' },
					});
				},
			},
		);
		await result.response.text();
		const usage = await result.usagePromise;
		assert.equal(usage.stream_error, 'MiniMax status 2013');
		assert.equal(usage.audio_characters, undefined);
	});
});
