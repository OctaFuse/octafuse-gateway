/**
 * `GET /elevenlabs/v1/text-to-speech/:voiceId/stream-input` 与 `GET /elevenlabs/v1/speech-to-text/realtime`：
 * 升级前用 query 的 `model_id` 完成鉴权、模型类型校验、余额检查与选路由（Node 绑定注入假调度）。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { GatewayRepositories, StorageContext } from '@octafuse/core';
import { createProxyApp } from '../../app';
import type {
	ElevenLabsRealtimeNodeDispatch,
	ElevenLabsRealtimeParams,
} from '../../services/egress/elevenlabs-realtime-driver';
import { EMPTY_USAGE } from '../../services/proxy';
import type { RouteResult } from '../../services/model-router';

const TTS_PRICING = JSON.stringify({
	audio_billing_mode: 'per_character',
	audio: { price_per_character: 0.0001 },
});
const ASR_PRICING = JSON.stringify({
	audio_billing_mode: 'per_second',
	audio: { price_per_second: 0.0001 },
});

type Mocks = {
	models?: Record<string, Record<string, unknown>>;
	routes?: Array<Record<string, unknown>>;
	apiKey?: Record<string, unknown>;
};

function buildRepos(mocks: Mocks): GatewayRepositories {
	const overrides: Record<string, Record<string, (...args: never[]) => unknown>> = {
		apiKeys: {
			getApiKeyWithUserByKey: async () => ({
				id: 'key-1',
				user_id: 'user-1',
				user_email: 'u@example.com',
				budget_max: 100,
				budget_spent: 0,
				wallet_granted: 0,
				wallet_spent: 0,
				budget_period: 'none',
				budget_reset_at: null,
				user_metadata: null,
				metadata: null,
				user_charged_cost_factors: null,
				rate_limit: null,
				user_rate_limit: null,
				...mocks.apiKey,
			}),
		},
		modelRouting: {
			getModelById: (async (id: string) => mocks.models?.[id] ?? null) as never,
			resolveModelSurface: async () => null,
			getModelRoutesByModelId: async () => mocks.routes ?? [],
		},
		providers: {
			getProviderById: async () => ({
				id: 'elevenlabs',
				name: 'ElevenLabs',
				status: 'active',
				api_key: 'el-secret',
				endpoints: JSON.stringify({
					elevenlabs: { base: 'https://api.elevenlabs.io/v1' },
				}),
			}),
		},
	};
	return new Proxy(
		{},
		{
			get: (_target, namespace: string) =>
				new Proxy(
					{},
					{
						get: (_inner, method: string) => overrides[namespace]?.[method] ?? (async () => null),
					}
				),
		}
	) as unknown as GatewayRepositories;
}

function appWith(mocks: Mocks = {}) {
	return createProxyApp(
		async () => ({ client: {}, repositories: buildRepos(mocks) }) as unknown as StorageContext
	);
}

type DispatchCall = { route: RouteResult; params: ElevenLabsRealtimeParams };

/** 假 Node 调度：记录调用，按 `reject` 决定握手是否成功。 */
function fakeDispatch(options: { rejectStatus?: number } = {}) {
	const calls: DispatchCall[] = [];
	const dispatch: ElevenLabsRealtimeNodeDispatch = async (route, params) => {
		calls.push({ route, params });
		if (options.rejectStatus) {
			return {
				response: new Response(JSON.stringify({ detail: { status: 'x', message: 'no' } }), {
					status: options.rejectStatus,
					headers: { 'Content-Type': 'application/json' },
				}),
				usagePromise: Promise.resolve(EMPTY_USAGE),
				upstreamRequestId: null,
			};
		}
		const response = new Response(null, {
			status: 200,
			headers: { 'X-Octafuse-Realtime-Upgrade': '1' },
		});
		Object.defineProperty(response, 'webSocket', { value: {} });
		return {
			response,
			usagePromise: Promise.resolve(EMPTY_USAGE),
			upstreamRequestId: 'up-1',
		};
	};
	return { calls, dispatch };
}

const TTS_PATH = '/elevenlabs/v1/text-to-speech/voice_1/stream-input';
const STT_PATH = '/elevenlabs/v1/speech-to-text/realtime';

