/**
 * `oat_` 访问令牌与 MCP OAuth 发现：
 * - 访问令牌只能访问 /mcp*，其它入口返回 403 gateway.scope_denied；
 * - 过期 / 未知 / 已撤销的令牌在 /mcp* 返回 401 且带 error="invalid_token"；
 * - `sk-` 用户 Key 在 /mcp* 的行为不变；
 * - 配置 MCP_OAUTH_AUTHORIZATION_SERVER 后，/mcp* 的 401 带 resource_metadata，并公开受保护资源元数据。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { hashOAuthAccessToken, type StorageContext } from '@octafuse/core';
import { createProxyApp } from '../app';

const ACTIVE = 'oat_activeTokenSecret0001';
const EXPIRED = 'oat_expiredTokenSecret002';

const userRow = {
	id: 'user-1',
	email: 'u@example.com',
	budget_max: 10,
	budget_base: 10,
	budget_spent: 0,
	budget_period: 'none',
	budget_reset_at: null,
	wallet_granted: 0,
	wallet_spent: 0,
	status: 'active',
	metadata: null,
	rate_limit: null,
	charged_cost_factors: null,
	external_system: null,
	external_user_id: null,
	created_at: '2026-01-01 00:00:00',
	updated_at: '2026-01-01 00:00:00',
};

const keyRow = {
	id: 'key-1',
	key: 'sk-test',
	user_id: 'user-1',
	name: null,
	status: 'active',
	metadata: null,
	last_used_at: null,
	rate_limit: null,
	created_at: '2026-01-01 00:00:00',
	updated_at: '2026-01-01 00:00:00',
	user_email: 'u@example.com',
	user_metadata: null,
	user_charged_cost_factors: null,
	user_rate_limit: null,
	budget_max: 10,
	budget_base: 10,
	budget_spent: 0,
	budget_period: 'none',
	budget_reset_at: null,
	wallet_granted: 0,
	wallet_spent: 0,
};

function tokenRow(id: string, expiresAt: string) {
	return {
		id,
		user_id: 'user-1',
		client_id: 'client-1',
		client_name: 'Codex',
		token_hint: '0001',
		scopes: ['mcp'],
		expires_at: expiresAt,
		last_used_at: null,
		rotated_at: null,
		revoked_at: null,
		created_at: '2026-01-01T00:00:00.000Z',
		updated_at: '2026-01-01T00:00:00.000Z',
	};
}

async function makeApp(opts: { authServer?: string | null } = {}) {
	const config: Record<string, string> = {};
	if (opts.authServer) config.MCP_OAUTH_AUTHORIZATION_SERVER = opts.authServer;
	const tokens = new Map<string, ReturnType<typeof tokenRow>>([
		[await hashOAuthAccessToken(ACTIVE), tokenRow('tok-active', new Date(Date.now() + 3600_000).toISOString())],
		[await hashOAuthAccessToken(EXPIRED), tokenRow('tok-expired', new Date(Date.now() - 1000).toISOString())],
	]);
	const touched: string[] = [];
	const app = createProxyApp(async () => {
		const storage = {
			client: {},
			repositories: {
				apiKeys: {
					getApiKeyWithUserByKey: async (key: string) => (key === 'sk-test' ? keyRow : null),
				},
				oauthAccessTokens: {
					getByHash: async (hash: string) => tokens.get(hash) ?? null,
					touchLastUsed: async (id: string) => {
						touched.push(id);
					},
				},
				users: {
					getById: async (id: string) => (id === 'user-1' ? userRow : null),
				},
				mcpServers: { listCallable: async () => [] },
				systemConfig: {
					getConfig: async (key: string) => config[key] ?? null,
				},
			},
		};
		return storage as unknown as StorageContext;
	});
	return { app, touched };
}

const bearer = (value: string) => ({ Authorization: `Bearer ${value}` });

describe('access tokens at the proxy', () => {
	it('rejects oat_ tokens on non-MCP endpoints with 403 gateway.scope_denied', async () => {
		const { app } = await makeApp();
		for (const path of ['/v1/me', '/v1/models']) {
			const res = await app.request(path, { headers: bearer(ACTIVE) });
			assert.equal(res.status, 403, path);
			assert.equal(res.headers.get('X-OctaFuse-Error-Code'), 'gateway.scope_denied');
		}
		const chat = await app.request('/v1/chat/completions', {
			method: 'POST',
			headers: bearer(ACTIVE),
			body: '{}',
		});
		assert.equal(chat.status, 403);
		assert.equal(chat.headers.get('X-OctaFuse-Error-Code'), 'gateway.scope_denied');
	});

	it('lets an active oat_ token reach /mcp and records last use', async () => {
		const { app, touched } = await makeApp();
		const res = await app.request('/mcp/insight', { method: 'GET', headers: bearer(ACTIVE) });
		// GET 通过鉴权后由聚合器返回 405，说明没有被鉴权层拦下。
		assert.equal(res.status, 405);
		assert.deepEqual(touched, ['tok-active']);
	});

	it('answers 401 invalid_token for expired and unknown tokens so clients refresh', async () => {
		const { app } = await makeApp();
		for (const token of [EXPIRED, 'oat_unknownTokenSecret003']) {
			const res = await app.request('http://gw.test/mcp', { method: 'POST', headers: bearer(token) });
			assert.equal(res.status, 401, token);
			assert.equal(res.headers.get('WWW-Authenticate'), 'Bearer error="invalid_token"');
		}
	});

	it('does not read the request body of unauthenticated requests', async () => {
		const { app } = await makeApp();
		for (const token of ['oat_unknownTokenSecret003', 'sk-nope', EXPIRED]) {
			const request = new Request('http://gw.test/mcp', {
				method: 'POST',
				headers: { ...bearer(token), 'Content-Type': 'application/json' },
				body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call' }),
			});
			let cloned = 0;
			const originalClone = request.clone.bind(request);
			request.clone = () => {
				cloned += 1;
				return originalClone();
			};
			const res = await app.fetch(request);
			assert.equal(res.status, 401, token);
			assert.equal(cloned, 0, `${token} must be rejected before the body is read`);
		}
	});

	it('rejects JSON-RPC batch arrays so they cannot bypass the tools/call rate limit', async () => {
		const { app } = await makeApp();
		for (const token of [ACTIVE, 'sk-test']) {
			const res = await app.request('http://gw.test/mcp', {
				method: 'POST',
				headers: { ...bearer(token), 'Content-Type': 'application/json' },
				body: JSON.stringify([
					{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'a__b' } },
					{ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'a__b' } },
				]),
			});
			assert.equal(res.status, 400, token);
			assert.equal(res.headers.get('X-OctaFuse-Error-Code'), 'gateway.invalid_request');
		}
	});

	it('adds resource_metadata next to invalid_token when OAuth discovery is on', async () => {
		const { app } = await makeApp({ authServer: 'https://soloent.ai' });
		const res = await app.request('http://gw.test/mcp/insight', { method: 'POST', headers: bearer(EXPIRED) });
		assert.equal(res.status, 401);
		assert.equal(
			res.headers.get('WWW-Authenticate'),
			'Bearer error="invalid_token", resource_metadata="http://gw.test/.well-known/oauth-protected-resource/mcp/insight"'
		);
	});

	it('keeps sk- keys working on /mcp and on the model endpoints', async () => {
		const { app } = await makeApp();
		const mcp = await app.request('/mcp', { method: 'GET', headers: bearer('sk-test') });
		assert.equal(mcp.status, 405);
		const me = await app.request('/v1/me', { headers: bearer('sk-test') });
		assert.notEqual(me.headers.get('X-OctaFuse-Error-Code'), 'gateway.scope_denied');
		assert.notEqual(me.status, 401);
	});
});

describe('MCP OAuth discovery', () => {
	it('adds WWW-Authenticate to /mcp 401 when the authorization server is configured', async () => {
		const { app } = await makeApp({ authServer: 'https://soloent.ai/' });
		const missing = await app.request('http://gw.test/mcp/insight', { method: 'POST' });
		assert.equal(missing.status, 401);
		assert.equal(
			missing.headers.get('WWW-Authenticate'),
			'Bearer resource_metadata="http://gw.test/.well-known/oauth-protected-resource/mcp/insight"'
		);
		const bad = await app.request('http://gw.test/mcp', { method: 'POST', headers: bearer('sk-nope') });
		assert.equal(bad.status, 401);
		assert.equal(
			bad.headers.get('WWW-Authenticate'),
			'Bearer resource_metadata="http://gw.test/.well-known/oauth-protected-resource/mcp"'
		);
	});

	it('does not add the challenge to non-MCP endpoints or when unconfigured', async () => {
		const configured = (await makeApp({ authServer: 'https://soloent.ai' })).app;
		const chat = await configured.request('/v1/chat/completions', { method: 'POST' });
		assert.equal(chat.status, 401);
		assert.equal(chat.headers.get('WWW-Authenticate'), null);

		const plain = (await makeApp()).app;
		const mcp = await plain.request('/mcp/insight', { method: 'POST' });
		assert.equal(mcp.status, 401);
		assert.equal(mcp.headers.get('WWW-Authenticate'), null);
	});

	it('serves protected resource metadata in both well-known forms', async () => {
		const { app } = await makeApp({ authServer: 'https://soloent.ai' });
		const suffixed = await app.request('http://gw.test/.well-known/oauth-protected-resource/mcp/insight');
		assert.equal(suffixed.status, 200);
		assert.deepEqual(await suffixed.json(), {
			resource: 'http://gw.test/mcp/insight',
			authorization_servers: ['https://soloent.ai'],
			scopes_supported: ['mcp'],
			bearer_methods_supported: ['header'],
			resource_name: 'OctaFuse MCP',
		});
		const root = await app.request('http://gw.test/.well-known/oauth-protected-resource');
		assert.equal(root.status, 200);
		assert.equal((await root.json()).resource, 'http://gw.test/mcp');
	});

	it('returns 404 metadata when unconfigured', async () => {
		const { app } = await makeApp();
		const res = await app.request('http://gw.test/.well-known/oauth-protected-resource/mcp/insight');
		assert.equal(res.status, 404);
	});
});
