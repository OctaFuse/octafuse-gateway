import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	buildAuthorizeErrorRedirect,
	buildAuthorizeSuccessRedirect,
	buildOAuthAuthorizationServerMetadata,
	generateOAuthClientSecret,
	generateRefreshToken,
	hashOAuthSecret,
	isAcceptableRedirectUriShape,
	isConfidentialAuthMethod,
	isRedirectUriAllowed,
	isRefreshTokenValue,
	isValidRedirectUriRule,
	matchOAuthApp,
	parseBasicClientCredentials,
	redirectUriMatchSpecificity,
	redirectUrisMatch,
	s256Challenge,
	validateAuthorizeParams,
	verifyOAuthClientSecret,
	verifyPkceS256,
} from './oauth-server';
import { resolveMcpOAuthMode } from './mcp-oauth-system-config';

const apps = [
	{ id: 'codex', enabled: true, redirect_uris: ['http://127.0.0.1/callback'], client_name_patterns: ['codex'] },
	{ id: 'doubao', enabled: true, redirect_uris: ['http://127.0.0.1/callback'], client_name_patterns: ['doubao', '豆包'] },
	{ id: 'chatgpt', enabled: true, redirect_uris: ['https://chatgpt.com/connector/oauth/abc'], client_name_patterns: [] },
	{ id: 'off', enabled: false, redirect_uris: ['https://off.example/cb'], client_name_patterns: [] },
];

describe('oauth app matching', () => {
	it('matches by redirect uri and falls back to name patterns for shared callbacks', () => {
		assert.equal(matchOAuthApp(apps, { clientName: 'x', redirectUris: ['https://chatgpt.com/connector/oauth/abc'] }), 'chatgpt');
		assert.equal(matchOAuthApp(apps, { clientName: 'Codex CLI', redirectUris: ['http://127.0.0.1:5555/callback'] }), 'codex');
		assert.equal(matchOAuthApp(apps, { clientName: '豆包桌面版', redirectUris: ['http://127.0.0.1:6000/callback'] }), 'doubao');
	});
	it('rejects unknown, disabled and ambiguous clients', () => {
		assert.equal(matchOAuthApp(apps, { clientName: 'x', redirectUris: ['https://evil.example/cb'] }), null);
		assert.equal(matchOAuthApp(apps, { clientName: 'x', redirectUris: ['https://off.example/cb'] }), null);
		assert.equal(matchOAuthApp(apps, { clientName: 'unknown tool', redirectUris: ['http://127.0.0.1:1/callback'] }), null);
		assert.equal(matchOAuthApp(apps, { clientName: 'x', redirectUris: [] }), null);
	});
	it('allows loopback callbacks on any port, including localhost', () => {
		assert.equal(isRedirectUriAllowed('http://127.0.0.1:9999/callback', ['http://127.0.0.1/callback']), true);
		assert.equal(isRedirectUriAllowed('http://localhost:9999/callback', ['http://localhost/callback']), true);
		assert.equal(isRedirectUriAllowed('http://localhost:9999/callback', ['http://127.0.0.1/callback']), false);
		assert.equal(redirectUrisMatch('http://localhost:1/cb', 'http://localhost:2/cb'), true);
	});

	it('prefers exact apps over wildcard apps and lets a generic loopback app catch the rest', () => {
		const directory = [
			...apps,
			{ id: 'workbuddy', enabled: true, redirect_uris: ['http://127.0.0.1/oauth/callback', 'https://*.workbuddy.cn'], client_name_patterns: [] },
			{ id: 'local', enabled: true, redirect_uris: ['http://127.0.0.1/*', 'http://localhost/*'], client_name_patterns: [] },
		];
		assert.equal(matchOAuthApp(directory, { clientName: 'x', redirectUris: ['http://127.0.0.1:7000/oauth/callback'] }), 'workbuddy');
		assert.equal(matchOAuthApp(directory, { clientName: 'x', redirectUris: ['https://connector.workbuddy.cn/cb'] }), 'workbuddy');
		assert.equal(matchOAuthApp(directory, { clientName: 'unknown tool', redirectUris: ['http://127.0.0.1:1/callback'] }), 'local');
		assert.equal(matchOAuthApp(directory, { clientName: 'Codex', redirectUris: ['http://127.0.0.1:1/callback'] }), 'codex');
		assert.equal(matchOAuthApp(directory, { clientName: 'x', redirectUris: ['http://localhost:3000/anything'] }), 'local');
		// 一个客户端的全部回调必须落在同一个应用里
		assert.equal(
			matchOAuthApp(directory, { clientName: 'x', redirectUris: ['http://localhost:3000/cb', 'https://chatgpt.com/connector/oauth/abc'] }),
			null
		);
	});
});