const TTS_MODEL = { id: 'flash', display_name: 'Flash', pricing_profile: TTS_PRICING };
const STT_MODEL = { id: 'scribe', display_name: 'Scribe', pricing_profile: ASR_PRICING };

function route(id: string, modelId: string, providerModelName: string, operation: string) {
	return {
		id,
		model_id: modelId,
		provider_id: 'elevenlabs',
		provider_model_name: providerModelName,
		priority: 0,
		status: 'active',
		route_group: 'default',
		weight: 1,
		price_override: null,
		custom_params: null,
		upstream_protocol: 'elevenlabs',
		route_pool_id: 'pool-1',
		upstream_operation: operation,
		adapter: 'passthrough',
	};
}

const TTS_ROUTE = route('r-tts', 'flash', 'eleven_flash_v2_5', 'audio.speech.realtime');
const STT_ROUTE = route('r-stt', 'scribe', 'scribe_v2_realtime', 'audio.transcriptions.realtime');

async function request(
	mocks: Mocks,
	path: string,
	options: { headers?: Record<string, string>; dispatch?: ElevenLabsRealtimeNodeDispatch } = {}
) {
	const headers = { Upgrade: 'websocket', 'xi-api-key': 'sk-ok', ...options.headers };
	return appWith(mocks).request(
		path,
		{ headers },
		options.dispatch ? { NODE_ELEVENLABS_REALTIME_DISPATCH: options.dispatch } : {}
	);
}

describe('ElevenLabs realtime routes (pre-upgrade)', () => {
	it('rejects a request without WebSocket upgrade with 426', async () => {
		const { dispatch } = fakeDispatch();
		const response = await request(
			{ models: { flash: TTS_MODEL }, routes: [TTS_ROUTE] },
			`${TTS_PATH}?model_id=flash`,
			{ headers: { Upgrade: '' }, dispatch }
		);
		assert.equal(response.status, 426);
	});

	it('requires an API key', async () => {
		const { dispatch } = fakeDispatch();
		const response = await appWith({}).request(
			`${TTS_PATH}?model_id=flash`,
			{ headers: { Upgrade: 'websocket' } },
			{ NODE_ELEVENLABS_REALTIME_DISPATCH: dispatch }
		);
		assert.equal(response.status, 401);
	});

	it('rejects a missing model_id with 400', async () => {
		const { dispatch, calls } = fakeDispatch();
		const response = await request({}, TTS_PATH, { dispatch });
		assert.equal(response.status, 400);
		assert.equal(calls.length, 0);
	});

	it('rejects an invalid voice_id with 400', async () => {
		const { dispatch, calls } = fakeDispatch();
		const response = await request(
			{ models: { flash: TTS_MODEL }, routes: [TTS_ROUTE] },
			'/elevenlabs/v1/text-to-speech/bad%20voice/stream-input?model_id=flash',
			{ dispatch }
		);
		assert.equal(response.status, 400);
		assert.equal(calls.length, 0);
	});

	it('returns 404 for an unknown model', async () => {
		const { dispatch, calls } = fakeDispatch();
		const response = await request({}, `${TTS_PATH}?model_id=nope`, { dispatch });
		assert.equal(response.status, 404);
		assert.equal(calls.length, 0);
	});

	it('rejects a transcription model on the speech endpoint and vice versa', async () => {
		const { dispatch, calls } = fakeDispatch();
		const mocks = {
			models: { flash: TTS_MODEL, scribe: STT_MODEL },
			routes: [TTS_ROUTE, STT_ROUTE],
		};
		const wrongTts = await request(mocks, `${TTS_PATH}?model_id=scribe`, { dispatch });
		assert.equal(wrongTts.status, 400);
		const wrongStt = await request(mocks, `${STT_PATH}?model_id=flash`, { dispatch });
		assert.equal(wrongStt.status, 400);
		assert.equal(calls.length, 0);
	});

	it('returns 404 when the model has no route for the operation', async () => {
		const { dispatch, calls } = fakeDispatch();
		const response = await request(
			{ models: { flash: TTS_MODEL }, routes: [] },
			`${TTS_PATH}?model_id=flash`,
			{ dispatch }
		);
		assert.equal(response.status, 404);
		assert.equal(calls.length, 0);
	});

	it('rejects a key with no balance left with 403', async () => {
		const { dispatch, calls } = fakeDispatch();
		const response = await request(
			{
				models: { flash: TTS_MODEL },
				routes: [TTS_ROUTE],
				apiKey: { budget_max: 1, budget_spent: 1 },
			},
			`${TTS_PATH}?model_id=flash`,
			{ dispatch }
		);
		assert.equal(response.status, 403);
		assert.equal(calls.length, 0);
	});
});

