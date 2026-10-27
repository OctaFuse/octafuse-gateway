/**
 * 上游「等响应头」超时。
 *
 * 流式请求如果上游接了连接却迟迟不回响应头，`fetch()` 会一直挂着，failover 根本轮不到。
 * 这里只给「发请求 → 收到响应头」这一段限时：响应头到手后立刻清掉定时器，
 * 不会误伤之后的流式 body（首包 / 空闲超时另有计时）。
 *
 * 超时按 fetch 异常抛出，由 `failoverDispatch` 当作瞬时失败换下一个候选；不写跨请求熔断。
 */

export const UPSTREAM_HEADERS_TIMEOUT_MESSAGE_PREFIX = 'Upstream response headers timeout';

export type UpstreamHeadersTimeoutOptions = {
	/** 流式请求发出后等待上游响应头的上限；未设则不限时。 */
	headersTimeoutMs?: number;
};

export function isUpstreamHeadersTimeoutMessage(message: string): boolean {
	return message.startsWith(UPSTREAM_HEADERS_TIMEOUT_MESSAGE_PREFIX);
}

export async function fetchUntilHeaders(
	url: string,
	init: RequestInit,
	timeoutMs?: number
): Promise<Response> {
	if (timeoutMs == null || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
		return fetch(url, init);
	}
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		return await fetch(url, { ...init, signal: controller.signal });
	} catch (err) {
		if (controller.signal.aborted) {
			throw new Error(`${UPSTREAM_HEADERS_TIMEOUT_MESSAGE_PREFIX} after ${timeoutMs}ms`);
		}
		throw err;
	} finally {
		clearTimeout(timer);
	}
}
