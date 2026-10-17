import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RouteResult } from "../model-router";
import {
	buildDashScopeTaskFailedEvent,
	DashScopeRealtimeClientSession,
	dashScopeInferenceOperationForTask,
	inspectDashScopeClientFrame,
} from "./dashscope-realtime-session";
import {
	createRealtimeSocket,
	type RealtimeFrameData,
} from "./dashscope-realtime-socket";

function route(overrides: Partial<RouteResult> = {}): RouteResult {
	return {
		targetId: "route-1",
		modelSurfaceId: "surface-1",
		routePoolId: "pool-1",
		providerId: "dashscope",
		providerName: "DashScope",
		providerModelName: "fun-asr-realtime-v2",
		upstreamProtocol: "dashscope",
		upstreamOperation: "audio.transcriptions.realtime.inference",
		adapter: "passthrough",
		providerEndpoints: {
			dashscope: { base: "https://dashscope.aliyuncs.com/api/v1" },
		},
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
		emitClose: (code = 1000, reason = "") => handlers.close(code, reason),
		emitError: () => handlers.error(),
	};
}

function runTask(model: string, taskId = "task-1", task = "asr"): string {
	return JSON.stringify({
		header: { action: "run-task", task_id: taskId, streaming: "duplex" },
		payload: { task_group: "audio", task, function: "recognition", model },
	});
}

function finishTask(taskId: string): string {
	return JSON.stringify({ header: { action: "finish-task", task_id: taskId } });
}

describe("DashScope run-task inspection", () => {
	it("reads action, task id, model and task from a client frame", () => {
		assert.deepEqual(inspectDashScopeClientFrame(runTask(" fun-asr:cn ", "t9", "tts")), {
			action: "run-task",
			taskId: "t9",
			model: "fun-asr:cn",
			task: "tts",
		});
	});

	it("returns null for non-JSON text and fills blanks for other JSON", () => {
		assert.equal(inspectDashScopeClientFrame("not json"), null);
		assert.equal(inspectDashScopeClientFrame("[1]"), null);
		assert.deepEqual(inspectDashScopeClientFrame("{}"), {
			action: "",
			taskId: "",
			model: "",
			task: "",
		});
	});

	it("derives the realtime inference operation from payload.task like the official API", () => {
		assert.equal(
			dashScopeInferenceOperationForTask("asr"),
			"audio.transcriptions.realtime.inference"
		);
		assert.equal(
			dashScopeInferenceOperationForTask("tts"),
			"audio.speech.realtime.inference"
		);
		assert.equal(dashScopeInferenceOperationForTask("stt"), null);
		assert.equal(dashScopeInferenceOperationForTask(""), null);
	});

	it("builds a DashScope task-failed event with the client's task id", () => {
		const event = JSON.parse(
			buildDashScopeTaskFailedEvent("task-7", "gateway.model_not_found", "Model not found: x")
		);
		assert.equal(event.header.event, "task-failed");
		assert.equal(event.header.task_id, "task-7");
		assert.equal(event.header.error_code, "gateway.model_not_found");
		assert.equal(event.header.error_message, "Model not found: x");
		assert.deepEqual(event.payload, {});
	});
});

