import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { afterEach, describe, it } from 'node:test';
import {
	clearGcpServiceAccountTokenCache,
	GCP_CLOUD_PLATFORM_SCOPE,
	GCP_OAUTH_TOKEN_URL,
	isGcpServiceAccountJson,
	parseGcpServiceAccountJson,
	resolveProviderUpstreamSecret,
} from './gcp-service-account-token';
import { fingerprintProviderApiKey, maskProviderApiKeyForAdmin } from './db/provider-key-utils';
import { prepareGeminiUpstreamFetch, resolveGeminiAuthForUpstreamSecret } from './gemini-upstream-url';

const { privateKey } = generateKeyPairSync('rsa', {
	modulusLength: 2048,
	publicKeyEncoding: { type: 'spki', format: 'pem' },
	privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const SERVICE_ACCOUNT_JSON = JSON.stringify({
	type: 'service_account',
	project_id: 'demo',
	client_email: 'vertex@demo.iam.gserviceaccount.com',
	private_key: privateKey,
});

function decodeJwtPayload(assertion: string): Record<string, unknown> {
	const payload = assertion.split('.')[1];
	assert.ok(payload);
	return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
}

afterEach(() => {
	clearGcpServiceAccountTokenCache();
});

describe('parseGcpServiceAccountJson', () => {
	it('recognizes a service account JSON', () => {
		const parsed = parseGcpServiceAccountJson(SERVICE_ACCOUNT_JSON);
		assert.ok(parsed);
		assert.equal(parsed.client_email, 'vertex@demo.iam.gserviceaccount.com');
		assert.equal(isGcpServiceAccountJson(SERVICE_ACCOUNT_JSON), true);
	});

	it('rejects ordinary API keys and incomplete JSON', () => {
		assert.equal(parseGcpServiceAccountJson('sk-vertex-api-key'), null);
		assert.equal(isGcpServiceAccountJson('sk-vertex-api-key'), false);
		assert.equal(parseGcpServiceAccountJson('{"type":"service_account"}'), null);
		assert.equal(
			parseGcpServiceAccountJson(
				JSON.stringify({ type: 'authorized_user', client_email: 'x', private_key: privateKey })
			),
			null
		);
	});
});

describe('resolveProviderUpstreamSecret', () => {
	it('returns ordinary keys unchanged', async () => {
		const resolved = await resolveProviderUpstreamSecret('sk-plain');
		assert.deepEqual(resolved, { secret: 'sk-plain', isServiceAccount: false });
	});

	it('exchanges a JWT assertion for an access token and caches it', async () => {
		let tokenCalls = 0;
		const fetchImpl: typeof fetch = async (input, init) => {
			tokenCalls += 1;
			assert.equal(String(input), GCP_OAUTH_TOKEN_URL);
			const body = String(init?.body ?? '');
			const params = new URLSearchParams(body);
			assert.equal(params.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
			const assertion = params.get('assertion') ?? '';
			const claims = decodeJwtPayload(assertion);
			assert.equal(claims.iss, 'vertex@demo.iam.gserviceaccount.com');
			assert.equal(claims.aud, GCP_OAUTH_TOKEN_URL);
			assert.equal(claims.scope, GCP_CLOUD_PLATFORM_SCOPE);
			return new Response(JSON.stringify({ access_token: 'ya29.cached', expires_in: 3600 }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			});
		};

		const first = await resolveProviderUpstreamSecret(SERVICE_ACCOUNT_JSON, { fetchImpl, nowMs: () => 1_000 });
		const second = await resolveProviderUpstreamSecret(SERVICE_ACCOUNT_JSON, { fetchImpl, nowMs: () => 60_000 });
		assert.equal(first.isServiceAccount, true);
		assert.equal(first.secret, 'ya29.cached');
		assert.equal(first.clientEmail, 'vertex@demo.iam.gserviceaccount.com');
		assert.equal(second.secret, 'ya29.cached');
		assert.equal(tokenCalls, 1);
	});

	it('refreshes when the cached token is within the skew window', async () => {
		let tokenCalls = 0;
		const fetchImpl: typeof fetch = async () => {
			tokenCalls += 1;
			return new Response(JSON.stringify({ access_token: `ya29.${tokenCalls}`, expires_in: 3600 }), {
				status: 200,
			});
		};
		const t0 = 10_000_000;
		await resolveProviderUpstreamSecret(SERVICE_ACCOUNT_JSON, { fetchImpl, nowMs: () => t0 });
		await resolveProviderUpstreamSecret(SERVICE_ACCOUNT_JSON, {
			fetchImpl,
			nowMs: () => t0 + 56 * 60 * 1000,
		});
		assert.equal(tokenCalls, 2);
	});
});

describe('provider key masking for service accounts', () => {
	it('does not leak the private key', () => {
		assert.equal(maskProviderApiKeyForAdmin(SERVICE_ACCOUNT_JSON), 'sa:vertex@demo.iam.gserviceaccount.com');
		assert.equal(fingerprintProviderApiKey(SERVICE_ACCOUNT_JSON), 'sa:….com');
		assert.equal(maskProviderApiKeyForAdmin(SERVICE_ACCOUNT_JSON).includes('BEGIN'), false);
		assert.equal(fingerprintProviderApiKey('sk-1234567890'), '…7890');
	});
});

describe('resolveGeminiAuthForUpstreamSecret', () => {
	it('forces bearer for service accounts and keeps query-key for ordinary keys', () => {
		assert.equal(resolveGeminiAuthForUpstreamSecret('query-key', true), 'bearer');
		assert.equal(resolveGeminiAuthForUpstreamSecret(undefined, true), 'bearer');
		assert.equal(resolveGeminiAuthForUpstreamSecret('query-key', false), 'query-key');
		assert.equal(resolveGeminiAuthForUpstreamSecret(undefined, false), 'query-key');
	});

	it('does not put service account JSON into ?key=', () => {
		const { url, headers } = prepareGeminiUpstreamFetch({
			baseUrl: 'https://aiplatform.googleapis.com/v1/projects/p/locations/global/publishers/google/models',
			modelName: 'gemini-2.5-flash',
			action: 'generateContent',
			apiKey: SERVICE_ACCOUNT_JSON,
			auth: resolveGeminiAuthForUpstreamSecret('query-key', true),
		});
		assert.equal(url.searchParams.has('key'), false);
		assert.equal(headers.Authorization, `Bearer ${SERVICE_ACCOUNT_JSON}`);
	});
});
