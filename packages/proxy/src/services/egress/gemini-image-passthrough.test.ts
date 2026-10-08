import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { RouteResult } from '../model-router';
import { dispatchGeminiImagePassthrough } from './gemini-image-passthrough';

function route(): RouteResult {
	return {
		targetId: 'route-1',
		modelSurfaceId: 'surface-1',
		routePoolId: 'pool-1',
		providerId: 'google',
		providerName: 'Google',
		providerModelName: 'gemini-3.1-flash-image',
		upstreamProtocol: 'gemini',
		upstreamOperation: 'models.generate',
		adapter: 'passthrough',
		providerEndpoints: {
			gemini: { base: 'https://generativelanguage.googleapis.com/v1beta/models' },
		},
		providerApiKey: 'provider-key',
		priceOverrideRaw: null,
		routeMeteredProfileJson: null,
		routeChargedProfileJson: null,
		customParams: { headers: { 'X-Route': 'gemini' } },
		routeGroup: 'default',
		routePriority: 0,
		routeWeight: 1,
		providerKeyId: null,
		providerKeyLabel: null,
		providerKeyFingerprint: null,
	};
}

const upstreamBody = {
	candidates: [
		{
			content: {
				parts: [
					{ thought: true, inlineData: { mimeType: 'image/png', data: 'thought' } },
					{ text: 'a lantern' },
					{ inlineData: { mimeType: 'image/png', data: 'abc' } },
				],
			},
		},
	],
	usageMetadata: {
		promptTokenCount: 12,
		candidatesTokenCount: 1132,
		thoughtsTokenCount: 20,
		promptTokensDetails: [
			{ modality: 'TEXT', tokenCount: 12 },
		],
		candidatesTokensDetails: [
			{ modality: 'TEXT', tokenCount: 12 },
			{ modality: 'IMAGE', tokenCount: 1120 },
		],
	},
};

describe('Gemini image passthrough', () => {
	it('posts generateContent, keeps the body, and bills non-thought images from modality details', async () => {
		let seenHeaders: HeadersInit | undefined;
		const result = await dispatchGeminiImagePassthrough(
			route(),
			'generateContent',
			{
				contents: [{ parts: [{ text: 'a red lantern' }] }],
				generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
			},
			'',
			undefined,
			null,
			undefined,
			{
				fetchImpl: async (url, init) => {
					const u = new URL(String(url));
					assert.equal(
						u.pathname,
						'/v1beta/models/gemini-3.1-flash-image:generateContent',
					);
					assert.equal(u.searchParams.get('key'), 'provider-key');
					const body = JSON.parse(String(init?.body));
					assert.equal(body.contents[0].parts[0].text, 'a red lantern');
					assert.equal(body.model, undefined);
					seenHeaders = init?.headers;
					return new Response(JSON.stringify(upstreamBody), {
						status: 200,
						headers: { 'Content-Type': 'application/json', 'x-request-id': 'gem-1' },
					});
				},
			},
		);
		const headers = new Headers(seenHeaders);
		assert.equal(headers.get('X-Route'), 'gemini');
		assert.equal(headers.get('Authorization'), null);
		assert.equal(result.response.status, 200);
		assert.equal(result.meta?.imageCount, 1);
		assert.equal(result.meta?.imageUsage?.text_tokens, 12);
		assert.equal(result.meta?.imageUsage?.text_output_tokens, 32);
		assert.equal(result.meta?.imageUsage?.image_output_tokens, 1120);
		assert.equal(result.upstreamRequestId, 'gem-1');
	});

	it('counts streamed images and keeps the last usageMetadata', async () => {
		const sse = [
			'data: {"candidates":[{"content":{"parts":[{"thought":true,"inlineData":{"mimeType":"image/png","data":"t"}},{"inlineData":{"mimeType":"image/png","data":"img"}}]}}]}',
			'',
			'data: {"usageMetadata":{"promptTokenCount":4,"candidatesTokenCount":1120,"candidatesTokensDetails":[{"modality":"IMAGE","tokenCount":1120}]}}',
			'',
			'',
		].join('\n');
		const result = await dispatchGeminiImagePassthrough(
			route(),
			'streamGenerateContent',
			{ contents: [{ parts: [{ text: 'lantern' }] }] },
			'',
			undefined,
			null,
			undefined,
			{
				fetchImpl: async (url) => {
					const u = new URL(String(url));
					assert.equal(u.pathname, '/v1beta/models/gemini-3.1-flash-image:streamGenerateContent');
					assert.equal(u.searchParams.get('alt'), 'sse');
					return new Response(sse, {
						status: 200,
						headers: { 'Content-Type': 'text/event-stream' },
					});
				},
			},
		);
		const text = await result.response.text();
		await result.usagePromise;
		assert.match(text, /inlineData/);
		assert.equal(result.response.headers.get('content-length'), null);
		assert.equal(result.meta?.imageCount, 1);
		assert.equal(result.meta?.imageUsage?.image_output_tokens, 1120);
		assert.equal(result.meta?.imageUsage?.text_tokens, 4);
	});

	it('marks client cancellation', async () => {
		const controller = new AbortController();
		controller.abort();
		const result = await dispatchGeminiImagePassthrough(
			route(),
			'generateContent',
			{ contents: [{ parts: [{ text: 'lantern' }] }] },
			'',
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
		assert.equal(result.meta?.imageUsage, null);
	});

	it('times out when the upstream does not respond', async () => {
		const result = await dispatchGeminiImagePassthrough(
			route(),
			'generateContent',
			{ contents: [{ parts: [{ text: 'lantern' }] }] },
			'',
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
