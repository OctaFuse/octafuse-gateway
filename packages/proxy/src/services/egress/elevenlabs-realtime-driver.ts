/**
 * ElevenLabs 原生实时 WebSocket 驱动（模型都在 query 的 `model_id`，升级前即可选路由）：
 * - `audio.speech.realtime`：`/v1/text-to-speech/{voice_id}/stream-input`，客户端发文本帧，服务端回音频帧。
 * - `audio.transcriptions.realtime`：`/v1/speech-to-text/realtime`，客户端发 base64 音频帧，服务端回转写事件。
 *
 * 对外保持 ElevenLabs 原生帧。网关只做三件事：
 * 1. 连上游时把 `model_id` 换成供应商模型名，并用路由选中的上游密钥写 `xi-api-key`。
 * 2. 从 TTS 首帧剥掉客户端可能带来的凭据（`xi_api_key` / `authorization`），避免把网关 Key 转给上游。
 * 3. 统计用量：TTS 数客户端发出的文本字符，STT 按客户端发出的音频字节折算秒数。
 */
import { applyRouteExtraHeaders, resolveProviderUpstreamSecret } from "@octafuse/core";
import {
	elevenLabsErrorHttpStatus,
	readElevenLabsError,
} from "@octafuse/core/elevenlabs-native";
import { resolveUpstreamEndpoint } from "@octafuse/core/provider-endpoints";
import type { ProxyDispatchResult } from "../failover-dispatch";
import type { RouteResult } from "../model-router";
import { EMPTY_USAGE, type UsageFromStream } from "../proxy";
import type { RequestTimingAttempt, RequestTimingCollector } from "../request-timing";
import {
	normalizeWebSocketCloseCode,
	outboundWebSocketFetchUrl,
	wrapWorkersWebSocket,
} from "./dashscope-realtime-driver";
import type { RealtimeSocket } from "./dashscope-realtime-socket";
import { extractUpstreamRequestId } from "./upstream-request-id";

export const ELEVENLABS_REALTIME_OPERATIONS = [
	"audio.speech.realtime",
	"audio.transcriptions.realtime",
] as const;

export type ElevenLabsRealtimeOperation = (typeof ELEVENLABS_REALTIME_OPERATIONS)[number];

export type ElevenLabsRealtimeParams = {
	operation: ElevenLabsRealtimeOperation;
	/** TTS 路径参数；STT 不需要。 */
	voiceId?: string;
	/** 客户端原始 query。`model_id` 会被供应商模型名覆盖，鉴权类参数会被丢弃。 */
	query: Record<string, string>;
};

export type ElevenLabsRealtimeNodeDispatch = (
	route: RouteResult,
	params: ElevenLabsRealtimeParams,
	requestSignal?: AbortSignal,
	timing?: RequestTimingCollector | null,
	attempt?: RequestTimingAttempt
) => Promise<ProxyDispatchResult>;

export type ElevenLabsRealtimeDispatchOptions = {
	fetchImpl?: typeof fetch;
	/** 浏览器通过 Sec-WebSocket-Protocol 鉴权时，回写被选中的 token。 */
	responseProtocol?: string;
	/** Node 运行时的 upgrade 适配器；Worker 继续使用 WebSocketPair。 */
	nodeDispatch?: ElevenLabsRealtimeNodeDispatch;
};

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | null {
	return value != null && typeof value === "object" && !Array.isArray(value)
		? (value as JsonObject)
		: null;
}

function parseJsonObject(text: string): JsonObject | null {
	try {
		return asObject(JSON.parse(text) as unknown);
	} catch {
		return null;
	}
}

/** 这些 query 参数携带客户端凭据，不能转给上游。 */
const STRIPPED_QUERY_KEYS = new Set([
	"model_id",
	"xi-api-key",
	"xi_api_key",
	"api_key",
	"authorization",
	"token",
]);

/** TTS 首帧里可能带的凭据字段。 */
const STRIPPED_TTS_FRAME_KEYS = ["xi_api_key", "xi-api-key", "authorization"] as const;

export type ElevenLabsRealtimeTarget = {
	/** `wss://` 上游地址（含改写后的 query）。 */
	url: string;
	headers: Record<string, string>;
};