describe('redirect uri shapes and rules', () => {
	it('accepts https, loopback http and private-use schemes for client-supplied callbacks', () => {
		assert.equal(isAcceptableRedirectUriShape('https://claude.ai/api/mcp/auth_callback'), true);
		assert.equal(isAcceptableRedirectUriShape('http://localhost:8080/callback'), true);
		assert.equal(isAcceptableRedirectUriShape('cursor://anysphere.cursor-mcp/oauth/callback'), true);
		assert.equal(isAcceptableRedirectUriShape('com.example.app:/oauth2redirect'), true);
		assert.equal(isAcceptableRedirectUriShape('http://example.com/cb'), false);
		assert.equal(isAcceptableRedirectUriShape('javascript:alert(1)'), false);
		assert.equal(isAcceptableRedirectUriShape('data:text/html,hi'), false);
		assert.equal(isAcceptableRedirectUriShape('https://a.example/cb#frag'), false);
		assert.equal(isAcceptableRedirectUriShape('https://user:pw@a.example/cb'), false);
		assert.equal(isAcceptableRedirectUriShape('https://*.example.com/cb'), false);
	});

	it('validates admin rules with controlled wildcards', () => {
		assert.equal(isValidRedirectUriRule('https://*.tencent.com'), true);
		assert.equal(isValidRedirectUriRule('https://*.tencent.com/oauth/*'), true);
		assert.equal(isValidRedirectUriRule('http://127.0.0.1/*'), true);
		assert.equal(isValidRedirectUriRule('cursor://anysphere.cursor-mcp/oauth/callback'), true);
		assert.equal(isValidRedirectUriRule('https://*.com/cb'), false);
		assert.equal(isValidRedirectUriRule('https://a*.example.com/cb'), false);
		assert.equal(isValidRedirectUriRule('https://app.*.example.com/cb'), false);
		assert.equal(isValidRedirectUriRule('https://app.example.com/*/cb'), false);
		assert.equal(isValidRedirectUriRule('http://*.example.com/cb'), false);
		assert.equal(isValidRedirectUriRule('javascript:alert(1)'), false);
	});

	it('matches wildcard hosts on subdomains only and wildcard paths by prefix', () => {
		const rules = ['https://*.tencent.com', 'https://app.example.com/oauth/*'];
		assert.equal(isRedirectUriAllowed('https://a.tencent.com/x/y?z=1', rules), true);
		assert.equal(isRedirectUriAllowed('https://a.b.tencent.com/cb', rules), true);
		assert.equal(isRedirectUriAllowed('https://tencent.com/cb', rules), false);
		assert.equal(isRedirectUriAllowed('https://eviltencent.com/cb', rules), false);
		assert.equal(isRedirectUriAllowed('https://a.tencent.com.evil.com/cb', rules), false);
		assert.equal(isRedirectUriAllowed('https://a.tencent.com:8443/cb', rules), false);
		assert.equal(isRedirectUriAllowed('https://app.example.com/oauth/callback?x=1', rules), true);
		assert.equal(isRedirectUriAllowed('https://app.example.com/other', rules), false);
		assert.equal(redirectUriMatchSpecificity('https://app.example.com/oauth/cb', ['https://app.example.com/oauth/cb', ...rules]), 2);
		assert.equal(redirectUriMatchSpecificity('https://app.example.com/oauth/cb', rules), 1);
	});
});

