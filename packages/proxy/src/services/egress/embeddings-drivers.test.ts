import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import type { RouteResult } from '../model-router';
import {
	dispatchGeminiEmbedRoute,
	parseGeminiEmbedUsage,
	rewriteGeminiEmbedModel,
} from './gemini-embed-driver';
import { dispatchOpenAiEmbeddingsRoute, parseOpenAiEmbeddingsUsage } from './openai-embeddings-driver';

function route(overrides: Partial<RouteResult>): RouteResult {
	return {
		targetId: 'route-1',
		modelSurfaceId: 'surface-1',
		routePoolId: 'pool-1',
		providerId: 'p1',
		providerName: 'Provider',
		providerModelName: 'text-embedding-3-small',
		upstreamProtocol: 'openai',
		upstreamOperation: 'embeddings',
		adapter: 'passthrough',
		providerEndpoints: { openai: { base: 'https://api.example.com/v1' } },
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
		...overrides,
	};
}

const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
});

function mockFetch(
	status: number,
	body: string,
	contentType = 'application/json'
): { calls: Array<{ url: string; init: RequestInit | undefined }> } {
	const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
	globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
		calls.push({ url: String(input), init });
		return new Response(body, {
			status,
			headers: { 'Content-Type': contentType, 'x-request-id': 'req-1' },
		});
	}) as typeof fetch;
	return { calls };
}

describe('parseOpenAiEmbeddingsUsage', () => {
	it('reads prompt_tokens and falls back to total_tokens', () => {
		const a = parseOpenAiEmbeddingsUsage(JSON.stringify({ usage: { prompt_tokens: 8, total_tokens: 8 } }));
		assert.equal(a?.input_tokens, 8);
		assert.equal(a?.output_tokens, 0);
		assert.equal(a?.total_tokens, 8);
		const b = parseOpenAiEmbeddingsUsage(JSON.stringify({ usage: { total_tokens: 5 } }));
		assert.equal(b?.input_tokens, 5);
	});

	it('returns null without usable usage', () => {
		assert.equal(parseOpenAiEmbeddingsUsage('not json'), null);
		assert.equal(parseOpenAiEmbeddingsUsage(JSON.stringify({ data: [] })), null);
		assert.equal(parseOpenAiEmbeddingsUsage(JSON.stringify({ usage: { prompt_tokens: 0 } })), null);
	});
});

describe('dispatchOpenAiEmbeddingsRoute', () => {
	it('posts to {base}/embeddings, replaces model and bills prompt tokens', async () => {
		const upstream = { object: 'list', data: [{ embedding: [0.1] }], usage: { prompt_tokens: 12, total_tokens: 12 } };
		const { calls } = mockFetch(200, JSON.stringify(upstream));
		const result = await dispatchOpenAiEmbeddingsRoute(route({}), {
			model: 'gateway-embed',
			input: ['a', 'b'],
			dimensions: 256,
		});
		assert.equal(calls[0]!.url, 'https://api.example.com/v1/embeddings');
		const sent = JSON.parse(String(calls[0]!.init?.body));
		assert.equal(sent.model, 'text-embedding-3-small');
		assert.deepEqual(sent.input, ['a', 'b']);
		assert.equal(sent.dimensions, 256);
		assert.equal((calls[0]!.init?.headers as Record<string, string>).Authorization, 'Bearer sk-test');
		assert.equal(await result.response.text(), JSON.stringify(upstream));
		assert.equal((await result.usagePromise).input_tokens, 12);
		assert.equal(result.upstreamRequestId, 'req-1');
	});

	it('merges route custom_params body defaults without overriding the client', async () => {
		const { calls } = mockFetch(200, JSON.stringify({ usage: { prompt_tokens: 1 } }));
		await dispatchOpenAiEmbeddingsRoute(
			route({ customParams: { body: { dimensions: 512, encoding_format: 'float' } } }),
			{ model: 'm', input: 'x', encoding_format: 'base64' }
		);
		const sent = JSON.parse(String(calls[0]!.init?.body));
		assert.equal(sent.dimensions, 512);
		assert.equal(sent.encoding_format, 'base64');
	});

	it('passes upstream errors through without usage', async () => {
		mockFetch(429, JSON.stringify({ error: { message: 'rate' } }));
		const result = await dispatchOpenAiEmbeddingsRoute(route({}), { model: 'm', input: 'x' });
		assert.equal(result.response.status, 429);
		assert.equal((await result.usagePromise).input_tokens, 0);
	});
});

