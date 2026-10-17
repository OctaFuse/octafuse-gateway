import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { IncomingMessage } from 'node:http';
import { Readable } from 'node:stream';
import type { RouteResult } from '../services/model-router';
import {
	createNodeDashScopeDeferredRuntime,
	createNodeDashScopeRealtimeDispatch,
	createNodeElevenLabsRealtimeDispatch,
	type NodeWebSocket,
	type NodeWebSocketConstructor,
} from './node-realtime';

function route(overrides: Partial<RouteResult> = {}): RouteResult {
	return {
		targetId: 'route-1',
		modelSurfaceId: 'surface-1',
		routePoolId: 'pool-1',
		providerId: 'dashscope',
		providerName: 'DashScope',
		providerModelName: 'fun-asr-realtime',
		upstreamProtocol: 'dashscope',
		upstreamOperation: 'audio.transcriptions.realtime.inference',
		adapter: 'passthrough',
		providerEndpoints: {
			dashscope: { base: 'https://dashscope.aliyuncs.com/api/v1' },
		},
		providerApiKey: 'secret',
		priceOverrideRaw: null,
		routeMeteredProfileJson: null,
		routeChargedProfileJson: null,
		customParams: null,
		routeGroup: 'default',
		routePriority: 0,
		routeWeight: 1,
		providerKeyId: null,
		providerKeyLabel: null,
		providerKeyFingerprint: null,
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
		(code >= 1000 &&
			code <= 1014 &&
			code !== 1004 &&
			code !== 1005 &&
			code !== 1006) ||
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
	private readonly unexpectedListeners: Array<(_request: IncomingMessage, response: IncomingMessage) => void> = [];

	on(event: 'open', _listener: () => void): this;
	on(event: 'upgrade', _listener: (_response: IncomingMessage) => void): this;
	on(event: 'unexpected-response', _listener: (_request: IncomingMessage, response: IncomingMessage) => void): this;
	on(event: 'message', listener: MessageListener): this;
	on(event: 'close', listener: CloseListener): this;
	on(event: 'error', listener: ErrorListener): this;
	on(event: SocketEvent | 'open' | 'upgrade' | 'unexpected-response', listener: SocketListener | (() => void) | ((_response: IncomingMessage) => void) | ((_request: IncomingMessage, response: IncomingMessage) => void)): this {
		if (event === 'open') this.openListeners.push(listener as () => void);
		if (event === 'unexpected-response') {
			this.unexpectedListeners.push(listener as (_request: IncomingMessage, response: IncomingMessage) => void);
		}
		if (event === 'message') this.messageListeners.push(listener as MessageListener);
		if (event === 'close') this.closeListeners.push(listener as CloseListener);
		if (event === 'error') this.errorListeners.push(listener as ErrorListener);
		return this;
	}

	off(event: 'message', listener: MessageListener): this;
	off(event: 'close', listener: CloseListener): this;
	off(event: 'error', listener: ErrorListener): this;
	off(event: SocketEvent, listener: SocketListener): this {
		const listeners = event === 'message'
			? this.messageListeners
			: event === 'close'
				? this.closeListeners
				: this.errorListeners;
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

	emitUnexpectedResponse(statusCode: number, body: string, headers: Record<string, string> = {}): void {
		const response = Object.assign(Readable.from([Buffer.from(body)]), { statusCode, headers }) as unknown as IncomingMessage;
		for (const listener of [...this.unexpectedListeners]) listener({} as IncomingMessage, response);
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

	emitClose(code = 1000, reason = ''): void {
		this.close(code, reason);
	}

	private dispatchMessage(data: Buffer, isBinary: boolean): void {
		for (const listener of [...this.messageListeners]) listener(data, isBinary);
	}
}

describe('Node DashScope realtime adapter', () => {
	it('bridges text and binary frames while keeping the routed model and usage', async () => {
		const client = new FakeSocket();
		let upstream: FakeSocket | null = null;
		let upstreamUrl = '';
		const WebSocketCtor = function (url: string): NodeWebSocket {
			upstreamUrl = url;
			upstream = new FakeSocket();
			queueMicrotask(() => upstream?.emitOpen());
			return upstream;
		} as unknown as NodeWebSocketConstructor;

		const dispatch = createNodeDashScopeRealtimeDispatch(client, WebSocketCtor);
		const resultPromise = dispatch(route({ providerModelName: 'fun-asr-realtime-v2' }), 'audio.transcriptions.realtime.inference');
		await new Promise<void>((resolve) => queueMicrotask(resolve));
		assert.ok(upstream);
		const result = await resultPromise;

		assert.match(upstreamUrl, /wss:\/\/dashscope/);
		assert.equal(result.response.headers.get('x-octafuse-realtime-upgrade'), '1');
		client.emitMessage(JSON.stringify({
			header: { action: 'run-task' },
			payload: { model: 'gateway-model' },
		}), false);
		assert.equal(typeof upstream!.sent[0], 'string');
		assert.equal(JSON.parse(String(upstream!.sent[0])).payload.model, 'fun-asr-realtime-v2');

		upstream!.emitUpstreamMessage(JSON.stringify({
			header: { event: 'task-finished', task_id: 'task-1' },
			payload: { usage: { duration: 1.5 } },
		}), false);
		upstream!.emitClose();
		const usage = await result.usagePromise;
		assert.equal(usage.audio_duration_seconds, 1.5);
	});

	it('still records usage when the client closes with reserved code 1005', async () => {
		const client = new FakeSocket();
		let upstream: FakeSocket | null = null;
		const WebSocketCtor = function (_url: string): NodeWebSocket {
			upstream = new FakeSocket();
			queueMicrotask(() => upstream?.emitOpen());
			return upstream;
		} as unknown as NodeWebSocketConstructor;

		const dispatch = createNodeDashScopeRealtimeDispatch(client, WebSocketCtor);
		const resultPromise = dispatch(route(), 'audio.transcriptions.realtime.inference');
		await new Promise<void>((resolve) => queueMicrotask(resolve));
		assert.ok(upstream);
		const result = await resultPromise;

		upstream!.emitUpstreamMessage(JSON.stringify({
			header: { event: 'task-finished', task_id: 'task-1' },
			payload: { usage: { duration: 1.5 } },
		}), false);
		assert.doesNotThrow(() => client.emitPeerClose(1005));
		const usage = await result.usagePromise;
		assert.equal(usage.audio_duration_seconds, 1.5);
		assert.equal(upstream!.closeCodes[0], 1000);
	});

	it('forwards messages queued while the client socket is paused', async () => {
		const client = new FakeSocket();
		client.pause();
		client.emitMessage(JSON.stringify({
			header: { action: 'run-task' },
			payload: { model: 'gateway-model' },
		}), false);

		let upstream: FakeSocket | null = null;
		const WebSocketCtor = function (_url: string): NodeWebSocket {
			upstream = new FakeSocket();
			queueMicrotask(() => upstream?.emitOpen());
			return upstream;
		} as unknown as NodeWebSocketConstructor;

		const dispatch = createNodeDashScopeRealtimeDispatch(client, WebSocketCtor);
		const resultPromise = dispatch(route({ providerModelName: 'fun-asr-realtime-v2' }), 'audio.transcriptions.realtime.inference');
		await new Promise<void>((resolve) => queueMicrotask(resolve));
		assert.ok(upstream);
		await resultPromise;

		assert.equal(upstream!.sent.length, 0);
		client.resume();
		assert.equal(typeof upstream!.sent[0], 'string');
		assert.equal(JSON.parse(String(upstream!.sent[0])).payload.model, 'fun-asr-realtime-v2');
	});
});

describe('Node DashScope deferred realtime runtime', () => {
	it('queues downstream frames from construction and relays them once connected upstream', async () => {
		const client = new FakeSocket();
		const received: Array<string | ArrayBuffer | Uint8Array> = [];
		let upstream: FakeSocket | null = null;
		let upstreamUrl = '';
		const WebSocketCtor = function (url: string): NodeWebSocket {
			upstreamUrl = url;
			upstream = new FakeSocket();
			queueMicrotask(() => upstream?.emitOpen());
			return upstream;
		} as unknown as NodeWebSocketConstructor;

		const runtime = createNodeDashScopeDeferredRuntime(client, WebSocketCtor);
		// 监听器注册之前到达的 run-task 帧要先排队
		client.emitMessage(JSON.stringify({ header: { action: 'run-task' }, payload: { model: 'm', task: 'asr' } }), false);
		runtime.client.onMessage((data) => received.push(data));
		assert.equal(typeof received[0], 'string');

		const opened = await runtime.connectUpstream(
			route({ providerModelName: 'fun-asr-realtime-v2' }),
			'audio.transcriptions.realtime.inference'
		);
		assert.ok('socket' in opened);
		assert.match(upstreamUrl, /wss:\/\/dashscope/);

		const upstreamFrames: Array<string | ArrayBuffer | Uint8Array> = [];
		opened.socket.onMessage((data) => upstreamFrames.push(data));
		upstream!.emitUpstreamMessage(JSON.stringify({ header: { event: 'task-started' } }), false);
		assert.equal(typeof upstreamFrames[0], 'string');

		runtime.client.send(JSON.stringify({ header: { event: 'task-started' } }));
		assert.equal(typeof client.sent[0], 'string');
		runtime.client.close(1000, 'done');
		assert.equal(client.closeCodes[0], 1000);
	});

	it('aborts a pending upstream connection when the session signal fires', async () => {
		const client = new FakeSocket();
		let upstream: FakeSocket | null = null;
		const WebSocketCtor = function (_url: string): NodeWebSocket {
			upstream = new FakeSocket();
			return upstream;
		} as unknown as NodeWebSocketConstructor;
		const runtime = createNodeDashScopeDeferredRuntime(client, WebSocketCtor);
		const controller = new AbortController();
		const pending = runtime.connectUpstream(
			route(),
			'audio.transcriptions.realtime.inference',
			controller.signal
		);
		await new Promise<void>((resolve) => setImmediate(resolve));
		controller.abort();
		await assert.rejects(pending, /aborted/);
		assert.equal(upstream!.closeCodes[0], 1000);
	});
});

describe('Node ElevenLabs realtime adapter', () => {
	const elevenRoute = (overrides: Partial<RouteResult> = {}) =>
		route({
			providerId: 'elevenlabs',
			providerName: 'ElevenLabs',
			providerModelName: 'eleven_flash_v2_5',
			upstreamProtocol: 'elevenlabs',
			upstreamOperation: 'audio.speech.realtime',
			providerEndpoints: { elevenlabs: { base: 'https://api.elevenlabs.io/v1' } },
			...overrides,
		});

	it('connects with xi-api-key, bridges frames and reports TTS usage', async () => {
		const client = new FakeSocket();
		let upstream: FakeSocket | null = null;
		let upstreamUrl = '';
		let upstreamHeaders: Record<string, string> = {};
		const WebSocketCtor = function (url: string, options?: { headers?: Record<string, string> }): NodeWebSocket {
			upstreamUrl = url;
			upstreamHeaders = options?.headers ?? {};
			upstream = new FakeSocket();
			queueMicrotask(() => upstream?.emitOpen());
			return upstream;
		} as unknown as NodeWebSocketConstructor;

		const dispatch = createNodeElevenLabsRealtimeDispatch(client, WebSocketCtor);
		const result = await dispatch(elevenRoute(), {
			operation: 'audio.speech.realtime',
			voiceId: 'voice_1',
			query: { model_id: 'gateway-model', output_format: 'pcm_16000' },
		});

		const url = new URL(upstreamUrl);
		assert.equal(url.protocol, 'wss:');
		assert.equal(url.pathname, '/v1/text-to-speech/voice_1/stream-input');
		assert.equal(url.searchParams.get('model_id'), 'eleven_flash_v2_5');
		assert.equal(upstreamHeaders['xi-api-key'], 'secret');
		assert.equal(result.response.headers.get('x-octafuse-realtime-upgrade'), '1');
		assert.equal(result.response.headers.get('x-octafuse-realtime-protocol'), 'elevenlabs');

		client.emitMessage(JSON.stringify({ text: ' ', xi_api_key: 'sk-client' }), false);
		client.emitMessage(JSON.stringify({ text: 'Hello' }), false);
		assert.equal(upstream!.sent.length, 2);
		assert.ok(!String(upstream!.sent[0]).includes('sk-client'));

		upstream!.emitUpstreamMessage(JSON.stringify({ audio: 'AAAA' }), false);
		upstream!.emitUpstreamMessage(JSON.stringify({ isFinal: true }), false);
		assert.equal(client.sent.length, 2);
		upstream!.emitClose();
		const usage = await result.usagePromise;
		assert.equal(usage.audio_characters, 5);
		assert.equal(usage.stream_error, undefined);
	});

	it('forwards messages the client sent before the upstream finished connecting', async () => {
		const client = new FakeSocket();
		client.pause();
		client.emitMessage(JSON.stringify({ text: ' ' }), false);
		let upstream: FakeSocket | null = null;
		const WebSocketCtor = function (_url: string): NodeWebSocket {
			upstream = new FakeSocket();
			queueMicrotask(() => upstream?.emitOpen());
			return upstream;
		} as unknown as NodeWebSocketConstructor;
		const dispatch = createNodeElevenLabsRealtimeDispatch(client, WebSocketCtor);
		await dispatch(elevenRoute(), { operation: 'audio.speech.realtime', voiceId: 'voice_1', query: {} });
		assert.equal(upstream!.sent.length, 0);
		client.resume();
		assert.equal(upstream!.sent.length, 1);
	});

	it('forwards an upstream first frame sent in the same tick as open (session_started)', async () => {
		const client = new FakeSocket();
		const WebSocketCtor = function (_url: string): NodeWebSocket {
			const upstream = new FakeSocket();
			queueMicrotask(() => {
				upstream.emitOpen();
				upstream.emitUpstreamMessage(JSON.stringify({ message_type: 'session_started' }), false);
			});
			return upstream;
		} as unknown as NodeWebSocketConstructor;
		const dispatch = createNodeElevenLabsRealtimeDispatch(client, WebSocketCtor);
		await dispatch(
			elevenRoute({ upstreamOperation: 'audio.transcriptions.realtime' }),
			{ operation: 'audio.transcriptions.realtime', query: { audio_format: 'pcm_16000' } },
		);
		assert.equal(client.sent.length, 1);
		assert.equal(JSON.parse(String(client.sent[0])).message_type, 'session_started');
	});

	it('returns the upstream handshake rejection, rewriting quota_exceeded to 402', async () => {
		const client = new FakeSocket();
		let upstream: FakeSocket | null = null;
		const WebSocketCtor = function (_url: string): NodeWebSocket {
			upstream = new FakeSocket();
			queueMicrotask(() =>
				upstream?.emitUnexpectedResponse(
					401,
					JSON.stringify({ detail: { status: 'quota_exceeded', message: 'out of credits' } }),
					{ 'content-type': 'application/json' }
				)
			);
			return upstream;
		} as unknown as NodeWebSocketConstructor;
		const dispatch = createNodeElevenLabsRealtimeDispatch(client, WebSocketCtor);
		const result = await dispatch(elevenRoute(), {
			operation: 'audio.speech.realtime',
			voiceId: 'voice_1',
			query: {},
		});
		assert.equal(result.response.status, 402);
		assert.equal(result.response.headers.get('x-octafuse-realtime-upgrade'), null);
		assert.match(await result.response.text(), /out of credits/);
		// 握手失败时下游不能被关闭，留给 failover 重试下一条路由
		assert.equal(client.closeCodes.length, 0);
	});

	it('bills STT audio bytes using the query audio_format', async () => {
		const client = new FakeSocket();
		let upstream: FakeSocket | null = null;
		const WebSocketCtor = function (_url: string): NodeWebSocket {
			upstream = new FakeSocket();
			queueMicrotask(() => upstream?.emitOpen());
			return upstream;
		} as unknown as NodeWebSocketConstructor;
		const dispatch = createNodeElevenLabsRealtimeDispatch(client, WebSocketCtor);
		const result = await dispatch(
			elevenRoute({ providerModelName: 'scribe_v2_realtime', upstreamOperation: 'audio.transcriptions.realtime' }),
			{ operation: 'audio.transcriptions.realtime', query: { audio_format: 'pcm_16000' } }
		);
		client.emitMessage(
			JSON.stringify({ message_type: 'input_audio_chunk', audio_base_64: Buffer.alloc(64_000).toString('base64') }),
			false
		);
		client.emitPeerClose(1000, 'done');
		const usage = await result.usagePromise;
		assert.equal(usage.audio_duration_seconds, 2);
	});
});
