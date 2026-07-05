/**
 * Provider key 限流：按 `provider_api_keys.limit_config`（RPM / TPM / 并发）做进程内滑动窗口计数。
 *
 * - RPM：请求发起时刻计数（60s 滑动窗口）。
 * - TPM：滞后计数——流结束后由 `releaseProviderKeyUsage` 按真实 usage 累加（60s 滑动窗口）；
 *   即本窗口超限后拦截的是后续请求，属业界通行近似。
 * - 并发：`acquire` 时 +1，流结束（usagePromise settle）时 -1。
 *
 * 状态为单实例进程内存（与 cooldown/敏感熔断一致）：Workers 多 isolate 各自计数，为软限制；
 * 建议把限额配置为供应商真实限额的 ~90%，由网关先行拦截以便精确预估恢复时间。
 */
import { parseProviderKeyLimitConfig, type ActiveProviderApiKeyRow } from '@octafuse/core';

const WINDOW_MS = 60_000;
/** 并发满时无法精确预估恢复时间（取决于在途流何时结束），给一个保守的重试建议。 */
const CONCURRENCY_RETRY_HINT_MS = 2_000;

type KeyRuntimeState = {
	/** 60s 窗口内的请求发起时间戳（ms，升序） */
	requestAt: number[];
	/** 60s 窗口内的 token 入账（流结束时刻 + token 数，升序） */
	tokenEvents: Array<{ at: number; tokens: number }>;
	inFlight: number;
};

const stateByKey = new Map<string, KeyRuntimeState>();

export type ProviderKeyAvailability =
	| { available: true }
	| {
			available: false;
			reason: 'rpm' | 'tpm' | 'concurrency';
			/** 预计最早可用的等待毫秒数（并发满时为保守建议值） */
			retryAfterMs: number;
	  };

function getState(keyId: string): KeyRuntimeState {
	let state = stateByKey.get(keyId);
	if (!state) {
		state = { requestAt: [], tokenEvents: [], inFlight: 0 };
		stateByKey.set(keyId, state);
	}
	return state;
}

function pruneState(state: KeyRuntimeState, now: number): void {
	const cutoff = now - WINDOW_MS;
	while (state.requestAt.length > 0 && state.requestAt[0]! <= cutoff) {
		state.requestAt.shift();
	}
	while (state.tokenEvents.length > 0 && state.tokenEvents[0]!.at <= cutoff) {
		state.tokenEvents.shift();
	}
}

function sumTokens(state: KeyRuntimeState): number {
	let total = 0;
	for (const e of state.tokenEvents) total += e.tokens;
	return total;
}

/**
 * 检查 key 当前是否可接单（纯检查，无副作用）。未配置 limit_config 时恒可用。
 */
export function checkProviderKeyAvailability(
	key: Pick<ActiveProviderApiKeyRow, 'id' | 'limit_config'>,
	now = Date.now()
): ProviderKeyAvailability {
	const limits = parseProviderKeyLimitConfig(key.limit_config);
	if (!limits) return { available: true };
	const state = stateByKey.get(key.id);
	if (!state) return { available: true };
	pruneState(state, now);

	if (limits.maxConcurrency != null && state.inFlight >= limits.maxConcurrency) {
		return { available: false, reason: 'concurrency', retryAfterMs: CONCURRENCY_RETRY_HINT_MS };
	}

	if (limits.rpm != null && state.requestAt.length >= limits.rpm) {
		// 最早一条请求滑出窗口后即有余量。
		const oldestRelevant = state.requestAt[state.requestAt.length - limits.rpm]!;
		const retryAfterMs = Math.max(1, oldestRelevant + WINDOW_MS - now);
		return { available: false, reason: 'rpm', retryAfterMs };
	}

	if (limits.tpm != null) {
		let total = sumTokens(state);
		if (total >= limits.tpm) {
			// 从最旧的 token 事件开始累计过期，直到窗口内总量降到限额以下。
			let retryAfterMs = WINDOW_MS;
			for (const e of state.tokenEvents) {
				total -= e.tokens;
				if (total < limits.tpm) {
					retryAfterMs = Math.max(1, e.at + WINDOW_MS - now);
					break;
				}
			}
			return { available: false, reason: 'tpm', retryAfterMs };
		}
	}

	return { available: true };
}

/**
 * 余量分数 = min(各已配置维度的剩余比例)，无任何限制时为 1；供粘性绑定分配排序。
 */
export function getProviderKeyHeadroom(
	key: Pick<ActiveProviderApiKeyRow, 'id' | 'limit_config'>,
	now = Date.now()
): number {
	const limits = parseProviderKeyLimitConfig(key.limit_config);
	if (!limits) return 1;
	const state = stateByKey.get(key.id);
	if (!state) return 1;
	pruneState(state, now);

	let headroom = 1;
	if (limits.rpm != null) {
		headroom = Math.min(headroom, Math.max(0, (limits.rpm - state.requestAt.length) / limits.rpm));
	}
	if (limits.tpm != null) {
		headroom = Math.min(headroom, Math.max(0, (limits.tpm - sumTokens(state)) / limits.tpm));
	}
	if (limits.maxConcurrency != null) {
		headroom = Math.min(headroom, Math.max(0, (limits.maxConcurrency - state.inFlight) / limits.maxConcurrency));
	}
	return headroom;
}

/**
 * 请求发起：RPM 计数 + 并发 +1。仅对配置了 limit_config 的 key 记录（省内存）。
 */
export function acquireProviderKey(
	key: Pick<ActiveProviderApiKeyRow, 'id' | 'limit_config'>,
	now = Date.now()
): void {
	if (!parseProviderKeyLimitConfig(key.limit_config)) return;
	const state = getState(key.id);
	pruneState(state, now);
	state.requestAt.push(now);
	state.inFlight += 1;
}

/**
 * 流结束（成功或失败）：并发 -1 + TPM 入账。与 `acquireProviderKey` 成对调用。
 */
export function releaseProviderKeyUsage(
	key: Pick<ActiveProviderApiKeyRow, 'id' | 'limit_config'>,
	totalTokens: number,
	now = Date.now()
): void {
	if (!parseProviderKeyLimitConfig(key.limit_config)) return;
	const state = stateByKey.get(key.id);
	if (!state) return;
	state.inFlight = Math.max(0, state.inFlight - 1);
	if (totalTokens > 0) {
		state.tokenEvents.push({ at: now, tokens: totalTokens });
	}
	pruneState(state, now);
}

/** 测试用：清空限流状态。 */
export function resetProviderKeyRateLimiterStateForTests(): void {
	stateByKey.clear();
}
