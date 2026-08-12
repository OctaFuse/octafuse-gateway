/**
 * DashScope 原生实时音频 WebSocket 驱动：
 * - inference：Fun-ASR / Paraformer / CosyVoice / Sambert 的 run-task 生命周期。
 * - session：Qwen-ASR-Realtime / Qwen-TTS-Realtime 的 session 生命周期。
 *
 * 对外保持 DashScope 原生事件，网关只替换供应商模型名、转发帧并汇总真实 usage。
 */
import { resolveUpstreamEndpoint } from "@octafuse/core/provider-endpoints";
import type { ProxyDispatchResult } from "../failover-dispatch";
import type { RouteResult } from "../model-router";
import { EMPTY_USAGE, type UsageFromStream } from "../proxy";
import type {
	RequestTimingAttempt,
	RequestTimingCollector,
} from "../request-timing";
import { buildRouteRequestBody } from "../route-default-params";
import { extractUpstreamRequestId } from "./upstream-request-id";

export const DASHSCOPE_REALTIME_OPERATIONS = [
	"audio.transcriptions.realtime.inference",
	"audio.transcriptions.realtime.session",
	"audio.speech.realtime.inference",
	"audio.speech.realtime.session",
] as const;

export type DashScopeRealtimeOperation =
	(typeof DASHSCOPE_REALTIME_OPERATIONS)[number];

type JsonObject = Record<string, unknown>;

type UsageSnapshot = {
	duration: number;
	characters: number;
	inputTokens: number;
	outputTokens: number;
	totalTokens: number;
	raw: unknown;
};

export type DashScopeRealtimeDispatchOptions = {
	fetchImpl?: typeof fetch;
	/** 浏览器通过 Sec-WebSocket-Protocol 鉴权时，回写被选中的 token。 */
	responseProtocol?: string;
	/** Node 运行时的 upgrade 适配器；Worker 继续使用 WebSocketPair。 */
	nodeDispatch?: DashScopeRealtimeNodeDispatch;
};

export type DashScopeRealtimeNodeDispatch = (
	route: RouteResult,
	operation: DashScopeRealtimeOperation,
	requestSignal?: AbortSignal,
	timing?: RequestTimingCollector | null,
	attempt?: RequestTimingAttempt
) => Promise<ProxyDispatchResult>;

function asObject(value: unknown): JsonObject | null {
	return value != null && typeof value === "object" && !Array.isArray(value)
		? (value as JsonObject)
		: null;
}

function finiteNonNegative(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0
		? value
		: 0;
}

function eventName(event: JsonObject): string {
	const header = asObject(event.header);
	// DashScope inference 客户端命令使用 header.action，服务端事件使用 header.event。
	if (typeof header?.action === "string") return header.action;
	if (typeof header?.event === "string") return header.event;
	return typeof event.type === "string" ? event.type : "";
}

function eventUsage(event: JsonObject): JsonObject | null {
	const payload = asObject(event.payload);
	const response = asObject(event.response);
	return (
		asObject(payload?.usage) ??
		asObject(response?.usage) ??
		asObject(event.usage)
	);
}

function usageKey(event: JsonObject): string {
	const header = asObject(event.header);
	if (typeof header?.task_id === "string" && header.task_id) {
		return `task:${header.task_id}`;
	}
	const response = asObject(event.response);
	if (typeof response?.id === "string" && response.id)
		return `response:${response.id}`;
	if (typeof event.response_id === "string" && event.response_id) {
		return `response:${event.response_id}`;
	}
	return "connection";
}

function eventFailureMessage(event: JsonObject, name: string): string | null {
	if (name !== "task-failed" && name !== "error") return null;
	const header = asObject(event.header);
	const payload = asObject(event.payload);
	const error = asObject(event.error);
	const message =
		(typeof header?.error_message === "string" && header.error_message) ||
		(typeof payload?.message === "string" && payload.message) ||
		(typeof error?.message === "string" && error.message) ||
		(typeof event.message === "string" && event.message);
	return message || `DashScope realtime event ${name}`;
}

/** 从原生服务端事件中按 task/response 累计真实计费 usage。 */
export class DashScopeRealtimeUsageCollector {
	private readonly snapshots = new Map<string, UsageSnapshot>();
	private completed = false;
	private failure: string | null = null;

