import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import type { RouteResult } from '../model-router';
import { dispatchGeminiRoute } from './gemini-driver';

// 用 node:test 的 mock 替代原 vitest 的 vi.fn / vi.stubGlobal。
const originalFetch = globalThis.fetch;
const vi = {
	fn: <T extends (...args: never[]) => unknown>(impl: T) => mock.fn(impl),
	stubGlobal: (_name: 'fetch', value: unknown) => {
		globalThis.fetch = value as typeof fetch;
	},
	unstubAllGlobals: () => {
		globalThis.fetch = originalFetch;
	},
};

function minimalRoute(overrides: Partial<RouteResult>): RouteResult {
	return {
		providerId: 'p1',
		providerName: 'Test Provider',
		providerModelName: 'gemini-2.5-flash',
		upstreamProtocol: 'gemini',
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
		...overrides,
	};
}

describe('dispatchGeminiRoute upstream auth', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('appends query key for official Gemini upstream', async () => {
		const fetchMock = vi.fn(async () => new Response('{}', { status: 400 }));
		vi.stubGlobal('fetch', fetchMock);

		await dispatchGeminiRoute(minimalRoute({}), {}, 'generateContent', '');

		const [calledUrl, init] = fetchMock.mock.calls[0].arguments as unknown as [string, RequestInit];
		const u = new URL(calledUrl);
		assert.equal(u.searchParams.get('key'), 'provider-key');
		assert.equal((init.headers as Record<string, string>).Authorization, undefined);
	});

	it('uses models.generate family template with wire action', async () => {
		const fetchMock = vi.fn(async () => new Response('{}', { status: 400 }));
		vi.stubGlobal('fetch', fetchMock);

		await dispatchGeminiRoute(
			minimalRoute({
				providerEndpoints: {
					gemini: {
						endpoints: {
							'models.generate': 'https://family.example/v1/models/{model}:{action}',
						},
					},
				},
			}),
			{},
			'streamGenerateContent',
			''
		);

		const [calledUrl] = fetchMock.mock.calls[0].arguments as unknown as [string, RequestInit];
		const u = new URL(calledUrl);
		assert.equal(u.pathname, '/v1/models/gemini-2.5-flash:streamGenerateContent');
		assert.equal(u.searchParams.get('alt'), 'sse');
	});

	it('uses Authorization Bearer for qnaigc bypass upstream', async () => {
		const fetchMock = vi.fn(async () => new Response('{}', { status: 400 }));
		vi.stubGlobal('fetch', fetchMock);

		await dispatchGeminiRoute(
			minimalRoute({
				providerEndpoints: {
					gemini: {
						base: 'https://api.qnaigc.com//bypass/vertex/v1/models',
						auth: 'bearer',
					},
				},
				providerApiKey: 'bearer-token',
			}),
			{},
			'generateContent',
			''
		);

		const [calledUrl, init] = fetchMock.mock.calls[0].arguments as unknown as [string, RequestInit];
		const u = new URL(calledUrl);
		assert.equal(u.pathname, '/bypass/vertex/v1/models/gemini-2.5-flash:generateContent');
		assert.equal(calledUrl, 
			'https://api.qnaigc.com/bypass/vertex/v1/models/gemini-2.5-flash:generateContent'
		);
		assert.equal(u.searchParams.has('key'), false);
		assert.equal((init.headers as Record<string, string>).Authorization, 'Bearer bearer-token');
	});

	it('uses Authorization Bearer and alt=sse for modelink stream upstream', async () => {
		const fetchMock = vi.fn(async () => new Response('data: {}\n\n', { status: 200 }));
		vi.stubGlobal('fetch', fetchMock);

		await dispatchGeminiRoute(
			minimalRoute({
				providerEndpoints: {
					gemini: {
						base: 'https://api.modelink.ai/bypass/vertex/v1/models',
						auth: 'bearer',
					},
				},
				providerApiKey: 'modelink-token',
			}),
			{},
			'streamGenerateContent',
			''
		);

		const [calledUrl, init] = fetchMock.mock.calls[0].arguments as unknown as [string, RequestInit];
		const u = new URL(calledUrl);
		assert.equal(u.searchParams.has('key'), false);
		assert.equal(u.searchParams.get('alt'), 'sse');
		assert.equal((init.headers as Record<string, string>).Authorization, 'Bearer modelink-token');
	});
});

