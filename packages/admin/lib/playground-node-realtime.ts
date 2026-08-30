/**
 * Admin Node 调试台实时 WebSocket 适配：用 `ws` 接管 upgrade，
 * 复用调试台的模型注入规则，不计费、无 failover。
 */
import { createRequire } from 'node:module';
import type { IncomingMessage } from 'node:http';
import { applyRouteExtraHeaders, resolveProviderUpstreamSecret } from '@octafuse/core';
import type {
	PlaygroundDashScopeRealtimeOperation,
	PlaygroundRealtimeNodeDispatch,
} from '@/lib/services/admin/playground-realtime-service';
import { rewritePlaygroundRealtimeClientMessage } from '@/lib/services/admin/playground-realtime-service';
import type { PlaygroundResolvedRoute } from '@/lib/services/admin/playground-service';

/** 上游 WSS 握手超时；不设的话 `ws` 会一直挂起，调试台只剩空的 HTTP 101。 */
export const PLAYGROUND_UPSTREAM_HANDSHAKE_TIMEOUT_MS = 15_000;

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
	options?: { headers?: Record<string, string>; handshakeTimeout?: number }
) => NodeWebSocket;

export interface NodeWebSocketServer {
	handleUpgrade(
		request: IncomingMessage,
		socket: NodeJS.ReadWriteStream,
		head: Buffer,
		callback: (client: NodeWebSocket) => void
	): void;
}

type NodeWebSocketServerConstructor = new (options: { noServer: true }) => NodeWebSocketServer;

/** RFC 6455 / `ws` 合法 Close 码；保留码写入 Close 帧会抛 TypeError。 */
export function normalizePlaygroundWebSocketCloseCode(code: number | undefined): number {
	if (typeof code !== 'number' || !Number.isInteger(code)) return 1000;
	if (
		(code >= 1000 && code <= 1014 && code !== 1004 && code !== 1005 && code !== 1006) ||
		(code >= 3000 && code <= 4999)
	) {
		return code;
	}
	return 1000;
}

