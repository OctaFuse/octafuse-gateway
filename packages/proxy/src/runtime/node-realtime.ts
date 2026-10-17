/**
 * Node Proxy 的实时 WebSocket 适配层：`@hono/node-server` 负责普通 HTTP，
 * 这里用 `ws` 接管 upgrade，并复用 DashScope 的事件改写、failover 与 usage collector。
 */
import { createRequire } from 'node:module';
import type { IncomingHttpHeaders, IncomingMessage } from 'node:http';
import { applyRouteExtraHeaders, resolveProviderUpstreamSecret } from '@octafuse/core';
import { resolveUpstreamEndpoint } from '@octafuse/core/provider-endpoints';
import { pickDashScopeRealtimeSubprotocol } from '@octafuse/core/realtime-protocol';
import type { UsageFromStream } from '../services/proxy';
import { EMPTY_USAGE } from '../services/proxy';
import type { ProxyDispatchResult } from '../services/failover-dispatch';
import type { RouteResult } from '../services/model-router';
import type {
	DashScopeRealtimeNodeDispatch,
	DashScopeRealtimeOperation,
} from '../services/egress/dashscope-realtime-driver';
import {
	DashScopeRealtimeUsageCollector,
	normalizeWebSocketCloseCode,
	rewriteDashScopeRealtimeClientMessage,
} from '../services/egress/dashscope-realtime-driver';
import type {
	RequestTimingAttempt,
	RequestTimingCollector,
} from '../services/request-timing';
import { extractUpstreamRequestId } from '../services/egress/upstream-request-id';
import { createRealtimeSocket, type RealtimeSocket } from '../services/egress/dashscope-realtime-socket';
import {
	bridgeElevenLabsRealtime,
	elevenLabsRealtimeRejectedResult,
	resolveElevenLabsRealtimeTarget,
	type ElevenLabsRealtimeNodeDispatch,
} from '../services/egress/elevenlabs-realtime-driver';
import type { DeferredRealtimeRuntime } from '../services/egress/dashscope-realtime-session';

const nodeRequire = createRequire(import.meta.url);
const wsModule = nodeRequire('ws') as {
	WebSocket: NodeWebSocketConstructor;
	WebSocketServer: NodeWebSocketServerConstructor;
};

const NODE_WS_OPEN = 1;
const NODE_WS_CLOSED = 3;

export interface NodeWebSocket {
	readonly readyState: number;
	binaryType: string;
	on(event: 'open', listener: () => void): this;
	on(event: 'upgrade', listener: (_response: IncomingMessage) => void): this;
	on(event: 'unexpected-response', listener: (_request: IncomingMessage, response: IncomingMessage) => void): this;
	on(event: 'message', listener: (data: Buffer, isBinary: boolean) => void): this;
	on(event: 'close', listener: (code: number, reason: Buffer) => void): this;
	on(event: 'error', listener: (error: Error) => void): this;
	off(event: 'message', listener: (data: Buffer, isBinary: boolean) => void): this;
	off(event: 'close', listener: (code: number, reason: Buffer) => void): this;
	off(event: 'error', listener: (error: Error) => void): this;
	send(data: string | Buffer): void;
	close(code?: number, reason?: string): void;
	pause(): void;
	resume(): void;
}

export type NodeWebSocketConstructor = new (
	url: string,
	options?: { headers?: Record<string, string> }
) => NodeWebSocket;

export interface NodeWebSocketServer {
	handleUpgrade(
		request: IncomingMessage,
		socket: NodeJS.ReadWriteStream,
		head: Buffer,
		callback: (client: NodeWebSocket) => void
	): void;
}

export type NodeWebSocketServerConstructor = new (options: {
	noServer: true;
	handleProtocols?: (protocols: Set<string>, request: IncomingMessage) => string | false;
}) => NodeWebSocketServer;

/**
 * 握手响应与上游首帧（如 ElevenLabs 的 `session_started`）常在同一个 TCP 包里，
 * `ws` 会在 nextTick 里先把它们发出来，早于 promise 回调里挂的监听器。
 * 因此在 `open` 的同一同步段里先挂缓冲监听，由调用方在自己订阅后回放。
 */
