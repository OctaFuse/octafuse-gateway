/**
 * DashScope run-task（inference）协议的“延迟连接上游”会话，与运行时无关。
 *
 * 官方 `wss://dashscope.aliyuncs.com/api-ws/v1/inference` 的模型写在 run-task 帧里，
 * 网关升级后先接受下游，读到第一帧 run-task 才能选路由、连上游：
 *
 *   waitForRunTask() → 路由 + 连上游（含 failover，由调用方做） → bridge()
 *
 * 等待与连接期间收到的帧都缓冲（有上限），连上后按顺序补发。升级之后不能再回 HTTP 错误码，
 * 失败统一回 DashScope 格式的 `task-failed` 事件再关闭连接。
 */
import type { RouteResult } from '../model-router';
import type { UsageFromStream } from '../proxy';
import type { RequestTimingAttempt, RequestTimingCollector } from '../request-timing';
import {
	DashScopeRealtimeUsageCollector,
	rewriteDashScopeRealtimeClientMessage,
	type DashScopeRealtimeOperation,
} from './dashscope-realtime-driver';
import type {
	RealtimeFrameData,
	RealtimeSocket,
	RealtimeUpstreamOpened,
	RealtimeUpstreamRejected,
} from './dashscope-realtime-socket';

/** 升级后等第一帧 run-task 的上限。 */
export const DASHSCOPE_RUN_TASK_WAIT_MS = 10_000;
/** 连上上游之前最多缓冲的帧数 / 字节数，超出就关闭连接。 */
export const DASHSCOPE_REALTIME_MAX_BUFFERED_FRAMES = 256;
export const DASHSCOPE_REALTIME_MAX_BUFFERED_BYTES = 8 * 1024 * 1024;

/** 连上游的运行时实现（Workers 用出站 fetch Upgrade，Node 用 `ws`）。 */
export type RealtimeUpstreamConnect = (
	route: RouteResult,
	operation: DashScopeRealtimeOperation,
	signal?: AbortSignal,
	timing?: RequestTimingCollector | null,
	attempt?: RequestTimingAttempt
) => Promise<RealtimeUpstreamOpened | RealtimeUpstreamRejected>;

/** 延迟连接会话需要的运行时能力：已接受的下游 socket + 连上游。 */
export type DeferredRealtimeRuntime = {
	client: RealtimeSocket;
	connectUpstream: RealtimeUpstreamConnect;
};

export type RunTaskRequest = {
	/** run-task 的 `header.task_id`，用于 `task-failed` 回包；缺失时为空串。 */
	taskId: string;
	/** `payload.model`：Gateway 模型 ID，可带 `:group` 后缀。 */
	model: string;
	/** `payload.task`：`asr` / `tts` 等。 */
	task: string;
};

export type WaitForRunTaskResult =
	| { ok: true; request: RunTaskRequest }
	| { ok: false; reason: 'timeout' | 'invalid' | 'closed' | 'overflow' };

export const DASHSCOPE_REALTIME_INFERENCE_TASK_OPERATIONS = {
	asr: 'audio.transcriptions.realtime.inference',
	tts: 'audio.speech.realtime.inference',
} as const satisfies Record<string, DashScopeRealtimeOperation>;

/** `payload.task` 对应的 operation；官方也是靠这个字段区分 ASR 与 TTS。 */
export function dashScopeInferenceOperationForTask(
	task: string
): DashScopeRealtimeOperation | null {
	return task === 'asr' || task === 'tts'
		? DASHSCOPE_REALTIME_INFERENCE_TASK_OPERATIONS[task]
		: null;
}

type ClientFrameInfo = {
	action: string;
	taskId: string;
	model: string;
	task: string;
};

function asObject(value: unknown): Record<string, unknown> | null {
	return value != null && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function str(value: unknown): string {
	return typeof value === 'string' ? value.trim() : '';
}

/** 解析下游文本帧；不是 JSON 对象时返回 null。 */
export function inspectDashScopeClientFrame(text: string): ClientFrameInfo | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return null;
	}
	const event = asObject(parsed);
	if (!event) return null;
	const header = asObject(event.header);
	const payload = asObject(event.payload);
	return {
		action: str(header?.action),
		taskId: str(header?.task_id),
		model: str(payload?.model),
		task: str(payload?.task),
	};
}

/** DashScope 格式的 `task-failed` 事件。 */
export function buildDashScopeTaskFailedEvent(
	taskId: string,
	errorCode: string,
	errorMessage: string
): string {
	return JSON.stringify({
		header: {
			task_id: taskId,
			event: 'task-failed',
			error_code: errorCode,
			error_message: errorMessage,
			attributes: {},
		},
		payload: {},
	});
}

function frameSize(data: RealtimeFrameData): number {
	return typeof data === 'string' ? data.length : data.byteLength;
}