describe('ElevenLabs realtime routes (upgrade)', () => {
	it('routes TTS stream-input by model_id and swaps in the provider model name', async () => {
		const { dispatch, calls } = fakeDispatch();
		const response = await request(
			{ models: { flash: TTS_MODEL }, routes: [TTS_ROUTE] },
			`${TTS_PATH}?model_id=flash&output_format=pcm_16000`,
			{ dispatch }
		);
		assert.equal(response.status, 200);
		assert.equal(response.headers.get('x-octafuse-realtime-upgrade'), '1');
		assert.equal(calls.length, 1);
		assert.equal(calls[0]?.route.providerModelName, 'eleven_flash_v2_5');
		assert.equal(calls[0]?.route.upstreamOperation, 'audio.speech.realtime');
		assert.equal(calls[0]?.params.operation, 'audio.speech.realtime');
		assert.equal(calls[0]?.params.voiceId, 'voice_1');
		assert.equal(calls[0]?.params.query.output_format, 'pcm_16000');
	});

	it('routes STT realtime by model_id', async () => {
		const { dispatch, calls } = fakeDispatch();
		const response = await request(
			{ models: { scribe: STT_MODEL }, routes: [STT_ROUTE] },
			`${STT_PATH}?model_id=scribe&audio_format=pcm_16000`,
			{ dispatch }
		);
		assert.equal(response.status, 200);
		assert.equal(calls.length, 1);
		assert.equal(calls[0]?.route.providerModelName, 'scribe_v2_realtime');
		assert.equal(calls[0]?.params.operation, 'audio.transcriptions.realtime');
		assert.equal(calls[0]?.params.voiceId, undefined);
		assert.equal(calls[0]?.params.query.audio_format, 'pcm_16000');
	});

	it('accepts the gateway key via Authorization Bearer', async () => {
		const { dispatch, calls } = fakeDispatch();
		const response = await request(
			{ models: { scribe: STT_MODEL }, routes: [STT_ROUTE] },
			`${STT_PATH}?model_id=scribe`,
			{ headers: { 'xi-api-key': '', Authorization: 'Bearer sk-ok' }, dispatch }
		);
		assert.equal(response.status, 200);
		assert.equal(calls.length, 1);
	});

	it('accepts the gateway key via the octafuse-api-key subprotocol (browsers)', async () => {
		const { dispatch, calls } = fakeDispatch();
		const response = await request(
			{ models: { scribe: STT_MODEL }, routes: [STT_ROUTE] },
			`${STT_PATH}?model_id=scribe`,
			{
				headers: { 'xi-api-key': '', 'Sec-WebSocket-Protocol': 'octafuse-api-key.sk-ok' },
				dispatch,
			}
		);
		assert.equal(response.status, 200);
		assert.equal(calls.length, 1);
	});

	it('returns the upstream handshake error instead of upgrading', async () => {
		const { dispatch, calls } = fakeDispatch({ rejectStatus: 429 });
		const response = await request(
			{ models: { flash: TTS_MODEL }, routes: [TTS_ROUTE] },
			`${TTS_PATH}?model_id=flash`,
			{ dispatch }
		);
		assert.equal(calls.length, 1);
		assert.equal(response.status, 429);
		assert.equal(response.headers.get('x-octafuse-realtime-upgrade'), null);
	});

	it('does not expose multi-stream-input', async () => {
		const { dispatch, calls } = fakeDispatch();
		const response = await request(
			{ models: { flash: TTS_MODEL }, routes: [TTS_ROUTE] },
			'/elevenlabs/v1/text-to-speech/voice_1/multi-stream-input?model_id=flash',
			{ dispatch }
		);
		assert.equal(response.status, 404);
		assert.equal(calls.length, 0);
	});
});
