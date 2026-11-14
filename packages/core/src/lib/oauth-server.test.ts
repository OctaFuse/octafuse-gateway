import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	buildAuthorizeErrorRedirect,
	buildAuthorizeSuccessRedirect,
	buildOAuthAuthorizationServerMetadata,
	generateRefreshToken,
	hashOAuthSecret,
	isRedirectUriAllowed,
	isRefreshTokenValue,
	matchOAuthApp,
	s256Challenge,
	validateAuthorizeParams,
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
	it('allows loopback callbacks on any port', () => {
		assert.equal(isRedirectUriAllowed('http://127.0.0.1:9999/callback', ['http://127.0.0.1/callback']), true);
		assert.equal(isRedirectUriAllowed('http://localhost:9999/callback', ['http://127.0.0.1/callback']), false);
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
	});
	it('prefers builtin over external and treats invalid values as unset', () => {
		assert.deepEqual(resolveMcpOAuthMode({}), { mode: 'off' });
		assert.deepEqual(resolveMcpOAuthMode({ authorizationServer: 'https://portal.example/path' }), {
			mode: 'external',
			authorizationServer: 'https://portal.example',
		});
		assert.deepEqual(
			resolveMcpOAuthMode({ issuer: 'https://gw.example', authorizationServer: 'https://portal.example', consentUrl: 'https://portal.example/oauth/consent' }),
			{ mode: 'builtin', issuer: 'https://gw.example', consentUrl: 'https://portal.example/oauth/consent' }
		);
		assert.deepEqual(resolveMcpOAuthMode({ issuer: 'http://gw.example', authorizationServer: 'not a url' }), { mode: 'off' });
		assert.deepEqual(resolveMcpOAuthMode({ issuer: 'https://gw.example', consentUrl: 'http://evil.example/x' }), {
			mode: 'builtin',
			issuer: 'https://gw.example',
			consentUrl: null,
		});
	});
});
