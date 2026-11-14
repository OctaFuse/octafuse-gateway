/**
 * 应用目录与授权请求的管理服务，用 node:sqlite 跑真实 D1 迁移与共享 SQL 仓储。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { createRequire } from 'node:module';
import { URL } from 'node:url';
import {
	createOAuthAccessTokensSqlRepository,
	createOAuthServerSqlRepository,
	hashAuthorizationRequestId,
	type GatewayRepositories,
	type SqlExec,
} from '@octafuse/core';
import { isAdminServiceError } from './errors';
import {
	acceptOAuthAuthorizationRequest,
	createOAuthApp,
	deleteOAuthApp,
	getAuthorizationRequest,
	isOAuthAuthorizationRequestError,
	listOAuthApps,
	rejectOAuthAuthorizationRequest,
	revokeOAuthAppGrants,
	revokeUserOAuthGrants,
	updateOAuthApp,
} from './oauth-server-service';

// admin 包的 @types/node 较旧，没有 node:sqlite 的类型声明；这里只用到下面这几个方法。
type SqliteStatement = { all: (...params: unknown[]) => unknown[]; run: (...params: unknown[]) => unknown };
type SqliteDb = { exec: (sql: string) => void; prepare: (sql: string) => SqliteStatement };
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
	DatabaseSync: new (path: string) => SqliteDb;
};

const USER = '8f14e45f-ceea-4e67-a1b2-3c4d5e6f7a8b';
const ISSUER = 'https://gw.example.com';

function setup(config: Record<string, string> = { MCP_OAUTH_ISSUER: ISSUER }) {
	const db = new DatabaseSync(':memory:');
	db.exec('CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT);');
	db.exec('CREATE TABLE api_key_request_logs (id TEXT PRIMARY KEY, api_key_id TEXT);');
	for (const name of ['0035_oauth_access_tokens', '0036_oauth_authorization_server']) {
		db.exec(readFileSync(new URL(`../../../../core/migrations-d1/${name}.sql`, import.meta.url), 'utf8'));
	}
	db.prepare('INSERT INTO users (id, email) VALUES (?, ?)').run(USER, 'a@example.com');
	const exec: SqlExec = async (query, params) => {
		const statement = db.prepare(query);
		if (/^\s*(select|with)\b/i.test(query)) return statement.all(...(params as never[])) as Array<Record<string, unknown>>;
		statement.run(...(params as never[]));
		return [];
	};
	const oauthServer = createOAuthServerSqlRepository(exec);
	const oauthAccessTokens = createOAuthAccessTokensSqlRepository(exec);
	const repos = {
		oauthServer,
		oauthAccessTokens,
		users: {
			getById: async (id: string) => (id === USER ? { id: USER, status: 'active' } : null),
			getByExternalPair: async () => null,
		},
		systemConfig: { getConfig: async (key: string) => config[key] ?? null },
	} as unknown as GatewayRepositories;
	return { repos, oauthServer, oauthAccessTokens };
}

const nowIso = () => new Date().toISOString();

async function rejects(promise: Promise<unknown>, status: number, code?: string) {
	await assert.rejects(promise, (error) => {
		if (isAdminServiceError(error)) return error.status === status;
		if (isOAuthAuthorizationRequestError(error)) return error.status === status && (!code || error.code === code);
		return false;
	});
}

async function pendingRequest(ctx: ReturnType<typeof setup>, over: { appEnabled?: boolean } = {}) {
	const app = await createOAuthApp(ctx.repos, {
		slug: 'codex', name: 'Codex', redirect_uris: ['http://127.0.0.1/callback'], enabled: over.appEnabled ?? true,
	});
	await ctx.oauthServer.insertClient({
		clientId: 'c1', appId: app.id, clientName: 'Codex', redirectUris: ['http://127.0.0.1:1/callback'], nowIso: nowIso(),
	});
	await ctx.oauthServer.insertRequest({
		idHash: await hashAuthorizationRequestId('req-secret'), clientId: 'c1', redirectUri: 'http://127.0.0.1:1/callback',
		codeChallenge: 'x'.repeat(43), resource: null, state: 'st', scope: 'mcp',
		expiresAt: new Date(Date.now() + 600_000).toISOString(), nowIso: nowIso(),
	});
	return app;
}

describe('authorization requests', () => {
	it('describes a pending request with the app name', async () => {
		const ctx = setup();
		await pendingRequest(ctx);
		const view = await getAuthorizationRequest(ctx.repos, 'req-secret');
		assert.equal(view.status, 'pending');
		assert.equal(view.app_name, 'Codex');
		assert.equal(view.client_id, 'c1');
		await rejects(getAuthorizationRequest(ctx.repos, 'nope'), 404, 'request_not_found');
	});

	it('accepts once, returns a callback with code / state / iss, and refuses a second decision', async () => {
		const ctx = setup();
		await pendingRequest(ctx);
		const { redirect_uri } = await acceptOAuthAuthorizationRequest(ctx.repos, 'req-secret', { user_id: USER });
		const url = new URL(redirect_uri);
		assert.ok(url.searchParams.get('code'));
		assert.equal(url.searchParams.get('state'), 'st');
		assert.equal(url.searchParams.get('iss'), ISSUER);
		await rejects(acceptOAuthAuthorizationRequest(ctx.repos, 'req-secret', { user_id: USER }), 409, 'request_not_pending');
		await rejects(rejectOAuthAuthorizationRequest(ctx.repos, 'req-secret'), 409, 'request_not_pending');
		assert.equal((await getAuthorizationRequest(ctx.repos, 'req-secret')).status, 'approved');
	});

	it('rejects with access_denied', async () => {
		const ctx = setup();
		await pendingRequest(ctx);
		const { redirect_uri } = await rejectOAuthAuthorizationRequest(ctx.repos, 'req-secret');
		assert.equal(new URL(redirect_uri).searchParams.get('error'), 'access_denied');
		assert.equal((await getAuthorizationRequest(ctx.repos, 'req-secret')).status, 'denied');
	});

	it('validates the user and the app, and needs built-in mode', async () => {
		const ctx = setup();
		await pendingRequest(ctx);
		await rejects(acceptOAuthAuthorizationRequest(ctx.repos, 'req-secret', {}), 400);
		await rejects(acceptOAuthAuthorizationRequest(ctx.repos, 'req-secret', { user_id: '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed' }), 404);

		const disabled = setup();
		await pendingRequest(disabled, { appEnabled: false });
		await rejects(acceptOAuthAuthorizationRequest(disabled.repos, 'req-secret', { user_id: USER }), 403, 'app_unavailable');

		const off = setup({});
		await rejects(getAuthorizationRequest(off.repos, 'req-secret'), 503, 'oauth_disabled');
	});
});

describe('application directory', () => {
	it('validates input and rejects duplicate slugs', async () => {
		const { repos } = setup();
		await rejects(createOAuthApp(repos, { slug: 'Bad Slug', name: 'x' }), 400);
		await rejects(createOAuthApp(repos, { slug: 'ok', name: '' }), 400);
		await rejects(createOAuthApp(repos, { slug: 'ok', name: 'x', redirect_uris: ['ftp://x'] }), 400);
		await createOAuthApp(repos, { slug: 'ok', name: 'OK', redirect_uris: ['https://ok.example/cb'] });
		await rejects(createOAuthApp(repos, { slug: 'ok', name: 'dup' }), 409);
		await rejects(updateOAuthApp(repos, 'missing', { name: 'x' }), 404);
	});

	it('re-attributes unattributed clients when the directory changes', async () => {
		const ctx = setup();
		await ctx.oauthServer.insertClient({
			clientId: 'orphan', appId: null, clientName: 'Doubao', redirectUris: ['https://doubao.example/cb'], nowIso: nowIso(),
		});
		const app = await createOAuthApp(ctx.repos, { slug: 'doubao', name: 'Doubao', redirect_uris: ['https://doubao.example/cb'] });
		assert.equal((await ctx.oauthServer.getClient('orphan'))?.app_id, app.id);
	});

	it('summarises apps with stats and groups legacy grants as unattributed', async () => {
		const ctx = setup();
		const app = await createOAuthApp(ctx.repos, { slug: 'codex', name: 'Codex', redirect_uris: ['http://127.0.0.1/callback'] });
		const base = {
			userId: USER, scopes: ['mcp'], expiresAt: new Date(Date.now() + 3600_000).toISOString(), nowIso: nowIso(), tokenHint: 'x',
		};
		await ctx.oauthAccessTokens.issue({ ...base, id: 't1', clientId: 'c1', clientName: 'Codex', tokenHash: 'h1', appId: app.id });
		await ctx.oauthAccessTokens.issue({ ...base, id: 't2', clientId: 'old', clientName: 'ChatGPT', tokenHash: 'h2' });
		const overview = await listOAuthApps(ctx.repos);
		assert.equal(overview.apps[0]?.live_count, 1);
		assert.equal(overview.apps[0]?.user_count, 1);
		assert.deepEqual(overview.unattributed.map((s) => s.app_name), ['ChatGPT']);
	});

	it('revokes by app, by unattributed group and by user; deleting an app revokes its grants', async () => {
		const ctx = setup();
		const app = await createOAuthApp(ctx.repos, { slug: 'codex', name: 'Codex', redirect_uris: ['http://127.0.0.1/callback'] });
		const base = {
			userId: USER, scopes: ['mcp'], expiresAt: new Date(Date.now() + 3600_000).toISOString(), nowIso: nowIso(), tokenHint: 'x',
		};
		await ctx.oauthAccessTokens.issue({ ...base, id: 't1', clientId: 'c1', clientName: 'Codex', tokenHash: 'h1', appId: app.id });
		await ctx.oauthAccessTokens.issue({ ...base, id: 't2', clientId: 'old', clientName: 'ChatGPT', tokenHash: 'h2' });
		await ctx.oauthAccessTokens.issue({ ...base, id: 't3', clientId: 'old2', clientName: 'Claude', tokenHash: 'h3' });

		await rejects(revokeOAuthAppGrants(ctx.repos, 'none', {}), 400);
		await rejects(revokeOAuthAppGrants(ctx.repos, 'missing', {}), 404);
		assert.deepEqual(await revokeOAuthAppGrants(ctx.repos, 'none', { client_name: 'ChatGPT' }), { revoked: 1 });
		assert.deepEqual(await revokeOAuthAppGrants(ctx.repos, app.id, {}), { revoked: 1 });
		assert.deepEqual(await revokeUserOAuthGrants(ctx.repos, USER), { revoked: 1 });
		await rejects(revokeUserOAuthGrants(ctx.repos, '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed'), 404);

		await ctx.oauthAccessTokens.issue({ ...base, id: 't4', clientId: 'c1', clientName: 'Codex', tokenHash: 'h4', appId: app.id });
		assert.deepEqual(await deleteOAuthApp(ctx.repos, app.id), { revoked: 1 });
		assert.equal((await listOAuthApps(ctx.repos)).apps.length, 0);
		await rejects(deleteOAuthApp(ctx.repos, app.id), 404);
	});
});