describe('client authentication helpers', () => {
	it('parses HTTP Basic client credentials with form-encoding', () => {
		const header = `Basic ${btoa(`${encodeURIComponent('octa_a b')}:${encodeURIComponent('s:e/c')}`)}`;
		assert.deepEqual(parseBasicClientCredentials(header), { clientId: 'octa_a b', clientSecret: 's:e/c' });
		assert.deepEqual(parseBasicClientCredentials(`Basic ${btoa('octa_x:')}`), { clientId: 'octa_x', clientSecret: '' });
		assert.equal(parseBasicClientCredentials('Bearer abc'), null);
		assert.equal(parseBasicClientCredentials(`Basic ${btoa('no-colon')}`), null);
	});

	it('verifies hashed client secrets', async () => {
		const secret = generateOAuthClientSecret();
		const hash = await hashOAuthSecret(secret);
		assert.equal(await verifyOAuthClientSecret(secret, hash), true);
		assert.equal(await verifyOAuthClientSecret(`${secret}x`, hash), false);
		assert.equal(await verifyOAuthClientSecret(secret, null), false);
		assert.equal(isConfidentialAuthMethod('client_secret_post'), true);
		assert.equal(isConfidentialAuthMethod('none'), false);
	});
});

describe('pkce and tokens', () => {
	it('verifies S256 challenges', async () => {
		const verifier = 'a'.repeat(43);
		const challenge = await s256Challenge(verifier);
		assert.equal(await verifyPkceS256(verifier, challenge), true);
		assert.equal(await verifyPkceS256('b'.repeat(43), challenge), false);
	});
	it('generates recognisable refresh tokens and hashes deterministically', async () => {
		const token = generateRefreshToken();
		assert.equal(isRefreshTokenValue(token), true);
		assert.equal(isRefreshTokenValue('sk-abc'), false);
		assert.equal(await hashOAuthSecret(token), await hashOAuthSecret(token));
	});
});