type EarlyUpstreamMessages = {
	/** 停止缓冲并返回已缓冲的帧。 */
	drain(): Array<{ data: Buffer; isBinary: boolean }>;
};

type OpenedUpstream = {
	socket: NodeWebSocket;
	requestId: string | null;
	early: EarlyUpstreamMessages;
};

function createEarlyUpstreamMessages(upstream: NodeWebSocket): EarlyUpstreamMessages {
	const buffered: Array<{ data: Buffer; isBinary: boolean }> = [];
	const listener = (data: Buffer, isBinary: boolean) => {
		buffered.push({ data, isBinary });
	};
	upstream.on('message', listener);
	return {
		drain() {
			upstream.off('message', listener);
			return buffered.splice(0);
		},
	};
}

type RejectedUpstream = {
	response: Response;
	requestId: string | null;
};

function toHeaders(raw: IncomingHttpHeaders): Headers {
	const headers = new Headers();
	for (const [key, value] of Object.entries(raw)) {
		if (typeof value === 'string') headers.set(key, value);
		else if (Array.isArray(value)) headers.set(key, value.join(', '));
	}
	return headers;
}

function closeSocket(socket: NodeWebSocket, code = 1000, reason = ''): void {
	if (socket.readyState === NODE_WS_CLOSED) return;
	const safeCode = normalizeWebSocketCloseCode(code);
	try {
		socket.close(safeCode, reason.slice(0, 123));
	} catch {
		try {
			socket.close(1000);
		} catch {
			// ignore
		}
	}
}

function realtimeCapability(operation: DashScopeRealtimeOperation):
	| 'audio.realtime.inference'
	| 'audio.realtime.session' {
	return operation.endsWith('.inference')
		? 'audio.realtime.inference'
		: 'audio.realtime.session';
}

async function connectUpstream(
	route: RouteResult,
	operation: DashScopeRealtimeOperation,
	signal: AbortSignal | undefined,
	timing: RequestTimingCollector | null | undefined,
	attempt: RequestTimingAttempt | undefined,
	WebSocketCtor: NodeWebSocketConstructor
): Promise<OpenedUpstream | RejectedUpstream> {
	const endpoint = resolveUpstreamEndpoint(
		'dashscope',
		realtimeCapability(operation),
		route.providerEndpoints,
		{ providerId: route.providerId }
	);
	const url = new URL(endpoint);
	if (operation.endsWith('.session')) url.searchParams.set('model', route.providerModelName);

	const { secret } = await resolveProviderUpstreamSecret(route.providerApiKey);
	return connectNodeUpstream(
		url.toString(),
		applyRouteExtraHeaders({ Authorization: `Bearer ${secret}` }, route.customParams),
		signal,
		timing,
		attempt,
		WebSocketCtor
	);
}

/** 读上游握手被拒时的响应体（有上限与超时，用于识别 ElevenLabs 的 `detail.status`）。 */
function readRejectedBody(response: IncomingMessage, limitBytes = 8192, timeoutMs = 2000): Promise<string> {
	return new Promise<string>((resolve) => {
		const chunks: Buffer[] = [];
		let size = 0;
		let done = false;
		const finish = () => {
			if (done) return;
			done = true;
			clearTimeout(timer);
			resolve(Buffer.concat(chunks).toString('utf8'));
		};
		const timer = setTimeout(finish, timeoutMs);
		response.on('data', (chunk: Buffer) => {
			if (size >= limitBytes) return;
			chunks.push(chunk);
			size += chunk.length;
			if (size >= limitBytes) finish();
		});
		response.on('end', finish);
		response.on('error', finish);
		response.on('close', finish);
	});
}

