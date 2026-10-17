/**
 * 调试台的 DashScope 原生 WebSocket 直连：使用管理员会话解析路由，
 * 供应商连接和事件转发都在 Worker 侧完成，因此不会把供应商 API Key 暴露给浏览器，也不写网关用量日志。
 */
import { applyRouteExtraHeaders } from '@octafuse/core/route-custom-params';
import { resolveProviderUpstreamSecret } from '@octafuse/core';
import { resolveUpstreamEndpoint } from '@octafuse/core/provider-endpoints';
import { isValidElevenLabsVoiceId } from '@octafuse/core/elevenlabs-native';
import { mergePlaygroundRequestBody, type PlaygroundResolvedRoute, resolvePlaygroundRoute } from './playground-service';
import type { GatewayRepositories } from '@octafuse/core';
import { AdminServiceError } from './errors';
import { isAudioKind } from '@/lib/invoke-kind';

export const PLAYGROUND_DASHSCOPE_REALTIME_OPERATIONS = [
	'audio.transcriptions.realtime.inference',
	'audio.transcriptions.realtime.session',
	'audio.speech.realtime.inference',
	'audio.speech.realtime.session',
] as const;

export type PlaygroundDashScopeRealtimeOperation = (typeof PLAYGROUND_DASHSCOPE_REALTIME_OPERATIONS)[number];

export const PLAYGROUND_ELEVENLABS_REALTIME_OPERATIONS = [
	'audio.transcriptions.realtime',
	'audio.speech.realtime',
] as const;

export type PlaygroundElevenLabsRealtimeOperation = (typeof PLAYGROUND_ELEVENLABS_REALTIME_OPERATIONS)[number];

/** 调试台 `GET /playground/realtime` 接受的全部 operation。 */
export const PLAYGROUND_REALTIME_OPERATIONS = [
	...PLAYGROUND_DASHSCOPE_REALTIME_OPERATIONS,
	...PLAYGROUND_ELEVENLABS_REALTIME_OPERATIONS,
] as const;

export type PlaygroundRealtimeOperation = (typeof PLAYGROUND_REALTIME_OPERATIONS)[number];

export function isPlaygroundElevenLabsRealtimeOperation(
	value: string,
): value is PlaygroundElevenLabsRealtimeOperation {
	return (PLAYGROUND_ELEVENLABS_REALTIME_OPERATIONS as readonly string[]).includes(value);
}

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | null {
	return value != null && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : null;
}

function eventName(event: JsonObject): string {
	const header = asObject(event.header);
	if (typeof header?.action === 'string') return header.action;
	if (typeof header?.event === 'string') return header.event;
	return typeof event.type === 'string' ? event.type : '';
}

/** 与 Proxy 保持同一模型注入和 custom_params 合并规则。 */
export function rewritePlaygroundRealtimeClientMessage(
	route: PlaygroundResolvedRoute,
	operation: PlaygroundRealtimeOperation,
	message: string,
): string {
	// ElevenLabs 的模型在 URL 的 model_id 里，帧内容原样转发。
	if (isPlaygroundElevenLabsRealtimeOperation(operation)) return message;
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
		(operation.endsWith('.inference') && name === 'run-task') ||
		(operation.endsWith('.session') && name === 'session.update');
	if (!shouldMerge) return message;

	const merged = mergePlaygroundRequestBody(route, event);
	if (name === 'run-task') {
		const payload = asObject(merged.payload) ?? {};
		merged.payload = { ...payload, model: route.providerModelName };
	}
	return JSON.stringify(merged);
}

function outboundWebSocketFetchUrl(endpoint: string): URL {
	const url = new URL(endpoint);
	if (url.protocol === 'wss:') url.protocol = 'https:';
	if (url.protocol === 'ws:') url.protocol = 'http:';
	return url;
}

function realtimeCapability(
	operation: PlaygroundDashScopeRealtimeOperation,
): 'audio.realtime.inference' | 'audio.realtime.session' {
	return operation.endsWith('.inference') ? 'audio.realtime.inference' : 'audio.realtime.session';
}

function closeSocket(socket: WebSocket, code = 1000, reason = ''): void {
	if (socket.readyState === WebSocket.CLOSED) return;
	socket.close(code, reason.slice(0, 123));
}

function isRealtimeOperation(value: string): value is PlaygroundRealtimeOperation {
	return (PLAYGROUND_REALTIME_OPERATIONS as readonly string[]).includes(value);
}

export type PlaygroundRealtimeDispatchResult = {
	response: Response;
	upstreamUrl: string;
};

