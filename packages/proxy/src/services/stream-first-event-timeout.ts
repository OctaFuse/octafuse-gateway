/**
 * 流式首个 SSE 事件超时：收到 2xx headers 后若上游长时间不吐出第一个「真事件」，
 * 在换路由前把本次 attempt 判为瞬时失败（524），交给 failover 换下一个候选。
 *
 * 「真事件」指带内容的 SSE 行；`: keep-alive` 一类注释心跳和空行不算（上游排队时会一直发心跳）。
 * 只在后面还有可切换的候选时才生效；已是最后一个候选时跳过，改由流内首包 / 空闲计时兜底，
 * 避免把唯一一条路由上的慢首包直接打成错误。
 *
 * 作用于文本流式入口：Chat Completions、Responses、Anthropic Messages、Gemini `streamGenerateContent`。
 * Images / Audio / Realtime / Tools 不走此开关。
 *
 * `system_config.STREAM_FIRST_EVENT_TIMEOUT_MS`：未配置 / 空 = 默认 60s；正整数毫秒 = 自定义；
 * `0` = 关闭；非法值回退默认。
 * `system_config.STREAM_FIRST_EVENT_TIMEOUT_ROUTE_GROUPS`：逗号分隔路由组；
 * 空 / 未配置 / `*` / `all` 作用于全部路由组。
 */

import {
	createSseProgressScanner,
	readWithIdleTimeout,
} from './egress/stream-idle-timeout';

export const STREAM_FIRST_EVENT_TIMEOUT_MS_KEY = 'STREAM_FIRST_EVENT_TIMEOUT_MS';
export const STREAM_FIRST_EVENT_TIMEOUT_ROUTE_GROUPS_KEY = 'STREAM_FIRST_EVENT_TIMEOUT_ROUTE_GROUPS';

/** 未配置 `system_config.STREAM_FIRST_EVENT_TIMEOUT_MS` 时的首个真事件等待上限。 */
export const DEFAULT_STREAM_FIRST_EVENT_TIMEOUT_MS = 60_000;

const CACHE_TTL_MS = 30_000;

type CacheEntry = {
	timeoutMs: number;
	groups: string[] | '*';
	expiresAt: number;
};

let cache: CacheEntry | null = null;

export function resetStreamFirstEventTimeoutCacheForTests(): void {
	cache = null;
}

/** 未配置 / 空串 / 非法 = 默认；`<= 0` = 关闭。 */
export function parseFirstEventTimeoutMs(raw: string | null | undefined): number {
	const s = (raw ?? '').trim();
	if (!s) return DEFAULT_STREAM_FIRST_EVENT_TIMEOUT_MS;
	const n = Number.parseInt(s, 10);
	if (!Number.isFinite(n)) return DEFAULT_STREAM_FIRST_EVENT_TIMEOUT_MS;
	return n > 0 ? n : 0;
}

export function parseFirstEventTimeoutRouteGroups(
	raw: string | null | undefined
): string[] | '*' {
	const s = (raw ?? '').trim();
	if (!s) return '*';
	if (s === '*' || s.toLowerCase() === 'all') return '*';
	const groups = s
		.split(',')
		.map((part) => part.trim())
		.filter(Boolean);
	return groups.length > 0 ? groups : '*';
}

export function resolveFirstEventTimeoutMs(
	timeoutMs: number,
	groups: string[] | '*',
	routeGroup: string
): number {
	if (timeoutMs <= 0) return 0;
	if (groups === '*') return timeoutMs;
	return groups.includes(routeGroup) ? timeoutMs : 0;
}

export async function loadFirstEventTimeoutConfig(repos: {
	systemConfig: { getConfig: (key: string) => Promise<string | null> };
}): Promise<{ timeoutMs: number; groups: string[] | '*' }> {
	const now = Date.now();
	if (cache && cache.expiresAt > now) {
		return { timeoutMs: cache.timeoutMs, groups: cache.groups };
	}
	const [timeoutRaw, groupsRaw] = await Promise.all([
		repos.systemConfig.getConfig(STREAM_FIRST_EVENT_TIMEOUT_MS_KEY),
		repos.systemConfig.getConfig(STREAM_FIRST_EVENT_TIMEOUT_ROUTE_GROUPS_KEY),
	]);
	const timeoutMs = parseFirstEventTimeoutMs(timeoutRaw);
	const groups = parseFirstEventTimeoutRouteGroups(groupsRaw);
	cache = { timeoutMs, groups, expiresAt: now + CACHE_TTL_MS };
	return { timeoutMs, groups };
}

