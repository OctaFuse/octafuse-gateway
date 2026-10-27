/**
 * 流式上游空闲超时：`reader.read()` 本身不会超时，需用 Promise.race 包一层可重置的定时器。
 *
 * 两段阈值不要混用：
 * - 尚未出现带内容的 SSE 事件：用 {@link STREAM_FIRST_CHUNK_TIMEOUT_MS}（默认 2 分钟），避免静默思考被空闲阈值误杀。
 * - 已经出过内容：用 {@link STREAM_IDLE_TIMEOUT_MS}（默认 90 秒）收口挂死的流。
 *
 * 部署可用环境变量覆盖，见 `stream-timeout-env.ts`。
 * 只有带内容的 SSE 行才算进展并重置计时；`:` 开头的注释心跳和空行不会续命，
 * 因此「只发心跳、不出字」的上游会在首包 / 空闲阈值内被掐，不必等绝对兜底。
 */

import {
	DEFAULT_STREAM_FIRST_CHUNK_TIMEOUT_MS,
	DEFAULT_STREAM_IDLE_TIMEOUT_MS,
} from '../stream-timeout-env';

/** 两次带内容的 SSE 事件之间允许的最长空闲。超过则 cancel 上游并按已解析 usage 记账。 */
export const STREAM_IDLE_TIMEOUT_MS = DEFAULT_STREAM_IDLE_TIMEOUT_MS;

/** 等待第一个带内容的 SSE 事件的上限；默认 2 分钟。 */
export const STREAM_FIRST_CHUNK_TIMEOUT_MS = DEFAULT_STREAM_FIRST_CHUNK_TIMEOUT_MS;

/** 写入 `usage.stream_error` 与请求日志 `error_message`，便于筛空闲掐流。 */
export const STREAM_IDLE_TIMEOUT_MESSAGE = 'Stream idle timeout';

/** 空闲超时错误帧的 `code`（OpenAI / Responses 协议用）。 */
export const STREAM_IDLE_TIMEOUT_CODE = 'stream_idle_timeout';

export type StreamIdleTimeoutFrameProtocol = 'openai-chat' | 'anthropic' | 'gemini';

/**
 * 空闲超时掐流时写给下游的协议原生终止错误帧。
 *
 * 不写帧直接 `writer.close()` 会让客户端看到「干净 EOF」，部分 SDK 会把它当成正常结束，
 * 导致 agent 静默收口。帧以 `\n` 开头，用来结束上游已写完整行但尚未以空行收尾的事件（SSE 事件以空行结尾）。
 */
export function streamIdleTimeoutErrorFrame(protocol: StreamIdleTimeoutFrameProtocol): string {
	switch (protocol) {
		case 'openai-chat':
			return (
				'\ndata: ' +
				JSON.stringify({
					error: {
						message: STREAM_IDLE_TIMEOUT_MESSAGE,
						type: 'server_error',
						code: STREAM_IDLE_TIMEOUT_CODE,
					},
				}) +
				'\n\n'
			);
		case 'anthropic':
			return (
				'\nevent: error\ndata: ' +
				JSON.stringify({
					type: 'error',
					error: { type: 'api_error', message: STREAM_IDLE_TIMEOUT_MESSAGE },
				}) +
				'\n\n'
			);
		case 'gemini':
			return (
				'\ndata: ' +
				JSON.stringify({
					error: {
						code: 504,
						status: 'DEADLINE_EXCEEDED',
						message: STREAM_IDLE_TIMEOUT_MESSAGE,
					},
				}) +
				'\n\n'
			);
	}
}

const IDLE_TIMEOUT_SENTINEL = Symbol('stream-idle-timeout');

export type IdleReadResult<T> =
	| { done: true; value?: undefined; idleTimedOut: false }
	| { done: false; value: T; idleTimedOut: false }
	| { done: false; value?: undefined; idleTimedOut: true };

export type StreamIdleClockOptions = {
	firstChunkTimeoutMs?: number;
	idleTimeoutMs?: number;
};

export type StreamIdleClock = {
	/** 本次 `read()` 还允许等待的毫秒数（已扣除自上次有效进展起累计空等的时间）。 */
	timeoutMs(): number;
	noteChunk(value?: Uint8Array): void;
};

