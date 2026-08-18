import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { afterEach, describe, it } from 'node:test';
import { applyVertexOpenAiModelPrefix, clearGcpServiceAccountTokenCache, GCP_OAUTH_TOKEN_URL } from '@octafuse/core';
import type { PlaygroundResolvedRoute } from './playground-service';
import { applyPlaygroundUpstreamCredential, buildPlaygroundGeminiUpstreamRequest } from './playground-service';

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

afterEach(() => {
	globalThis.fetch = originalFetch;
	clearGcpServiceAccountTokenCache();
});

function route(base: string, apiKey: string): PlaygroundResolvedRoute {
	return {
		upstreamProtocol: 'gemini',
		upstreamOperation: 'generateContent',
		adapter: 'passthrough',
		providerEndpoints: { gemini: { base } },
		providerId: 'p1',
		providerApiKey: apiKey,
		providerModelName: 'gemini-2.5-flash',
		customParams: null,
		isImageModel: false,
		isAudioModel: false,
	};
}

describe('buildPlaygroundGeminiUpstreamRequest', () => {
	it('uses query key for official Gemini upstream', () => {
		const result = buildPlaygroundGeminiUpstreamRequest(
			route('https://generativelanguage.googleapis.com/v1beta/models', 'provider-key'),
			'generateContent'
		);
		const u = new URL(result.url);
		assert.equal(u.searchParams.get('key'), 'provider-key');
		assert.equal(result.headers.Authorization, undefined);
	});

	it('uses configured bearer for ZenMux Vertex prefix', () => {
		const result = buildPlaygroundGeminiUpstreamRequest(
			{
				...route('https://zenmux.ai/api/vertex-ai/v1/publishers/google/models', 'zm-key'),
				providerEndpoints: {
					gemini: {
						base: 'https://zenmux.ai/api/vertex-ai/v1/publishers/google/models',
						auth: 'bearer',
					},
				},
			},
			'generateContent'
		);
		const u = new URL(result.url);
		assert.equal(u.searchParams.has('key'), false);
		assert.equal(result.headers.Authorization, 'Bearer zm-key');
	});

	it('uses Authorization Bearer when gemini.auth is bearer', () => {
		const result = buildPlaygroundGeminiUpstreamRequest(
			{
				...route('https://api.qnaigc.com//bypass/vertex/v1/models', 'provider-token'),
				providerEndpoints: {
					gemini: {
						base: 'https://api.qnaigc.com//bypass/vertex/v1/models',
						auth: 'bearer',
					},
				},
			},
			'streamGenerateContent'
		);
		const u = new URL(result.url);
		assert.equal(
			u.pathname,
			'/bypass/vertex/v1/models/gemini-2.5-flash:streamGenerateContent'
		);
		assert.equal(u.searchParams.has('key'), false);
		assert.equal(u.searchParams.get('alt'), 'sse');
		assert.equal(result.headers.Authorization, 'Bearer provider-token');
	});

	it('forces Bearer and never puts service account JSON in ?key=', () => {
		const result = buildPlaygroundGeminiUpstreamRequest(
			{
				...route(
					'https://aiplatform.googleapis.com/v1/projects/demo/locations/global/publishers/google/models',
					SERVICE_ACCOUNT_JSON
				),
				providerEndpoints: {
					gemini: {
						base: 'https://aiplatform.googleapis.com/v1/projects/demo/locations/global/publishers/google/models',
						auth: 'query-key',
					},
				},
			},
			'generateContent'
		);
		const u = new URL(result.url);
		assert.equal(u.searchParams.has('key'), false);
		assert.equal(result.headers.Authorization, `Bearer ${SERVICE_ACCOUNT_JSON}`);
	});
});

describe('applyPlaygroundUpstreamCredential', () => {
	it('exchanges a service account for an access token and forces Gemini bearer', async () => {
		globalThis.fetch = (async (input) => {
			assert.equal(String(input), GCP_OAUTH_TOKEN_URL);
			return new Response(JSON.stringify({ access_token: 'ya29.playground', expires_in: 3600 }), {
				status: 200,
			});
		}) as typeof fetch;

		const resolved = await applyPlaygroundUpstreamCredential(
			route(
				'https://aiplatform.googleapis.com/v1/projects/demo/locations/global/publishers/google/models',
				SERVICE_ACCOUNT_JSON
			)
		);
		assert.equal(resolved.providerApiKey, 'ya29.playground');
		assert.equal(resolved.providerEndpoints.gemini?.auth, 'bearer');

		const request = buildPlaygroundGeminiUpstreamRequest(resolved, 'generateContent');
		const u = new URL(request.url);
		assert.equal(u.searchParams.has('key'), false);
		assert.equal(request.headers.Authorization, 'Bearer ya29.playground');
	});
});

describe('Vertex OpenAI playground model prefix', () => {
	it('adds google/ only on official openapi chat URLs', () => {
		assert.equal(
			applyVertexOpenAiModelPrefix(
				'https://aiplatform.googleapis.com/v1/projects/demo/locations/global/endpoints/openapi/chat/completions',
				'gemini-2.5-flash'
			),
			'google/gemini-2.5-flash'
		);
	});
});
