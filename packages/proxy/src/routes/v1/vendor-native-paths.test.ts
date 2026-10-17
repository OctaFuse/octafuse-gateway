/**
 * 厂商原生透传路径：新路径 `/{厂商}/官方路径` 与 TEMP(soloent) 旧别名 `/v1/{厂商}/...` 挂同一组 handler。
 * 删除旧别名时（见 app.ts 的 TEMP 注释）一并删掉本文件里的 LEGACY 用例。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { StorageContext } from '@octafuse/core';
import { createProxyApp } from '../../app';
import { isDashScopeRealtimePath } from '@octafuse/core/realtime-protocol';

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

const HTTP_NEW_PATHS = [
	['POST', '/dashscope/api/v1/services/aigc/multimodal-generation/generation'],
	['POST', '/dashscope/api/v1/services/audio/tts/SpeechSynthesizer'],
	['POST', '/dashscope/api/v1/services/audio/asr/transcription'],
	['GET', '/dashscope/api/v1/tasks/task-1'],
	['POST', '/minimax/v1/speech_to_text'],
	['POST', '/minimax/v1/t2a_v2'],
	['POST', '/minimax/v1/image_generation'],
	['POST', '/volcengine/api/v3/images/generations'],
] as const;

const HTTP_LEGACY_PATHS = [
	['POST', '/v1/dashscope/services/aigc/multimodal-generation/generation'],
	['POST', '/v1/dashscope/services/audio/tts/SpeechSynthesizer'],
	['POST', '/v1/dashscope/services/audio/asr/transcription'],
	['GET', '/v1/dashscope/tasks/task-1'],
	['POST', '/v1/minimax/speech_to_text'],
	['POST', '/v1/minimax/t2a_v2'],
	['POST', '/v1/minimax/image_generation'],
	['POST', '/v1/volcengine/images/generations'],
] as const;

const WS_PATHS = [
	'/dashscope/api-ws/v1/inference',
	'/dashscope/api-ws/v1/realtime?model=qwen3-asr-flash-realtime',
	// TEMP(soloent)：旧实时入口别名
	'/v1/dashscope/realtime?model=fun-asr-realtime&operation=audio.transcriptions.realtime.inference',
] as const;

async function expectMounted(method: string, path: string): Promise<void> {
	const app = appWithUnknownKey();
	const missing = await app.request(path, { method });
	assert.equal(missing.status, 401, `${method} ${path} should reach auth`);
	const authed = await app.request(path, {
		method,
		headers: { Authorization: 'Bearer sk-unknown' },
	});
	assert.equal(authed.status, 401, `${method} ${path}`);
	assert.equal((await authed.json()).error, 'Invalid API key', `${method} ${path}`);
}

describe('vendor native passthrough paths', () => {
	it('mounts the official-style paths', async () => {
		for (const [method, path] of HTTP_NEW_PATHS) await expectMounted(method, path);
	});

	it('keeps the legacy /v1/{vendor} paths mounted as aliases', async () => {
		for (const [method, path] of HTTP_LEGACY_PATHS) await expectMounted(method, path);
	});

	it('does not leak vendor paths under /v1 for the new layout', async () => {
		const res = await appWithUnknownKey().request('/v1/minimax/v1/t2a_v2', { method: 'POST' });
		assert.equal(res.status, 404);
	});
});

describe('DashScope realtime WebSocket entries', () => {
	it('mounts both new entries and the legacy alias behind API key auth', async () => {
		for (const path of WS_PATHS) {
			const res = await appWithUnknownKey().request(path, {
				headers: { Upgrade: 'websocket', Authorization: 'Bearer sk-unknown' },
			});
			assert.equal(res.status, 401, path);
			assert.equal((await res.json()).error, 'Invalid API key', path);
		}
	});

	it('accepts the lowercase "bearer" scheme the official DashScope SDK sends', async () => {
		const res = await appWithUnknownKey().request('/dashscope/api-ws/v1/inference', {
			headers: { Upgrade: 'websocket', Authorization: 'bearer sk-unknown' },
		});
		assert.equal(res.status, 401);
		assert.equal((await res.json()).error, 'Invalid API key');
	});

	it('reads the API key from the Sec-WebSocket-Protocol token on every entry', async () => {
		for (const path of WS_PATHS) {
			const res = await appWithUnknownKey().request(path, {
				headers: {
					Upgrade: 'websocket',
					'Sec-WebSocket-Protocol': 'octafuse-api-key.sk-browser',
				},
			});
			assert.equal(res.status, 401, path);
			assert.equal((await res.json()).error, 'Invalid API key', path);
		}
	});

	it('identifies realtime paths for the Node upgrade allowlist', () => {
		for (const path of WS_PATHS) {
			assert.equal(isDashScopeRealtimePath(new URL(path, 'http://x').pathname), true, path);
		}
		assert.equal(isDashScopeRealtimePath('/dashscope/api/v1/tasks'), false);
	});
});