export type SseProgressScanner = {
	/** 喂入下一个 chunk；返回该 chunk 内是否出现了内容行的字节。 */
	feed(chunk: Uint8Array): boolean;
};

type SseLineState = 'line_start' | 'comment' | 'content';

/**
 * 判断上游字节里有没有「真进展」：出现了非空、且不以 `:` 开头的行的任意字节。
 *
 * `: keep-alive` / `: PING` 之类 SSE 注释和空行只证明连接还活着，不代表模型在出字。
 * DeepSeek 等上游排队时会持续发这类注释；若把它们当进展，首包 / 空闲计时会被无限续命。
 * 当前行的类型跨 chunk 保持：一行很长的 `data:` 被拆成多块时，后续块仍算进展；
 * 被拆开的注释行后续块仍不算。
 */
export function createSseProgressScanner(): SseProgressScanner {
	let state: SseLineState = 'line_start';
	return {
		feed(chunk) {
			let progress = false;
			for (let i = 0; i < chunk.length; i += 1) {
				const byte = chunk[i]!;
				if (byte === 0x0a || byte === 0x0d) {
					state = 'line_start';
					continue;
				}
				if (state === 'line_start') {
					// 0x3a = ':'
					state = byte === 0x3a ? 'comment' : 'content';
				}
				if (state === 'content') progress = true;
			}
			return progress;
		},
	};
}

export function nextStreamReadTimeoutMs(
	hasReceivedChunk: boolean,
	options?: StreamIdleClockOptions
): number {
	if (hasReceivedChunk) {
		return options?.idleTimeoutMs ?? STREAM_IDLE_TIMEOUT_MS;
	}
	return options?.firstChunkTimeoutMs ?? STREAM_FIRST_CHUNK_TIMEOUT_MS;
}

/**
 * 读流计时钟。只有「真进展」（见 {@link createSseProgressScanner}）才把状态切到空闲档并清零累计等待；
 * 纯心跳 chunk 到达时，已等待的时间继续累加，不会重置预算。
 * 等待时长只统计 `read()` 本身，写下游被客户端拖慢的时间不算上游空闲。
 */
export function createStreamIdleClock(options?: StreamIdleClockOptions): StreamIdleClock {
	const scanner = createSseProgressScanner();
	let hasProgress = false;
	let waitedMs = 0;
	let readStartedAt = 0;
	return {
		timeoutMs() {
			readStartedAt = Date.now();
			return Math.max(1, nextStreamReadTimeoutMs(hasProgress, options) - waitedMs);
		},
		noteChunk(value) {
			if (!value || value.byteLength === 0) return;
			if (scanner.feed(value)) {
				hasProgress = true;
				waitedMs = 0;
			} else if (readStartedAt > 0) {
				waitedMs += Date.now() - readStartedAt;
			}
		},
	};
}

export function applyStreamIdleTimeout(usage: {
	cancelled?: boolean;
	stream_error?: string;
}): void {
	if (usage.cancelled) return;
	usage.stream_error = usage.stream_error ?? STREAM_IDLE_TIMEOUT_MESSAGE;
}

/**
 * 带空闲超时的 `reader.read()`。每次调用独立计时；调用方在拿到 chunk 后再次调用即重置。
 */
export async function readWithIdleTimeout<T>(
	reader: ReadableStreamDefaultReader<T>,
	idleTimeoutMs: number
): Promise<IdleReadResult<T>> {
	if (!Number.isFinite(idleTimeoutMs) || idleTimeoutMs <= 0) {
		const result = await reader.read();
		if (result.done) return { done: true, idleTimedOut: false };
		return { done: false, value: result.value as T, idleTimedOut: false };
	}

	let timeoutId: ReturnType<typeof setTimeout> | undefined;
	const timeoutPromise = new Promise<typeof IDLE_TIMEOUT_SENTINEL>((resolve) => {
		timeoutId = setTimeout(() => resolve(IDLE_TIMEOUT_SENTINEL), idleTimeoutMs);
	});
	try {
		const raced = await Promise.race([reader.read(), timeoutPromise]);
		if (raced === IDLE_TIMEOUT_SENTINEL) {
			return { done: false, idleTimedOut: true };
		}
		if (raced.done) return { done: true, idleTimedOut: false };
		return { done: false, value: raced.value as T, idleTimedOut: false };
	} finally {
		if (timeoutId !== undefined) clearTimeout(timeoutId);
	}
}