describe('dispatchGeminiRoute upstream trace ids', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('returns header request id from non-stream JSON response', async () => {
		const body = JSON.stringify({
			responseId: 'gemini-msg-1',
			usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 2, totalTokenCount: 3 },
		});
		const fetchMock = vi.fn(
			async () =>
				new Response(body, {
					status: 200,
					headers: {
						'Content-Type': 'application/json',
						'http_x_reqid': 'qiniu-req-abc',
					},
				})
		);
		vi.stubGlobal('fetch', fetchMock);

		const result = await dispatchGeminiRoute(minimalRoute({}), {}, 'generateContent', '');
		assert.equal(result.upstreamRequestId, 'qiniu-req-abc');
		const usage = await result.usagePromise;
		assert.equal(usage.upstreamMessageId, 'gemini-msg-1');
	});

	it('parses body requestId when proxy adds it', async () => {
		const body = JSON.stringify({
			responseId: 'gemini-msg-2',
			requestId: 'proxy-req-2',
			usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
		});
		const fetchMock = vi.fn(
			async () =>
				new Response(body, {
					status: 200,
					headers: { 'Content-Type': 'application/json' },
				})
		);
		vi.stubGlobal('fetch', fetchMock);

		const result = await dispatchGeminiRoute(minimalRoute({}), {}, 'generateContent', '');
		assert.equal(result.upstreamRequestId, null);
		const usage = await result.usagePromise;
		assert.equal(usage.upstreamMessageId, 'gemini-msg-2');
		assert.equal(usage.upstreamBodyRequestId, 'proxy-req-2');
	});
});

describe('dispatchGeminiRoute invalid thought signature retry', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	const historyBody = {
		contents: [
			{ role: 'user', parts: [{ text: 'hi' }] },
			{
				role: 'model',
				parts: [{ functionCall: { name: 'read_files', args: {} }, thoughtSignature: 'foreign-sig' }],
			},
			{ role: 'user', parts: [{ functionResponse: { name: 'read_files', response: {} } }] },
		],
	};
	const invalidSignatureBody = JSON.stringify({
		error: { code: 400, message: 'Invalid thought signature.', status: 'INVALID_ARGUMENT' },
	});
	const okBody = JSON.stringify({
		usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
	});

	it('retries once on the same upstream with placeholder signatures', async () => {
		let n = 0;
		const fetchMock = vi.fn(async () => {
			n += 1;
			return n === 1
				? new Response(invalidSignatureBody, { status: 400, headers: { 'Content-Type': 'application/json' } })
				: new Response(okBody, { status: 200, headers: { 'Content-Type': 'application/json' } });
		});
		vi.stubGlobal('fetch', fetchMock);

		const result = await dispatchGeminiRoute(minimalRoute({}), historyBody, 'generateContent', '');

		assert.equal(fetchMock.mock.calls.length, 2);
		assert.equal(result.response.status, 200);
		const first = JSON.parse((fetchMock.mock.calls[0].arguments as unknown as [string, RequestInit])[1].body as string);
		const second = JSON.parse((fetchMock.mock.calls[1].arguments as unknown as [string, RequestInit])[1].body as string);
		assert.equal(first.contents[1].parts[0].thoughtSignature, 'foreign-sig');
		assert.equal(second.contents[1].parts[0].thoughtSignature, 'skip_thought_signature_validator');
		assert.equal(
			(fetchMock.mock.calls[0].arguments as unknown as [string])[0],
			(fetchMock.mock.calls[1].arguments as unknown as [string])[0]
		);
	});

	it('does not retry for unrelated 400 errors', async () => {
		const fetchMock = vi.fn(
			async () => new Response(JSON.stringify({ error: { message: 'bad request' } }), { status: 400 })
		);
		vi.stubGlobal('fetch', fetchMock);

		const result = await dispatchGeminiRoute(minimalRoute({}), historyBody, 'generateContent', '');

		assert.equal(fetchMock.mock.calls.length, 1);
		assert.equal(result.response.status, 400);
	});

	it('does not retry when the request carries no signature', async () => {
		const fetchMock = vi.fn(async () => new Response(invalidSignatureBody, { status: 400 }));
		vi.stubGlobal('fetch', fetchMock);

		const result = await dispatchGeminiRoute(
			minimalRoute({}),
			{ contents: [{ role: 'user', parts: [{ text: 'hi' }] }] },
			'generateContent',
			''
		);

		assert.equal(fetchMock.mock.calls.length, 1);
		assert.equal(result.response.status, 400);
		assert.match(await result.response.text(), /Invalid thought signature/);
	});

	it('retries at most once', async () => {
		const fetchMock = vi.fn(async () => new Response(invalidSignatureBody, { status: 400 }));
		vi.stubGlobal('fetch', fetchMock);

		const result = await dispatchGeminiRoute(minimalRoute({}), historyBody, 'generateContent', '');

		assert.equal(fetchMock.mock.calls.length, 2);
		assert.equal(result.response.status, 400);
	});
});
