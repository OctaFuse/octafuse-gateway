import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	OAUTH_ACCESS_TOKEN_PREFIX,
	oauthAccessTokenHint,
	oauthAccessTokenStatus,
	coerceOAuthAccessTokenScopesInput,
	coerceOAuthAccessTokenTtlInput,
	generateOAuthAccessTokenSecret,
	hashOAuthAccessToken,
	isOAuthAccessTokenValue,
	isPathAllowedForOAuthAccessTokenScopes,
	parseOAuthAccessTokenScopes,
} from './oauth-access-tokens';

describe('access token secrets', () => {
	it('generates oat_ prefixed unique urlsafe secrets', () => {
		const a = generateOAuthAccessTokenSecret();
		const b = generateOAuthAccessTokenSecret();
		assert.ok(a.startsWith(OAUTH_ACCESS_TOKEN_PREFIX));
		assert.notEqual(a, b);
		assert.match(a.slice(OAUTH_ACCESS_TOKEN_PREFIX.length), /^[A-Za-z0-9_-]{43}$/);
		assert.ok(isOAuthAccessTokenValue(a));
		assert.ok(!isOAuthAccessTokenValue('sk-abc'));
	});

	it('hashes deterministically and exposes only the last 4 chars as hint', async () => {
		const secret = 'oat_exampleSecretValue1234';
		assert.equal(await hashOAuthAccessToken(secret), await hashOAuthAccessToken(secret));
		assert.match(await hashOAuthAccessToken(secret), /^[0-9a-f]{64}$/);
		assert.equal(oauthAccessTokenHint(secret), '1234');
	});
});

describe('access token scopes and ttl', () => {
	it('parses stored scopes with a safe default', () => {
		assert.deepEqual(parseOAuthAccessTokenScopes('["mcp"]'), ['mcp']);
		assert.deepEqual(parseOAuthAccessTokenScopes(null), ['mcp']);
		assert.deepEqual(parseOAuthAccessTokenScopes('[]'), ['mcp']);
		assert.deepEqual(parseOAuthAccessTokenScopes('nope'), ['mcp']);
	});

	it('validates scope input', () => {
		assert.deepEqual(coerceOAuthAccessTokenScopesInput(undefined), { ok: true, value: ['mcp'] });
		assert.deepEqual(coerceOAuthAccessTokenScopesInput(['mcp', 'mcp']), { ok: true, value: ['mcp'] });
		assert.equal(coerceOAuthAccessTokenScopesInput([]).ok, false);
		assert.equal(coerceOAuthAccessTokenScopesInput(['admin']).ok, false);
		assert.equal(coerceOAuthAccessTokenScopesInput('mcp').ok, false);
	});

	it('validates ttl input', () => {
		assert.deepEqual(coerceOAuthAccessTokenTtlInput(undefined), { ok: true, value: 3600 });
		assert.deepEqual(coerceOAuthAccessTokenTtlInput(120), { ok: true, value: 120 });
		assert.equal(coerceOAuthAccessTokenTtlInput(10).ok, false);
		assert.equal(coerceOAuthAccessTokenTtlInput(1.5).ok, false);
		assert.equal(coerceOAuthAccessTokenTtlInput('3600').ok, false);
		assert.equal(coerceOAuthAccessTokenTtlInput(99999999).ok, false);
	});

	it('limits the mcp scope to /mcp paths', () => {
		assert.ok(isPathAllowedForOAuthAccessTokenScopes(['mcp'], '/mcp'));
		assert.ok(isPathAllowedForOAuthAccessTokenScopes(['mcp'], '/mcp/soloent-insight'));
		assert.ok(!isPathAllowedForOAuthAccessTokenScopes(['mcp'], '/mcpx'));
		assert.ok(!isPathAllowedForOAuthAccessTokenScopes(['mcp'], '/v1/chat/completions'));
		assert.ok(!isPathAllowedForOAuthAccessTokenScopes([], '/mcp'));
	});
});

describe('access token status', () => {
	const now = Date.parse('2026-10-30T12:00:00.000Z');
	it('derives revoked / expired / active', () => {
		assert.equal(oauthAccessTokenStatus({ revoked_at: '2026-10-30T10:00:00.000Z', expires_at: null }, now), 'revoked');
		assert.equal(
			oauthAccessTokenStatus({ revoked_at: null, expires_at: '2026-10-30T11:00:00.000Z' }, now),
			'expired'
		);
		assert.equal(oauthAccessTokenStatus({ revoked_at: null, expires_at: '2026-10-30T13:00:00.000Z' }, now), 'active');
	});
});