/** 解析上游 WebSocket 地址与鉴权头。 */
export async function resolveElevenLabsRealtimeTarget(
	route: RouteResult,
	params: ElevenLabsRealtimeParams
): Promise<ElevenLabsRealtimeTarget> {
	const isSpeech = params.operation === "audio.speech.realtime";
	const endpoint = resolveUpstreamEndpoint(
		"elevenlabs",
		params.operation,
		route.providerEndpoints,
		{
			providerId: route.providerId,
			...(isSpeech ? { voiceId: params.voiceId } : {}),
		}
	);
	const url = new URL(endpoint);
	for (const [key, value] of Object.entries(params.query)) {
		if (STRIPPED_QUERY_KEYS.has(key.toLowerCase())) continue;
		url.searchParams.set(key, value);
	}
	url.searchParams.set("model_id", route.providerModelName);

	const { secret } = await resolveProviderUpstreamSecret(route.providerApiKey);
	return {
		url: url.toString(),
		headers: applyRouteExtraHeaders({ "xi-api-key": secret }, route.customParams),
	};
}

/** `audio_format` → 每秒字节数。`pcm_N` 为 16 位，`ulaw_` / `alaw_` 为 8 位；未知时按 `pcm_16000`。 */
export function elevenLabsAudioByteRate(format: string | null | undefined): number {
	const match = /^(pcm|ulaw|alaw)_(\d+)$/i.exec((format ?? "").trim());
	if (!match) return 32_000;
	const rate = Number(match[2]);
	if (!Number.isFinite(rate) || rate <= 0) return 32_000;
	return match[1]!.toLowerCase() === "pcm" ? rate * 2 : rate;
}

/** base64 字符串解码后的字节数（不实际解码）。 */
export function base64DecodedByteLength(value: string): number {
	const length = value.length;
	if (length === 0) return 0;
	const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
	return Math.max(0, Math.floor((length * 3) / 4) - padding);
}

/** 实时转写服务端事件里表示失败的 `message_type`。 */
const STT_ERROR_MESSAGE_TYPES = new Set([
	"error",
	"auth_error",
	"quota_exceeded",
	"transcriber_error",
	"input_error",
	"unaccepted_terms",
	"rate_limited",
	"queue_overflow",
	"resource_exhausted",
	"session_time_limit_exceeded",
	"chunk_size_exceeded",
	"insufficient_audio_activity",
]);

function serverFailureMessage(event: JsonObject): string | null {
	const type = typeof event.message_type === "string" ? event.message_type : "";
	const message =
		(typeof event.message === "string" && event.message) ||
		(typeof event.error === "string" && event.error) ||
		"";
	if (type && (STT_ERROR_MESSAGE_TYPES.has(type) || type.endsWith("_error"))) {
		return message ? `${type}: ${message}` : `ElevenLabs realtime event ${type}`;
	}
	// TTS 错误帧：带 `error` 字符串且不是音频帧。
	if (typeof event.error === "string" && event.error && event.audio === undefined) {
		return message && message !== event.error ? `${event.error}: ${message}` : event.error;
	}
	return null;
}

/**
 * 汇总一次实时会话的计费用量。
 * - TTS：客户端文本帧的字符数（码点），首帧 `" "`（初始化）不计。
 * - STT：客户端音频帧解码后的字节数 ÷ 字节率；字节率优先取服务端 `session_started.config.audio_format`，
 *   其次是 query 的 `audio_format`，再默认 `pcm_16000`。
 */
export class ElevenLabsRealtimeUsageCollector {
	private characters = 0;
	private audioBytes = 0;
	private initFrameSeen = false;
	private completed = false;
	private failure: string | null = null;
	private serverAudioFormat: string | null = null;

	constructor(
		private readonly operation: ElevenLabsRealtimeOperation,
		private readonly queryAudioFormat: string | null = null
	) {}

	private get isSpeech(): boolean {
		return this.operation === "audio.speech.realtime";
	}

	/**
	 * 观察并（必要时）改写客户端文本帧，返回要发给上游的文本。
	 * 仅 TTS 会剥离凭据；STT 不改写。
	 */
	observeClientMessage(message: string): string {
		const event = parseJsonObject(message);
		if (!event) return message;

		if (this.isSpeech) {
			let rewritten = false;
			for (const key of STRIPPED_TTS_FRAME_KEYS) {
				if (key in event) {
					delete event[key];
					rewritten = true;
				}
			}
			if (typeof event.text === "string") {
				const isInit = !this.initFrameSeen && event.text === " ";
				this.initFrameSeen = true;
				if (!isInit) this.characters += Array.from(event.text).length;
			}
			return rewritten ? JSON.stringify(event) : message;
		}

		if (typeof event.audio_base_64 === "string") {
			this.audioBytes += base64DecodedByteLength(event.audio_base_64);
		}
		return message;
	}

