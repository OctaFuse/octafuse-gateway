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
	hashOAuthSecret,
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
	for (const name of ['0035_oauth_access_tokens', '0036_oauth_authorization_server', '0037_oauth_client_credentials']) {
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

/** 授权地址；`extra` 里值为空串的参数会被去掉（用于模拟不带 PKCE）。 */
async function authorizeUrl(clientId: string, extra: Record<string, string> = {}) {
	const params = new URLSearchParams({
		client_id: clientId, redirect_uri: REDIRECT, response_type: 'code', state: 'st1',
		code_challenge: await s256Challenge(VERIFIER), code_challenge_method: 'S256', resource: `${ISSUER}/mcp`, ...extra,
	});
	for (const [key, value] of Object.entries(extra)) if (value === '') params.delete(key);
	return `/oauth/authorize?${params.toString()}`;
}

/** 走到确认页并同意，返回授权码。 */
async function approve(
	ctx: Ctx,
	clientId: string,
	options: { redirect?: string; extra?: Record<string, string>; expectName?: RegExp } = {}
): Promise<string> {
	const redirect = options.redirect ?? REDIRECT;
	const auth = await ctx.app.request(await authorizeUrl(clientId, { redirect_uri: redirect, ...options.extra }));
	assert.equal(auth.status, 302, await auth.clone().text());
	const consent = new URL(auth.headers.get('location') as string);
	assert.equal(consent.origin + consent.pathname, `${ISSUER}/oauth/consent`);
	const requestId = consent.searchParams.get('request_id') as string;
	const page = await ctx.app.request(`/oauth/consent?request_id=${requestId}`);
	assert.equal(page.status, 200);
	assert.match(await page.text(), options.expectName ?? /Codex/);
	const done = await postForm(ctx, '/oauth/consent', { request_id: requestId, decision: 'approve', api_key: SK });
	assert.equal(done.status, 303);
	const back = new URL(done.headers.get('location') as string);
	assert.equal(back.origin + back.pathname, new URL(redirect).origin + new URL(redirect).pathname);
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
		const jwt = await postJson(ctx, '/oauth/register', {
			client_name: 'x', redirect_uris: [REDIRECT], token_endpoint_auth_method: 'private_key_jwt',
		});
		assert.equal(((await jwt.json()) as { error: string }).error, 'invalid_client_metadata');
		const wildcard = await postJson(ctx, '/oauth/register', { client_name: 'x', redirect_uris: ['https://*.example.com/cb'] });
		assert.equal(((await wildcard.json()) as { error: string }).error, 'invalid_redirect_uri', 'clients cannot register wildcard callbacks');
	});

	it('serves discovery documents on the path variants clients probe', async () => {
		const ctx = await makeApp();
		for (const path of [
			'/.well-known/oauth-authorization-server/mcp',
			'/.well-known/oauth-authorization-server/mcp/insight',
			'/mcp/.well-known/oauth-authorization-server',
		]) {
			const res = await ctx.app.request(path);
			assert.equal(res.status, 200, path);
			const meta = (await res.json()) as { issuer: string; token_endpoint_auth_methods_supported: string[] };
			assert.equal(meta.issuer, ISSUER);
			assert.deepEqual(meta.token_endpoint_auth_methods_supported, ['none', 'client_secret_basic', 'client_secret_post']);
		}
		const resource = await ctx.app.request('/mcp/.well-known/oauth-protected-resource', { headers: { host: 'gw.example.com' } });
		assert.equal(resource.status, 200);
		assert.deepEqual(((await resource.json()) as { authorization_servers: string[] }).authorization_servers, [ISSUER]);
		const unauth = await ctx.app.request('/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
		assert.match(unauth.headers.get('www-authenticate') ?? '', /scope="mcp"/);
	});

	it('registers loopback-localhost and private-use scheme callbacks for matching apps', async () => {
		const ctx = await makeApp();
		await ctx.oauthServer.insertApp({
			id: 'app-cursor', slug: 'cursor', name: 'Cursor', redirectUris: ['cursor://anysphere.cursor-mcp/oauth/callback'],
			clientNamePatterns: [], enabled: true, nowIso: '2026-01-01T00:00:00.000Z',
		});
		await ctx.oauthServer.insertApp({
			id: 'app-local', slug: 'local', name: 'Local clients', redirectUris: ['http://localhost/*', 'http://127.0.0.1/*'],
			clientNamePatterns: [], enabled: true, nowIso: '2026-01-01T00:00:00.000Z',
		});
		const cursor = await postJson(ctx, '/oauth/register', {
			client_name: 'Cursor', redirect_uris: ['cursor://anysphere.cursor-mcp/oauth/callback'],
		});
		assert.equal(cursor.status, 201);
		assert.equal((await ctx.oauthServer.getClient(((await cursor.json()) as { client_id: string }).client_id))?.app_id, 'app-cursor');
		const cli = await postJson(ctx, '/oauth/register', { client_name: 'Some CLI', redirect_uris: ['http://localhost:51234/callback'] });
		assert.equal(cli.status, 201);
		const cliId = ((await cli.json()) as { client_id: string }).client_id;
		assert.equal((await ctx.oauthServer.getClient(cliId))?.app_id, 'app-local');
		// Codex 应用的具体地址比通用应用的通配更精确
		const codex = await registerClient(ctx, 'Unknown name');
		assert.equal((await ctx.oauthServer.getClient(codex.client_id))?.app_id, 'app-codex');
		// localhost 回调可以换端口
		const code = await approve(ctx, cliId, { redirect: 'http://localhost:60000/callback', expectName: /Local clients|Some CLI/ });
		const token = await tokenRequest(ctx, code, cliId, { redirect_uri: 'http://localhost:60000/callback' });
		assert.equal(token.status, 200);
	});

	it('supports confidential clients registered dynamically, with or without PKCE', async () => {
		const ctx = await makeApp();
		const reg = await postJson(ctx, '/oauth/register', {
			client_name: 'Codex server', redirect_uris: [REDIRECT], token_endpoint_auth_method: 'client_secret_post',
		});
		assert.equal(reg.status, 201);
		const { client_id, client_secret, token_endpoint_auth_method } = (await reg.json()) as {
			client_id: string; client_secret: string; token_endpoint_auth_method: string;
		};
		assert.match(client_secret, /^ocs_/);
		assert.equal(token_endpoint_auth_method, 'client_secret_post');
		const stored = await ctx.oauthServer.getClient(client_id);
		assert.notEqual(stored?.client_secret_hash, client_secret, 'only the hash is stored');

		const noPkce = { code_challenge: '', code_challenge_method: '' };
		const code = await approve(ctx, client_id, { extra: noPkce });
		const missing = await tokenRequest(ctx, code, client_id, { code_verifier: '' });
		assert.equal(missing.status, 401);
		assert.equal(((await missing.json()) as { error: string }).error, 'invalid_client');

		const code2 = await approve(ctx, client_id, { extra: noPkce });
		const ok = await tokenRequest(ctx, code2, client_id, { code_verifier: '', client_secret });
		assert.equal(ok.status, 200);
		const { refresh_token } = (await ok.json()) as { refresh_token: string };

		// Basic 认证同样可用；错误的 secret 带 WWW-Authenticate
		const basic = (secret: string) => `Basic ${btoa(`${encodeURIComponent(client_id)}:${encodeURIComponent(secret)}`)}`;
		const wrong = await postForm(ctx, '/oauth/token', { grant_type: 'refresh_token', refresh_token }, { Authorization: basic('ocs_wrong') });
		assert.equal(wrong.status, 401);
		assert.match(wrong.headers.get('www-authenticate') ?? '', /^Basic/);
		const refreshed = await postForm(ctx, '/oauth/token', { grant_type: 'refresh_token', refresh_token }, { Authorization: basic(client_secret) });
		assert.equal(refreshed.status, 200);

		// 带了 PKCE 就照常校验
		const code3 = await approve(ctx, client_id);
		assert.equal((await tokenRequest(ctx, code3, client_id, { client_secret, code_verifier: 'w'.repeat(50) })).status, 400);
	});

	it('accepts manual clients issued by an admin for an app with wildcard callbacks', async () => {
		const ctx = await makeApp();
		await ctx.oauthServer.insertApp({
			id: 'app-wb', slug: 'workbuddy', name: 'WorkBuddy', redirectUris: ['https://*.workbuddy.cn', 'https://*.tencent.com'],
			clientNamePatterns: [], enabled: true, nowIso: '2026-01-01T00:00:00.000Z',
		});
		const secret = 'ocs_manual-secret';
		await ctx.oauthServer.insertClient({
			clientId: 'octa_manual', appId: 'app-wb', clientName: 'Tencent connector', redirectUris: [],
			nowIso: '2026-01-01T00:00:00.000Z', registrationMethod: 'manual', tokenEndpointAuthMethod: 'client_secret_basic',
			clientSecretHash: await hashOAuthSecret(secret),
		});
		const redirect = 'https://connector.workbuddy.cn/oauth/callback';
		const evil = await ctx.app.request(await authorizeUrl('octa_manual', { redirect_uri: 'https://evil.example/cb' }));
		assert.equal(evil.status, 400);
		const code = await approve(ctx, 'octa_manual', {
			redirect, extra: { code_challenge: '', code_challenge_method: '' }, expectName: /WorkBuddy|Tencent connector/,
		});
		const token = await postForm(
			ctx,
			'/oauth/token',
			{ grant_type: 'authorization_code', code, redirect_uri: redirect },
			{ Authorization: `Basic ${btoa(`octa_manual:${secret}`)}` }
		);
		assert.equal(token.status, 200);
		const grant = await ctx.oauthAccessTokens.getByHash(
			await hashOAuthAccessToken(((await token.json()) as { access_token: string }).access_token)
		);
		assert.equal(grant?.app_id, 'app-wb');
	});

	it('accepts client ID metadata documents only when enabled', async () => {
		const metadataUrl = 'https://agent.example.com/oauth/client.json';
		const off = await makeApp();
		const disabled = await off.app.request(await authorizeUrl(metadataUrl));
		assert.equal(disabled.status, 400);
		assert.equal(((await disabled.json()) as { error: string }).error, 'invalid_client');

		const ctx = await makeApp({ MCP_OAUTH_ISSUER: ISSUER, MCP_OAUTH_CIMD_ENABLED: 'true' });
		const meta = (await (await ctx.app.request('/.well-known/oauth-authorization-server')).json()) as {
			client_id_metadata_document_supported: boolean;
		};
		assert.equal(meta.client_id_metadata_document_supported, true);

		const originalFetch = globalThis.fetch;
		let fetches = 0;
		globalThis.fetch = (async (input: RequestInfo | URL) => {
			fetches += 1;
			assert.equal(String(input), metadataUrl);
			return new Response(JSON.stringify({ client_id: metadataUrl, client_name: 'Codex via CIMD', redirect_uris: [REDIRECT] }), {
				status: 200,
				headers: { 'content-type': 'application/json' },
			});
		}) as typeof fetch;
		try {
			const code = await approve(ctx, metadataUrl);
			const client = await ctx.oauthServer.getClient(metadataUrl);
			assert.equal(client?.registration_method, 'cimd');
			assert.equal(client?.app_id, 'app-codex');
			assert.equal((await tokenRequest(ctx, code, metadataUrl)).status, 200);
			await approve(ctx, metadataUrl);
			assert.equal(fetches, 1, 'fresh metadata is reused');
		} finally {
			globalThis.fetch = originalFetch;
		}
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
