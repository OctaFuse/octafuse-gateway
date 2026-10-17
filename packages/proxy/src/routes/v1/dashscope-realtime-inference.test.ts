/**
 * `GET /dashscope/api-ws/v1/inference`：升级后先接受下游，读到 run-task 的
 * `payload.model` / `payload.task` 才选路由、连上游（Node 绑定注入假运行时）。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { GatewayRepositories, StorageContext } from '@octafuse/core';
import { GatewayErrorCode } from '../../services/gateway-error-codes';
import { createProxyApp } from '../../app';
import type { RouteResult } from '../../services/model-router';
import {
	createRealtimeSocket,
	type RealtimeFrameData,
} from '../../services/egress/dashscope-realtime-socket';
import type {
	DeferredRealtimeRuntime,
	RealtimeUpstreamConnect,
} from '../../services/egress/dashscope-realtime-session';

function fakeSocket() {
	const sent: RealtimeFrameData[] = [];
	const closes: Array<{ code?: number; reason?: string }> = [];
	let handlers!: {
		message(data: RealtimeFrameData): void;
		close(code: number, reason: string): void;
		error(): void;
	};
	const socket = createRealtimeSocket({
		send: (data) => {
			sent.push(data);
		},
		close: (code, reason) => {
			closes.push({ code, reason });
		},
		subscribe: (h) => {
			handlers = h;
		},
	});
	return {
		socket,
		sent,
		closes,
		emitMessage: (data: RealtimeFrameData) => handlers.message(data),
		emitClose: (code = 1000, reason = '') => handlers.close(code, reason),
	};
}

type Mocks = {
	models?: Record<string, Record<string, unknown>>;
	routes?: Array<Record<string, unknown>>;
};

/** 未显式提供的仓储方法一律返回 `null`，只实现这条路径会用到的几个。 */
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
			}),
		},
		modelRouting: {
			getModelById: (async (id: string) => mocks.models?.[id] ?? null) as never,
			resolveModelSurface: async () => null,
			getModelRoutesByModelId: async () => mocks.routes ?? [],
		},
		providers: {
			getProviderById: async () => ({
				id: 'dashscope',
				name: 'DashScope',
				status: 'active',
				api_key: 'secret',
				endpoints: JSON.stringify({
					dashscope: { base: 'https://dashscope.aliyuncs.com/api/v1' },
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
						get: (_inner, method: string) =>
							overrides[namespace]?.[method] ?? (async () => null),
					}
				),
		}
	) as unknown as GatewayRepositories;
}

function appWith(mocks: Mocks = {}) {
	return createProxyApp(async () => ({ client: {}, repositories: buildRepos(mocks) }) as unknown as StorageContext);
}

function runTask(model: string, task = 'asr', taskId = 'task-1'): string {
	return JSON.stringify({
		header: { action: 'run-task', task_id: taskId, streaming: 'duplex' },
		payload: { task_group: 'audio', task, function: 'recognition', model },
	});
}

