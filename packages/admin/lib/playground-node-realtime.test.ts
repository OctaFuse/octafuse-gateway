import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { IncomingMessage } from 'node:http';
import type { PlaygroundResolvedRoute } from './services/admin/playground-service';
import { connectPlaygroundDashScopeRealtime } from './services/admin/playground-realtime-service';
import { AdminServiceError } from './services/admin/errors';
import {
	createPlaygroundNodeRealtimeDispatch,
	normalizePlaygroundWebSocketCloseCode,
	type NodeWebSocket,
	type NodeWebSocketConstructor,
} from './playground-node-realtime';

function route(overrides: Partial<PlaygroundResolvedRoute> = {}): PlaygroundResolvedRoute {
	return {
		upstreamProtocol: 'dashscope',
		upstreamOperation: 'audio.transcriptions.realtime.inference',
		adapter: 'passthrough',
		providerEndpoints: {
			dashscope: { base: 'https://dashscope.aliyuncs.com/api/v1' },
		},
		providerId: 'dashscope',
		providerApiKey: 'secret',
		providerModelName: 'qwen3-asr-flash-realtime',
		customParams: null,
		isImageModel: false,
		isAudioModel: true,
		...overrides,
	};
}

type MessageListener = (data: Buffer, isBinary: boolean) => void;
type CloseListener = (code: number, reason: Buffer) => void;
type ErrorListener = (error: Error) => void;
type SocketEvent = 'message' | 'close' | 'error';
type SocketListener = MessageListener | CloseListener | ErrorListener;

function isValidWsCloseCode(code: number): boolean {
	return (
		(code >= 1000 && code <= 1014 && code !== 1004 && code !== 1005 && code !== 1006) ||
		(code >= 3000 && code <= 4999)
	);
}

class FakeSocket implements NodeWebSocket {
	readyState = 1;
	binaryType = '';
	sent: Array<string | Buffer> = [];
	closeCodes: number[] = [];
	private paused = false;
	private readonly queuedMessages: Array<{ data: Buffer; isBinary: boolean }> = [];
	private readonly messageListeners: MessageListener[] = [];
	private readonly closeListeners: CloseListener[] = [];
	private readonly errorListeners: ErrorListener[] = [];
	private readonly openListeners: Array<() => void> = [];

	on(event: 'open', _listener: () => void): this;
	on(event: 'upgrade', _listener: (_response: IncomingMessage) => void): this;
	on(event: 'unexpected-response', _listener: (_request: IncomingMessage, response: IncomingMessage) => void): this;
	on(event: 'message', listener: MessageListener): this;
	on(event: 'close', listener: CloseListener): this;
	on(event: 'error', listener: ErrorListener): this;
	on(
		event: SocketEvent | 'open' | 'upgrade' | 'unexpected-response',
		listener:
			| SocketListener
			| (() => void)
			| ((_response: IncomingMessage) => void)
			| ((_request: IncomingMessage, response: IncomingMessage) => void)
	): this {
		if (event === 'open') this.openListeners.push(listener as () => void);
		if (event === 'message') this.messageListeners.push(listener as MessageListener);
		if (event === 'close') this.closeListeners.push(listener as CloseListener);
		if (event === 'error') this.errorListeners.push(listener as ErrorListener);
		return this;
	}

	off(event: 'message', listener: MessageListener): this;
	off(event: 'close', listener: CloseListener): this;
	off(event: 'error', listener: ErrorListener): this;
	off(event: SocketEvent, listener: SocketListener): this {
		const listeners =
			event === 'message' ? this.messageListeners : event === 'close' ? this.closeListeners : this.errorListeners;
		const index = listeners.indexOf(listener as never);
		if (index >= 0) listeners.splice(index, 1);
		return this;
	}

	send(data: string | Buffer): void {
		this.sent.push(data);
	}