type SessionPhase = 'waiting' | 'pending' | 'bridged' | 'closed';

type BridgeHandlers = {
	onFrame(data: RealtimeFrameData): void;
	onClose(code: number, reason: string): void;
	onError(): void;
};

export type DashScopeRealtimeSessionOptions = {
	maxBufferedFrames?: number;
	maxBufferedBytes?: number;
};

export class DashScopeRealtimeClientSession {
	private readonly buffer: RealtimeFrameData[] = [];
	private bufferedBytes = 0;
	private phase: SessionPhase = 'waiting';
	private clientClosed = false;
	private clientClosedFirst = false;
	private firstResult: WaitForRunTaskResult | null = null;
	private waiter: ((result: WaitForRunTaskResult) => void) | null = null;
	private waitTimer: ReturnType<typeof setTimeout> | null = null;
	private bridgeHandlers: BridgeHandlers | null = null;
	private readonly abortController = new AbortController();
	private readonly maxFrames: number;
	private readonly maxBytes: number;

	constructor(
		private readonly client: RealtimeSocket,
		options: DashScopeRealtimeSessionOptions = {}
	) {
		this.maxFrames = options.maxBufferedFrames ?? DASHSCOPE_REALTIME_MAX_BUFFERED_FRAMES;
		this.maxBytes = options.maxBufferedBytes ?? DASHSCOPE_REALTIME_MAX_BUFFERED_BYTES;
		client.onMessage((data) => this.handleMessage(data));
		client.onClose((code, reason) => this.handleClientClose(code, reason));
		client.onError(() => this.handleClientError());
	}

	/** 下游关闭或出错时 abort，用来中断选路 / 连上游。 */
	get signal(): AbortSignal {
		return this.abortController.signal;
	}

	get isClientClosed(): boolean {
		return this.clientClosed;
	}

	/** 等第一帧 run-task。超时、第一帧不是 run-task、缓冲溢出都会以 1008 关闭下游。 */
	waitForRunTask(timeoutMs = DASHSCOPE_RUN_TASK_WAIT_MS): Promise<WaitForRunTaskResult> {
		if (this.firstResult) return Promise.resolve(this.firstResult);
		if (this.phase === 'closed') return Promise.resolve({ ok: false, reason: 'closed' });
		return new Promise<WaitForRunTaskResult>((resolve) => {
			this.waiter = resolve;
			this.waitTimer = setTimeout(() => {
				this.rejectBeforeBridge(
					'timeout',
					1008,
					`Timed out waiting for run-task (${Math.round(timeoutMs / 1000)}s)`
				);
			}, timeoutMs);
		});
	}

	/** 回 `task-failed` 然后正常关闭下游。 */
	failAndClose(taskId: string, errorCode: string, errorMessage: string): void {
		this.sendTaskFailed(taskId, errorCode, errorMessage);
		this.phase = 'closed';
		this.closeClient(1000, 'task failed');
	}

	closeClient(code = 1000, reason = ''): void {
		try {
			this.client.close(code, reason);
		} catch {
			// ignore：下游可能已经断开
		}
	}

