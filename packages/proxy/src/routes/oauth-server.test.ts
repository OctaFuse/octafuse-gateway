/**
 * 内置授权服务器端到端：真实 D1 迁移 + 共享 SQL 仓储（node:sqlite），走完
 * 发现 → 注册 → 授权 → 内置确认页 → 换令牌 → 使用 → 刷新 → 撤销，并覆盖授权码重放、刷新令牌重放、应用停用、外部同意页模式。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { URL } from 'node:url';
import {
	createOAuthAccessTokensSqlRepository,
	createOAuthServerSqlRepository,
	hashOAuthAccessToken,
	s256Challenge,
	type SqlExec,
	type StorageContext,
} from '@octafuse/core';
import { createProxyApp } from '../app';

const ISSUER = 'https://gw.example.com';
const VERIFIER = 'v'.repeat(50);
const SK = 'sk-user-one';
const REDIRECT = 'http://127.0.0.1:4455/callback';

const userRow = (id: string, status = 'active') => ({
	id,
	email: `${id}@example.com`,
	budget_max: 10,
	budget_base: 10,
	budget_spent: 0,
	budget_period: 'none',
	budget_reset_at: null,
	wallet_granted: 0,
	wallet_spent: 0,
	status,
	metadata: null,
	rate_limit: null,
	charged_cost_factors: null,
	external_system: null,
	external_user_id: null,
	created_at: '2026-01-01 00:00:00',
	updated_at: '2026-01-01 00:00:00',
});

function keyRowFor(userId: string) {
	return {
		id: `key-${userId}`, key: SK, user_id: userId, name: null, status: 'active', metadata: null, last_used_at: null,
		rate_limit: null, created_at: '2026-01-01 00:00:00', updated_at: '2026-01-01 00:00:00',
		user_email: `${userId}@example.com`, user_metadata: null, user_charged_cost_factors: null, user_rate_limit: null,
		budget_max: 10, budget_base: 10, budget_spent: 0, budget_period: 'none', budget_reset_at: null,
		wallet_granted: 0, wallet_spent: 0,
	};
}

async function makeApp(config: Record<string, string> = { MCP_OAUTH_ISSUER: ISSUER }) {
	const db = new DatabaseSync(':memory:');
	db.exec('CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT);');
	db.exec('CREATE TABLE api_key_request_logs (id TEXT PRIMARY KEY, api_key_id TEXT);');
	for (const name of ['0035_oauth_access_tokens', '0036_oauth_authorization_server']) {
		db.exec(readFileSync(new URL(`../../../core/migrations-d1/${name}.sql`, import.meta.url), 'utf8'));
	}
	db.prepare('INSERT INTO users (id, email) VALUES (?, ?)').run('user-1', 'user-1@example.com');
	const exec: SqlExec = async (query, params) => {
		const statement = db.prepare(query);
		if (/^\s*(select|with)\b/i.test(query)) return statement.all(...(params as never[])) as Array<Record<string, unknown>>;
		statement.run(...(params as never[]));
		return [];
	};
	const oauthServer = createOAuthServerSqlRepository(exec);
	const oauthAccessTokens = createOAuthAccessTokensSqlRepository(exec);
	await oauthServer.insertApp({
		id: 'app-codex', slug: 'codex', name: 'Codex', redirectUris: ['http://127.0.0.1/callback'],
		clientNamePatterns: [], enabled: true, nowIso: '2026-01-01T00:00:00.000Z',
	});
	const users = new Map([['user-1', userRow('user-1')], ['banned', userRow('banned', 'disabled')]]);
	const app = createProxyApp(async () => {
		const storage = {
			client: {},
			repositories: {
				oauthServer,
				oauthAccessTokens,
				apiKeys: { getApiKeyWithUserByKey: async (key: string) => (key === SK ? keyRowFor('user-1') : null) },
				users: { getById: async (id: string) => users.get(id) ?? null },
				mcpServers: { listCallable: async () => [] },
				systemConfig: { getConfig: async (key: string) => config[key] ?? null },
			},
		};
		return storage as unknown as StorageContext;
	});
	return { app, oauthServer, oauthAccessTokens, config };
}

type Ctx = Awaited<ReturnType<typeof makeApp>>;

const postJson = (ctx: Ctx, path: string, body: unknown) =>
	ctx.app.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const postForm = (ctx: Ctx, path: string, body: Record<string, string>, headers: Record<string, string> = {}) =>
	ctx.app.request(path, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
		body: new URLSearchParams(body).toString(),
	});

async function registerClient(ctx: Ctx, name = 'Codex CLI') {
	const res = await postJson(ctx, '/oauth/register', { client_name: name, redirect_uris: [REDIRECT] });
	assert.equal(res.status, 201);
	return (await res.json()) as { client_id: string };
}

async function authorizeUrl(clientId: string, extra: Record<string, string> = {}) {
	const params = new URLSearchParams({
		client_id: clientId, redirect_uri: REDIRECT, response_type: 'code', state: 'st1',
		code_challenge: await s256Challenge(VERIFIER), code_challenge_method: 'S256', resource: `${ISSUER}/mcp`, ...extra,
	});
	return `/oauth/authorize?${params.toString()}`;
}

/** 走到确认页并同意，返回授权码。 */
async function approve(ctx: Ctx, clientId: string): Promise<string> {
	const auth = await ctx.app.request(await authorizeUrl(clientId));
	assert.equal(auth.status, 302);
	const consent = new URL(auth.headers.get('location') as string);
	assert.equal(consent.origin + consent.pathname, `${ISSUER}/oauth/consent`);
	const requestId = consent.searchParams.get('request_id') as string;
	const page = await ctx.app.request(`/oauth/consent?request_id=${requestId}`);
	assert.equal(page.status, 200);
	assert.match(await page.text(), /Codex/);
	const done = await postForm(ctx, '/oauth/consent', { request_id: requestId, decision: 'approve', api_key: SK });
	assert.equal(done.status, 303);
	const back = new URL(done.headers.get('location') as string);
	assert.equal(back.origin + back.pathname, REDIRECT);
	assert.equal(back.searchParams.get('state'), 'st1');
	assert.equal(back.searchParams.get('iss'), ISSUER);
	return back.searchParams.get('code') as string;
}