describe('rewriteGeminiEmbedModel', () => {
	it('rewrites every batch request model and adds it when missing', () => {
		const out = rewriteGeminiEmbedModel(
			{
				requests: [
					{ model: 'models/gateway-embed', content: { parts: [{ text: 'a' }] } },
					{ content: { parts: [{ text: 'b' }] }, taskType: 'RETRIEVAL_QUERY' },
				],
			},
			'batchEmbedContents',
			'gemini-embedding-001'
		) as { requests: Array<{ model: string; taskType?: string }> };
		assert.equal(out.requests[0]!.model, 'models/gemini-embedding-001');
		assert.equal(out.requests[1]!.model, 'models/gemini-embedding-001');
		assert.equal(out.requests[1]!.taskType, 'RETRIEVAL_QUERY');
	});

	it('only rewrites embedContent model when the client sent one', () => {
		assert.deepEqual(
			rewriteGeminiEmbedModel({ model: 'models/x', content: {} }, 'embedContent', 'gemini-embedding-001'),
			{ model: 'models/gemini-embedding-001', content: {} }
		);
		assert.deepEqual(rewriteGeminiEmbedModel({ content: {} }, 'embedContent', 'gemini-embedding-001'), {
			content: {},
		});
	});
});

describe('parseGeminiEmbedUsage', () => {
	it('reads promptTokenCount', () => {
		const u = parseGeminiEmbedUsage(JSON.stringify({ usageMetadata: { promptTokenCount: 7 } }));
		assert.equal(u?.input_tokens, 7);
		assert.equal(u?.output_tokens, 0);
		assert.equal(u?.total_tokens, 7);
	});

	it('returns null without usageMetadata', () => {
		assert.equal(parseGeminiEmbedUsage(JSON.stringify({ embedding: { values: [0.1] } })), null);
	});
});

describe('dispatchGeminiEmbedRoute', () => {
	const geminiRoute = route({
		providerModelName: 'gemini-embedding-001',
		upstreamProtocol: 'gemini',
		upstreamOperation: 'models.embed',
		providerEndpoints: { gemini: { base: 'https://generativelanguage.googleapis.com/v1beta/models' } },
	});

	it('posts batchEmbedContents with key query and rewritten models', async () => {
		const { calls } = mockFetch(
			200,
			JSON.stringify({ embeddings: [{ values: [0.1] }], usageMetadata: { promptTokenCount: 9 } })
		);
		const result = await dispatchGeminiEmbedRoute(
			geminiRoute,
			{ requests: [{ model: 'models/gateway-embed', content: { parts: [{ text: 'a' }] } }] },
			'batchEmbedContents',
			''
		);
		const url = new URL(calls[0]!.url);
		assert.equal(
			`${url.origin}${url.pathname}`,
			'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents'
		);
		assert.equal(url.searchParams.get('key'), 'sk-test');
		assert.equal(url.searchParams.get('alt'), null);
		const sent = JSON.parse(String(calls[0]!.init?.body));
		assert.equal(sent.requests[0].model, 'models/gemini-embedding-001');
		assert.equal((await result.usagePromise).input_tokens, 9);
	});

	it('posts embedContent and keeps the client body shape', async () => {
		const { calls } = mockFetch(
			200,
			JSON.stringify({ embedding: { values: [0.1] }, usageMetadata: { promptTokenCount: 3 } })
		);
		const result = await dispatchGeminiEmbedRoute(
			geminiRoute,
			{ content: { parts: [{ text: 'hi' }] }, outputDimensionality: 256 },
			'embedContent',
			''
		);
		assert.ok(calls[0]!.url.includes('gemini-embedding-001:embedContent'));
		const sent = JSON.parse(String(calls[0]!.init?.body));
		assert.equal(sent.model, undefined);
		assert.equal(sent.outputDimensionality, 256);
		assert.equal((await result.usagePromise).input_tokens, 3);
	});
});
