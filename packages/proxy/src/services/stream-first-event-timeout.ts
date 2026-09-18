/**
 * 流式首个 SSE 事件超时（灰度）：收到 2xx headers 后若上游长时间不吐第一个 chunk，
 * 可在换路由前把本次 attempt 判为瞬时失败。默认关闭。
 *
 * 作用于文本流式入口：Chat Completions、Responses、Anthropic Messages、Gemini `streamGenerateContent`。
 * Images / Audio / Realtime / Tools 不走此开关。
 *
 * `system_config.STREAM_FIRST_EVENT_TIMEOUT_MS`：正整数毫秒；空 / 0 / 非法 = 关闭。
 * `system_config.STREAM_FIRST_EVENT_TIMEOUT_ROUTE_GROUPS`：逗号分隔路由组；
 * 超时开启且该键为空时只作用于 `default`（`@default` 灰度）；`*` / `all` 作用于全部。
 */

export const STREAM_FIRST_EVENT_TIMEOUT_MS_KEY = 'STREAM_FIRST_EVENT_TIMEOUT_MS';
export const STREAM_FIRST_EVENT_TIMEOUT_ROUTE_GROUPS_KEY = 'STREAM_FIRST_EVENT_TIMEOUT_ROUTE_GROUPS';

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

export function parseFirstEventTimeoutMs(raw: string | null | undefined): number {
	const s = (raw ?? '').trim();
	if (!s) return 0;
	const n = Number.parseInt(s, 10);
	if (!Number.isFinite(n) || n <= 0) return 0;
	return n;
}

export function parseFirstEventTimeoutRouteGroups(
	raw: string | null | undefined
): string[] | '*' {
	const s = (raw ?? '').trim();
	if (!s) return ['default'];
	if (s === '*' || s.toLowerCase() === 'all') return '*';
	const groups = s
		.split(',')
		.map((part) => part.trim())
		.filter(Boolean);
	return groups.length > 0 ? groups : ['default'];
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
	/** 收到 2xx 后等待首个 SSE chunk 的上限；未设或 ≤0 则不预读。超时返回 524 供 failover。 */
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
 * 在转发给客户端之前预读首个 SSE chunk。超时则返回 524；未开启时原样返回。
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
 * 预读上游流的第一个 chunk。超时则 cancel 并返回 timedOut。
 * 成功时把首 chunk prepend 回新的 ReadableStream，供后续 pump 使用。
 */
export async function peekFirstStreamChunk(
	body: ReadableStream<Uint8Array>,
	timeoutMs: number
): Promise<
	| { timedOut: true }
	| { timedOut: false; body: ReadableStream<Uint8Array> }
> {
	const reader = body.getReader();
	const first = await readFirstChunk(reader, timeoutMs);
	if (first.timedOut) {
		try {
			await reader.cancel();
		} catch {
			// ignore
		}
		return { timedOut: true };
	}
	return {
		timedOut: false,
		body: prependChunk(reader, first.value, first.done),
	};
}

async function readFirstChunk(
	reader: ReadableStreamDefaultReader<Uint8Array>,
	timeoutMs: number
): Promise<{ timedOut: true } | { timedOut: false; value?: Uint8Array; done: boolean }> {
	let timeoutId: ReturnType<typeof setTimeout> | undefined;
	const timeoutPromise = new Promise<{ timedOut: true }>((resolve) => {
		timeoutId = setTimeout(() => resolve({ timedOut: true }), timeoutMs);
	});
	try {
		const raced = await Promise.race([
			reader.read().then((chunk) => ({ timedOut: false as const, ...chunk })),
			timeoutPromise,
		]);
		return raced;
	} finally {
		if (timeoutId !== undefined) clearTimeout(timeoutId);
	}
}

function prependChunk(
	reader: ReadableStreamDefaultReader<Uint8Array>,
	first: Uint8Array | undefined,
	alreadyDone: boolean
): ReadableStream<Uint8Array> {
	let emittedFirst = first == null;
	return new ReadableStream<Uint8Array>({
		async pull(controller) {
			if (!emittedFirst) {
				emittedFirst = true;
				if (first && first.byteLength > 0) controller.enqueue(first);
				if (alreadyDone) {
					controller.close();
					return;
				}
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