	observeServerMessage(message: string): void {
		let event: JsonObject;
		try {
			const parsed = JSON.parse(message) as unknown;
			const object = asObject(parsed);
			if (!object) return;
			event = object;
		} catch {
			return;
		}

		const name = eventName(event);
		if (
			name === "task-finished" ||
			name === "session.finished" ||
			name === "response.done"
		) {
			this.completed = true;
		}
		this.failure = eventFailureMessage(event, name) ?? this.failure;

		const usage = eventUsage(event);
		if (!usage) return;
		this.snapshots.set(usageKey(event), {
			duration: finiteNonNegative(usage.duration),
			characters: finiteNonNegative(usage.characters),
			inputTokens: finiteNonNegative(usage.input_tokens),
			outputTokens: finiteNonNegative(usage.output_tokens),
			totalTokens: finiteNonNegative(usage.total_tokens),
			raw: usage,
		});
	}

	toUsage(options: {
		clientClosedFirst: boolean;
		transportError?: string | null;
	}): UsageFromStream {
		let duration = 0;
		let characters = 0;
		let inputTokens = 0;
		let outputTokens = 0;
		let totalTokens = 0;
		const rawSources: unknown[] = [];
		for (const snapshot of this.snapshots.values()) {
			duration += snapshot.duration;
			characters += snapshot.characters;
			inputTokens += snapshot.inputTokens;
			outputTokens += snapshot.outputTokens;
			totalTokens += snapshot.totalTokens;
			rawSources.push(snapshot.raw);
		}
		// 上游正常关闭并不等于任务成功；必须收到协议终态，避免把被截断的音频误记为成功。
		const incompleteUpstream =
			!this.completed && !options.clientClosedFirst
				? "Upstream WebSocket closed before a terminal event"
				: undefined;
		const streamError =
			this.failure ?? options.transportError ?? incompleteUpstream;
		return {
			...EMPTY_USAGE,
			input_tokens: inputTokens,
			output_tokens: outputTokens,
			total_tokens: totalTokens || inputTokens + outputTokens,
			raw_usage:
				rawSources.length > 0 ? JSON.stringify({ sources: rawSources }) : null,
			audio_duration_seconds: duration,
			audio_characters: characters,
			cancelled: options.clientClosedFirst && !this.completed && !streamError,
			stream_error: streamError,
		};
	}
}

function isInferenceOperation(operation: DashScopeRealtimeOperation): boolean {
	return operation.endsWith(".inference");
}

function isSessionOperation(operation: DashScopeRealtimeOperation): boolean {
	return operation.endsWith(".session");
}

/** 仅改写任务启动/会话配置帧；音频二进制帧和其他事件完全透传。 */
export function rewriteDashScopeRealtimeClientMessage(
	route: RouteResult,
	operation: DashScopeRealtimeOperation,
	message: string
): string {
	let event: JsonObject;
	try {
		const parsed = JSON.parse(message) as unknown;
		const object = asObject(parsed);
		if (!object) return message;
		event = object;
	} catch {
		return message;
	}
	const name = eventName(event);
	const shouldMerge =
		(isInferenceOperation(operation) && name === "run-task") ||
		(isSessionOperation(operation) && name === "session.update");
	if (!shouldMerge) return message;

	const merged = buildRouteRequestBody(route, event);
	if (name === "run-task") {
		const payload = asObject(merged.payload) ?? {};
		merged.payload = { ...payload, model: route.providerModelName };
	}
	return JSON.stringify(merged);
}

function realtimeCapability(
	operation: DashScopeRealtimeOperation
): "audio.realtime.inference" | "audio.realtime.session" {
	return isInferenceOperation(operation)
		? "audio.realtime.inference"
		: "audio.realtime.session";
}

/** Workers 通过 HTTP(S) Upgrade 建立出站 WebSocket，fetch 不能直接接收 ws(s) URL。 */
export function outboundWebSocketFetchUrl(endpoint: string): URL {
	const url = new URL(endpoint);
	if (url.protocol === "wss:") url.protocol = "https:";
	if (url.protocol === "ws:") url.protocol = "http:";
	return url;
}

function closeSocket(socket: WebSocket, code = 1000, reason = ""): void {
	// Workers' allowHalfOpen sockets remain CLOSING after the peer sends Close;
	// calling close again is required to complete that handshake.
	if (socket.readyState === WebSocket.CLOSED) return;
	socket.close(code, reason.slice(0, 123));
}

