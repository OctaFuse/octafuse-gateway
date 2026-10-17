/**
 * 上游 HTTP 失败分类：决定是否 failover 到下一 provider。
 */

import type { ProviderFailureKind } from './provider-circuit-breaker';

export type UpstreamFailureAction = 'retry_key' | 'fail_immediately';

export type UpstreamFailureClassification = {
	action: UpstreamFailureAction;
	/** 401/402/403 等鉴权 / 额度异常，切换 provider 但应记录告警 */
	alertOnKeySwitch?: boolean;
	/** 有值时 dispatch 会写入 provider 熔断；524 / fetch 等瞬时错误不设此项 */
	failureKind?: ProviderFailureKind;
};

/**
 * 对上游 HTTP status 分类。
 * - `retry_key`：可尝试下一 provider（历史命名保留）。
 * - `fail_immediately`：请求本身错误（400/404 等），不重试其它 provider。
 */
export function classifyUpstreamHttpFailure(status: number): UpstreamFailureClassification {
	if (status === 429) {
		return { action: 'retry_key', failureKind: 'rate_limit' };
	}
	// Cloudflare 524 等边缘超时：仅同次 failover，不跨请求熔断。
	if (status === 524) {
		return { action: 'retry_key' };
	}
	if (status >= 500) {
		return { action: 'retry_key', failureKind: 'server' };
	}
	// 402：上游余额 / 额度用尽（MiniMax 1008、ElevenLabs quota_exceeded 改写而来），与 key 失效同属需人工处理的供应商侧故障。
	if (status === 401 || status === 402 || status === 403) {
		return { action: 'retry_key', alertOnKeySwitch: true, failureKind: 'auth' };
	}
	return { action: 'fail_immediately' };
}

/** fetch 异常、超时、网络错误 → 同次 failover，不跨请求熔断。 */
export function classifyUpstreamFetchFailure(): UpstreamFailureClassification {
	return { action: 'retry_key' };
}