	close(code = 1000, reason = ''): void {
		if (typeof code !== 'number' || !isValidWsCloseCode(code)) {
			throw new TypeError('First argument must be a valid error code number');
		}
		this.closeCodes.push(code);
		if (this.readyState === 3) return;
		this.readyState = 3;
		for (const listener of [...this.closeListeners]) listener(code, Buffer.from(reason));
	}

	pause(): void {
		this.paused = true;
	}

	resume(): void {
		this.paused = false;
		for (const queued of this.queuedMessages.splice(0)) {
			this.dispatchMessage(queued.data, queued.isBinary);
		}
	}

	emitOpen(): void {
		for (const listener of [...this.openListeners]) listener();
	}

	emitMessage(data: string | Buffer, isBinary = typeof data !== 'string'): void {
		const buffer = typeof data === 'string' ? Buffer.from(data) : data;
		if (this.paused) {
			this.queuedMessages.push({ data: buffer, isBinary });
			return;
		}
		this.dispatchMessage(buffer, isBinary);
	}

	emitUpstreamMessage(data: string | Buffer, isBinary = typeof data !== 'string'): void {
		this.emitMessage(data, isBinary);
	}

	emitPeerClose(code = 1000, reason = ''): void {
		if (this.readyState === 3) return;
		this.readyState = 3;
		for (const listener of [...this.closeListeners]) listener(code, Buffer.from(reason));
	}

	private dispatchMessage(data: Buffer, isBinary: boolean): void {
		for (const listener of [...this.messageListeners]) listener(data, isBinary);
	}
}

describe('Playground Node realtime adapter', () => {
	it('bridges text and binary frames while injecting the routed model', async () => {
		const client = new FakeSocket();
		let upstream: FakeSocket | null = null;
		let upstreamUrl = '';
		const WebSocketCtor = function (url: string): NodeWebSocket {
			upstreamUrl = url;
			upstream = new FakeSocket();
			queueMicrotask(() => upstream?.emitOpen());
			return upstream;
		} as unknown as NodeWebSocketConstructor;

		const dispatch = createPlaygroundNodeRealtimeDispatch(client, WebSocketCtor);
		const result = await connectPlaygroundDashScopeRealtime(
			route({ providerModelName: 'qwen3-asr-flash-realtime' }),
			'audio.transcriptions.realtime.inference',
			undefined,
			{ nodeDispatch: dispatch },
		);

		assert.match(upstreamUrl, /wss:\/\/dashscope/);
		assert.equal(result.response.headers.get('x-octafuse-realtime-upgrade'), '1');
		client.emitMessage(
			JSON.stringify({
				header: { action: 'run-task' },
				payload: { model: 'gateway-model' },
			}),
			false,
		);
		assert.equal(typeof upstream!.sent[0], 'string');
		assert.equal(JSON.parse(String(upstream!.sent[0])).payload.model, 'qwen3-asr-flash-realtime');

		upstream!.emitUpstreamMessage(JSON.stringify({ header: { event: 'task-started' } }), false);
		assert.equal(typeof client.sent[0], 'string');
		const pcm = Buffer.from([1, 2, 3, 4]);
		client.emitMessage(pcm, true);
		assert.equal(Buffer.isBuffer(upstream!.sent[1]), true);
		assert.deepEqual(upstream!.sent[1], pcm);
	});

	it('normalizes reserved close codes before forwarding to upstream', async () => {
		const client = new FakeSocket();
		let upstream: FakeSocket | null = null;
		const WebSocketCtor = function (_url: string): NodeWebSocket {
			upstream = new FakeSocket();
			queueMicrotask(() => upstream?.emitOpen());
			return upstream;
		} as unknown as NodeWebSocketConstructor;

		const dispatch = createPlaygroundNodeRealtimeDispatch(client, WebSocketCtor);
		await connectPlaygroundDashScopeRealtime(route(), 'audio.transcriptions.realtime.inference', undefined, {
			nodeDispatch: dispatch,
		});
		assert.doesNotThrow(() => client.emitPeerClose(1005));
		assert.equal(upstream!.closeCodes[0], 1000);
	});

	it('forwards messages queued while the client socket is paused', async () => {
		const client = new FakeSocket();
		client.pause();
		client.emitMessage(
			JSON.stringify({
				header: { action: 'run-task' },
				payload: { model: 'gateway-model' },
			}),
			false,
		);

		let upstream: FakeSocket | null = null;
		const WebSocketCtor = function (_url: string): NodeWebSocket {
			upstream = new FakeSocket();
			queueMicrotask(() => upstream?.emitOpen());
			return upstream;
		} as unknown as NodeWebSocketConstructor;

		const dispatch = createPlaygroundNodeRealtimeDispatch(client, WebSocketCtor);
		await connectPlaygroundDashScopeRealtime(
			route({ providerModelName: 'qwen3-asr-flash-realtime' }),
			'audio.transcriptions.realtime.inference',
			undefined,
			{ nodeDispatch: dispatch },
		);

		assert.equal(JSON.parse(String(upstream!.sent[0])).payload.model, 'qwen3-asr-flash-realtime');
	});

	it('keeps the bridge open if the HTTP request signal aborts after upstream is connected', async () => {
		const client = new FakeSocket();
		let upstream: FakeSocket | null = null;
		const ac = new AbortController();
		const WebSocketCtor = function (_url: string): NodeWebSocket {
			upstream = new FakeSocket();
			queueMicrotask(() => upstream?.emitOpen());
			return upstream;
		} as unknown as NodeWebSocketConstructor;

		const dispatch = createPlaygroundNodeRealtimeDispatch(client, WebSocketCtor);
		await connectPlaygroundDashScopeRealtime(
			route(),
			'audio.transcriptions.realtime.inference',
			ac.signal,
			{ nodeDispatch: dispatch },
		);
		ac.abort();
		assert.equal(client.readyState, 1);
		assert.equal(upstream!.readyState, 1);
		assert.equal(client.closeCodes.length, 0);
		assert.equal(upstream!.closeCodes.length, 0);
	});

	it('fails the handshake when upstream never opens', async () => {
		const client = new FakeSocket();
		const WebSocketCtor = function (_url: string): NodeWebSocket {
			return new FakeSocket();
		} as unknown as NodeWebSocketConstructor;
		const dispatch = createPlaygroundNodeRealtimeDispatch(client, WebSocketCtor, {
			handshakeTimeoutMs: 20,
		});
		await assert.rejects(
			() =>
				connectPlaygroundDashScopeRealtime(
					route(),
					'audio.transcriptions.realtime.inference',
					undefined,
					{ nodeDispatch: dispatch },
				),
			/handshake timed out/,
		);
	});
});

