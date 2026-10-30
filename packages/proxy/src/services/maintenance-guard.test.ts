import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { resetMaintenanceModeCacheForTests, type StorageContext } from '@octafuse/core';
import { createProxyApp } from '../app';
import { GATEWAY_ERROR_CODE_HEADER, GatewayErrorCode } from './gateway-error-codes';
import { isMaintenanceExemptRequest } from './maintenance-guard';

const ENABLED = JSON.stringify({
	enabled: true,
	message: '',
	messages: { en: 'Down for {minutes} min', zh: '维护 {minutes} 分钟' },
	expected_end_at: new Date(Date.now() + 10 * 60_000).toISOString(),
	block_admin_writes: true,
});

function appWith(configValue: string | null | Error) {
	let authLookups = 0;
	const app = createProxyApp(async () => {
		return {
			client: {},
			repositories: {
				systemConfig: {
					getConfig: async (key: string) => {
						assert.equal(key, 'MAINTENANCE_MODE');
						if (configValue instanceof Error) throw configValue;
						return configValue;
					},
				},
				apiKeys: {
					getApiKeyWithUserByKey: async () => {
						authLookups += 1;
						return null;
					},
				},
			},
		} as unknown as StorageContext;
	});
	return { app, authLookups: () => authLookups };
}

beforeEach(() => resetMaintenanceModeCacheForTests());

describe('isMaintenanceExemptRequest', () => {
	it('keeps probes and read-only listings available', () => {
		for (const [method, path] of [
			['GET', '/'],
			['GET', '/health'],
			['GET', '/v1/models'],
			['GET', '/v1/me'],
			['GET', '/v1/tools/pricing'],
			['GET', '/catalog'],
			['GET', '/.well-known/oauth-protected-resource'],
			['GET', '/.well-known/oauth-protected-resource/mcp/insight'],
			['GET', '/v1beta/models'],
			['GET', '/v1beta/models/gemini-2.5-pro'],
		]) {
			assert.equal(isMaintenanceExemptRequest(method, path), true, `${method} ${path}`);
		}
	});

	it('blocks inference, MCP, realtime upgrades and Gemini generate calls', () => {
		for (const [method, path] of [
			['POST', '/v1/chat/completions'],
			['POST', '/v1/messages'],
			['POST', '/v1beta/models/gemini-2.5-pro:generateContent'],
			['POST', '/v1/models'],
			['POST', '/v1/tools/web-search'],
			['GET', '/mcp'],
			['POST', '/mcp/some-server'],
			['GET', '/v1/dashscope/realtime'],
			['GET', '/dashscope/api-ws/v1/realtime'],
		]) {
			assert.equal(isMaintenanceExemptRequest(method, path), false, `${method} ${path}`);
		}
	});
});

describe('maintenance guard in the proxy app', () => {
	it('returns a friendly OpenAI-style 503 before authentication', async () => {
		const { app, authLookups } = appWith(ENABLED);
		const res = await app.request('/v1/chat/completions', {
			method: 'POST',
			headers: { Authorization: 'Bearer sk-x', 'Accept-Language': 'zh-CN' },
		});
		assert.equal(res.status, 503);
		assert.equal(res.headers.get(GATEWAY_ERROR_CODE_HEADER), GatewayErrorCode.maintenance);
		assert.equal(res.headers.get('X-OctaFuse-Maintenance'), '1');
		const retryAfter = Number(res.headers.get('Retry-After'));
		assert.ok(retryAfter > 0 && retryAfter <= 300);
		const body = (await res.json()) as { error: { message: string; code: string }; code: string; message: string };
		assert.match(body.message, /^维护 (9|10) 分钟$/);
		assert.equal(body.error.message, body.message);
		assert.equal(body.error.code, GatewayErrorCode.maintenance);
		assert.equal(body.code, GatewayErrorCode.maintenance);
		assert.equal(authLookups(), 0, 'must not touch API key auth or billing paths');
	});

	it('picks the message language from Accept-Language', async () => {
		const { app } = appWith(ENABLED);
		const res = await app.request('/v1/chat/completions', { method: 'POST', headers: { 'Accept-Language': 'en-US,en;q=0.9' } });
		const body = (await res.json()) as { message: string };
		assert.match(body.message, /^Down for (9|10) min$/);
	});

	it('uses the Anthropic error envelope on /v1/messages and aliases', async () => {
		const { app } = appWith(ENABLED);
		for (const path of ['/v1/messages', '/messages', '/v1/v1/messages']) {
			const res = await app.request(path, { method: 'POST' });
			assert.equal(res.status, 503, path);
			const body = (await res.json()) as { type: string; error: { type: string; message: string } };
			assert.equal(body.type, 'error', path);
			assert.equal(body.error.type, 'api_error', path);
			assert.ok(body.error.message.length > 0, path);
		}
	});

	it('uses the Gemini error envelope under /v1beta', async () => {
		const { app } = appWith(ENABLED);
		const res = await app.request('/v1beta/models/gemini-2.5-pro:generateContent', { method: 'POST' });
		assert.equal(res.status, 503);
		const body = (await res.json()) as { error: { code: number; status: string } };
		assert.equal(body.error.code, 503);
		assert.equal(body.error.status, 'UNAVAILABLE');
	});

	it('keeps /health at 200 and marks maintenance', async () => {
		const { app } = appWith(ENABLED);
		const res = await app.request('/health');
		assert.equal(res.status, 200);
		assert.equal(res.headers.get('X-OctaFuse-Maintenance'), '1');
		assert.deepEqual(await res.json(), { status: 'ok', service: 'octafuse-proxy', maintenance: true });
	});

	it('does not interfere when disabled or unset', async () => {
		for (const value of [null, '', '{"enabled":false}']) {
			resetMaintenanceModeCacheForTests();
			const { app } = appWith(value);
			const health = await app.request('/health');
			assert.deepEqual(await health.json(), { status: 'ok', service: 'octafuse-proxy' });
			const chat = await app.request('/v1/chat/completions', { method: 'POST' });
			assert.equal(chat.status, 401, 'falls through to normal auth');
		}
	});

	it('fails open when the config cannot be read', async () => {
		const { app } = appWith(new Error('db down'));
		const chat = await app.request('/v1/chat/completions', { method: 'POST' });
		assert.equal(chat.status, 401);
		const health = await app.request('/health');
		assert.equal(health.status, 200);
	});
});