export type PlaygroundRealtimeNodeDispatch = (
	route: PlaygroundResolvedRoute,
	operation: PlaygroundRealtimeOperation,
	requestSignal: AbortSignal | undefined,
	upstreamUrl: string,
) => Promise<Response>;

export type PlaygroundRealtimeDispatchOptions = {
	nodeDispatch?: PlaygroundRealtimeNodeDispatch;
};

function withSessionModel(endpoint: string, operation: PlaygroundDashScopeRealtimeOperation, model: string): string {
	const url = new URL(endpoint);
	if (operation.endsWith('.session')) url.searchParams.set('model', model);
	return url.toString();
}

/** 在已解析路由上建立调试台专用的非计费原生 WebSocket（Workers 或 Node dispatch）。 */
export async function connectPlaygroundDashScopeRealtime(
	route: PlaygroundResolvedRoute,
	operation: PlaygroundDashScopeRealtimeOperation,
	requestSignal?: AbortSignal,
	options?: PlaygroundRealtimeDispatchOptions,
): Promise<PlaygroundRealtimeDispatchResult> {
	if (route.upstreamProtocol !== 'dashscope' || !isAudioKind(route.modelKind)) {
		throw new AdminServiceError(400, 'Playground realtime routes must use an audio DashScope route');
	}
	const endpoint = resolveUpstreamEndpoint('dashscope', realtimeCapability(operation), route.providerEndpoints, {
		providerId: route.providerId,
	});
	if (options?.nodeDispatch) {
		const response = await options.nodeDispatch(
			route,
			operation,
			requestSignal,
			withSessionModel(endpoint, operation, route.providerModelName),
		);
		return { response, upstreamUrl: endpoint };
	}
	if (typeof WebSocketPair === 'undefined') {
		throw new AdminServiceError(501, 'DashScope realtime requires the Cloudflare Workers runtime');
	}

	return openWorkersPlaygroundBridge({
		route,
		operation,
		upstreamUrl: withSessionModel(endpoint, operation, route.providerModelName),
		reportedUrl: endpoint,
		headers: { Authorization: `Bearer ${route.providerApiKey}` },
		protocolLabel: 'dashscope-playground',
		requestSignal,
	});
}

type WorkersBridgeInput = {
	route: PlaygroundResolvedRoute;
	operation: PlaygroundRealtimeOperation;
	/** 实际握手的 wss:// 地址（含 query）。 */
	upstreamUrl: string;
	/** 回给调试台展示的地址（不含密钥与随机参数）。 */
	reportedUrl: string;
	/** 鉴权头；其它头由 `custom_params` 合并。 */
	headers: Record<string, string>;
	protocolLabel: string;
	requestSignal?: AbortSignal;
};

/** Workers 运行时：握手上游并在浏览器与上游之间桥接帧；握手失败时把上游响应原样返回。 */
async function openWorkersPlaygroundBridge(input: WorkersBridgeInput): Promise<PlaygroundRealtimeDispatchResult> {
	const { route, operation } = input;
	const url = outboundWebSocketFetchUrl(input.upstreamUrl);
	const upstreamResponse = await fetch(url.toString(), {
		headers: applyRouteExtraHeaders({ ...input.headers, Upgrade: 'websocket' }, route.customParams),
		signal: input.requestSignal,
	});
	const upstream = upstreamResponse.webSocket;
	if (upstreamResponse.status !== 101 || !upstream) {
		return { response: upstreamResponse, upstreamUrl: input.reportedUrl };
	}

	const pair = new WebSocketPair();
	const client = pair[0];
	const server = pair[1];
	server.accept({ allowHalfOpen: true });
	upstream.binaryType = 'arraybuffer';
	upstream.accept({ allowHalfOpen: true });

	server.addEventListener('message', (event) => {
		try {
			const data =
				typeof event.data === 'string'
					? rewritePlaygroundRealtimeClientMessage(route, operation, event.data)
					: event.data;
			upstream.send(data);
		} catch {
			closeSocket(server, 1011, 'Gateway upstream send failed');
			closeSocket(upstream, 1011, 'Gateway upstream send failed');
		}
	});
	upstream.addEventListener('message', (event) => {
		try {
			server.send(event.data);
		} catch {
			closeSocket(server, 1011, 'Gateway client send failed');
			closeSocket(upstream, 1011, 'Gateway client send failed');
		}
	});
	server.addEventListener('close', (event) => {
		closeSocket(upstream, event.code, event.reason);
		// allowHalfOpen 下必须显式完成本端 Close 握手，避免调试台连接悬挂。
		closeSocket(server, event.code, event.reason);
	});
	upstream.addEventListener('close', (event) => {
		closeSocket(server, event.code, event.reason);
	});
	server.addEventListener('error', () => {
		closeSocket(upstream, 1011, 'Client WebSocket error');
	});
	upstream.addEventListener('error', () => {
		closeSocket(server, 1011, 'Upstream WebSocket error');
	});

	return {
		response: new Response(null, {
			status: 101,
			webSocket: client,
			headers: { 'X-Octafuse-Realtime-Protocol': input.protocolLabel },
		}),
		upstreamUrl: input.reportedUrl,
	};
}