describe('connectPlaygroundDashScopeRealtime runtime selection', () => {
	it('returns 501 without WebSocketPair when Node dispatch is absent', async () => {
		await assert.rejects(
			() => connectPlaygroundDashScopeRealtime(route(), 'audio.transcriptions.realtime.inference'),
			(error: unknown) => {
				assert.equal(error instanceof AdminServiceError, true);
				assert.equal((error as AdminServiceError).status, 501);
				return true;
			},
		);
	});

	it('rejects non-audio routes before connecting', async () => {
		await assert.rejects(
			() =>
				connectPlaygroundDashScopeRealtime(
					route({ isAudioModel: false }),
					'audio.transcriptions.realtime.inference',
					undefined,
					{ nodeDispatch: async () => new Response(null, { status: 200 }) },
				),
			(error: unknown) => {
				assert.equal(error instanceof AdminServiceError, true);
				assert.equal((error as AdminServiceError).status, 400);
				return true;
			},
		);
	});

	it('maps reserved WebSocket close codes to 1000', () => {
		assert.equal(normalizePlaygroundWebSocketCloseCode(1000), 1000);
		assert.equal(normalizePlaygroundWebSocketCloseCode(1005), 1000);
		assert.equal(normalizePlaygroundWebSocketCloseCode(1006), 1000);
		assert.equal(normalizePlaygroundWebSocketCloseCode(1011), 1011);
	});
});
