/**
 * 文本流式超时：部署环境变量覆盖代码默认值。
 *
 * - Node / Docker：读 `process.env`
 * - Cloudflare Worker：读 Worker bindings（wrangler `vars` 或 Dashboard Variables）
 *
 * 空 / 缺省 / 非正整数一律回退默认。不进 `system_config`。
 */

export const STREAM_FIRST_CHUNK_TIMEOUT_MS_ENV = 'STREAM_FIRST_CHUNK_TIMEOUT_MS';
export const STREAM_IDLE_TIMEOUT_MS_ENV = 'STREAM_IDLE_TIMEOUT_MS';
export const USAGE_SAFETY_TIMEOUT_MS_ENV = 'USAGE_SAFETY_TIMEOUT_MS';

/** 尚未收到非空 chunk 时的等待上限（默认 2 分钟，对齐 Worker）。 */
export const DEFAULT_STREAM_FIRST_CHUNK_TIMEOUT_MS = 120_000;

/** 已吐过 chunk 之后两次 chunk 之间的空闲上限（默认 30 秒）。 */
export const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 30_000;

/** `usagePromise` 未 resolve 的绝对兜底（默认 10 分钟）。 */
export const DEFAULT_USAGE_SAFETY_TIMEOUT_MS = 10 * 60 * 1000;

export type StreamTimeoutBindings = {
	STREAM_FIRST_CHUNK_TIMEOUT_MS?: string;
	STREAM_IDLE_TIMEOUT_MS?: string;
	USAGE_SAFETY_TIMEOUT_MS?: string;
};

export type ResolvedStreamTimeouts = {
	firstChunkTimeoutMs: number;
	idleTimeoutMs: number;
	usageSafetyTimeoutMs: number;
};

export function parsePositiveTimeoutMs(raw: unknown, fallback: number): number {
	if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
		return Math.trunc(raw);
	}
	if (typeof raw !== 'string') return fallback;
	const s = raw.trim();
	if (!s) return fallback;
	const n = Number.parseInt(s, 10);
	if (!Number.isFinite(n) || n <= 0) return fallback;
	return n;
}

function readEnvValue(
	bindings: StreamTimeoutBindings | null | undefined,
	key: keyof StreamTimeoutBindings
): unknown {
	const fromBinding = bindings?.[key];
	if (fromBinding != null && String(fromBinding).trim() !== '') return fromBinding;
	if (typeof process !== 'undefined' && process.env) {
		return process.env[key];
	}
	return undefined;
}

export function resolveStreamTimeouts(
	bindings?: StreamTimeoutBindings | null
): ResolvedStreamTimeouts {
	return {
		firstChunkTimeoutMs: parsePositiveTimeoutMs(
			readEnvValue(bindings, STREAM_FIRST_CHUNK_TIMEOUT_MS_ENV),
			DEFAULT_STREAM_FIRST_CHUNK_TIMEOUT_MS
		),
		idleTimeoutMs: parsePositiveTimeoutMs(
			readEnvValue(bindings, STREAM_IDLE_TIMEOUT_MS_ENV),
			DEFAULT_STREAM_IDLE_TIMEOUT_MS
		),
		usageSafetyTimeoutMs: parsePositiveTimeoutMs(
			readEnvValue(bindings, USAGE_SAFETY_TIMEOUT_MS_ENV),
			DEFAULT_USAGE_SAFETY_TIMEOUT_MS
		),
	};
}
