import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { afterEach, describe, it } from 'node:test';
import { clearGcpServiceAccountTokenCache, GCP_OAUTH_TOKEN_URL } from '@octafuse/core';
import type { RouteResult } from '../model-router';
import { dispatchGeminiRoute } from './gemini-driver';
import { dispatchOpenAiRoute } from './openai-driver';

const { privateKey } = generateKeyPairSync('rsa', {
	modulusLength: 2048,
	publicKeyEncoding: { type: 'spki', format: 'pem' },
	privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const SERVICE_ACCOUNT_JSON = JSON.stringify({
	type: 'service_account',
	client_email: 'vertex@demo.iam.gserviceaccount.com',
	private_key: privateKey,
});

const originalFetch = globalThis.fetch;

function stubFetch(handler: typeof fetch): void {
	globalThis.fetch = handler;
}

afterEach(() => {
	globalThis.fetch = originalFetch;
	clearGcpServiceAccountTokenCache();
});

function route(overrides: Partial<RouteResult>): RouteResult {
	return {
		targetId: 't1',
		modelSurfaceId: null,
		routePoolId: null,
		providerId: 'p1',
		providerName: 'Vertex',
		providerModelName: 'gemini-2.5-flash',
		upstreamProtocol: 'openai',
		upstreamOperation: 'chat',
		adapter: 'passthrough',
		providerEndpoints: {},
		providerApiKey: SERVICE_ACCOUNT_JSON,
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

function tokenThenUpstreamFetch(): { fetchImpl: typeof fetch; upstream: { url: string; init: RequestInit }[] } {
	const upstream: { url: string; init: RequestInit }[] = [];
	const fetchImpl: typeof fetch = async (input, init) => {
		const url = String(input);
		if (url === GCP_OAUTH_TOKEN_URL) {
			return new Response(JSON.stringify({ access_token: 'ya29.sa-token', expires_in: 3600 }), { status: 200 });
		}
		upstream.push({ url, init: init ?? {} });
		return new Response('{}', { status: 400 });
	};
	return { fetchImpl, upstream };
}

describe('Vertex service account egress', () => {
	it('sends Vertex OpenAI a Bearer access token and prefixes google/', async () => {
		const { fetchImpl, upstream } = tokenThenUpstreamFetch();
		stubFetch(fetchImpl);
		await dispatchOpenAiRoute(
			route({
				providerEndpoints: {
					openai: {
						endpoints: {
							chat: 'https://aiplatform.googleapis.com/v1/projects/demo/locations/global/endpoints/openapi/chat/completions',
						},
					},
				},
			}),
			{ messages: [{ role: 'user', content: 'hi' }] }
		);
		assert.equal(upstream.length, 1);
		assert.match(upstream[0].url, /\/endpoints\/openapi\/chat\/completions$/);
		const headers = upstream[0].init.headers as Record<string, string>;
		assert.equal(headers.Authorization, 'Bearer ya29.sa-token');
		const body = JSON.parse(String(upstream[0].init.body)) as { model: string };
		assert.equal(body.model, 'google/gemini-2.5-flash');
		assert.equal(upstream[0].url.includes(SERVICE_ACCOUNT_JSON), false);
	});

	it('forces Gemini Bearer and never puts the service account JSON in ?key=', async () => {
		const { fetchImpl, upstream } = tokenThenUpstreamFetch();
		stubFetch(fetchImpl);
		await dispatchGeminiRoute(
			route({
				upstreamProtocol: 'gemini',
				upstreamOperation: 'models.generate',
				providerEndpoints: {
					gemini: {
						base: 'https://aiplatform.googleapis.com/v1/projects/demo/locations/global/publishers/google/models',
						auth: 'query-key',
					},
				},
			}),
			{},
			'generateContent',
			''
		);
		assert.equal(upstream.length, 1);
		const called = new URL(upstream[0].url);
		assert.equal(called.searchParams.has('key'), false);
		assert.equal(called.pathname.endsWith('/models/gemini-2.5-flash:generateContent'), true);
		assert.equal(called.pathname.includes('/google/gemini-2.5-flash'), false);
		const headers = upstream[0].init.headers as Record<string, string>;
		assert.equal(headers.Authorization, 'Bearer ya29.sa-token');
	});
});
