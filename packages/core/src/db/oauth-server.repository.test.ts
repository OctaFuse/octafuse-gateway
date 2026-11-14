/**
 * 用 node:sqlite 跑真实的 D1 迁移（0035 + 0036）与共享 SQL 仓储：应用目录、注册实例、授权请求 / 授权码的原子消费，
 * 以及访问令牌上的刷新令牌轮换、重放检测、按应用统计与批量撤销。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { URL } from 'node:url';
import { createOAuthAccessTokensSqlRepository, type SqlExec } from './oauth-access-tokens.repository';
import { createOAuthServerSqlRepository } from './oauth-server.repository';

const MIGRATIONS = [
	new URL('../../migrations-d1/0035_oauth_access_tokens.sql', import.meta.url),
	new URL('../../migrations-d1/0036_oauth_authorization_server.sql', import.meta.url),
];

function setup() {
	const db = new DatabaseSync(':memory:');
	db.exec('CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT);');
	db.exec('CREATE TABLE api_key_request_logs (id TEXT PRIMARY KEY, api_key_id TEXT);');
	for (const migration of MIGRATIONS) db.exec(readFileSync(migration, 'utf8'));
	db.prepare('INSERT INTO users (id, email) VALUES (?, ?)').run('u1', 'a@example.com');
	db.prepare('INSERT INTO users (id, email) VALUES (?, ?)').run('u2', 'b@example.com');
	const exec: SqlExec = async (query, params) => {
		const statement = db.prepare(query);
		if (/^\s*(select|with)\b/i.test(query)) {
			return statement.all(...(params as never[])) as Array<Record<string, unknown>>;
		}
		statement.run(...(params as never[]));
		return [];
	};
	return { server: createOAuthServerSqlRepository(exec), tokens: createOAuthAccessTokensSqlRepository(exec) };
}

const T0 = '2026-11-01T00:00:00.000Z';
const T1 = '2026-11-01T00:05:00.000Z';
const T2 = '2026-11-01T00:20:00.000Z';
const HOUR = '2026-11-01T01:00:00.000Z';
const LATER = '2026-11-02T00:00:00.000Z';
const MONTH = '2026-12-01T00:00:00.000Z';

describe('oauth apps and clients', () => {
	it('manages the app directory and detaches clients on delete', async () => {
		const { server, tokens } = setup();
		const app = await server.insertApp({
			id: 'app-1',
			slug: 'codex',
			name: 'Codex',
			redirectUris: ['http://127.0.0.1/callback'],
			clientNamePatterns: ['codex'],
			enabled: true,
			nowIso: T0,
		});
		assert.deepEqual(app.redirect_uris, ['http://127.0.0.1/callback']);
		assert.equal(app.enabled, true);
		assert.equal((await server.getAppBySlug('codex'))?.id, 'app-1');
		const updated = await server.updateApp('app-1', { enabled: false, name: 'Codex CLI' }, T1);
		assert.equal(updated?.enabled, false);
		assert.equal(updated?.name, 'Codex CLI');

		await server.insertClient({ clientId: 'c1', appId: 'app-1', clientName: 'Codex', redirectUris: ['http://127.0.0.1/callback'], nowIso: T0 });
		await server.insertClient({ clientId: 'c2', appId: null, clientName: 'Mystery', redirectUris: ['https://x.example/cb'], nowIso: T0 });
		const counts = await server.countClientsByApp();
		assert.equal(counts.find((c) => c.app_id === 'app-1')?.client_count, 1);
		assert.equal((await server.listUnattributedClients(10)).length, 1);
		const listed = await server.listClients({ appId: 'app-1', page: 1, pageSize: 10, nowIso: T1 });
		assert.equal(listed.total, 1);
		assert.equal(listed.rows[0]?.live_grant_count, 0);

		await tokens.assignApp('c1', 'app-1');
		assert.equal(await server.deleteApp('app-1'), true);
		assert.equal((await server.getClient('c1'))?.app_id, null);
		assert.equal(await server.deleteApp('app-1'), false);
	});

	it('deletes only never-authorized stale clients', async () => {
		const { server, tokens } = setup();
		await server.insertClient({ clientId: 'old', appId: null, clientName: 'a', redirectUris: ['https://a/cb'], nowIso: T0 });
		await server.insertClient({ clientId: 'used', appId: null, clientName: 'b', redirectUris: ['https://b/cb'], nowIso: T0 });
		await server.insertClient({ clientId: 'granted', appId: null, clientName: 'c', redirectUris: ['https://c/cb'], nowIso: T0 });
		await server.insertClient({ clientId: 'fresh', appId: null, clientName: 'd', redirectUris: ['https://d/cb'], nowIso: LATER });
		await server.touchClientAuthorized('used', T1);
		await tokens.issue({
			id: 't1', userId: 'u1', clientId: 'granted', clientName: 'c', tokenHash: 'h1', tokenHint: 'x',
			scopes: ['mcp'], expiresAt: HOUR, nowIso: T1,
		});
		assert.equal(await server.deleteUnusedClients('2026-11-01T12:00:00.000Z'), 1);
		assert.equal(await server.getClient('old'), null);
		assert.ok(await server.getClient('used'));
		assert.ok(await server.getClient('granted'));
		assert.ok(await server.getClient('fresh'));
	});
});

describe('authorization requests and codes', () => {
	async function seeded() {
		const ctx = setup();
		await ctx.server.insertRequest({
			idHash: 'req-1', clientId: 'c1', redirectUri: 'http://127.0.0.1:1/cb', codeChallenge: 'chal',
			resource: null, state: 's', scope: 'mcp', expiresAt: T2, nowIso: T0,
		});
		return ctx;
	}

	it('approves once and rejects a second decision', async () => {
		const { server } = await seeded();
		assert.equal(await server.approveRequest('req-1', { userId: 'u1', codeHash: 'code-1', codeExpiresAt: T2, nowIso: T1 }), true);
		assert.equal(await server.approveRequest('req-1', { userId: 'u2', codeHash: 'code-2', codeExpiresAt: T2, nowIso: T1 }), false);
		assert.equal(await server.denyRequest('req-1', T1), false);
		assert.equal((await server.getRequest('req-1'))?.user_id, 'u1');
	});

	it('refuses to approve an expired request', async () => {
		const { server } = await seeded();
		assert.equal(await server.approveRequest('req-1', { userId: 'u1', codeHash: 'c', codeExpiresAt: LATER, nowIso: LATER }), false);
	});

	it('denies a pending request without issuing a code', async () => {
		const { server } = await seeded();
		assert.equal(await server.denyRequest('req-1', T1), true);
		const row = await server.getRequest('req-1');
		assert.equal(row?.code_hash, null);
		assert.equal(await server.approveRequest('req-1', { userId: 'u1', codeHash: 'c', codeExpiresAt: T2, nowIso: T1 }), false);
	});

	it('consumes a code exactly once and not after expiry', async () => {
		const { server } = await seeded();
		await server.approveRequest('req-1', { userId: 'u1', codeHash: 'code-1', codeExpiresAt: T2, nowIso: T1 });
		const first = await server.consumeCode('code-1', T1, `${T1}|m1`);
		assert.equal(first?.user_id, 'u1');
		assert.equal(first?.code_challenge, 'chal');
		assert.equal(await server.consumeCode('code-1', T1, `${T1}|m2`), null, 'replay');
		assert.equal(await server.consumeCode('missing', T1, `${T1}|m3`), null);

		await server.insertRequest({
			idHash: 'req-2', clientId: 'c1', redirectUri: 'http://127.0.0.1:1/cb', codeChallenge: 'chal',
			resource: null, state: null, scope: 'mcp', expiresAt: T2, nowIso: T0,
		});
		await server.approveRequest('req-2', { userId: 'u1', codeHash: 'code-2', codeExpiresAt: T2, nowIso: T1 });
		assert.equal(await server.consumeCode('code-2', LATER, `${LATER}|m4`), null, 'expired');
		await server.deleteExpiredRequests(LATER);
		assert.equal(await server.getRequest('req-2'), null);
	});
});

describe('refresh tokens, per-app stats and bulk revoke', () => {
	const issue = (tokens: ReturnType<typeof setup>['tokens'], over: Record<string, unknown> = {}) =>
		tokens.issue({
			id: 't1', userId: 'u1', clientId: 'c1', clientName: 'Codex', tokenHash: 'a1', tokenHint: 'aaaa',
			scopes: ['mcp'], expiresAt: HOUR, nowIso: T0, appId: 'app-1',
			refresh: { hash: 'r1', expiresAt: MONTH }, ...over,
		} as never);

	it('rotates by refresh token and detects replay of the previous one', async () => {
		const { tokens } = setup();
		await issue(tokens);
		assert.equal((await tokens.getByRefreshHash('r1'))?.id, 't1');
		const rotated = await tokens.rotateByRefresh('r1', {
			tokenHash: 'a2', tokenHint: 'bbbb', expiresAt: HOUR, newRefreshHash: 'r2', newRefreshExpiresAt: MONTH, nowIso: T1,
		});
		assert.equal(rotated?.id, 't1');
		assert.equal(await tokens.getByHash('a1'), null);
		assert.equal((await tokens.getByHash('a2'))?.id, 't1');
		assert.equal(await tokens.getByRefreshHash('r1'), null);
		assert.equal((await tokens.getByPrevRefreshHash('r1'))?.id, 't1', 'replay must be recognisable');
		assert.equal(
			await tokens.rotateByRefresh('r1', {
				tokenHash: 'a3', tokenHint: 'cccc', expiresAt: HOUR, newRefreshHash: 'r3', newRefreshExpiresAt: MONTH, nowIso: T2,
			}),
			null
		);
	});

	it('does not rotate an expired refresh token and clears hashes on revoke', async () => {
		const { tokens } = setup();
		await issue(tokens, { refresh: { hash: 'r1', expiresAt: T1 } });
		assert.equal(
			await tokens.rotateByRefresh('r1', {
				tokenHash: 'a2', tokenHint: 'b', expiresAt: HOUR, newRefreshHash: 'r2', newRefreshExpiresAt: MONTH, nowIso: T2,
			}),
			null
		);
		await tokens.issue({
			id: 't9', userId: 'u2', clientId: 'c9', clientName: 'X', tokenHash: 'z', tokenHint: 'z', scopes: ['mcp'],
			expiresAt: HOUR, nowIso: T0, refresh: { hash: 'r9', expiresAt: MONTH },
		});
		assert.equal(await tokens.revokeById('t9', T1), true);
		assert.equal(await tokens.getByRefreshHash('r9'), null);
	});

	it('reports the four statuses and filters by them', async () => {
		const { tokens } = setup();
		await issue(tokens);
		const list = (status: 'active' | 'renewable' | 'expired' | 'revoked', nowIso: string) =>
			tokens.list({ page: 1, pageSize: 10, status, nowIso });
		assert.equal((await list('active', T1)).total, 1);
		assert.equal((await list('renewable', LATER)).total, 1, 'access token expired but refresh valid');
		assert.equal((await list('expired', LATER)).total, 0);
		assert.equal((await list('expired', '2027-01-01T00:00:00.000Z')).total, 1);
	});

	it('summarises per app, groups legacy grants by name and revokes in bulk', async () => {
		const { server, tokens } = setup();
		await server.insertApp({ id: 'app-1', slug: 'codex', name: 'Codex', redirectUris: [], clientNamePatterns: [], enabled: true, nowIso: T0 });
		await issue(tokens);
		await issue(tokens, { id: 't2', userId: 'u2', clientId: 'c2', tokenHash: 'a2', refresh: { hash: 'r2', expiresAt: MONTH } });
		await tokens.issue({
			id: 'legacy', userId: 'u1', clientId: 'old-client', clientName: 'ChatGPT', tokenHash: 'l1', tokenHint: 'l',
			scopes: ['mcp'], expiresAt: HOUR, nowIso: T0,
		});

		const stats = await tokens.statsByApp(T1);
		const codex = stats.find((s) => s.app_id === 'app-1');
		assert.equal(codex?.app_name, 'Codex');
		assert.equal(codex?.client_count, 2);
		assert.equal(codex?.user_count, 2);
		assert.equal(codex?.live_count, 2);
		const legacy = stats.find((s) => s.app_id === null);
		assert.equal(legacy?.app_name, 'ChatGPT');

		const named = await tokens.list({ page: 1, pageSize: 10, appId: 'none', clientName: 'ChatGPT', nowIso: T1 });
		assert.deepEqual(named.rows.map((r) => r.id), ['legacy']);
		const byApp = await tokens.list({ page: 1, pageSize: 10, appId: 'app-1', nowIso: T1 });
		assert.equal(byApp.rows[0]?.app_name, 'Codex');

		await assert.rejects(() => tokens.revokeWhere({}, T1));
		assert.equal(await tokens.revokeWhere({ userId: 'u1' }, T1), 2, 'user-wide revoke across apps');
		assert.equal(await tokens.revokeWhere({ appId: 'app-1' }, T1), 1);
		assert.equal(await tokens.revokeWhere({ appId: 'app-1' }, T1), 0);
		assert.equal(await tokens.getByRefreshHash('r2'), null);
	});

	it('cleans up by refresh expiry', async () => {
		const { tokens } = setup();
		await issue(tokens, { refresh: { hash: 'r1', expiresAt: T1 } });
		assert.equal(await tokens.deleteStale(T0), 0);
		assert.equal(await tokens.deleteStale(T2), 1);
	});
});