function bridgeSockets(params: {
	client: WebSocket;
	server: WebSocket;
	upstream: WebSocket;
	route: RouteResult;
	operation: DashScopeRealtimeOperation;
	timing?: RequestTimingCollector | null;
}): Promise<UsageFromStream> {
	const { client, server, upstream, route, operation, timing } = params;
	const collector = new DashScopeRealtimeUsageCollector();
	let settled = false;
	let clientClosedFirst = false;

	return new Promise<UsageFromStream>((resolve) => {
		const finish = (transportError?: string | null) => {
			if (settled) return;
			settled = true;
			timing?.markStreamComplete();
			resolve(collector.toUsage({ clientClosedFirst, transportError }));
		};

		server.accept({ allowHalfOpen: true });
		upstream.binaryType = "arraybuffer";
		// fetch 返回的出站 WebSocket 由 Worker 自己消费，必须显式 accept 后才能收发。
		upstream.accept({ allowHalfOpen: true });

		server.addEventListener("message", (event) => {
			try {
				const data =
					typeof event.data === "string"
						? rewriteDashScopeRealtimeClientMessage(
								route,
								operation,
								event.data
						  )
						: event.data;
				upstream.send(data);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				closeSocket(server, 1011, "Gateway upstream send failed");
				closeSocket(upstream, 1011, "Gateway upstream send failed");
				finish(message);
			}
		});

		upstream.addEventListener("message", (event) => {
			try {
				if (typeof event.data === "string")
					collector.observeServerMessage(event.data);
				server.send(event.data);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				closeSocket(server, 1011, "Gateway client send failed");
				closeSocket(upstream, 1011, "Gateway client send failed");
				finish(message);
			}
		});

		server.addEventListener("close", (event) => {
			clientClosedFirst = true;
			closeSocket(upstream, event.code, event.reason);
			// `server.accept({ allowHalfOpen: true })` leaves this side in CLOSING.
			// Complete the client close handshake before recording usage.
			closeSocket(server, event.code, event.reason);
			finish();
		});
		upstream.addEventListener("close", (event) => {
			closeSocket(server, event.code, event.reason);
			finish(
				event.code === 1000
					? null
					: `Upstream WebSocket closed with code ${event.code}`
			);
		});
		server.addEventListener("error", () => {
			clientClosedFirst = true;
			closeSocket(upstream, 1011, "Client WebSocket error");
			finish("Client WebSocket transport error");
		});
		upstream.addEventListener("error", () => {
			closeSocket(server, 1011, "Upstream WebSocket error");
			finish("Upstream WebSocket transport error");
		});
	});
}

/** 使用 Workers outbound WebSocket fetch 建立上游，再通过 WebSocketPair 对外暴露本地连接。 */
export async function dispatchDashScopeRealtime(
	route: RouteResult,
	operation: DashScopeRealtimeOperation,
	requestSignal?: AbortSignal,
	timing?: RequestTimingCollector | null,
	attempt?: RequestTimingAttempt,
	options: DashScopeRealtimeDispatchOptions = {}
): Promise<ProxyDispatchResult> {
	if (options.nodeDispatch) {
		return options.nodeDispatch(route, operation, requestSignal, timing, attempt);
	}
	if (typeof WebSocketPair === "undefined") {
		return {
			response: new Response(
				JSON.stringify({
					error: {
						message:
							"DashScope realtime requires the Cloudflare Workers runtime",
					},
				}),
				{ status: 501, headers: { "Content-Type": "application/json" } }
			),
			usagePromise: Promise.resolve(EMPTY_USAGE),
			upstreamRequestId: null,
		};
	}

	const capability = realtimeCapability(operation);
	const endpoint = resolveUpstreamEndpoint(
		"dashscope",
		capability,
		route.providerEndpoints,
		{
			providerId: route.providerId,
		}
	);
	const url = outboundWebSocketFetchUrl(endpoint);
	if (isSessionOperation(operation))
		url.searchParams.set("model", route.providerModelName);

	const upstreamResponse = await (options.fetchImpl ?? fetch)(url.toString(), {
		headers: {
			Authorization: `Bearer ${route.providerApiKey}`,
			Upgrade: "websocket",
		},
		signal: requestSignal,
	});
	timing?.markAttemptHeaders(attempt, upstreamResponse.status);
	const upstreamRequestId = extractUpstreamRequestId(upstreamResponse.headers);
	const upstream = upstreamResponse.webSocket;
	if (upstreamResponse.status !== 101 || !upstream) {
		return {
			response: upstreamResponse,
			usagePromise: Promise.resolve(EMPTY_USAGE),
			upstreamRequestId,
		};
	}

	const pair = new WebSocketPair();
	const client = pair[0];
	const server = pair[1];
	const usagePromise = bridgeSockets({
		client,
		server,
		upstream,
		route,
		operation,
		timing,
	});
	return {
		response: new Response(null, {
			status: 101,
			webSocket: client,
			headers: {
				"X-Octafuse-Realtime-Protocol": "dashscope",
				...(options.responseProtocol
					? { "Sec-WebSocket-Protocol": options.responseProtocol }
					: {}),
			},
		}),
		usagePromise,
		upstreamRequestId,
	};
}
