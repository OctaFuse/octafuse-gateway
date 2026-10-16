/**
 * 流式上游空闲超时：`reader.read()` 本身不会超时，需用 Promise.race 包一层可重置的定时器。
 *
 * 两段阈值不要混用：
 * - 尚未收到任何非空 chunk：用 {@link STREAM_FIRST_CHUNK_TIMEOUT_MS}（默认 2 分钟），避免静默思考被空闲阈值误杀。
 * - 已经吐过 chunk：用 {@link STREAM_IDLE_TIMEOUT_MS}（默认 90 秒）收口挂死的流。
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