	/**
	 * 连上游之后开始双向透传：先按顺序补发缓冲帧，再转发实时帧。
	 * 只改写 run-task；同一连接里换了模型的后续 run-task 只对该任务回 `task-failed`，连接不断。
	 */
	bridge(params: {
		upstream: RealtimeSocket;
		route: RouteResult;
		operation: DashScopeRealtimeOperation;
		/** 第一个 run-task 的 `payload.model`；路由按它定下来。 */
		model: string;
		timing?: RequestTimingCollector | null;
	}): Promise<UsageFromStream> {
		const { upstream, route, operation, model, timing } = params;
		const collector = new DashScopeRealtimeUsageCollector();
		let settled = false;
		let dropping: { taskId: string } | null = null;

		return new Promise<UsageFromStream>((resolve) => {
			const finish = (transportError?: string | null) => {
				if (settled) return;
				settled = true;
				this.phase = 'closed';
				this.bridgeHandlers = null;
				timing?.markStreamComplete();
				resolve(
					collector.toUsage({
						clientClosedFirst: this.clientClosedFirst,
						transportError,
					})
				);
			};

			const forward = (data: RealtimeFrameData) => {
				try {
					if (typeof data !== 'string') {
						if (dropping) return;
						upstream.send(data);
						return;
					}
					const info = inspectDashScopeClientFrame(data);
					if (info?.action === 'run-task') {
						if (info.model !== model) {
							this.sendTaskFailed(
								info.taskId,
								'InvalidParameter',
								`This connection is bound to model "${model}"; open a new connection to use "${info.model || '(empty)'}"`
							);
							dropping = { taskId: info.taskId };
							return;
						}
						dropping = null;
					} else if (dropping && info && info.taskId === dropping.taskId) {
						return;
					}
					upstream.send(rewriteDashScopeRealtimeClientMessage(route, operation, data));
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					this.closeUpstream(upstream, 1011, 'Gateway upstream send failed');
					this.closeClient(1011, 'Gateway upstream send failed');
					finish(message);
				}
			};

			this.bridgeHandlers = {
				onFrame: forward,
				onClose: (code, reason) => {
					try {
						this.closeUpstream(upstream, code, reason);
						// 完成下游关闭握手后再记账。
						this.closeClient(code, reason);
					} finally {
						finish();
					}
				},
				onError: () => {
					try {
						this.closeUpstream(upstream, 1011, 'Client WebSocket error');
					} finally {
						finish('Client WebSocket transport error');
					}
				},
			};

			upstream.onMessage((data) => {
				try {
					if (typeof data === 'string') collector.observeServerMessage(data);
					this.client.send(data);
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					this.closeUpstream(upstream, 1011, 'Gateway client send failed');
					this.closeClient(1011, 'Gateway client send failed');
					finish(message);
				}
			});
			upstream.onClose((code, reason) => {
				try {
					this.closeClient(code, reason);
				} finally {
					finish(code === 1000 ? null : `Upstream WebSocket closed with code ${code}`);
				}
			});
			upstream.onError(() => {
				try {
					this.closeClient(1011, 'Upstream WebSocket error');
				} finally {
					finish('Upstream WebSocket transport error');
				}
			});

			this.phase = 'bridged';
			this.bufferedBytes = 0;
			for (const frame of this.buffer.splice(0)) {
				if (settled) break;
				forward(frame);
			}
		});
	}

	private closeUpstream(upstream: RealtimeSocket, code: number, reason: string): void {
		try {
			upstream.close(code, reason);
		} catch {
			// ignore
		}
	}

	private sendTaskFailed(taskId: string, errorCode: string, errorMessage: string): void {
		try {
			this.client.send(buildDashScopeTaskFailedEvent(taskId, errorCode, errorMessage));
		} catch {
			// 下游已断开时没有可回的对象
		}
	}

	private settleFirst(result: WaitForRunTaskResult): void {
		this.firstResult = result;
		if (this.waitTimer) clearTimeout(this.waitTimer);
		this.waitTimer = null;
		const waiter = this.waiter;
		this.waiter = null;
		waiter?.(result);
	}

	private rejectBeforeBridge(
		reason: 'timeout' | 'invalid' | 'closed' | 'overflow',
		code: number,
		closeReason: string
	): void {
		if (this.phase === 'closed') return;
		this.phase = 'closed';
		this.clientClosed = true;
		this.abortController.abort();
		this.closeClient(code, closeReason);
		this.settleFirst({ ok: false, reason });
	}

	private handleMessage(data: RealtimeFrameData): void {
		if (this.phase === 'closed') return;
		if (this.phase === 'bridged') {
			this.bridgeHandlers?.onFrame(data);
			return;
		}
		this.bufferedBytes += frameSize(data);
		if (this.buffer.length + 1 > this.maxFrames || this.bufferedBytes > this.maxBytes) {
			this.rejectBeforeBridge('overflow', 1008, 'Realtime frame buffer overflow');
			return;
		}
		this.buffer.push(data);
		if (this.phase === 'waiting' && this.buffer.length === 1) this.evaluateFirstFrame(data);
	}

	private evaluateFirstFrame(data: RealtimeFrameData): void {
		const info = typeof data === 'string' ? inspectDashScopeClientFrame(data) : null;
		if (info?.action !== 'run-task') {
			this.rejectBeforeBridge('invalid', 1008, 'First frame must be a run-task command');
			return;
		}
		this.phase = 'pending';
		this.settleFirst({
			ok: true,
			request: { taskId: info.taskId, model: info.model, task: info.task },
		});
	}

	private handleClientClose(code: number, reason: string): void {
		if (this.clientClosed) return;
		this.clientClosed = true;
		this.clientClosedFirst = true;
		this.abortController.abort();
		if (this.phase === 'bridged' && this.bridgeHandlers) {
			this.bridgeHandlers.onClose(code, reason);
			return;
		}
		this.phase = 'closed';
		// 完成下游关闭握手。
		this.closeClient(code, reason);
		this.settleFirst({ ok: false, reason: 'closed' });
	}

	private handleClientError(): void {
		if (this.clientClosed) return;
		this.clientClosed = true;
		this.clientClosedFirst = true;
		this.abortController.abort();
		if (this.phase === 'bridged' && this.bridgeHandlers) {
			this.bridgeHandlers.onError();
			return;
		}
		this.phase = 'closed';
		this.settleFirst({ ok: false, reason: 'closed' });
	}
}