describe("DashScope deferred session: waiting for run-task", () => {
	it("resolves with the request when run-task arrives after the wait started", async () => {
		const client = fakeSocket();
		const session = new DashScopeRealtimeClientSession(client.socket);
		const waiting = session.waitForRunTask(1000);
		client.emitMessage(runTask("fun-asr-realtime", "t1", "asr"));
		const result = await waiting;
		assert.deepEqual(result, {
			ok: true,
			request: { taskId: "t1", model: "fun-asr-realtime", task: "asr" },
		});
		assert.equal(client.closes.length, 0);
	});

	it("still returns the request when run-task arrived before waiting", async () => {
		const client = fakeSocket();
		const session = new DashScopeRealtimeClientSession(client.socket);
		client.emitMessage(runTask("m"));
		const result = await session.waitForRunTask(1000);
		assert.equal(result.ok, true);
	});

	it("closes with 1008 when the first frame is not run-task", async () => {
		const client = fakeSocket();
		const session = new DashScopeRealtimeClientSession(client.socket);
		const waiting = session.waitForRunTask(1000);
		client.emitMessage(finishTask("t1"));
		assert.deepEqual(await waiting, { ok: false, reason: "invalid" });
		assert.equal(client.closes[0]?.code, 1008);
		assert.equal(session.isClientClosed, true);
		assert.equal(session.signal.aborted, true);
	});

	it("closes with 1008 when the first frame is binary", async () => {
		const client = fakeSocket();
		const session = new DashScopeRealtimeClientSession(client.socket);
		client.emitMessage(new Uint8Array([1, 2, 3]));
		assert.deepEqual(await session.waitForRunTask(1000), { ok: false, reason: "invalid" });
		assert.equal(client.closes[0]?.code, 1008);
	});

	it("closes with 1008 when no run-task arrives in time", async () => {
		const client = fakeSocket();
		const session = new DashScopeRealtimeClientSession(client.socket);
		assert.deepEqual(await session.waitForRunTask(10), { ok: false, reason: "timeout" });
		assert.equal(client.closes[0]?.code, 1008);
	});

	it("reports closed when the client disconnects before run-task", async () => {
		const client = fakeSocket();
		const session = new DashScopeRealtimeClientSession(client.socket);
		const waiting = session.waitForRunTask(1000);
		client.emitClose(1001, "going away");
		assert.deepEqual(await waiting, { ok: false, reason: "closed" });
		assert.equal(session.isClientClosed, true);
		assert.equal(session.signal.aborted, true);
	});

	it("closes with 1008 when buffered frames exceed the limit", async () => {
		const client = fakeSocket();
		const session = new DashScopeRealtimeClientSession(client.socket, {
			maxBufferedFrames: 2,
		});
		const waiting = session.waitForRunTask(1000);
		client.emitMessage(runTask("m"));
		await waiting;
		client.emitMessage(new Uint8Array([1]));
		assert.equal(client.closes.length, 0);
		client.emitMessage(new Uint8Array([2]));
		assert.equal(client.closes[0]?.code, 1008);
		assert.match(client.closes[0]?.reason ?? "", /buffer overflow/);
		assert.equal(session.isClientClosed, true);
	});

	it("replies task-failed and closes normally via failAndClose", async () => {
		const client = fakeSocket();
		const session = new DashScopeRealtimeClientSession(client.socket);
		client.emitMessage(runTask("missing-model", "t5"));
		await session.waitForRunTask(1000);
		session.failAndClose("t5", "gateway.model_not_found", "Model not found: missing-model");
		const event = JSON.parse(String(client.sent[0]));
		assert.equal(event.header.event, "task-failed");
		assert.equal(event.header.task_id, "t5");
		assert.equal(client.closes[0]?.code, 1000);
	});
});