export type PlaygroundElevenLabsRealtimeParams = {
	/** TTS 路径参数；转写不需要。 */
	voiceId?: string;
	/** 浏览器传来的 query（output_format、audio_format、commit_strategy 等）。 */
	query?: Record<string, string>;
};

/** 携带客户端凭据或由路由决定的 query，不转给上游。 */
const ELEVENLABS_STRIPPED_QUERY_KEYS = new Set([
	'model_id',
	'xi-api-key',
	'xi_api_key',
	'api_key',
	'authorization',
	'token',
]);

/** 在已解析的 ElevenLabs 路由上建立调试台专用的非计费 WebSocket（Workers 或 Node dispatch）。 */
export async function connectPlaygroundElevenLabsRealtime(
	route: PlaygroundResolvedRoute,
	operation: PlaygroundElevenLabsRealtimeOperation,
	params: PlaygroundElevenLabsRealtimeParams = {},
	requestSignal?: AbortSignal,
	options?: PlaygroundRealtimeDispatchOptions,
): Promise<PlaygroundRealtimeDispatchResult> {
	if (route.upstreamProtocol !== 'elevenlabs' || !isAudioKind(route.modelKind)) {
		throw new AdminServiceError(400, 'Playground realtime routes must use an audio ElevenLabs route');
	}
	if (route.upstreamOperation !== operation) {
		throw new AdminServiceError(
			400,
			`Route upstream operation ${JSON.stringify(route.upstreamOperation)} does not match ${operation}`,
		);
	}
	const isSpeech = operation === 'audio.speech.realtime';
	const voiceId = params.voiceId?.trim() ?? '';
	if (isSpeech && !isValidElevenLabsVoiceId(voiceId)) {
		throw new AdminServiceError(400, 'voice_id is required for ElevenLabs realtime speech');
	}
	const endpoint = resolveUpstreamEndpoint('elevenlabs', operation, route.providerEndpoints, {
		providerId: route.providerId,
		...(isSpeech ? { voiceId } : {}),
	});
	const url = new URL(endpoint);
	for (const [key, value] of Object.entries(params.query ?? {})) {
		if (ELEVENLABS_STRIPPED_QUERY_KEYS.has(key.toLowerCase())) continue;
		url.searchParams.set(key, value);
	}
	url.searchParams.set('model_id', route.providerModelName);
	const upstreamUrl = url.toString();
	if (options?.nodeDispatch) {
		const response = await options.nodeDispatch(route, operation, requestSignal, upstreamUrl);
		return { response, upstreamUrl: endpoint };
	}
	if (typeof WebSocketPair === 'undefined') {
		throw new AdminServiceError(501, 'ElevenLabs realtime requires the Cloudflare Workers runtime');
	}
	const { secret } = await resolveProviderUpstreamSecret(route.providerApiKey);
	return openWorkersPlaygroundBridge({
		route,
		operation,
		upstreamUrl,
		reportedUrl: endpoint,
		headers: { 'xi-api-key': secret },
		protocolLabel: 'elevenlabs-playground',
		requestSignal,
	});
}

/** 解析路由并建立调试台专用的非计费原生 WebSocket（DashScope / ElevenLabs）。 */
export async function dispatchPlaygroundRealtime(
	repos: GatewayRepositories,
	input: {
		routeId: string;
		operation: string;
		/** 仅 ElevenLabs：TTS 路径参数与 query。 */
		elevenLabs?: PlaygroundElevenLabsRealtimeParams;
	},
	requestSignal?: AbortSignal,
	options?: PlaygroundRealtimeDispatchOptions,
): Promise<PlaygroundRealtimeDispatchResult> {
	if (!isRealtimeOperation(input.operation)) {
		throw new AdminServiceError(400, `Unsupported realtime operation: ${input.operation || '(empty)'}`);
	}
	const route = await resolvePlaygroundRoute(repos, input.routeId);
	if (isPlaygroundElevenLabsRealtimeOperation(input.operation)) {
		return connectPlaygroundElevenLabsRealtime(route, input.operation, input.elevenLabs, requestSignal, options);
	}
	return connectPlaygroundDashScopeRealtime(route, input.operation, requestSignal, options);
}
