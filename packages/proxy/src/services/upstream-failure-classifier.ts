/**
 * 上游 HTTP 失败分类：决定是否在同 provider 内换 key、或换下一 provider。
 */

import type { ProviderKeyFailureKind } from './provider-key-circuit-breaker';

export type UpstreamFailureAction = 'retry_key' | 'fail_immediately';

export type UpstreamFailureClassification = {
	action: UpstreamFailureAction;
	/** 401/403 等 key 异常，切换 key 但应记录告警 */
	alertOnKeySwitch?: boolean;
	/** 有值时 dispatch 会写入 provider key 熔断；524 / fetch 等瞬时错误不设此项 */
	failureKind?: ProviderKeyFailureKind;
};

/**
 * 对上游 HTTP status 分类。
 * - `retry_key`：可尝试同 provider 下一把 key；全部 key 失败后再换 provider。
 * - `fail_immediately`：请求本身错误（400/404 等），不重试其它 key 或 provider。
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
	if (status === 401 || status === 403) {
		return { action: 'retry_key', alertOnKeySwitch: true, failureKind: 'auth' };
	}
	return { action: 'fail_immediately' };
}

/** fetch 异常、超时、网络错误 → 同次 failover，不跨请求熔断。 */
export function classifyUpstreamFetchFailure(): UpstreamFailureClassification {
	return { action: 'retry_key' };
}
