import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { attachUpstreamExtraFields } from '@octafuse/core/upstream-extra-fields';
import type { RouteResult } from '../model-router';
import { dispatchVolcengineOpenAiImage } from './volcengine-openai-driver';

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
		adapter: 'volcengine-image',
		providerEndpoints: { volcengine: { base: 'https://ark.cn-beijing.volces.com/api/v3' } },
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

describe('Volcengine OpenAI image driver', () => {
	it('maps n onto sequential generation and drops failed images', async () => {
		let posted: Record<string, unknown> | null = null;
		const result = await dispatchVolcengineOpenAiImage(
			route(),
			{
				prompt: 'a cat',
				n: 3,
				size: '2K',
				quality: 'high',
				background: 'transparent',
				response_format: 'url',
				watermark: false,
			},
			undefined,
			null,
			undefined,
			{
				fetchImpl: async (url, init) => {
					assert.equal(String(url), 'https://ark.cn-beijing.volces.com/api/v3/images/generations');
					assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer sk-test');
					posted = JSON.parse(String(init?.body)) as Record<string, unknown>;
					return new Response(
						JSON.stringify({
							created: 1700000000,
							data: [
								{ url: 'https://cdn.example/a.png' },
								{ error: { code: 'x', message: 'second failed' } },
							],
							usage: { generated_images: 1 },
						}),
						{ status: 200, headers: { 'Content-Type': 'application/json', 'x-request-id': 'ark-1' } },
					);
				},
			},
		);
		assert.equal(posted?.model, 'doubao-seedream-5-0-260128');
		assert.equal(posted?.sequential_image_generation, 'auto');
		assert.deepEqual(posted?.sequential_image_generation_options, { max_images: 3 });
		assert.equal(posted?.quality, undefined);
		assert.equal(posted?.background, 'transparent');
		assert.equal(posted?.watermark, false);
		assert.equal(result.response.status, 200);
		assert.equal(result.upstreamRequestId, 'ark-1');
		const body = (await result.response.json()) as { data: Array<{ url: string }> };
		assert.deepEqual(body.data, [{ url: 'https://cdn.example/a.png' }]);
		assert.equal(result.meta?.imageCount, 1);
		assert.equal(result.meta?.imageBillingSize, '2k');
	});

	it('bills explicit pixel sizes by tier and rejects groups on Seedream 5.0 pro', async () => {
		const pro = { ...route(), providerModelName: 'doubao-seedream-5-0-pro-260708' };
		const tiered = await dispatchVolcengineOpenAiImage(
			pro,
			{ prompt: 'a cat', size: '2048x1024' },
			undefined,
			null,
			undefined,
			{
				fetchImpl: async () =>
					new Response(JSON.stringify({ data: [{ url: 'https://cdn.example/a.png', size: '2048x1024' }] }), {
						status: 200,
						headers: { 'Content-Type': 'application/json' },
					}),
			},
		);
		assert.equal(tiered.meta?.imageBillingSize, '1.5k');

		let called = false;
		const rejected = await dispatchVolcengineOpenAiImage(pro, { prompt: 'a cat', n: 2 }, undefined, null, undefined, {
			fetchImpl: async () => {
				called = true;
				return new Response('{}', { status: 200 });
			},
		});
		assert.equal(called, false);
		assert.equal(rejected.response.status, 400);
	});

	it('returns 502 with the first image error when every image fails', async () => {
		const result = await dispatchVolcengineOpenAiImage(
			route(),
			{ prompt: 'a cat', n: 2 },
			undefined,
			null,
			undefined,
			{
				fetchImpl: async () =>
					new Response(
						JSON.stringify({
							data: [
								{ error: { code: 'x', message: 'first failed' } },
								{ error: { code: 'y', message: 'second failed' } },
							],
							usage: { generated_images: 0 },
						}),
						{ status: 200, headers: { 'Content-Type': 'application/json' } },
					),
			},
		);
		assert.equal(result.response.status, 502);
		const payload = (await result.response.json()) as { error: { message: string } };
		assert.equal(payload.error.message, 'first failed');
		assert.equal(result.meta?.imageCount, 0);
	});

	it('returns upstream 4xx unchanged in status and message', async () => {
		const result = await dispatchVolcengineOpenAiImage(
			route(),
			{ prompt: 'a cat' },
			undefined,
			null,
			undefined,
			{
				fetchImpl: async () =>
					new Response(JSON.stringify({ error: { code: 'InvalidParameter', message: 'size is invalid' } }), {
						status: 400,
						headers: { 'Content-Type': 'application/json' },
					}),
			},
		);
		assert.equal(result.response.status, 400);
		const payload = (await result.response.json()) as { error: { message: string } };
		assert.equal(payload.error.message, 'size is invalid');
	});

	it('restores protected sequential, stream, and response_format fields', async () => {
		let posted: Record<string, unknown> | null = null;
		const result = await dispatchVolcengineOpenAiImage(
			route(),
			attachUpstreamExtraFields(
				{ prompt: 'a cat', n: 1, response_format: 'url', size: '2K' },
				{
					stream: true,
					sequential_image_generation: 'auto',
					sequential_image_generation_options: { max_images: 9 },
					response_format: 'b64_json',
					seed: 7,
				},
			),
			undefined,
			null,
			undefined,
			{
				fetchImpl: async (_url, init) => {
					posted = JSON.parse(String(init?.body)) as Record<string, unknown>;
					return new Response(JSON.stringify({ data: [{ url: 'https://cdn.example/a.png' }], usage: { generated_images: 1 } }), {
						status: 200,
						headers: { 'Content-Type': 'application/json' },
					});
				},
			},
		);
		assert.equal(posted?.stream, undefined);
		assert.equal(posted?.sequential_image_generation, undefined);
		assert.equal(posted?.sequential_image_generation_options, undefined);
		assert.equal(posted?.response_format, 'url');
		assert.equal(posted?.seed, 7);
		assert.ok(result.meta?.restoredUpstreamPaths?.includes('stream'));
		assert.ok(result.meta?.restoredUpstreamPaths?.includes('sequential_image_generation'));
		assert.ok(result.meta?.restoredUpstreamPaths?.includes('response_format'));
		assert.equal(result.response.status, 200);
	});

	it('marks client cancellation', async () => {
		const controller = new AbortController();
		controller.abort();
		const result = await dispatchVolcengineOpenAiImage(
			route(),
			{ prompt: 'a cat' },
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
	});

	it('times out when the upstream does not respond', async () => {
		const result = await dispatchVolcengineOpenAiImage(
			route(),
			{ prompt: 'a cat' },
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
		const payload = (await result.response.json()) as { error: { message: string } };
		assert.match(payload.error.message, /timed out/);
	});
});
