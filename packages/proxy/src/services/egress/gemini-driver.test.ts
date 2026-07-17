import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RouteResult } from '../model-router';
import { dispatchGeminiRoute } from './gemini-driver';

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

		const [calledUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		const u = new URL(calledUrl);
		expect(u.searchParams.get('key')).toBe('provider-key');
		expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
	});

	it('uses Authorization Bearer for qnaigc bypass upstream', async () => {
		const fetchMock = vi.fn(async () => new Response('{}', { status: 400 }));
		vi.stubGlobal('fetch', fetchMock);

		await dispatchGeminiRoute(
			minimalRoute({
				providerEndpoints: {
					gemini: { base: 'https://api.qnaigc.com//bypass/vertex/v1/models' },
				},
				providerApiKey: 'bearer-token',
			}),
			{},
			'generateContent',
			''
		);

		const [calledUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		const u = new URL(calledUrl);
		expect(u.pathname).toBe('/bypass/vertex/v1/models/gemini-2.5-flash:generateContent');
		expect(calledUrl).toBe(
			'https://api.qnaigc.com/bypass/vertex/v1/models/gemini-2.5-flash:generateContent'
		);
		expect(u.searchParams.has('key')).toBe(false);
		expect((init.headers as Record<string, string>).Authorization).toBe('Bearer bearer-token');
	});

	it('uses Authorization Bearer and alt=sse for modelink stream upstream', async () => {
		const fetchMock = vi.fn(async () => new Response('data: {}\n\n', { status: 200 }));
		vi.stubGlobal('fetch', fetchMock);

		await dispatchGeminiRoute(
			minimalRoute({
				providerEndpoints: {
					gemini: { base: 'https://api.modelink.ai/bypass/vertex/v1/models' },
				},
				providerApiKey: 'modelink-token',
			}),
			{},
			'streamGenerateContent',
			''
		);

		const [calledUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		const u = new URL(calledUrl);
		expect(u.searchParams.has('key')).toBe(false);
		expect(u.searchParams.get('alt')).toBe('sse');
		expect((init.headers as Record<string, string>).Authorization).toBe('Bearer modelink-token');
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
		expect(result.upstreamRequestId).toBe('qiniu-req-abc');
		const usage = await result.usagePromise;
		expect(usage.upstreamMessageId).toBe('gemini-msg-1');
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
		expect(result.upstreamRequestId).toBeNull();
		const usage = await result.usagePromise;
		expect(usage.upstreamMessageId).toBe('gemini-msg-2');
		expect(usage.upstreamBodyRequestId).toBe('proxy-req-2');
	});
});
