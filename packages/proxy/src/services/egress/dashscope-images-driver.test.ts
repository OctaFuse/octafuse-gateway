import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { RouteResult } from '../model-router';
import {
	buildDashScopeImageBody,
	DashScopeImageClientError,
	dispatchDashScopeImageGenerations,
	maxNForImageAdapter,
	maxNForImageRoutes,
	normalizeDashScopeImageResult,
	resolveImageBillingSize,
} from './dashscope-images-driver';

function route(overrides: Partial<RouteResult> = {}): RouteResult {
	return {
		targetId: 'target-1',
		modelSurfaceId: 'surface-1',
		routePoolId: 'pool-1',
		providerId: 'aliyun',
		providerName: 'Aliyun',
		providerModelName: 'qwen-image-3.0-pro',
		upstreamProtocol: 'dashscope',
		upstreamOperation: 'images.generations.multimodal',
		adapter: 'dashscope-image-qwen',
		providerEndpoints: {
			dashscope: { base: 'https://dashscope.aliyuncs.com/api/v1' },
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

describe('DashScope image request mapping', () => {
	it('always writes parameters.n and defaults missing n to 1', () => {
		const body = buildDashScopeImageBody('wan', route({ providerModelName: 'wan2.7-image' }), {
			prompt: 'a red apple',
		});
		assert.deepEqual(body, {
			model: 'wan2.7-image',
			input: { messages: [{ role: 'user', content: [{ text: 'a red apple' }] }] },
			parameters: { n: 1 },
		});
	});

	it('places reference images before the prompt text', () => {
		const body = buildDashScopeImageBody('qwen', route(), {
			prompt: 'edit this',
			n: 2,
			size: '1024*1024',
			image: ['https://example.com/a.png', 'data:image/png;base64,AAA'],
			watermark: false,
		});
		assert.deepEqual(body.input, {
			messages: [
				{
					role: 'user',
					content: [
						{ image: 'https://example.com/a.png' },
						{ image: 'data:image/png;base64,AAA' },
						{ text: 'edit this' },
					],
				},
			],
		});
		assert.deepEqual(body.parameters, { watermark: false, n: 2, size: '1024*1024' });
	});

	it('rewrites OpenAI 1024x1024 size to DashScope 1024*1024', () => {
		const qwen = buildDashScopeImageBody('qwen', route(), {
			prompt: 'a red apple',
			size: '1024x1024',
		});
		assert.equal((qwen.parameters as Record<string, unknown>).size, '1024*1024');
		const wan = buildDashScopeImageBody('wan', route({ providerModelName: 'wan2.7-image' }), {
			prompt: 'a red apple',
			size: '1024X1024',
		});
		assert.equal((wan.parameters as Record<string, unknown>).size, '1024*1024');
	});

	it('rejects qwen size abbreviations and allows wan 2K', () => {
		assert.throws(
			() => buildDashScopeImageBody('qwen', route(), { prompt: 'hi', size: '2K' }),
			(err: unknown) => err instanceof DashScopeImageClientError
		);
		const wan = buildDashScopeImageBody('wan', route({ providerModelName: 'wan2.7-image' }), {
			prompt: 'hi',
			size: '2K',
		});
		assert.equal((wan.parameters as Record<string, unknown>).size, '2K');
		assert.equal((wan.parameters as Record<string, unknown>).n, 1);
	});
});

describe('DashScope image result and billing size', () => {
	it('flattens image URLs across choices and content parts', () => {
		const normalized = normalizeDashScopeImageResult({
			output: {
				choices: [
					{ message: { content: [{ image: 'https://oss.example/a.png' }, { text: 'note' }] } },
					{ message: { content: [{ image: 'https://oss.example/b.png' }] } },
				],
			},
		});
		assert.deepEqual(normalized.data, [
			{ url: 'https://oss.example/a.png' },
			{ url: 'https://oss.example/b.png' },
		]);
	});

	it('derives qwen 1k/2k from usage and leaves wan as null', () => {
		assert.equal(resolveImageBillingSize('wan', { image_count: 1, size: '1488*704' }), null);
		assert.equal(resolveImageBillingSize('qwen', { output_image_type: 'qima_output_2k' }), '2k');
		assert.equal(resolveImageBillingSize('qwen', { output_image_type: 'qima_output_1k' }), '1k');
		assert.equal(
			resolveImageBillingSize('qwen', { output_width: 2048, output_height: 2048 }),
			'2k'
		);
		assert.equal(
			resolveImageBillingSize('qwen', { output_width: 1024, output_height: 1024 }),
			'1k'
		);
	});

	it('caps n by adapter family and takes the min across candidate routes', () => {
		assert.equal(maxNForImageAdapter('dashscope-image-wan'), 4);
		assert.equal(maxNForImageAdapter('dashscope-image-qwen'), 6);
		assert.equal(maxNForImageAdapter('passthrough'), 1);
		assert.equal(
			maxNForImageRoutes([{ adapter: 'dashscope-image-qwen' }, { adapter: 'dashscope-image-wan' }]),
			4
		);
	});
});

describe('DashScope image dispatch', () => {
	it('posts to multimodal-generation and returns OpenAI url data', async () => {
		const calls: Array<{ url: string; init?: RequestInit }> = [];
		const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
			calls.push({ url: String(input), init });
			return new Response(
				JSON.stringify({
					request_id: 'req-image',
					output: {
						choices: [{ message: { content: [{ image: 'https://oss.example/out.png' }] } }],
					},
					usage: { output_image_count: 1, output_image_type: 'qima_output_2k' },
				}),
				{ status: 200, headers: { 'Content-Type': 'application/json' } }
			);
		};
		const result = await dispatchDashScopeImageGenerations(
			route(),
			{ prompt: 'a cat' },
			undefined,
			null,
			undefined,
			{ fetchImpl }
		);
		assert.equal(
			calls[0]?.url,
			'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation'
		);
		const posted = JSON.parse(String(calls[0]?.init?.body)) as {
			parameters: { n: number };
		};
		assert.equal(posted.parameters.n, 1);
		const payload = (await result.response.json()) as {
			created: number;
			data: Array<{ url: string }>;
		};
		assert.equal(typeof payload.created, 'number');
		assert.deepEqual(payload.data, [{ url: 'https://oss.example/out.png' }]);
		assert.equal(result.meta.imageBillingSize, '2k');
		assert.equal(result.upstreamRequestId, 'req-image');
	});

	it('downloads OSS urls when response_format is b64_json', async () => {
		const fetchImpl = async (input: string | URL | Request) => {
			const url = String(input);
			if (url.includes('multimodal-generation')) {
				return new Response(
					JSON.stringify({
						output: {
							choices: [{ message: { content: [{ image: 'https://oss.example/out.png' }] } }],
						},
					}),
					{ status: 200 }
				);
			}
			return new Response(Uint8Array.from([1, 2, 3]), { status: 200 });
		};
		const result = await dispatchDashScopeImageGenerations(
			route(),
			{ prompt: 'a cat', response_format: 'b64_json' },
			undefined,
			null,
			undefined,
			{ fetchImpl }
		);
		const body = (await result.response.json()) as { data: Array<{ b64_json?: string; url?: string }> };
		assert.equal(body.data[0]?.b64_json, btoa(String.fromCharCode(1, 2, 3)));
		assert.equal(body.data[0]?.url, undefined);
	});

	it('falls back to url when b64 download fails', async () => {
		const fetchImpl = async (input: string | URL | Request) => {
			const url = String(input);
			if (url.includes('multimodal-generation')) {
				return new Response(
					JSON.stringify({
						output: {
							choices: [{ message: { content: [{ image: 'https://oss.example/out.png' }] } }],
						},
					}),
					{ status: 200 }
				);
			}
			return new Response('missing', { status: 404 });
		};
		const result = await dispatchDashScopeImageGenerations(
			route(),
			{ prompt: 'a cat', response_format: 'b64_json' },
			undefined,
			null,
			undefined,
			{ fetchImpl }
		);
		const body = (await result.response.json()) as { data: Array<{ url?: string }> };
		assert.equal(body.data[0]?.url, 'https://oss.example/out.png');
	});

	it('returns 400 when qwen receives a size abbreviation', async () => {
		const result = await dispatchDashScopeImageGenerations(
			route(),
			{ prompt: 'a cat', size: '2K' },
			undefined,
			null,
			undefined,
			{ fetchImpl: async () => new Response('unused') }
		);
		assert.equal(result.response.status, 400);
	});

	it('maps client abort to 504', async () => {
		const controller = new AbortController();
		controller.abort();
		const result = await dispatchDashScopeImageGenerations(
			route(),
			{ prompt: 'a cat' },
			controller.signal,
			null,
			undefined,
			{
				fetchImpl: async (_input, init) => {
					if (init?.signal?.aborted) {
						const err = new Error('aborted');
						err.name = 'AbortError';
						throw err;
					}
					throw new Error('upstream should not be called after client abort');
				},
			}
		);
		assert.equal(result.response.status, 504);
		assert.equal(result.meta.imageAbortReason, 'client_abort');
	});
});