	observeServerMessage(message: string): void {
		const event = parseJsonObject(message);
		if (!event) return;
		if (event.isFinal === true) this.completed = true;
		if (event.message_type === "session_started") {
			const config = asObject(event.config);
			if (typeof config?.audio_format === "string") this.serverAudioFormat = config.audio_format;
		}
		this.failure = serverFailureMessage(event) ?? this.failure;
	}

	toUsage(options: {
		clientClosedFirst: boolean;
		transportError?: string | null;
	}): UsageFromStream {
		// TTS 以 `isFinal` 为终态；STT 没有终态事件，由客户端或上游正常关闭结束。
		const incompleteUpstream =
			this.isSpeech && !this.completed && !options.clientClosedFirst
				? "Upstream WebSocket closed before a terminal event"
				: undefined;
		const streamError = this.failure ?? options.transportError ?? incompleteUpstream;
		const byteRate = elevenLabsAudioByteRate(this.serverAudioFormat ?? this.queryAudioFormat);
		const durationSeconds = this.isSpeech ? 0 : this.audioBytes / byteRate;
		return {
			...EMPTY_USAGE,
			raw_usage: JSON.stringify({
				source: "gateway_estimate",
				...(this.isSpeech
					? { characters: this.characters }
					: { audio_bytes: this.audioBytes, byte_rate: byteRate }),
			}),
			audio_duration_seconds: durationSeconds,
			audio_characters: this.isSpeech ? this.characters : 0,
			cancelled: this.isSpeech && options.clientClosedFirst && !this.completed && !streamError,
			stream_error: streamError,
		};
	}
}

function safeClose(socket: RealtimeSocket, code: number, reason: string): void {
	try {
		socket.close(normalizeWebSocketCloseCode(code), reason.slice(0, 123));
	} catch {
		// ignore：对端可能已经断开
	}
}

/**
 * 双向桥接已接受的下游 socket 与已连上的上游 socket，会话结束时返回用量。
 * 两端都是运行时无关的 `RealtimeSocket`（先订阅后排队，不会丢帧）。
 */
export function bridgeElevenLabsRealtime(params: {
	client: RealtimeSocket;
	upstream: RealtimeSocket;
	operation: ElevenLabsRealtimeOperation;
	/** 客户端 query 的 `audio_format`，STT 折算时长用。 */
	audioFormat?: string | null;
	timing?: RequestTimingCollector | null;
}): Promise<UsageFromStream> {
	const { client, upstream, operation, timing } = params;
	const collector = new ElevenLabsRealtimeUsageCollector(operation, params.audioFormat ?? null);
	let settled = false;
	let clientClosedFirst = false;

	return new Promise<UsageFromStream>((resolve) => {
		const finish = (transportError?: string | null) => {
			if (settled) return;
			settled = true;
			timing?.markStreamComplete();
			resolve(collector.toUsage({ clientClosedFirst, transportError }));
		};

		client.onMessage((data) => {
			try {
				upstream.send(typeof data === "string" ? collector.observeClientMessage(data) : data);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				safeClose(client, 1011, "Gateway upstream send failed");
				safeClose(upstream, 1011, "Gateway upstream send failed");
				finish(message);
			}
		});
		upstream.onMessage((data) => {
			try {
				if (typeof data === "string") collector.observeServerMessage(data);
				client.send(data);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				safeClose(client, 1011, "Gateway client send failed");
				safeClose(upstream, 1011, "Gateway client send failed");
				finish(message);
			}
		});
		client.onClose((code, reason) => {
			clientClosedFirst = true;
			try {
				safeClose(upstream, code, reason);
				// 完成下游关闭握手后再记账。
				safeClose(client, code, reason);
			} finally {
				finish();
			}
		});
		upstream.onClose((code, reason) => {
			try {
				safeClose(client, code, reason);
			} finally {
				finish(code === 1000 ? null : `Upstream WebSocket closed with code ${code}`);
			}
		});
		client.onError(() => {
			clientClosedFirst = true;
			try {
				safeClose(upstream, 1011, "Client WebSocket error");
			} finally {
				finish("Client WebSocket transport error");
			}
		});
		upstream.onError(() => {
			try {
				safeClose(client, 1011, "Upstream WebSocket error");
			} finally {
				finish("Upstream WebSocket transport error");
			}
		});
	});
}