describe("DashScope deferred session: bridge", () => {
	async function started(model = "fun-asr-realtime") {
		const client = fakeSocket();
		const upstream = fakeSocket();
		const session = new DashScopeRealtimeClientSession(client.socket);
		return { client, upstream, session, model };
	}

	it("replays buffered frames in order with the provider model, then forwards live frames", async () => {
		const { client, upstream, session } = await started();
		const waiting = session.waitForRunTask(1000);
		client.emitMessage(runTask("fun-asr-realtime", "t1"));
		await waiting;
		// 连接上游期间收到的音频帧
		client.emitMessage(new Uint8Array([1, 2]));
		client.emitMessage(new Uint8Array([3]));

		const usagePromise = session.bridge({
			upstream: upstream.socket,
			route: route({ providerModelName: "fun-asr-realtime-v2" }),
			operation: "audio.transcriptions.realtime.inference",
			model: "fun-asr-realtime",
		});
		assert.equal(upstream.sent.length, 3);
		assert.equal(JSON.parse(String(upstream.sent[0])).payload.model, "fun-asr-realtime-v2");
		assert.deepEqual([...(upstream.sent[1] as Uint8Array)], [1, 2]);
		assert.deepEqual([...(upstream.sent[2] as Uint8Array)], [3]);

		client.emitMessage(new Uint8Array([4]));
		client.emitMessage(finishTask("t1"));
		assert.equal(upstream.sent.length, 5);
		assert.deepEqual(JSON.parse(String(upstream.sent[4])).header.action, "finish-task");

		upstream.emitMessage(
			JSON.stringify({
				header: { event: "task-finished", task_id: "t1" },
				payload: { usage: { duration: 2.5 } },
			})
		);
		assert.equal(client.sent.length, 1);
		upstream.emitClose(1000, "");
		const usage = await usagePromise;
		assert.equal(usage.audio_duration_seconds, 2.5);
		assert.equal(usage.stream_error, undefined);
		assert.equal(client.closes[0]?.code, 1000);
	});

	it("fails only the second run-task when it changes the model, keeping the connection open", async () => {
		const { client, upstream, session } = await started();
		client.emitMessage(runTask("model-a", "t1"));
		await session.waitForRunTask(1000);
		const usagePromise = session.bridge({
			upstream: upstream.socket,
			route: route(),
			operation: "audio.transcriptions.realtime.inference",
			model: "model-a",
		});

		client.emitMessage(runTask("model-b", "t2"));
		const failed = JSON.parse(String(client.sent[0]));
		assert.equal(failed.header.event, "task-failed");
		assert.equal(failed.header.task_id, "t2");
		assert.equal(failed.header.error_code, "InvalidParameter");
		assert.match(failed.header.error_message, /model-a/);
		// 被拒任务的音频与 finish-task 都不能转给上游
		const before = upstream.sent.length;
		client.emitMessage(new Uint8Array([9]));
		client.emitMessage(finishTask("t2"));
		assert.equal(upstream.sent.length, before);
		assert.equal(client.closes.length, 0);
		assert.equal(upstream.closes.length, 0);

		// 同一模型的后续 run-task 正常放行，之后的音频也恢复转发
		client.emitMessage(runTask("model-a", "t3"));
		client.emitMessage(new Uint8Array([7]));
		assert.equal(upstream.sent.length, before + 2);
		assert.equal(JSON.parse(String(upstream.sent[before])).header.task_id, "t3");

		upstream.emitMessage(
			JSON.stringify({ header: { event: "task-finished", task_id: "t3" } })
		);
		upstream.emitClose(1000);
		await usagePromise;
	});

	it("closes upstream and records a cancelled usage when the client closes mid-stream", async () => {
		const { client, upstream, session } = await started();
		client.emitMessage(runTask("m", "t1"));
		await session.waitForRunTask(1000);
		const usagePromise = session.bridge({
			upstream: upstream.socket,
			route: route(),
			operation: "audio.transcriptions.realtime.inference",
			model: "m",
		});
		client.emitClose(1005);
		const usage = await usagePromise;
		assert.equal(upstream.closes.length, 1);
		assert.equal(usage.cancelled, true);
	});

	it("closes the client with the upstream code and marks incomplete usage as an error", async () => {
		const { client, upstream, session } = await started();
		client.emitMessage(runTask("m", "t1"));
		await session.waitForRunTask(1000);
		const usagePromise = session.bridge({
			upstream: upstream.socket,
			route: route(),
			operation: "audio.transcriptions.realtime.inference",
			model: "m",
		});
		upstream.emitClose(1011, "boom");
		const usage = await usagePromise;
		assert.equal(client.closes[0]?.code, 1011);
		assert.match(usage.stream_error ?? "", /1011/);
	});
});
