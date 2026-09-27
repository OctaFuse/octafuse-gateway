/**
 * TEMP(soloent): 覆盖 SoloEnt Agent 历史拼路径。
 * 0.17.x 与 0.18.0–0.18.5 退出且其插件 JWT 过期后，连同 app.ts 的别名路由一起删除。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { StorageContext } from '@octafuse/core';
import { createProxyApp } from '../../app';
import { isAnthropicMessagesPath } from '../../middleware/auth';

function appWithUnknownKey() {
	return createProxyApp(async () => {
		const storage = {
			client: {},
			repositories: {
				apiKeys: {
					getApiKeyWithUserByKey: async () => null,
				},
			},
		};
		return storage as StorageContext;
	});
}

async function post(path: string, headers: Record<string, string> = {}) {
	return appWithUnknownKey().request(path, { method: 'POST', headers });
}

describe('anthropic messages legacy paths', () => {
	it('recognizes the canonical path and both SoloEnt Agent aliases', () => {
		assert.equal(isAnthropicMessagesPath('/v1/messages'), true);
		assert.equal(isAnthropicMessagesPath('/messages'), true);
		assert.equal(isAnthropicMessagesPath('/v1/v1/messages'), true);
		assert.equal(isAnthropicMessagesPath('/v1/chat/completions'), false);
	});

	it('accepts x-api-key on /messages and /v1/v1/messages and enters the messages route', async () => {
		for (const path of ['/v1/messages', '/messages', '/v1/v1/messages']) {
			const missing = await post(path);
			assert.equal(missing.status, 401, path);
			assert.equal((await missing.json()).error, 'Missing or invalid API key');

			const authed = await post(path, { 'x-api-key': 'sk-legacy-alias-key' });
			assert.equal(authed.status, 401, path);
			assert.equal((await authed.json()).error, 'Invalid API key');
		}
	});
});