describe('authorize validation', () => {
	const client = { client_id: 'c1', app_id: 'a1', redirect_uris: ['http://127.0.0.1/callback'] };
	const base = {
		client_id: 'c1',
		redirect_uri: 'http://127.0.0.1:4000/callback',
		response_type: 'code',
		code_challenge: 'x'.repeat(43),
		code_challenge_method: 'S256',
		state: 's',
		resource: 'https://gw.example/mcp',
	};
	const run = (over: Record<string, string | undefined> = {}, allowed: string[] | null = ['http://127.0.0.1/callback']) => {
		const values = { ...base, ...over } as Record<string, string | undefined>;
		return validateAuthorizeParams((name) => values[name], {
			client,
			allowedRedirectUris: allowed,
			allowedResourceOrigins: ['https://gw.example'],
		});
	};
	it('accepts a valid request', () => {
		const result = run();
		assert.equal(result.ok, true);
	});
	it('rejects bad requests without redirecting for client / redirect errors', () => {
		const disabled = run({}, null);
		assert.equal(disabled.ok === false && disabled.redirectable, false);
		const badRedirect = run({ redirect_uri: 'https://evil.example/cb' });
		assert.equal(badRedirect.ok === false && badRedirect.redirectable, false);
		const noPkce = run({ code_challenge_method: 'plain' });
		assert.equal(noPkce.ok === false && noPkce.error, 'invalid_request');
		const badResource = run({ resource: 'https://other.example/mcp' });
		assert.equal(badResource.ok === false && badResource.error, 'invalid_target');
	});
	it('lets confidential clients skip PKCE but still rejects plain PKCE', () => {
		const values: Record<string, string | undefined> = { ...base, code_challenge: undefined, code_challenge_method: undefined };
		const check = (extra: Partial<typeof client> & { token_endpoint_auth_method?: string; registration_method?: string }, over = {}) =>
			validateAuthorizeParams((name) => ({ ...values, ...over } as Record<string, string | undefined>)[name], {
				client: { ...client, ...extra },
				allowedRedirectUris: ['http://127.0.0.1/callback'],
				allowedResourceOrigins: ['https://gw.example'],
			});
		assert.equal(check({}).ok, false);
		const confidential = check({ token_endpoint_auth_method: 'client_secret_basic' });
		assert.equal(confidential.ok && confidential.params.codeChallenge, '');
		const plain = check({ token_endpoint_auth_method: 'client_secret_basic' }, { code_challenge: 'x'.repeat(43), code_challenge_method: 'plain' });
		assert.equal(plain.ok, false);
	});
	it('matches manual clients against rules or the app allowlist', () => {
		const manual = (redirect_uris: string[], redirect: string) =>
			validateAuthorizeParams((name) => ({ ...base, redirect_uri: redirect } as Record<string, string | undefined>)[name], {
				client: { ...client, registration_method: 'manual', redirect_uris },
				allowedRedirectUris: ['https://*.workbuddy.cn'],
				allowedResourceOrigins: ['https://gw.example'],
			});
		assert.equal(manual([], 'https://a.workbuddy.cn/cb').ok, true);
		assert.equal(manual(['https://a.workbuddy.cn/*'], 'https://a.workbuddy.cn/cb').ok, true);
		assert.equal(manual(['https://a.workbuddy.cn/*'], 'https://b.workbuddy.cn/cb').ok, false);
		assert.equal(manual([], 'https://evil.example/cb').ok, false);
	});
	it('builds redirects with iss', () => {
		const ok = buildAuthorizeSuccessRedirect('http://127.0.0.1:4000/callback', 'abc', 's', 'https://gw.example');
		const url = new URL(ok);
		assert.equal(url.searchParams.get('code'), 'abc');
		assert.equal(url.searchParams.get('iss'), 'https://gw.example');
		const err = new URL(buildAuthorizeErrorRedirect('http://127.0.0.1:4000/callback', 'access_denied', 'no', 's', 'https://gw.example'));
		assert.equal(err.searchParams.get('error'), 'access_denied');
	});
});

describe('metadata and mode resolution', () => {
	it('advertises endpoints under the issuer', () => {
		const meta = buildOAuthAuthorizationServerMetadata('https://gw.example');
		assert.equal(meta.issuer, 'https://gw.example');
		assert.equal(meta.token_endpoint, 'https://gw.example/oauth/token');
		assert.deepEqual(meta.code_challenge_methods_supported, ['S256']);
		assert.deepEqual(meta.token_endpoint_auth_methods_supported, ['none', 'client_secret_basic', 'client_secret_post']);
		assert.equal(meta.client_id_metadata_document_supported, false);
		assert.equal(buildOAuthAuthorizationServerMetadata('https://gw.example', { clientIdMetadataDocuments: true }).client_id_metadata_document_supported, true);
	});
	it('prefers builtin over external and treats invalid values as unset', () => {
		assert.deepEqual(resolveMcpOAuthMode({}), { mode: 'off' });
		assert.deepEqual(resolveMcpOAuthMode({ authorizationServer: 'https://portal.example/path' }), {
			mode: 'external',
			authorizationServer: 'https://portal.example',
		});
		assert.deepEqual(
			resolveMcpOAuthMode({ issuer: 'https://gw.example', authorizationServer: 'https://portal.example', consentUrl: 'https://portal.example/oauth/consent' }),
			{ mode: 'builtin', issuer: 'https://gw.example', consentUrl: 'https://portal.example/oauth/consent', clientIdMetadataDocuments: false }
		);
		assert.deepEqual(resolveMcpOAuthMode({ issuer: 'http://gw.example', authorizationServer: 'not a url' }), { mode: 'off' });
		assert.deepEqual(resolveMcpOAuthMode({ issuer: 'https://gw.example', consentUrl: 'http://evil.example/x', cimdEnabled: 'true' }), {
			mode: 'builtin',
			issuer: 'https://gw.example',
			consentUrl: null,
			clientIdMetadataDocuments: true,
		});
	});
});
