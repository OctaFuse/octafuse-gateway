import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { RouteResult } from '../model-router';
import { dispatchVolcengineJsonPassthrough } from './volcengine-json-passthrough';

function route(): RouteResult {
	return {
		targetId: 'route-1',
		modelSurfaceId: 'surface-1',
		routePoolId: 'pool-1',
		providerId: 'volcengine-ark',
		providerName: 'Volcengine Ark',
		providerModelName: 'doubao-seedream-5-0-260128',
		upstreamProtocol: 'volcengine',
		upstreamOperation: 'images.generations',
		adapter: 'passthrough',
		providerEndpoints: { volcengine: { base: 'https://ark.cn-beijing.volces.com/api/v3' } },
		providerApiKey: 'sk-test',
		priceOverrideRaw: null,
		routeMeteredProfileJson: null,
		routeChargedProfileJson: null,
		customParams: { headers: { 'X-Route': 'ark' } },
		routeGroup: 'default',
		routePriority: 0,
		routeWeight: 1,
		providerKeyId: null,
		providerKeyLabel: null,
		providerKeyFingerprint: null,
	};
}

describe('Volcengine image passthrough', () => {
	it('replaces model, forwards headers, and counts generated_images', async () => {
		const upstream = {
			data: [{ url: 'https://cdn.example/a.png', size: '2048x2048' }],
			usage: { generated_images: 1, output_tokens: 16384, total_tokens: 16384 },
		};
		let seenHeaders: HeadersInit | undefined;
		const result = await dispatchVolcengineJsonPassthrough(
			route(),
			{ model: 'gateway-image', prompt: 'a cat', size: '2K' },
			undefined,
			null,
			undefined,
			{
				fetchImpl: async (url, init) => {
					assert.equal(String(url), 'https://ark.cn-beijing.volces.com/api/v3/images/generations');
					const body = JSON.parse(String(init?.body));
					assert.equal(body.model, 'doubao-seedream-5-0-260128');
					assert.equal(body.prompt, 'a cat');
					seenHeaders = init?.headers;
					return new Response(JSON.stringify(upstream), {
						status: 200,
						headers: { 'Content-Type': 'application/json', 'x-request-id': 'ark-1' },
					});
				},
			},
		);
		const headers = new Headers(seenHeaders);
		assert.equal(headers.get('Authorization'), 'Bearer sk-test');
		assert.equal(headers.get('Content-Type'), 'application/json');
		assert.equal(headers.get('X-Route'), 'ark');
		assert.equal(result.response.status, 200);
		assert.deepEqual(JSON.parse(await result.response.text()), upstream);
		assert.equal(result.meta?.imageCount, 1);
		assert.equal(result.upstreamRequestId, 'ark-1');
	});

	it('counts only successful images when some items fail', async () => {
		const upstream = {
			data: [{ url: 'https://cdn.example/a.png' }, { error: { code: 'x', message: 'failed' } }],
			usage: { generated_images: 1 },
		};
		const result = await dispatchVolcengineJsonPassthrough(
			route(),
			{ model: 'gateway-image', prompt: 'a cat', sequential_image_generation: 'auto' },
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
		assert.equal(result.meta?.imageCount, 1);
		assert.deepEqual(JSON.parse(await result.response.text()), upstream);
	});

	it('returns upstream errors unchanged', async () => {
		const upstream = { error: { code: 'InvalidParameter', message: 'size is invalid' } };
		const result = await dispatchVolcengineJsonPassthrough(
			route(),
			{ model: 'gateway-image', prompt: 'a cat' },
			undefined,
			null,
			undefined,
			{
				fetchImpl: async () =>
					new Response(JSON.stringify(upstream), {
						status: 400,
						headers: { 'Content-Type': 'application/json' },
					}),
			},
		);
		assert.equal(result.response.status, 400);
		assert.deepEqual(JSON.parse(await result.response.text()), upstream);
		assert.equal(result.meta?.imageCount, 0);
	});

	it('forwards SSE and bills generated_images from the completed event', async () => {
		const result = await dispatchVolcengineJsonPassthrough(
			route(),
			{ model: 'gateway-image', prompt: 'a cat', stream: true },
			undefined,
			null,
			undefined,
			{
				fetchImpl: async () => {
					const stream = new ReadableStream({
						start(controller) {
							const encoder = new TextEncoder();
							controller.enqueue(
								encoder.encode(
									'event: image_generation.partial_succeeded\ndata: {"type":"image_generation.partial_succeeded","url":"https://a"}\n\n',
								),
							);
							controller.enqueue(
								encoder.encode(
									'event: image_generation.partial_failed\ndata: {"type":"image_generation.partial_failed","error":{"code":"x","message":"failed"}}\n\n',
								),
							);
							controller.enqueue(
								encoder.encode(
									'event: image_generation.completed\ndata: {"type":"image_generation.completed","usage":{"generated_images":1}}\n\n',
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
						},
					});
				},
			},
		);
		assert.equal(result.response.headers.get('content-type'), 'text/event-stream');
		assert.equal(result.response.headers.get('content-length'), null);
		assert.equal(result.response.headers.get('content-encoding'), null);
		const text = await result.response.text();
		assert.match(text, /generated_images":1/);
		await result.usagePromise;
		assert.equal(result.meta?.imageCount, 1);
	});

	it('marks client cancellation and does not wait for a completed event', async () => {
		const controller = new AbortController();
		controller.abort();
		const result = await dispatchVolcengineJsonPassthrough(
			route(),
			{ model: 'gateway-image', prompt: 'a cat', stream: true },
			controller.signal,
			null,
			undefined,
			{
				fetchImpl: async (_url, init) => {
					assert.equal(init?.signal?.aborted, true);
					throw new DOMException('aborted', 'AbortError');
				},
			},
		);
		assert.equal(result.response.status, 499);
		assert.equal(result.meta?.imageAbortReason, 'client_abort');
		assert.equal(result.meta?.imageCount, 0);
	});

	it('times out when the upstream does not respond', async () => {
		const result = await dispatchVolcengineJsonPassthrough(
			route(),
			{ model: 'gateway-image', prompt: 'a cat' },
			undefined,
			null,
			undefined,
			{
				timeoutMs: 20,
				fetchImpl: (_url, init) =>
					new Promise((_resolve, reject) => {
						init?.signal?.addEventListener('abort', () => {
							reject(new DOMException('aborted', 'AbortError'));
						});
					}),
			},
		);
		assert.equal(result.response.status, 504);
		assert.equal(result.meta?.imageAbortReason, 'gateway_timeout');
		const payload = JSON.parse(await result.response.text()) as { error: { message: string } };
		assert.match(payload.error.message, /timed out/);
	});
});
