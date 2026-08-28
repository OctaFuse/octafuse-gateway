/**
 * 调试台的 DashScope 原生 WebSocket 直连：使用管理员会话解析路由，
 * 供应商连接和事件转发都在 Worker 侧完成，因此不会把供应商 API Key 暴露给浏览器，也不写网关用量日志。
 */
import { resolveUpstreamEndpoint } from '@octafuse/core/provider-endpoints';
import { mergePlaygroundRequestBody, type PlaygroundResolvedRoute, resolvePlaygroundRoute } from './playground-service';
import type { GatewayRepositories } from '@octafuse/core';
import { AdminServiceError } from './errors';

export const PLAYGROUND_DASHSCOPE_REALTIME_OPERATIONS = [
	'audio.transcriptions.realtime.inference',
	'audio.transcriptions.realtime.session',
	'audio.speech.realtime.inference',
] as const;

export type PlaygroundDashScopeRealtimeOperation = (typeof PLAYGROUND_DASHSCOPE_REALTIME_OPERATIONS)[number];

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
	operation: PlaygroundDashScopeRealtimeOperation,
	message: string,
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

function isRealtimeOperation(value: string): value is PlaygroundDashScopeRealtimeOperation {
	return (PLAYGROUND_DASHSCOPE_REALTIME_OPERATIONS as readonly string[]).includes(value);
}

export type PlaygroundRealtimeDispatchResult = {
	response: Response;
	upstreamUrl: string;
};

export type PlaygroundRealtimeNodeDispatch = (
	route: PlaygroundResolvedRoute,
	operation: PlaygroundDashScopeRealtimeOperation,
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
	if (route.upstreamProtocol !== 'dashscope' || !route.isAudioModel) {
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

	const url = outboundWebSocketFetchUrl(withSessionModel(endpoint, operation, route.providerModelName));
	const upstreamResponse = await fetch(url.toString(), {
		headers: {
			Authorization: `Bearer ${route.providerApiKey}`,
			Upgrade: 'websocket',
		},
		signal: requestSignal,
	});
	const upstream = upstreamResponse.webSocket;
	if (upstreamResponse.status !== 101 || !upstream) {
		return { response: upstreamResponse, upstreamUrl: endpoint };
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
			headers: { 'X-Octafuse-Realtime-Protocol': 'dashscope-playground' },
		}),
		upstreamUrl: endpoint,
	};
}

/** 解析路由并建立调试台专用的非计费原生 WebSocket。 */
export async function dispatchPlaygroundDashScopeRealtime(
	repos: GatewayRepositories,
	input: { routeId: string; operation: string },
	requestSignal?: AbortSignal,
	options?: PlaygroundRealtimeDispatchOptions,
): Promise<PlaygroundRealtimeDispatchResult> {
	if (!isRealtimeOperation(input.operation)) {
		throw new AdminServiceError(400, `Unsupported realtime operation: ${input.operation || '(empty)'}`);
	}
	const route = await resolvePlaygroundRoute(repos, input.routeId);
	return connectPlaygroundDashScopeRealtime(route, input.operation, requestSignal, options);
}