const tokenRequest = (ctx: Ctx, code: string, clientId: string, over: Record<string, string> = {}) =>
	postForm(ctx, '/oauth/token', {
		grant_type: 'authorization_code', code, code_verifier: VERIFIER, client_id: clientId, redirect_uri: REDIRECT, ...over,
	});

describe('built-in authorization server', () => {
	it('is invisible when disabled', async () => {
		const ctx = await makeApp({});
		assert.equal((await ctx.app.request('/.well-known/oauth-authorization-server')).status, 404);
		assert.equal((await postJson(ctx, '/oauth/register', { redirect_uris: [REDIRECT] })).status, 404);
		assert.equal((await ctx.app.request('/oauth/consent?request_id=x')).status, 404);
	});

	it('publishes metadata and points MCP discovery at itself', async () => {
		const ctx = await makeApp();
		const meta = await ctx.app.request('/.well-known/oauth-authorization-server');
		assert.equal(meta.status, 200);
		const json = (await meta.json()) as { issuer: string; token_endpoint: string };
		assert.equal(json.issuer, ISSUER);
		assert.equal(json.token_endpoint, `${ISSUER}/oauth/token`);
		const resource = await ctx.app.request('/.well-known/oauth-protected-resource/mcp', { headers: { host: 'gw.example.com' } });
		assert.deepEqual(((await resource.json()) as { authorization_servers: string[] }).authorization_servers, [ISSUER]);
		const unauth = await ctx.app.request('/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
		assert.equal(unauth.status, 401);
		assert.match(unauth.headers.get('www-authenticate') ?? '', /resource_metadata=/);
	});

	it('registers only clients whose callbacks belong to an enabled app', async () => {
		const ctx = await makeApp();
		const ok = await registerClient(ctx);
		const client = await ctx.oauthServer.getClient(ok.client_id);
		assert.equal(client?.app_id, 'app-codex');
		const bad = await postJson(ctx, '/oauth/register', { client_name: 'Evil', redirect_uris: ['https://evil.example/cb'] });
		assert.equal(bad.status, 400);
		assert.equal(((await bad.json()) as { error: string }).error, 'invalid_redirect_uri');
		const noUris = await postJson(ctx, '/oauth/register', { client_name: 'x' });
		assert.equal(noUris.status, 400);
		const secret = await postJson(ctx, '/oauth/register', {
			client_name: 'x', redirect_uris: [REDIRECT], token_endpoint_auth_method: 'client_secret_basic',
		});
		assert.equal(((await secret.json()) as { error: string }).error, 'invalid_client_metadata');
	});

	it('runs the full flow: authorize, consent, token, MCP use, refresh, revoke', async () => {
		const ctx = await makeApp();
		const { client_id } = await registerClient(ctx);
		const code = await approve(ctx, client_id);

		const res = await tokenRequest(ctx, code, client_id);
		assert.equal(res.status, 200);
		const tokens = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number; token_type: string };
		assert.equal(tokens.token_type, 'Bearer');
		assert.equal(tokens.expires_in, 3600);
		assert.match(tokens.access_token, /^oat_/);
		assert.match(tokens.refresh_token, /^ort_/);

		const grant = await ctx.oauthAccessTokens.getByHash(await hashOAuthAccessToken(tokens.access_token));
		assert.equal(grant?.app_id, 'app-codex');
		assert.equal(grant?.user_id, 'user-1');
		// 访问令牌可用于 /mcp，不能用于其它入口
		const mcp = await ctx.app.request('/mcp', {
			method: 'POST',
			headers: { Authorization: `Bearer ${tokens.access_token}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
		});
		assert.notEqual(mcp.status, 401);
		assert.equal((await ctx.app.request('/v1/models', { headers: { Authorization: `Bearer ${tokens.access_token}` } })).status, 403);

		const refreshed = await postForm(ctx, '/oauth/token', {
			grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id,
		});
		assert.equal(refreshed.status, 200);
		const next = (await refreshed.json()) as { access_token: string; refresh_token: string };
		assert.notEqual(next.refresh_token, tokens.refresh_token);
		assert.equal(await ctx.oauthAccessTokens.getByHash(await hashOAuthAccessToken(tokens.access_token)), null);

		const revoked = await postForm(ctx, '/oauth/revoke', { token: next.refresh_token, client_id });
		assert.equal(revoked.status, 200);
		const after = await ctx.app.request('/mcp', {
			method: 'POST',
			headers: { Authorization: `Bearer ${next.access_token}`, 'Content-Type': 'application/json' },
			body: '{}',
		});
		assert.equal(after.status, 401);
		assert.match(after.headers.get('www-authenticate') ?? '', /invalid_token/);
		assert.equal((await postForm(ctx, '/oauth/revoke', { token: 'oat_unknown' })).status, 200, 'unknown token still 200');
	});

	it('rejects replayed codes, wrong verifiers, wrong clients and wrong redirect uris', async () => {
		const ctx = await makeApp();
		const { client_id } = await registerClient(ctx);
		const other = await registerClient(ctx, 'Codex Two');

		const code = await approve(ctx, client_id);
		assert.equal((await tokenRequest(ctx, code, client_id)).status, 200);
		const replay = await tokenRequest(ctx, code, client_id);
		assert.equal(replay.status, 400);
		assert.equal(((await replay.json()) as { error: string }).error, 'invalid_grant');

		const code2 = await approve(ctx, client_id);
		assert.equal((await tokenRequest(ctx, code2, client_id, { code_verifier: 'w'.repeat(50) })).status, 400);
		assert.equal((await tokenRequest(ctx, code2, client_id)).status, 400, 'code is single-use even after a failed attempt');

		const code3 = await approve(ctx, client_id);
		assert.equal((await tokenRequest(ctx, code3, other.client_id)).status, 400);
		const code4 = await approve(ctx, client_id);
		assert.equal((await tokenRequest(ctx, code4, client_id, { redirect_uri: 'http://127.0.0.1:9999/callback' })).status, 400);
	});

	it('treats a replayed refresh token as theft and revokes the whole grant', async () => {
		const ctx = await makeApp();
		const { client_id } = await registerClient(ctx);
		const first = (await (await tokenRequest(ctx, await approve(ctx, client_id), client_id)).json()) as {
			refresh_token: string;
		};
		const second = (await (
			await postForm(ctx, '/oauth/token', { grant_type: 'refresh_token', refresh_token: first.refresh_token, client_id })
		).json()) as { access_token: string; refresh_token: string };

		const replay = await postForm(ctx, '/oauth/token', { grant_type: 'refresh_token', refresh_token: first.refresh_token, client_id });
		assert.equal(replay.status, 400);
		const legit = await postForm(ctx, '/oauth/token', { grant_type: 'refresh_token', refresh_token: second.refresh_token, client_id });
		assert.equal(legit.status, 400, 'grant was revoked by the replay');
		assert.equal(await ctx.oauthAccessTokens.getByHash(await hashOAuthAccessToken(second.access_token)), null);
	});

	it('stops issuing tokens for a disabled app', async () => {
		const ctx = await makeApp();
		const { client_id } = await registerClient(ctx);
		const tokens = (await (await tokenRequest(ctx, await approve(ctx, client_id), client_id)).json()) as { refresh_token: string };
		await ctx.oauthServer.updateApp('app-codex', { enabled: false }, new Date().toISOString());
		const refresh = await postForm(ctx, '/oauth/token', { grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id });
		assert.equal(refresh.status, 400);
		const auth = await ctx.app.request(await authorizeUrl(client_id));
		assert.equal(auth.status, 400);
		assert.equal((await postJson(ctx, '/oauth/register', { client_name: 'x', redirect_uris: [REDIRECT] })).status, 400);
	});

	it('validates authorize parameters and redirects recoverable errors', async () => {
		const ctx = await makeApp();
		const { client_id } = await registerClient(ctx);
		const badRedirect = await ctx.app.request(await authorizeUrl(client_id, { redirect_uri: 'https://evil.example/cb' }));
		assert.equal(badRedirect.status, 400, 'unregistered redirect_uri is never redirected to');
		const noPkce = await ctx.app.request(await authorizeUrl(client_id, { code_challenge_method: 'plain' }));
		assert.equal(noPkce.status, 302);
		assert.equal(new URL(noPkce.headers.get('location') as string).searchParams.get('error'), 'invalid_request');
		const badResource = await ctx.app.request(await authorizeUrl(client_id, { resource: 'https://other.example/mcp' }));
		assert.equal(new URL(badResource.headers.get('location') as string).searchParams.get('error'), 'invalid_target');
		assert.equal((await ctx.app.request('/oauth/authorize?client_id=nope')).status, 400);
	});

	it('consent: wrong key re-renders, deny redirects with access_denied, request is single-decision', async () => {
		const ctx = await makeApp();
		const { client_id } = await registerClient(ctx);
		const auth = await ctx.app.request(await authorizeUrl(client_id));
		const requestId = new URL(auth.headers.get('location') as string).searchParams.get('request_id') as string;

		const wrong = await postForm(ctx, '/oauth/consent', { request_id: requestId, decision: 'approve', api_key: 'sk-wrong' });
		assert.equal(wrong.status, 200);
		assert.match(await wrong.text(), /invalid/i);

		const denied = await postForm(ctx, '/oauth/consent', { request_id: requestId, decision: 'deny' });
		assert.equal(denied.status, 303);
		assert.equal(new URL(denied.headers.get('location') as string).searchParams.get('error'), 'access_denied');
		const again = await postForm(ctx, '/oauth/consent', { request_id: requestId, decision: 'approve', api_key: SK });
		assert.equal(again.status, 409);
	});

	it('redirects to the external consent page when configured and disables the built-in page', async () => {
		const ctx = await makeApp({ MCP_OAUTH_ISSUER: ISSUER, MCP_OAUTH_CONSENT_URL: 'https://portal.example.com/oauth/consent' });
		const { client_id } = await registerClient(ctx);
		const auth = await ctx.app.request(await authorizeUrl(client_id));
		const location = new URL(auth.headers.get('location') as string);
		assert.equal(location.origin + location.pathname, 'https://portal.example.com/oauth/consent');
		const requestId = location.searchParams.get('request_id') as string;
		assert.ok(requestId);
		assert.equal((await ctx.app.request(`/oauth/consent?request_id=${requestId}`)).status, 404);
		assert.equal((await postForm(ctx, '/oauth/consent', { request_id: requestId, decision: 'approve', api_key: SK })).status, 404);
	});

	it('falls back to external-authorization-server mode when no issuer is set', async () => {
		const ctx = await makeApp({ MCP_OAUTH_AUTHORIZATION_SERVER: 'https://portal.example.com' });
		assert.equal((await ctx.app.request('/.well-known/oauth-authorization-server')).status, 404);
		const resource = await ctx.app.request('/.well-known/oauth-protected-resource/mcp', { headers: { host: 'gw.example.com' } });
		assert.deepEqual(((await resource.json()) as { authorization_servers: string[] }).authorization_servers, ['https://portal.example.com']);
	});
});