async function waitFor(condition: () => boolean, label: string): Promise<void> {
	for (let i = 0; i < 200; i += 1) {
		if (condition()) return;
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	assert.fail(`timed out waiting for ${label}`);
}

async function openInference(
	mocks: Mocks,
	connectUpstream: RealtimeUpstreamConnect = async () => {
		throw new Error('upstream must not be connected');
	}
) {
	const client = fakeSocket();
	const connects: RouteResult[] = [];
	const runtime: DeferredRealtimeRuntime = {
		client: client.socket,
		connectUpstream: async (route, ...rest) => {
			connects.push(route);
			return connectUpstream(route, ...rest);
		},
	};
	const response = await appWith(mocks).request(
		'/dashscope/api-ws/v1/inference',
		{ headers: { Upgrade: 'websocket', Authorization: 'bearer sk-ok' } },
		{ NODE_REALTIME_DEFERRED: () => runtime }
	);
	return { client, connects, response };
}

const ASR_MODEL = { id: 'fun-asr-realtime', display_name: 'Fun-ASR' };
const ASR_ROUTE = {
	id: 'route-1',
	model_id: 'fun-asr-realtime',
	provider_id: 'dashscope',
	provider_model_name: 'fun-asr-realtime-v2',
	priority: 0,
	status: 'active',
	route_group: 'default',
	weight: 1,
	price_override: null,
	custom_params: null,
	upstream_protocol: 'dashscope',
	route_pool_id: 'pool-1',
	upstream_operation: 'audio.transcriptions.realtime.inference',
	adapter: 'passthrough',
};

function lastEvent(client: ReturnType<typeof fakeSocket>) {
	return JSON.parse(String(client.sent[client.sent.length - 1]));
}

describe('DashScope realtime inference (deferred upstream)', () => {
	it('rejects a non-WebSocket request with 426', async () => {
		const response = await appWith().request(
			'/dashscope/api-ws/v1/inference',
			{ headers: { Authorization: 'Bearer sk-ok' } },
			{ NODE_REALTIME_DEFERRED: () => fakeSocketRuntime() }
		);
		assert.equal(response.status, 426);
	});

	it('accepts the downstream without connecting upstream and asks node.ts to resume reading', async () => {
		const { response, connects } = await openInference({});
		assert.equal(response.headers.get('x-octafuse-realtime-upgrade'), '1');
		assert.equal(connects.length, 0);
	});

	it('closes with 1008 when the first frame is not run-task', async () => {
		const { client, connects } = await openInference({});
		client.emitMessage(JSON.stringify({ header: { action: 'finish-task', task_id: 'x' } }));
		await waitFor(() => client.closes.length > 0, 'close');
		assert.equal(client.closes[0]?.code, 1008);
		assert.equal(connects.length, 0);
	});

	it('answers task-failed for an unsupported payload.task', async () => {
		const { client, connects } = await openInference({ models: { 'fun-asr-realtime': ASR_MODEL } });
		client.emitMessage(runTask('fun-asr-realtime', 'stt', 'task-9'));
		await waitFor(() => client.closes.length > 0, 'close');
		const event = lastEvent(client);
		assert.equal(event.header.event, 'task-failed');
		assert.equal(event.header.task_id, 'task-9');
		assert.equal(event.header.error_code, 'InvalidParameter');
		assert.equal(client.closes[0]?.code, 1000);
		assert.equal(connects.length, 0);
	});

	it('answers task-failed when payload.model is missing', async () => {
		const { client } = await openInference({});
		client.emitMessage(runTask('', 'asr', 'task-2'));
		await waitFor(() => client.closes.length > 0, 'close');
		const event = lastEvent(client);
		assert.equal(event.header.error_code, 'InvalidParameter');
		assert.match(event.header.error_message, /payload\.model/);
	});

	it('answers task-failed when the model does not exist', async () => {
		const { client, connects } = await openInference({});
		client.emitMessage(runTask('no-such-model', 'asr', 'task-3'));
		await waitFor(() => client.closes.length > 0, 'close');
		const event = lastEvent(client);
		assert.equal(event.header.event, 'task-failed');
		assert.equal(event.header.task_id, 'task-3');
		assert.equal(event.header.error_code, GatewayErrorCode.modelNotFound);
		assert.match(event.header.error_message, /no-such-model/);
		assert.equal(connects.length, 0);
	});

	it('answers task-failed when the model has no route for the task operation', async () => {
		const { client, connects } = await openInference({
			models: { 'fun-asr-realtime': ASR_MODEL },
			routes: [],
		});
		client.emitMessage(runTask('fun-asr-realtime', 'asr', 'task-4'));
		await waitFor(() => client.closes.length > 0, 'close');
		const event = lastEvent(client);
		assert.equal(event.header.error_code, GatewayErrorCode.noRoute);
		assert.equal(connects.length, 0);
	});

	it('answers task-failed when every upstream connection fails', async () => {
		const { client, connects } = await openInference(
			{ models: { 'fun-asr-realtime': ASR_MODEL }, routes: [ASR_ROUTE] },
			async () => ({ response: new Response('nope', { status: 503 }), requestId: null })
		);
		client.emitMessage(runTask('fun-asr-realtime', 'asr', 'task-5'));
		await waitFor(() => client.closes.length > 0, 'close');
		const event = lastEvent(client);
		assert.equal(event.header.event, 'task-failed');
		assert.equal(event.header.task_id, 'task-5');
		assert.ok(connects.length >= 1);
		assert.equal(client.closes[0]?.code, 1000);
	});

	it('routes by run-task, connects upstream, replays frames and bridges events', async () => {
		const upstream = fakeSocket();
		const { client, connects } = await openInference(
			{ models: { 'fun-asr-realtime': ASR_MODEL }, routes: [ASR_ROUTE] },
			async () => ({ socket: upstream.socket, requestId: 'req-1' })
		);
		// run-task 与紧随其后的音频帧在连接上游之前就到达
		client.emitMessage(runTask('fun-asr-realtime', 'asr', 'task-6'));
		client.emitMessage(new Uint8Array([1, 2, 3]));
		await waitFor(() => upstream.sent.length >= 2, 'replayed frames');

		assert.equal(connects.length, 1);
		assert.equal(connects[0]?.providerModelName, 'fun-asr-realtime-v2');
		assert.equal(connects[0]?.upstreamOperation, 'audio.transcriptions.realtime.inference');
		const forwarded = JSON.parse(String(upstream.sent[0]));
		assert.equal(forwarded.header.action, 'run-task');
		assert.equal(forwarded.payload.model, 'fun-asr-realtime-v2');
		assert.deepEqual([...(upstream.sent[1] as Uint8Array)], [1, 2, 3]);

		upstream.emitMessage(
			JSON.stringify({ header: { event: 'task-started', task_id: 'task-6' }, payload: {} })
		);
		await waitFor(() => client.sent.length >= 1, 'event relay');
		assert.equal(lastEvent(client).header.event, 'task-started');

		upstream.emitMessage(
			JSON.stringify({
				header: { event: 'task-finished', task_id: 'task-6' },
				payload: { usage: { duration: 3 } },
			})
		);
		upstream.emitClose(1000, '');
		await waitFor(() => client.closes.length > 0, 'client close');
		assert.equal(client.closes[0]?.code, 1000);
	});

	it('picks the TTS operation from payload.task', async () => {
		const upstream = fakeSocket();
		const ttsRoute = {
			...ASR_ROUTE,
			id: 'route-tts',
			model_id: 'cosyvoice-v2',
			provider_model_name: 'cosyvoice-v2',
			upstream_operation: 'audio.speech.realtime.inference',
		};
		const { client, connects } = await openInference(
			{ models: { 'cosyvoice-v2': { id: 'cosyvoice-v2' } }, routes: [ttsRoute] },
			async () => ({ socket: upstream.socket, requestId: null })
		);
		client.emitMessage(runTask('cosyvoice-v2', 'tts', 'task-7'));
		await waitFor(() => connects.length === 1, 'connect');
		assert.equal(connects[0]?.upstreamOperation, 'audio.speech.realtime.inference');
		upstream.emitClose(1000, '');
	});
});

function fakeSocketRuntime(): DeferredRealtimeRuntime {
	return {
		client: fakeSocket().socket,
		connectUpstream: async () => {
			throw new Error('unused');
		},
	};
}
