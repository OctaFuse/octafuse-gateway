import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { attachUpstreamExtraFields } from '@octafuse/core/upstream-extra-fields';
import type { RouteResult } from '../model-router';
import { dispatchGeminiOpenAiImage } from './gemini-openai-image-driver';

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
		adapter: 'gemini-image',
		providerEndpoints: {
			gemini: { base: 'https://generativelanguage.googleapis.com/v1beta/models' },
		},
		providerApiKey: 'provider-key',
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

const geminiResponse = {
	candidates: [
		{
			content: {
				parts: [
					{ thought: true, inlineData: { mimeType: 'image/png', data: 'thought' } },
					{ text: 'Here you go.' },
					{ inlineData: { mimeType: 'image/png', data: 'final' } },
				],
			},
			finishReason: 'STOP',
		},
	],
	usageMetadata: {
		promptTokenCount: 12,
		candidatesTokenCount: 1130,
		thoughtsTokenCount: 22,
		totalTokenCount: 1164,
		promptTokensDetails: [{ modality: 'TEXT', tokenCount: 12 }],
		candidatesTokensDetails: [
			{ modality: 'TEXT', tokenCount: 10 },
			{ modality: 'IMAGE', tokenCount: 1120 },
		],
	},
};

describe('Gemini OpenAI image driver', () => {
	it('converts OpenAI generations to generateContent and returns b64_json with token usage', async () => {
		let posted: Record<string, unknown> | null = null;
		const result = await dispatchGeminiOpenAiImage(
			route(),
			attachUpstreamExtraFields(
				{ prompt: 'a red lantern', n: 1, size: '1536x1024', quality: 'high' },
				{ generationConfig: { imageConfig: { imageSize: '2K' }, candidateCount: 4 } },
			),
			undefined,
			null,
			undefined,
			{
				fetchImpl: async (url, init) => {
					const u = new URL(String(url));
					assert.equal(u.pathname, '/v1beta/models/gemini-3.1-flash-image:generateContent');
					assert.equal(u.searchParams.get('key'), 'provider-key');
					posted = JSON.parse(String(init?.body)) as Record<string, unknown>;
					return new Response(JSON.stringify(geminiResponse), {
						status: 200,
						headers: { 'Content-Type': 'application/json', 'x-request-id': 'gem-1' },
					});
				},
			},
		);
		assert.deepEqual(posted, {
			contents: [{ role: 'user', parts: [{ text: 'a red lantern' }] }],
			generationConfig: {
				responseModalities: ['TEXT', 'IMAGE'],
				imageConfig: { aspectRatio: '3:2', imageSize: '2K' },
			},
		});
		assert.equal(result.response.status, 200);
		assert.equal(result.upstreamRequestId, 'gem-1');
		const body = (await result.response.json()) as {
			data: Array<{ b64_json: string }>;
			usage: { output_tokens_details: { image_tokens: number; text_tokens: number } };
		};
		assert.deepEqual(body.data, [{ b64_json: 'final' }]);
		assert.deepEqual(body.usage.output_tokens_details, { text_tokens: 32, image_tokens: 1120 });
		assert.equal(result.meta?.imageCount, 1);
		assert.equal(result.meta?.imageBillingSize, '2k');
		assert.equal(result.meta?.imageUsage?.image_output_tokens, 1120);
		assert.equal(result.meta?.imageUsage?.text_output_tokens, 32);
		assert.deepEqual(result.meta?.restoredUpstreamPaths, ['generationConfig.candidateCount']);
	});

	it('returns 400 before calling upstream for options Gemini cannot honor', async () => {
		let called = false;
		const result = await dispatchGeminiOpenAiImage(route(), { prompt: 'cat', response_format: 'url' }, undefined, null, undefined, {
			fetchImpl: async () => {
				called = true;
				return new Response('{}');
			},
		});
		assert.equal(called, false);
		assert.equal(result.response.status, 400);
		assert.equal(result.meta?.imageCount, 0);
	});

	it('turns an imageless response into a 502 without usage', async () => {
		const result = await dispatchGeminiOpenAiImage(route(), { prompt: 'cat' }, undefined, null, undefined, {
			fetchImpl: async () =>
				new Response(
					JSON.stringify({
						candidates: [{ finishReason: 'IMAGE_SAFETY', content: { parts: [] } }],
						usageMetadata: { promptTokenCount: 5, totalTokenCount: 5 },
					}),
					{ status: 200, headers: { 'Content-Type': 'application/json' } },
				),
		});
		assert.equal(result.response.status, 502);
		const body = (await result.response.json()) as { error: { message: string } };
		assert.match(body.error.message, /IMAGE_SAFETY/);
		assert.equal(result.meta?.imageUsage, null);
		assert.equal(result.meta?.imageCount, 0);
	});

	it('passes upstream errors through with the Gemini message', async () => {
		const result = await dispatchGeminiOpenAiImage(route(), { prompt: 'cat' }, undefined, null, undefined, {
			fetchImpl: async () =>
				new Response(JSON.stringify({ error: { code: 429, message: 'Resource exhausted', status: 'RESOURCE_EXHAUSTED' } }), {
					status: 429,
					headers: { 'Content-Type': 'application/json' },
				}),
		});
		assert.equal(result.response.status, 429);
		const body = (await result.response.json()) as { error: { message: string } };
		assert.equal(body.error.message, 'Resource exhausted');
	});

	it('marks gateway timeouts so the request is not billed or retried', async () => {
		const result = await dispatchGeminiOpenAiImage(route(), { prompt: 'cat' }, undefined, null, undefined, {
			timeoutMs: 5,
			fetchImpl: (_url, init) =>
				new Promise((_resolve, reject) => {
					init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
				}),
		});
		assert.equal(result.response.status, 504);
		assert.equal(result.meta?.imageAbortReason, 'gateway_timeout');
	});
});
