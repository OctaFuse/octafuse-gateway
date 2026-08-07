import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RouteResult } from "../model-router";
import {
	DashScopeRealtimeUsageCollector,
	dispatchDashScopeRealtime,
	outboundWebSocketFetchUrl,
	rewriteDashScopeRealtimeClientMessage,
} from "./dashscope-realtime-driver";

function route(overrides: Partial<RouteResult> = {}): RouteResult {
	return {
		targetId: "route-1",
		modelSurfaceId: "surface-1",
		routePoolId: "pool-1",
		providerId: "dashscope",
		providerName: "DashScope",
		providerModelName: "fun-asr-realtime",
		upstreamProtocol: "dashscope",
		upstreamOperation: "audio.transcriptions.realtime.inference",
		adapter: "passthrough",
		providerEndpoints: {},
		providerApiKey: "secret",
		priceOverrideRaw: null,
		routeMeteredProfileJson: null,
		routeChargedProfileJson: null,
		customParams: null,
		routeGroup: "default",
		routePriority: 0,
		routeWeight: 1,
		providerKeyId: null,
		providerKeyLabel: null,
		providerKeyFingerprint: null,
		...overrides,
	};
}

describe("DashScope realtime client event rewrite", () => {
	it("converts WSS endpoints to the HTTPS Upgrade URL required by Workers fetch", () => {
		assert.equal(
			outboundWebSocketFetchUrl(
				"wss://dashscope.aliyuncs.com/api-ws/v1/inference"
			).toString(),
			"https://dashscope.aliyuncs.com/api-ws/v1/inference"
		);
	});

	it("injects the routed provider model into inference run-task and preserves user overrides", () => {
		const result = JSON.parse(
			rewriteDashScopeRealtimeClientMessage(
				route({
					providerModelName: "fun-asr-realtime-2026",
					customParams: {
						payload: { parameters: { format: "pcm", sample_rate: 8000 } },
					},
				}),
				"audio.transcriptions.realtime.inference",
				JSON.stringify({
					// 官方客户端命令字段是 action；event 只用于服务端事件。
					header: { action: "run-task", task_id: "task-1" },
					payload: {
						model: "gateway-alias",
						parameters: { sample_rate: 16000 },
					},
				})
			)
		) as Record<string, any>;
		assert.equal(result.payload.model, "fun-asr-realtime-2026");
		assert.equal(result.payload.parameters.format, "pcm");
		assert.equal(result.payload.parameters.sample_rate, 16000);
	});

	it("merges route defaults only into session.update", () => {
		const configured = JSON.parse(
			rewriteDashScopeRealtimeClientMessage(
				route({
					customParams: { session: { sample_rate: 24000, voice: "Cherry" } },
				}),
				"audio.speech.realtime.session",
				JSON.stringify({ type: "session.update", session: { voice: "Serena" } })
			)
		) as Record<string, any>;
		assert.equal(configured.session.sample_rate, 24000);
		assert.equal(configured.session.voice, "Serena");

		const untouched = JSON.stringify({
			type: "input_text_buffer.append",
			text: "hello",
		});
		assert.equal(
			rewriteDashScopeRealtimeClientMessage(
				route({ customParams: { session: { voice: "Cherry" } } }),
				"audio.speech.realtime.session",
				untouched
			),
			untouched
		);
	});
});

describe("DashScope realtime usage collection", () => {
	it("replaces cumulative usage within a task and sums separate tasks", () => {
		const collector = new DashScopeRealtimeUsageCollector();
		collector.observeServerMessage(
			JSON.stringify({
				header: { event: "result-generated", task_id: "task-1" },
				payload: { usage: { duration: 2 } },
			})
		);
		collector.observeServerMessage(
			JSON.stringify({
				header: { event: "result-generated", task_id: "task-1" },
				payload: { usage: { duration: 3 } },
			})
		);
		collector.observeServerMessage(
			JSON.stringify({
				header: { event: "task-finished", task_id: "task-2" },
				payload: { usage: { duration: 1 } },
			})
		);
		const usage = collector.toUsage({ clientClosedFirst: true });
		assert.equal(usage.audio_duration_seconds, 4);
		assert.equal(usage.cancelled, false);
	});

	it("captures Qwen realtime character/token usage without deriving missing characters", () => {
		const collector = new DashScopeRealtimeUsageCollector();
		collector.observeServerMessage(
			JSON.stringify({
				type: "response.done",
				response: {
					id: "response-1",
					usage: {
						characters: 25,
						input_tokens: 3,
						output_tokens: 64,
						total_tokens: 67,
					},
				},
			})
		);
		const usage = collector.toUsage({ clientClosedFirst: false });
		assert.equal(usage.audio_characters, 25);
		assert.equal(usage.input_tokens, 3);
		assert.equal(usage.output_tokens, 64);
		assert.equal(usage.total_tokens, 67);
		assert.equal(usage.stream_error, undefined);
	});

	it("marks native failure events and unfinished client disconnects explicitly", () => {
		const failed = new DashScopeRealtimeUsageCollector();
		failed.observeServerMessage(
			JSON.stringify({
				header: {
					event: "task-failed",
					task_id: "task-1",
					error_code: "CLIENT_ERROR",
					error_message: "invalid audio format",
				},
				payload: {},
			})
		);
		assert.equal(
			failed.toUsage({ clientClosedFirst: false }).stream_error,
			"invalid audio format"
		);

		const unfinished = new DashScopeRealtimeUsageCollector();
		assert.equal(
			unfinished.toUsage({ clientClosedFirst: true }).cancelled,
			true
		);
		assert.equal(
			unfinished.toUsage({ clientClosedFirst: false }).stream_error,
			"Upstream WebSocket closed before a terminal event"
		);
	});
});

