import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { IncomingMessage } from 'node:http';
import type { RouteResult } from '../services/model-router';
import {
	createNodeDashScopeRealtimeDispatch,
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

	on(event: 'open', _listener: () => void): this;
	on(event: 'upgrade', _listener: (_response: IncomingMessage) => void): this;
	on(event: 'unexpected-response', _listener: (_request: IncomingMessage, response: IncomingMessage) => void): this;
	on(event: 'message', listener: MessageListener): this;
	on(event: 'close', listener: CloseListener): this;
	on(event: 'error', listener: ErrorListener): this;
	on(event: SocketEvent | 'open' | 'upgrade' | 'unexpected-response', listener: SocketListener | (() => void) | ((_response: IncomingMessage) => void) | ((_request: IncomingMessage, response: IncomingMessage) => void)): this {
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