/** 上游握手被拒（非 101）：保留上游状态码；按 `detail.status` 把额度用尽 / 并发限流改写成可 failover 的状态。 */
export async function elevenLabsRealtimeRejectedResult(
	response: Response,
	requestId: string | null
): Promise<ProxyDispatchResult> {
	let text = "";
	try {
		text = await response.text();
	} catch {
		text = "";
	}
	let parsed: unknown = text;
	try {
		parsed = text ? JSON.parse(text) : null;
	} catch {
		parsed = text;
	}
	const info = readElevenLabsError(parsed);
	const status = elevenLabsErrorHttpStatus(response.status, info.status);
	const body =
		text ||
		JSON.stringify({
			error: {
				message: `ElevenLabs realtime upstream rejected the WebSocket upgrade (HTTP ${response.status})`,
				type: status >= 500 ? "upstream_error" : "invalid_request_error",
			},
		});
	return {
		response: new Response(body, {
			status,
			headers: { "Content-Type": response.headers.get("content-type") || "application/json" },
		}),
		usagePromise: Promise.resolve(EMPTY_USAGE),
		upstreamRequestId: requestId,
	};
}

function workersUnavailableResponse(): ProxyDispatchResult {
	return {
		response: new Response(
			JSON.stringify({
				error: { message: "ElevenLabs realtime requires the Cloudflare Workers runtime" },
			}),
			{ status: 501, headers: { "Content-Type": "application/json" } }
		),
		usagePromise: Promise.resolve(EMPTY_USAGE),
		upstreamRequestId: null,
	};
}

/**
 * 建立上游并桥接：Workers 用出站 fetch Upgrade + WebSocketPair，Node 交给 `nodeDispatch`。
 * 上游握手失败时返回上游的 HTTP 错误，让 failover / 熔断照常工作。
 */
export async function dispatchElevenLabsRealtime(
	route: RouteResult,
	params: ElevenLabsRealtimeParams,
	requestSignal?: AbortSignal,
	timing?: RequestTimingCollector | null,
	attempt?: RequestTimingAttempt,
	options: ElevenLabsRealtimeDispatchOptions = {}
): Promise<ProxyDispatchResult> {
	if (options.nodeDispatch) {
		return options.nodeDispatch(route, params, requestSignal, timing, attempt);
	}
	if (typeof WebSocketPair === "undefined") return workersUnavailableResponse();

	const target = await resolveElevenLabsRealtimeTarget(route, params);
	const upstreamResponse = await (options.fetchImpl ?? fetch)(
		outboundWebSocketFetchUrl(target.url).toString(),
		{
			headers: { ...target.headers, Upgrade: "websocket" },
			signal: requestSignal,
		}
	);
	timing?.markAttemptHeaders(attempt, upstreamResponse.status);
	const requestId = extractUpstreamRequestId(upstreamResponse.headers);
	const upstreamSocket = upstreamResponse.webSocket;
	if (upstreamResponse.status !== 101 || !upstreamSocket) {
		return elevenLabsRealtimeRejectedResult(upstreamResponse, requestId);
	}

	const pair = new WebSocketPair();
	const clientEnd = pair[0];
	const serverEnd = pair[1];
	const usagePromise = bridgeElevenLabsRealtime({
		client: wrapWorkersWebSocket(serverEnd, { upstream: false }),
		upstream: wrapWorkersWebSocket(upstreamSocket, { upstream: true }),
		operation: params.operation,
		audioFormat: params.query.audio_format ?? null,
		timing,
	});
	return {
		response: new Response(null, {
			status: 101,
			webSocket: clientEnd,
			headers: {
				"X-Octafuse-Realtime-Protocol": "elevenlabs",
				...(options.responseProtocol
					? { "Sec-WebSocket-Protocol": options.responseProtocol }
					: {}),
			},
		}),
		usagePromise,
		upstreamRequestId: requestId,
	};
}
