/**
 * DashScope 实时 WebSocket 的运行时无关 socket 抽象。
 * Workers（`WebSocket`）与 Node（`ws`）各写一层很薄的适配，会话与桥接逻辑只面向这个接口。
 */

export type RealtimeFrameData = string | ArrayBuffer | Uint8Array;

export interface RealtimeSocket {
	send(data: RealtimeFrameData): void;
	close(code?: number, reason?: string): void;
	/** 文本帧给 `string`，二进制帧给 `ArrayBuffer` / `Uint8Array`。 */
	onMessage(listener: (data: RealtimeFrameData) => void): void;
	onClose(listener: (code: number, reason: string) => void): void;
	onError(listener: () => void): void;
}

export type RealtimeSocketTransport = {
	send(data: RealtimeFrameData): void;
	close(code?: number, reason?: string): void;
	subscribe(handlers: {
		message(data: RealtimeFrameData): void;
		close(code: number, reason: string): void;
		error(): void;
	}): void;
};

/**
 * 立即订阅底层 socket 事件，监听器注册之前到达的消息 / 关闭 / 错误先排队，
 * 注册时按到达顺序补发。这样“连上游”与“开始桥接”之间隔着 await 也不会丢帧。
 */
export function createRealtimeSocket(transport: RealtimeSocketTransport): RealtimeSocket {
	let messageListener: ((data: RealtimeFrameData) => void) | null = null;
	let closeListener: ((code: number, reason: string) => void) | null = null;
	let errorListener: (() => void) | null = null;
	const queuedMessages: RealtimeFrameData[] = [];
	let queuedClose: { code: number; reason: string } | null = null;
	let queuedError = false;

	transport.subscribe({
		message(data) {
			if (messageListener) messageListener(data);
			else queuedMessages.push(data);
		},
		close(code, reason) {
			if (closeListener) closeListener(code, reason);
			else queuedClose = { code, reason };
		},
		error() {
			if (errorListener) errorListener();
			else queuedError = true;
		},
	});

	return {
		send: (data) => transport.send(data),
		close: (code, reason) => transport.close(code, reason),
		onMessage(listener) {
			messageListener = listener;
			for (const data of queuedMessages.splice(0)) listener(data);
		},
		onClose(listener) {
			closeListener = listener;
			if (queuedClose) {
				const pending = queuedClose;
				queuedClose = null;
				listener(pending.code, pending.reason);
			}
		},
		onError(listener) {
			errorListener = listener;
			if (queuedError) {
				queuedError = false;
				listener();
			}
		},
	};
}

export type RealtimeUpstreamOpened = {
	socket: RealtimeSocket;
	requestId: string | null;
};

export type RealtimeUpstreamRejected = {
	response: Response;
	requestId: string | null;
};