/** 建立上游 WebSocket：成功返回已 open 的 socket；握手被拒返回上游状态码（可选带响应体）。 */
function connectNodeUpstream(
	url: string,
	headers: Record<string, string>,
	signal: AbortSignal | undefined,
	timing: RequestTimingCollector | null | undefined,
	attempt: RequestTimingAttempt | undefined,
	WebSocketCtor: NodeWebSocketConstructor,
	options: { captureRejectedBody?: boolean } = {}
): Promise<OpenedUpstream | RejectedUpstream> {
	const upstream = new WebSocketCtor(url, { headers });
	let requestId: string | null = null;
	let settled = false;

	return new Promise<OpenedUpstream | RejectedUpstream>((resolve, reject) => {
		const cleanup = () => {
			signal?.removeEventListener('abort', onAbort);
			upstream.off('error', onError);
		};
		const onAbort = () => {
			if (settled) return;
			settled = true;
			cleanup();
			closeSocket(upstream, 1000, 'Gateway request aborted');
			reject(new Error('Gateway request aborted'));
		};
		const onError = (error: Error) => {
			if (settled) return;
			settled = true;
			cleanup();
			reject(error);
		};
		const onUpgrade = (response: IncomingMessage) => {
			requestId = extractUpstreamRequestId(toHeaders(response.headers));
		};
		const onOpen = () => {
			if (settled) return;
			settled = true;
			cleanup();
			timing?.markAttemptHeaders(attempt, 101);
			resolve({ socket: upstream, requestId, early: createEarlyUpstreamMessages(upstream) });
		};
		const onUnexpectedResponse = (_request: IncomingMessage, response: IncomingMessage) => {
			if (settled) return;
			settled = true;
			requestId = extractUpstreamRequestId(toHeaders(response.headers));
			cleanup();
			const status = response.statusCode && response.statusCode >= 200 && response.statusCode <= 599
				? response.statusCode
				: 502;
			timing?.markAttemptHeaders(attempt, status);
			if (!options.captureRejectedBody) {
				response.resume();
				resolve({ response: new Response(null, { status }), requestId });
				return;
			}
			const contentType = response.headers['content-type'];
			void readRejectedBody(response).then((text) => {
				resolve({
					response: new Response(text || null, {
						status,
						headers: typeof contentType === 'string' ? { 'Content-Type': contentType } : undefined,
					}),
					requestId,
				});
			});
		};

		upstream.on('upgrade', onUpgrade);
		upstream.on('open', onOpen);
		upstream.on('unexpected-response', onUnexpectedResponse);
		upstream.on('error', onError);
		signal?.addEventListener('abort', onAbort, { once: true });
	});
}

function nodeRealtimeResponse(socket: NodeWebSocket, vendor: 'dashscope' | 'elevenlabs' = 'dashscope'): Response {
	const response = new Response(null, {
		status: 200,
		headers: {
			'X-Octafuse-Realtime-Protocol': vendor,
			'X-Octafuse-Realtime-Upgrade': '1',
		},
	});
	// Node's standard Response forbids status 101; the upgrade is already owned by
	// the http.Server, so keep the socket as an explicit response marker instead.
	Object.defineProperty(response, 'webSocket', { value: socket });
	return response;
}

