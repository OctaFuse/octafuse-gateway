import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { GatewayRepositories } from '@octafuse/core';
import { isAdminServiceError } from './errors';
import {
	cleanupOAuthAccessTokens,
	issueOAuthAccessToken,
	listOAuthAccessTokens,
	revokeOAuthAccessTokenById,
	revokeOAuthAccessTokensBy,
	rotateOAuthAccessToken,
} from './oauth-access-tokens-service';

const USER = '8f14e45f-ceea-4e67-a1b2-3c4d5e6f7a8b';

function row(id = 'tok-1') {
	return {
		id,
		user_id: USER,
		client_id: 'c1',
		client_name: 'Codex',
		token_hint: 'abcd',
		scopes: ['mcp'],
		expires_at: new Date(Date.now() + 3600_000).toISOString(),
		last_used_at: null,
		rotated_at: null,
		revoked_at: null,
		created_at: '2026-01-01T00:00:00.000Z',
		updated_at: '2026-01-01T00:00:00.000Z',
	};
}

function makeRepos(overrides: Record<string, unknown> = {}) {
	const calls: Record<string, unknown[]> = {};
	const track = (name: string, result: unknown) => async (...args: unknown[]) => {
		calls[name] = args;
		return result;
	};
	const repos = {
		users: { getById: async (id: string) => (id === USER ? { id: USER } : null) },
		oauthAccessTokens: {
			issue: track('issue', { row: row(), rotated: false }),
			rotate: track('rotate', row()),
			list: track('list', { rows: [{ ...row(), user_email: 'a@b.c' }], total: 1 }),
			revokeById: track('revokeById', true),
			revokeByClient: track('revokeByClient', 2),
			revokeByHash: track('revokeByHash', 'tok-1'),
			deleteStale: track('deleteStale', 5),
			...overrides,
		},
	} as unknown as GatewayRepositories;
	return { repos, calls };
}

async function rejectsWith(promise: Promise<unknown>, status: number) {
	await assert.rejects(promise, (error) => isAdminServiceError(error) && error.status === status);
}

describe('access tokens admin service', () => {
	it('issues a token, returning the plaintext once and storing only its hash', async () => {
		const { repos, calls } = makeRepos();
		const result = await issueOAuthAccessToken(repos, USER, { client_id: 'c1', client_name: 'Codex', ttl_seconds: 600 });
		assert.match(result.access_token, /^oat_[A-Za-z0-9_-]{43}$/);
		assert.equal(result.expires_in, 600);
		assert.equal(result.token.status, 'active');
		const stored = calls.issue?.[0] as { tokenHash: string; tokenHint: string };
		assert.match(stored.tokenHash, /^[0-9a-f]{64}$/);
		assert.equal(stored.tokenHint, result.access_token.slice(-4));
		assert.ok(!JSON.stringify(result.token).includes(result.access_token));
	});

	it('validates issue input', async () => {
		const { repos } = makeRepos();
		await rejectsWith(issueOAuthAccessToken(repos, USER, { client_name: 'x' }), 400);
		await rejectsWith(issueOAuthAccessToken(repos, USER, { client_id: 'c', client_name: 'x', scopes: ['admin'] }), 400);
		await rejectsWith(issueOAuthAccessToken(repos, USER, { client_id: 'c', client_name: 'x', ttl_seconds: 5 }), 400);
		await rejectsWith(issueOAuthAccessToken(repos, '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed', { client_id: 'c', client_name: 'x' }), 404);
	});

	it('rotates and reports 404 for a revoked grant', async () => {
		const ok = makeRepos();
		const rotated = await rotateOAuthAccessToken(ok.repos, 'tok-1', {});
		assert.equal(rotated.expires_in, 3600);
		assert.match(rotated.access_token, /^oat_/);
		const gone = makeRepos({ rotate: async () => null });
		await rejectsWith(rotateOAuthAccessToken(gone.repos, 'tok-1', {}), 404);
	});

	it('lists with a validated status filter and page cap', async () => {
		const { repos, calls } = makeRepos();
		const page = await listOAuthAccessTokens(repos, { status: 'active', page_size: '9999', client_id: ' c1 ' });
		assert.equal(page.total, 1);
		assert.equal(page.page_size, 200);
		const filter = calls.list?.[0] as { clientId?: string; status?: string };
		assert.equal(filter.clientId, 'c1');
		assert.equal(filter.status, 'active');
		await rejectsWith(listOAuthAccessTokens(repos, { status: 'bogus' }), 400);
	});

	it('revokes by id, client or plaintext token — exactly one selector', async () => {
		const { repos, calls } = makeRepos();
		await revokeOAuthAccessTokenById(repos, 'tok-1');
		assert.deepEqual(await revokeOAuthAccessTokensBy(repos, { client_id: 'c1' }), { revoked: 2 });
		assert.deepEqual(await revokeOAuthAccessTokensBy(repos, { token: 'oat_whatever' }), { revoked: 1, token_id: 'tok-1' });
		assert.match(calls.revokeByHash?.[0] as string, /^[0-9a-f]{64}$/);
		await rejectsWith(revokeOAuthAccessTokensBy(repos, {}), 400);
		await rejectsWith(revokeOAuthAccessTokensBy(repos, { client_id: 'c', token: 't' }), 400);
		const none = makeRepos({ revokeById: async () => false });
		await rejectsWith(revokeOAuthAccessTokenById(none.repos, 'x'), 404);
	});

	it('cleans stale rows with a day-based cutoff', async () => {
		const { repos, calls } = makeRepos();
		assert.deepEqual(await cleanupOAuthAccessTokens(repos, {}), { deleted: 5 });
		const cutoff = Date.parse(calls.deleteStale?.[0] as string);
		const days = (Date.now() - cutoff) / 86_400_000;
		assert.ok(days > 29.9 && days < 30.1);
		await rejectsWith(cleanupOAuthAccessTokens(repos, { older_than_days: 0 }), 400);
	});
});