function closeSocket(socket: NodeWebSocket, code = 1000, reason = ''): void {
	if (socket.readyState === NODE_WS_CLOSED) return;
	const safeCode = normalizePlaygroundWebSocketCloseCode(code);
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

async function connectUpstream(
	upstreamUrl: string,
	providerApiKey: string,
	signal: AbortSignal | undefined,
	WebSocketCtor: NodeWebSocketConstructor,
	handshakeTimeoutMs: number,
	customParams: Record<string, unknown> | null
): Promise<{ socket: NodeWebSocket } | { response: Response }> {
	const { secret } = await resolveProviderUpstreamSecret(providerApiKey);
	const upstream = new WebSocketCtor(upstreamUrl, {
		headers: applyRouteExtraHeaders({ Authorization: `Bearer ${secret}` }, customParams),
		handshakeTimeout: handshakeTimeoutMs,
	});
	let settled = false;

	return new Promise((resolve, reject) => {
		let timeout: ReturnType<typeof setTimeout> | undefined;
		const cleanup = () => {
			if (timeout) clearTimeout(timeout);
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
			closeSocket(upstream, 1011, error.message.slice(0, 123));
			reject(error);
		};
		const onOpen = () => {
			if (settled) return;
			settled = true;
			cleanup();
			resolve({ socket: upstream });
		};
		const onUnexpectedResponse = (_request: IncomingMessage, response: IncomingMessage) => {
			if (settled) return;
			settled = true;
			response.resume();
			cleanup();
			const status =
				response.statusCode && response.statusCode >= 200 && response.statusCode <= 599
					? response.statusCode
					: 502;
			resolve({ response: new Response(null, { status }) });
		};

		upstream.on('open', onOpen);
		upstream.on('unexpected-response', onUnexpectedResponse);
		upstream.on('error', onError);
		if (handshakeTimeoutMs > 0) {
			timeout = setTimeout(() => {
				onError(new Error(`Upstream WebSocket handshake timed out after ${handshakeTimeoutMs}ms`));
			}, handshakeTimeoutMs);
		}
		if (signal?.aborted) {
			onAbort();
			return;
		}
		signal?.addEventListener('abort', onAbort, { once: true });
	});
}

function nodeRealtimeResponse(socket: NodeWebSocket): Response {
	const response = new Response(null, {
		status: 200,
		headers: {
			'X-Octafuse-Realtime-Protocol': 'dashscope-playground',
			'X-Octafuse-Realtime-Upgrade': '1',
		},
	});
	Object.defineProperty(response, 'webSocket', { value: socket });
	return response;
}

export function createPlaygroundNodeRealtimeDispatch(
	client: NodeWebSocket,
	WebSocketCtor: NodeWebSocketConstructor = wsModule.WebSocket,
	options?: { handshakeTimeoutMs?: number }
): PlaygroundRealtimeNodeDispatch {
	const handshakeTimeoutMs = options?.handshakeTimeoutMs ?? PLAYGROUND_UPSTREAM_HANDSHAKE_TIMEOUT_MS;
	return (
		route: PlaygroundResolvedRoute,
		operation: PlaygroundDashScopeRealtimeOperation,
		requestSignal: AbortSignal | undefined,
		upstreamUrl: string
	): Promise<Response> =>
		new Promise<Response>((resolve, reject) => {
			const pendingMessages: Array<{ data: Buffer; isBinary: boolean }> = [];
			let upstream: NodeWebSocket | null = null;
			let clientClosedBeforeOpen = false;
			const sendToUpstream = (data: Buffer, isBinary: boolean) => {
				if (!upstream || upstream.readyState !== NODE_WS_OPEN) {
					pendingMessages.push({ data, isBinary });
					return;
				}
				const payload = isBinary
					? data
					: rewritePlaygroundRealtimeClientMessage(route, operation, data.toString());
				upstream.send(payload);
			};
			const onClientMessage = (data: Buffer, isBinary: boolean) => {
				try {
					sendToUpstream(data, isBinary);
				} catch {
					closeSocket(client, 1011, 'Gateway upstream send failed');
					if (upstream) closeSocket(upstream, 1011, 'Gateway upstream send failed');
				}
			};
			const onClientClose = (code: number, reason: Buffer) => {
				clientClosedBeforeOpen = upstream == null;
				if (upstream) closeSocket(upstream, code, reason.toString());
			};
			const onClientError = () => {
				clientClosedBeforeOpen = upstream == null;
				if (upstream) closeSocket(upstream, 1011, 'Client WebSocket error');
			};
			const onUpstreamMessage = (data: Buffer, isBinary: boolean) => {
				try {
					client.send(isBinary ? data : data.toString());
				} catch {
					closeSocket(client, 1011, 'Gateway client send failed');
					if (upstream) closeSocket(upstream, 1011, 'Gateway client send failed');
				}
			};
			const onUpstreamClose = (code: number, reason: Buffer) => {
				closeSocket(client, code, reason.toString());
			};
			const onUpstreamError = () => {
				closeSocket(client, 1011, 'Upstream WebSocket error');
			};
			const onAbort = () => {
				// HTTP Request.signal 会在 Hono handler 返回后 abort。此时上游桥已经建立，
				// 不能再按「请求取消」拆掉浏览器 WebSocket，否则调试台只剩空的 101。
				if (upstream) return;
				clientClosedBeforeOpen = true;
				closeSocket(client, 1000, 'Gateway request aborted');
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
			if (requestSignal?.aborted) {
				onAbort();
			} else {
				requestSignal?.addEventListener('abort', onAbort, { once: true });
			}
			// 监听器就绪后立刻恢复读，让 pause 窗口内的 run-task 进入 pending 队列。
			client.resume();

			void connectUpstream(
				upstreamUrl,
				route.providerApiKey,
				requestSignal,
				WebSocketCtor,
				handshakeTimeoutMs,
				route.customParams
			)
				.then((opened) => {
					if ('response' in opened) {
						cleanupClient();
						resolve(opened.response);
						return;
					}
					if (clientClosedBeforeOpen) {
						cleanupClient();
						closeSocket(opened.socket, 1000, 'Client WebSocket closed');
						reject(new Error('Client WebSocket closed before upstream connection'));
						return;
					}
					upstream = opened.socket;
					upstream.binaryType = 'nodebuffer';
					upstream.on('message', onUpstreamMessage);
					upstream.on('close', onUpstreamClose);
					upstream.on('error', onUpstreamError);
					requestSignal?.removeEventListener('abort', onAbort);
					for (const pending of pendingMessages.splice(0)) {
						sendToUpstream(pending.data, pending.isBinary);
					}
					resolve(nodeRealtimeResponse(client));
				})
				.catch((error) => {
					cleanupClient();
					reject(error);
				});
		});
}

export function createPlaygroundNodeWebSocketServer(): NodeWebSocketServer {
	return new wsModule.WebSocketServer({ noServer: true });
}