class FakeSocket extends EventTarget {
	public readyState = 1;
	public binaryType = "blob";
	public acceptOptions: unknown;
	public closeCalls: Array<{ code: number; reason: string }> = [];

	accept(options?: unknown): void {
		this.acceptOptions = options;
	}

	send(_data: unknown): void {}

	close(code = 1000, reason = ""): void {
		this.closeCalls.push({ code, reason });
		this.readyState = 3;
	}
}

function dispatchClose(socket: FakeSocket, code: number, reason: string): void {
	socket.readyState = 2;
	const event = new Event("close");
	Object.defineProperties(event, {
		code: { value: code },
		reason: { value: reason },
	});
	socket.dispatchEvent(event);
}

describe("DashScope realtime bridge lifecycle", () => {
	it("completes a client close after task-finished without marking usage as an error", async () => {
		const client = new FakeSocket();
		const server = new FakeSocket();
		const upstream = new FakeSocket();
		const previousWebSocket = globalThis.WebSocket;
		const previousResponse = globalThis.Response;
		const previousWebSocketPair = (globalThis as typeof globalThis & {
			WebSocketPair?: unknown;
		}).WebSocketPair;
		(globalThis as typeof globalThis & { WebSocket: unknown }).WebSocket = {
			CLOSING: 2,
			CLOSED: 3,
		};
		(globalThis as typeof globalThis & { WebSocketPair: unknown }).WebSocketPair =
			class {
				0 = client;
				1 = server;
			};
		// Node 的 Response 禁止构造 101；Workers Upgrade Response 允许该状态，测试用最小替身模拟运行时。
		(globalThis as typeof globalThis & { Response: unknown }).Response = class {
			readonly status = 101;
			readonly webSocket = client;
			constructor(
				_body: unknown,
				_init: { status: number; webSocket: WebSocket; headers: Headers }
			) {}
		} as unknown as typeof Response;

		try {
			const result = await dispatchDashScopeRealtime(
			{
				...route({
					providerEndpoints: {
						dashscope: { base: "https://dashscope.aliyuncs.com/api/v1" },
					},
				}),
			},
			"audio.transcriptions.realtime.inference",
			undefined,
			undefined,
			undefined,
			{ fetchImpl: (async () => ({
				status: 101,
				headers: new Headers(),
				webSocket: upstream,
			})) as typeof fetch }
			);

			assert.equal(result.response.status, 101);
			assert.deepEqual(server.acceptOptions, { allowHalfOpen: true });
			assert.deepEqual(upstream.acceptOptions, { allowHalfOpen: true });
			upstream.dispatchEvent(
				new MessageEvent("message", {
					data: JSON.stringify({
						header: { event: "task-finished", task_id: "task-1" },
						payload: { usage: { duration: 5 } },
					}),
				})
			);

			dispatchClose(server, 1000, "client finished");
			const usage = await result.usagePromise;
			assert.equal(usage.audio_duration_seconds, 5);
			assert.equal(usage.stream_error, undefined);
			assert.equal(usage.cancelled, false);
			assert.equal(server.closeCalls.length, 1);
			assert.equal(upstream.closeCalls.length, 1);
		} finally {
			if (previousWebSocket === undefined) delete (globalThis as { WebSocket?: unknown }).WebSocket;
			else (globalThis as typeof globalThis & { WebSocket: unknown }).WebSocket = previousWebSocket;
			(globalThis as typeof globalThis & { Response: typeof Response }).Response = previousResponse;
			if (previousWebSocketPair === undefined) {
				delete (globalThis as { WebSocketPair?: unknown }).WebSocketPair;
			} else {
				(globalThis as typeof globalThis & { WebSocketPair: unknown }).WebSocketPair = previousWebSocketPair;
			}
		}
	});
});