export function createNodeDashScopeRealtimeDispatch(
	client: NodeWebSocket,
	WebSocketCtor: NodeWebSocketConstructor = wsModule.WebSocket
): DashScopeRealtimeNodeDispatch {
	return (
		route: RouteResult,
		operation: DashScopeRealtimeOperation,
		requestSignal?: AbortSignal,
		timing?: RequestTimingCollector | null,
		attempt?: RequestTimingAttempt
	): Promise<ProxyDispatchResult> =>
		new Promise<ProxyDispatchResult>((resolve, reject) => {
			const pendingMessages: Array<{ data: Buffer; isBinary: boolean }> = [];
			let upstream: NodeWebSocket | null = null;
			let streamError: string | null = null;
			let clientClosedFirst = false;
			let clientClosedBeforeOpen = false;
			let usageSettled = false;
			let resolveUsage!: (usage: UsageFromStream) => void;
			const collector = new DashScopeRealtimeUsageCollector();
			const usagePromise = new Promise<UsageFromStream>((usageResolve) => {
				resolveUsage = usageResolve;
			});
			const finishUsage = (transportError?: string | null) => {
				if (usageSettled) return;
				usageSettled = true;
				timing?.markStreamComplete();
				resolveUsage(collector.toUsage({
					clientClosedFirst,
					transportError: streamError ?? transportError,
				}));
			};
			const sendToUpstream = (data: Buffer, isBinary: boolean) => {
				if (!upstream || upstream.readyState !== NODE_WS_OPEN) {
					pendingMessages.push({ data, isBinary });
					return;
				}
				const payload = isBinary
					? data
					: rewriteDashScopeRealtimeClientMessage(route, operation, data.toString());
				upstream.send(payload);
			};
			const onClientMessage = (data: Buffer, isBinary: boolean) => {
				try {
					sendToUpstream(data, isBinary);
				} catch (error) {
					streamError = error instanceof Error ? error.message : String(error);
					closeSocket(client, 1011, 'Gateway upstream send failed');
					if (upstream) closeSocket(upstream, 1011, 'Gateway upstream send failed');
					finishUsage(streamError);
				}
			};
			const onClientClose = (code: number, reason: Buffer) => {
				clientClosedFirst = true;
				clientClosedBeforeOpen = upstream == null;
				try {
					if (upstream) closeSocket(upstream, code, reason.toString());
				} finally {
					finishUsage();
				}
			};
			const onClientError = () => {
				clientClosedFirst = true;
				clientClosedBeforeOpen = upstream == null;
				streamError = 'Client WebSocket transport error';
				try {
					if (upstream) closeSocket(upstream, 1011, 'Client WebSocket error');
				} finally {
					finishUsage(streamError);
				}
			};
			const onUpstreamMessage = (data: Buffer, isBinary: boolean) => {
				try {
					if (!isBinary) collector.observeServerMessage(data.toString());
					client.send(isBinary ? data : data.toString());
				} catch (error) {
					streamError = error instanceof Error ? error.message : String(error);
					closeSocket(client, 1011, 'Gateway client send failed');
					if (upstream) closeSocket(upstream, 1011, 'Gateway client send failed');
					finishUsage(streamError);
				}
			};
			const onUpstreamClose = (code: number, reason: Buffer) => {
				try {
					closeSocket(client, code, reason.toString());
				} finally {
					finishUsage(code === 1000 ? null : `Upstream WebSocket closed with code ${code}`);
				}
			};
			const onUpstreamError = () => {
				streamError = 'Upstream WebSocket transport error';
				try {
					closeSocket(client, 1011, 'Upstream WebSocket error');
				} finally {
					finishUsage(streamError);
				}
			};
			const onAbort = () => {
				streamError = 'Gateway request aborted';
				try {
					closeSocket(client, 1000, 'Gateway request aborted');
					if (upstream) closeSocket(upstream, 1000, 'Gateway request aborted');
				} finally {
					finishUsage(streamError);
				}
			};
			const cleanupClient = () => {
				client.off('message', onClientMessage);
				client.off('close', onClientClose);
				client.off('error', onClientError);
				requestSignal?.removeEventListener('abort', onAbort);
			};

			client.on('message', onClientMessage);
			client.on('close', onClientClose);
			client.on('error', onClientError);
			requestSignal?.addEventListener('abort', onAbort, { once: true });

			void connectUpstream(route, operation, requestSignal, timing, attempt, WebSocketCtor)
				.then((opened) => {
					if ('response' in opened) {
						cleanupClient();
						resolveUsage(EMPTY_USAGE);
						resolve({
							response: opened.response,
							usagePromise: Promise.resolve(EMPTY_USAGE),
							upstreamRequestId: opened.requestId,
						});
						return;
					}
					if (clientClosedBeforeOpen) {
						cleanupClient();
						closeSocket(opened.socket, 1000, 'Client WebSocket closed');
						resolveUsage(EMPTY_USAGE);
						reject(new Error('Client WebSocket closed before upstream connection'));
						return;
					}
					upstream = opened.socket;
					upstream.binaryType = 'nodebuffer';
					upstream.on('message', onUpstreamMessage);
					upstream.on('close', onUpstreamClose);
					upstream.on('error', onUpstreamError);
					for (const early of opened.early.drain()) onUpstreamMessage(early.data, early.isBinary);
					for (const pending of pendingMessages.splice(0)) {
						sendToUpstream(pending.data, pending.isBinary);
					}
					resolve({
						response: nodeRealtimeResponse(client),
						usagePromise,
						upstreamRequestId: opened.requestId,
					});
				})
				.catch((error) => {
					cleanupClient();
					resolveUsage(EMPTY_USAGE);
					reject(error);
				});
		});
}

