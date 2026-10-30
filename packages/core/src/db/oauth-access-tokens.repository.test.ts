/**
 * 用 node:sqlite 直接跑真实的 D1 迁移（0035）与共享 SQL 仓储，覆盖签发 / 轮换 / 撤销 / 过滤 / 清理。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, describe, it } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createOAuthAccessTokensSqlRepository, type SqlExec } from './oauth-access-tokens.repository';

const MIGRATION = new URL('../../migrations-d1/0035_oauth_access_tokens.sql', import.meta.url);

function createRepo() {
	const db = new DatabaseSync(':memory:');
	db.exec('CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT);');
	db.exec('CREATE TABLE api_key_request_logs (id TEXT PRIMARY KEY, api_key_id TEXT);');
	db.exec(readFileSync(MIGRATION, 'utf8'));
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
	return { repo: createOAuthAccessTokensSqlRepository(exec), db };
}

const T0 = '2026-10-30T00:00:00.000Z';
const T1 = '2026-10-30T01:00:00.000Z';
const T2 = '2026-10-30T02:00:00.000Z';

function params(overrides: Partial<Parameters<ReturnType<typeof createRepo>['repo']['issue']>[0]> = {}) {
	return {
		id: 'tok-1',
		userId: 'u1',
		clientId: 'client-a',
		clientName: 'Codex',
		tokenHash: 'hash-1',
		tokenHint: 'aaaa',
		scopes: ['mcp'],
		expiresAt: T1,
		nowIso: T0,
		...overrides,
	};
}

describe('access tokens repository', () => {
	let ctx: ReturnType<typeof createRepo>;
	before(() => {
		ctx = createRepo();
	});

	it('creates a grant and finds it by hash', async () => {
		const { row, rotated } = await ctx.repo.issue(params());
		assert.equal(rotated, false);
		assert.equal(row.id, 'tok-1');
		assert.deepEqual(row.scopes, ['mcp']);
		const found = await ctx.repo.getByHash('hash-1');
		assert.equal(found?.client_name, 'Codex');
		assert.equal(await ctx.repo.getByHash('missing'), null);
	});

	it('rotates the existing grant for the same user and client keeping the id', async () => {
		const { row, rotated } = await ctx.repo.issue(
			params({ id: 'tok-ignored', tokenHash: 'hash-2', tokenHint: 'bbbb', expiresAt: T2, nowIso: T1 })
		);
		assert.equal(rotated, true);
		assert.equal(row.id, 'tok-1');
		assert.equal(row.rotated_at, T1);
		assert.equal(await ctx.repo.getByHash('hash-1'), null, 'old hash must stop working');
		assert.equal((await ctx.repo.getByHash('hash-2'))?.token_hint, 'bbbb');
	});

	it('rotates by id and keeps other clients separate', async () => {
		const other = await ctx.repo.issue(
			params({ id: 'tok-2', clientId: 'client-b', clientName: 'ChatGPT', tokenHash: 'hash-b' })
		);
		assert.equal(other.rotated, false);
		const rotated = await ctx.repo.rotate('tok-2', {
			tokenHash: 'hash-b2',
			tokenHint: 'cccc',
			expiresAt: T2,
			nowIso: T1,
		});
		assert.equal(rotated?.id, 'tok-2');
		assert.equal(await ctx.repo.getByHash('hash-b'), null);
		assert.equal((await ctx.repo.getByHash('hash-b2'))?.client_id, 'client-b');
		assert.equal(await ctx.repo.rotate('nope', { tokenHash: 'x', tokenHint: 'x', expiresAt: T2, nowIso: T1 }), null);
	});

	it('filters, joins the user email and paginates', async () => {
		await ctx.repo.issue(params({ id: 'tok-3', userId: 'u2', clientId: 'client-a', tokenHash: 'hash-u2' }));
		const all = await ctx.repo.list({ page: 1, pageSize: 10, nowIso: T1 });
		assert.equal(all.total, 3);
		const byClient = await ctx.repo.list({ page: 1, pageSize: 10, clientId: 'client-a', nowIso: T1 });
		assert.equal(byClient.total, 2);
		const byEmail = await ctx.repo.list({ page: 1, pageSize: 10, userEmail: 'b@example', nowIso: T1 });
		assert.deepEqual(byEmail.rows.map((r) => [r.id, r.user_email]), [['tok-3', 'b@example.com']]);
		const paged = await ctx.repo.list({ page: 2, pageSize: 2, nowIso: T1 });
		assert.equal(paged.rows.length, 1);
		assert.equal(paged.total, 3);
	});

	it('splits active and expired by time', async () => {
		// tok-1 / tok-3 过期于 T1/T2 之前的设置：tok-1 在 T2 到期，tok-3 在 T1 到期
		const atT1 = await ctx.repo.list({ page: 1, pageSize: 10, status: 'expired', nowIso: T1 });
		assert.deepEqual(atT1.rows.map((r) => r.id), ['tok-3']);
		const atT2 = await ctx.repo.list({ page: 1, pageSize: 10, status: 'active', nowIso: T2 });
		assert.equal(atT2.total, 0);
	});

	it('summarises per client', async () => {
		const stats = await ctx.repo.statsByClient(T1);
		const a = stats.find((s) => s.client_id === 'client-a');
		assert.equal(a?.total_count, 2);
		assert.equal(a?.active_count, 1);
		assert.equal(a?.live_count, 2, 'live = 未撤销，含访问令牌已过期但可刷新的授权');
	});

	it('throttles last_used writes', async () => {
		const t = Date.parse(T1);
		await ctx.repo.touchLastUsed('tok-1', t);
		const first = (await ctx.repo.getById('tok-1'))?.last_used_at;
		assert.equal(first, T1);
		await ctx.repo.touchLastUsed('tok-1', t + 10_000);
		assert.equal((await ctx.repo.getById('tok-1'))?.last_used_at, first, 'within 60s: unchanged');
		await ctx.repo.touchLastUsed('tok-1', t + 120_000);
		assert.notEqual((await ctx.repo.getById('tok-1'))?.last_used_at, first);
	});

	it('revokes softly: hash cleared, name kept, second revoke is a no-op', async () => {
		assert.equal(await ctx.repo.revokeById('tok-2', T1), true);
		const row = await ctx.repo.getById('tok-2');
		assert.equal(row?.revoked_at, T1);
		assert.equal(row?.client_name, 'ChatGPT');
		assert.equal(row?.token_hint, null);
		assert.equal(await ctx.repo.getByHash('hash-b2'), null);
		assert.equal(await ctx.repo.revokeById('tok-2', T2), false);
		assert.equal(await ctx.repo.rotate('tok-2', { tokenHash: 'z', tokenHint: 'z', expiresAt: T2, nowIso: T2 }), null);
		const revoked = await ctx.repo.list({ page: 1, pageSize: 10, status: 'revoked', nowIso: T2 });
		assert.deepEqual(revoked.rows.map((r) => r.id), ['tok-2']);
	});

	it('issues a fresh grant after a revoke instead of reviving the old one', async () => {
		const { row, rotated } = await ctx.repo.issue(
			params({ id: 'tok-4', clientId: 'client-b', clientName: 'ChatGPT', tokenHash: 'hash-b3', nowIso: T2 })
		);
		assert.equal(rotated, false);
		assert.equal(row.id, 'tok-4');
	});

	it('revokes by hash and by client', async () => {
		assert.equal(await ctx.repo.revokeByHash('hash-b3', T2), 'tok-4');
		assert.equal(await ctx.repo.revokeByHash('hash-b3', T2), null);
		assert.equal(await ctx.repo.revokeByClient('client-a', T2), 2);
		assert.equal(await ctx.repo.revokeByClient('client-a', T2), 0);
	});

	it('resolves names for log display and cleans stale rows', async () => {
		const names = await ctx.repo.getNamesByIds(['tok-1', 'tok-2', 'tok-2', 'missing']);
		assert.deepEqual(names.map((n) => n.id).sort(), ['tok-1', 'tok-2']);
		// 所有行都已撤销（T1 / T2），cutoff 晚于 T2 时全部清掉
		assert.equal(await ctx.repo.deleteStale('2026-10-31T00:00:00.000Z'), 4);
		assert.equal(await ctx.repo.getById('tok-1'), null);
		assert.equal(await ctx.repo.deleteStale('2026-10-31T00:00:00.000Z'), 0);
	});
});
