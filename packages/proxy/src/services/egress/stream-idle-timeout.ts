/**
 * 流式上游空闲超时：`reader.read()` 本身不会超时，需用 Promise.race 包一层可重置的定时器。
 *
 * 两段阈值不要混用：
 * - 尚未收到任何非空 chunk：用 {@link STREAM_FIRST_CHUNK_TIMEOUT_MS}（默认 2 分钟），避免静默思考被空闲阈值误杀。
 * - 已经吐过 chunk：用 {@link STREAM_IDLE_TIMEOUT_MS}（默认 30 秒）收口挂死的流。
 *
 * 部署可用环境变量覆盖，见 `stream-timeout-env.ts`。
 * 计时按 TCP chunk 重置；SSE comment / ping 也会续命，心跳僵尸要靠绝对兜底。
 */

import {
	DEFAULT_STREAM_FIRST_CHUNK_TIMEOUT_MS,
	DEFAULT_STREAM_IDLE_TIMEOUT_MS,
} from '../stream-timeout-env';

/** 两次上游 chunk 之间允许的最长空闲。超过则 cancel 上游并按已解析 usage 记账。 */
export const STREAM_IDLE_TIMEOUT_MS = DEFAULT_STREAM_IDLE_TIMEOUT_MS;

/** 等待第一个非空 chunk 的上限；默认 2 分钟。 */
export const STREAM_FIRST_CHUNK_TIMEOUT_MS = DEFAULT_STREAM_FIRST_CHUNK_TIMEOUT_MS;

/** 写入 `usage.stream_error` 与请求日志 `error_message`，便于筛空闲掐流。 */
export const STREAM_IDLE_TIMEOUT_MESSAGE = 'Stream idle timeout';

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
	timeoutMs(): number;
	noteChunk(value?: Uint8Array): void;
};

export function nextStreamReadTimeoutMs(
	hasReceivedChunk: boolean,
	options?: StreamIdleClockOptions
): number {
	if (hasReceivedChunk) {
		return options?.idleTimeoutMs ?? STREAM_IDLE_TIMEOUT_MS;
	}
	return options?.firstChunkTimeoutMs ?? STREAM_FIRST_CHUNK_TIMEOUT_MS;
}

export function createStreamIdleClock(options?: StreamIdleClockOptions): StreamIdleClock {
	let hasReceivedChunk = false;
	return {
		timeoutMs: () => nextStreamReadTimeoutMs(hasReceivedChunk, options),
		noteChunk(value) {
			if (value && value.byteLength > 0) hasReceivedChunk = true;
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