export type FirstEventTimeoutOptions = {
	/** 收到 2xx 后等待首个带内容的 SSE 事件的上限；未设或 ≤0 则不预读。超时返回 524 供 failover。 */
	firstEventTimeoutMs?: number;
};

export function firstEventTimeoutErrorResponse(timeoutMs: number): Response {
	return new Response(
		JSON.stringify({
			error: {
				message: `First SSE event timeout after ${timeoutMs}ms`,
				type: 'first_event_timeout',
			},
		}),
		{ status: 524, headers: { 'Content-Type': 'application/json' } }
	);
}

/**
 * 在转发给客户端之前预读首个真 SSE 事件。超时则返回 524；未开启时原样返回。
 */
export async function peekResponseFirstEvent(
	response: Response,
	timeoutMs: number,
	logLabel: string
): Promise<{ timedOut: boolean; response: Response }> {
	if (timeoutMs <= 0 || !response.body) {
		return { timedOut: false, response };
	}
	const peeked = await peekFirstStreamChunk(response.body, timeoutMs);
	if (peeked.timedOut) {
		console.warn(`[Gateway Proxy] first SSE event timeout ${logLabel} timeoutMs=${timeoutMs}`);
		return { timedOut: true, response: firstEventTimeoutErrorResponse(timeoutMs) };
	}
	return {
		timedOut: false,
		response: new Response(peeked.body, {
			status: response.status,
			statusText: response.statusText,
			headers: response.headers,
		}),
	};
}

/**
 * 预读上游流直到出现第一个「真事件」（带内容的 SSE 行；注释心跳和空行不算）。
 * 总等待超过 `timeoutMs` 则 cancel 并返回 timedOut；流在此之前自然结束则原样放行。
 * 成功时把已读到的 chunk（含期间的心跳）按序 prepend 回新的 ReadableStream，供后续 pump 使用。
 */
export async function peekFirstStreamChunk(
	body: ReadableStream<Uint8Array>,
	timeoutMs: number
): Promise<
	| { timedOut: true }
	| { timedOut: false; body: ReadableStream<Uint8Array> }
> {
	const reader = body.getReader();
	const scanner = createSseProgressScanner();
	const buffered: Uint8Array[] = [];
	const deadline = Date.now() + timeoutMs;
	let streamDone = false;

	while (true) {
		const remaining = deadline - Date.now();
		const next =
			remaining > 0 ? await readWithIdleTimeout(reader, remaining) : { idleTimedOut: true as const };
		if (next.idleTimedOut) {
			try {
				await reader.cancel();
			} catch {
				// ignore
			}
			return { timedOut: true };
		}
		if (next.done) {
			streamDone = true;
			break;
		}
		const value = next.value;
		if (value && value.byteLength > 0) {
			buffered.push(value);
			if (scanner.feed(value)) break;
		}
	}

	return {
		timedOut: false,
		body: prependChunks(reader, buffered, streamDone),
	};
}

function prependChunks(
	reader: ReadableStreamDefaultReader<Uint8Array>,
	chunks: Uint8Array[],
	alreadyDone: boolean
): ReadableStream<Uint8Array> {
	let index = 0;
	return new ReadableStream<Uint8Array>({
		async pull(controller) {
			if (index < chunks.length) {
				controller.enqueue(chunks[index]!);
				index += 1;
				return;
			}
			if (alreadyDone) {
				controller.close();
				return;
			}
			const next = await reader.read();
			if (next.done) {
				controller.close();
				return;
			}
			controller.enqueue(next.value);
		},
		cancel(reason) {
			return reader.cancel(reason);
		},
	});
}