/** 把 `ws` socket 包成运行时无关的 `RealtimeSocket`。 */
function wrapNodeSocket(socket: NodeWebSocket, early?: EarlyUpstreamMessages): RealtimeSocket {
	return createRealtimeSocket({
		send: (data) => {
			if (typeof data === 'string') socket.send(data);
			else socket.send(Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer));
		},
		close: (code, reason) => closeSocket(socket, code ?? 1000, reason ?? ''),
		subscribe: (handlers) => {
			socket.on('message', (data, isBinary) => handlers.message(isBinary ? data : data.toString()));
			socket.on('close', (code, reason) => handlers.close(code, reason.toString()));
			socket.on('error', () => handlers.error());
			for (const frame of early?.drain() ?? []) {
				handlers.message(frame.isBinary ? frame.data : frame.data.toString());
			}
		},
	});
}

/**
 * ElevenLabs 实时入口的 Node 调度：下游已完成 upgrade 且暂停读；连上上游后桥接两端，
 * 返回与 Worker 一致的 `ProxyDispatchResult`（用 `webSocket` 标记 + `X-Octafuse-Realtime-Upgrade`）。
 */
export function createNodeElevenLabsRealtimeDispatch(
	client: NodeWebSocket,
	WebSocketCtor: NodeWebSocketConstructor = wsModule.WebSocket
): ElevenLabsRealtimeNodeDispatch {
	// 第一次调度时才订阅下游（同一连接 failover 多次复用同一个包装）；订阅后到达的帧 / close 会排队到桥接开始。
	let clientSocket: RealtimeSocket | null = null;
	return async (route, params, requestSignal, timing, attempt): Promise<ProxyDispatchResult> => {
		clientSocket ??= wrapNodeSocket(client);
		const target = await resolveElevenLabsRealtimeTarget(route, params);
		const opened = await connectNodeUpstream(
			target.url,
			target.headers,
			requestSignal,
			timing,
			attempt,
			WebSocketCtor,
			{ captureRejectedBody: true }
		);
		if ('response' in opened) {
			return elevenLabsRealtimeRejectedResult(opened.response, opened.requestId);
		}
		opened.socket.binaryType = 'nodebuffer';
		const usagePromise = bridgeElevenLabsRealtime({
			client: clientSocket,
			upstream: wrapNodeSocket(opened.socket, opened.early),
			operation: params.operation,
			audioFormat: params.query.audio_format ?? null,
			timing,
		});
		return {
			response: nodeRealtimeResponse(client, 'elevenlabs'),
			usagePromise,
			upstreamRequestId: opened.requestId,
		};
	};
}

/**
 * inference 新入口（延迟连接上游）的 Node 运行时：下游 `client` 已经完成 upgrade，
 * 订阅在这里立刻开始排队，等第一帧 run-task 后再由会话选路由、连上游。
 */
export function createNodeDashScopeDeferredRuntime(
	client: NodeWebSocket,
	WebSocketCtor: NodeWebSocketConstructor = wsModule.WebSocket
): DeferredRealtimeRuntime {
	return {
		client: wrapNodeSocket(client),
		connectUpstream: async (route, operation, signal, timing, attempt) => {
			const opened = await connectUpstream(route, operation, signal, timing, attempt, WebSocketCtor);
			if ('response' in opened) return { response: opened.response, requestId: opened.requestId };
			opened.socket.binaryType = 'nodebuffer';
			return { socket: wrapNodeSocket(opened.socket, opened.early), requestId: opened.requestId };
		},
	};
}

export function createNodeWebSocketServer(): NodeWebSocketServer {
	return new wsModule.WebSocketServer({
		noServer: true,
		handleProtocols: (protocols) => pickDashScopeRealtimeSubprotocol(protocols),
	});
}
