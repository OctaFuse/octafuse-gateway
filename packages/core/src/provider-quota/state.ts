/**
 * 额度状态只从归一化字段派生，阈值固定，暂不做成配置。
 */
import {
	PROVIDER_QUOTA_EXHAUSTED_PERCENT,
	PROVIDER_QUOTA_LOW_PERCENT,
	type ProviderQuotaBalance,
	type ProviderQuotaSnapshot,
	type ProviderQuotaState,
	type ProviderQuotaWindow,
} from './types';

export function deriveProviderQuotaState(input: {
	balances: readonly ProviderQuotaBalance[];
	windows: readonly ProviderQuotaWindow[];
	/** 厂商显式表示当前余额不可用于调用（例如 DeepSeek `is_available: false`）。 */
	unavailable?: boolean;
}): ProviderQuotaState {
	if (input.unavailable) return 'exhausted';
	if (input.balances.length > 0 && input.balances.every((balance) => balance.total <= 0)) {
		return 'exhausted';
	}
	const percents = input.windows
		.map((window) => window.usedPercent)
		.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
	if (percents.some((percent) => percent >= PROVIDER_QUOTA_EXHAUSTED_PERCENT)) return 'exhausted';
	if (percents.some((percent) => percent >= PROVIDER_QUOTA_LOW_PERCENT)) return 'low';
	const hasSignal =
		input.balances.length > 0 ||
		input.windows.some(
			(window) =>
				window.used != null || window.limit != null || window.remaining != null || window.usedPercent != null,
		);
	return hasSignal ? 'ok' : 'unknown';
}

export function buildProviderQuotaSnapshot(input: {
	adapter: string;
	checkedAt: string;
	balances: ProviderQuotaBalance[];
	windows: ProviderQuotaWindow[];
	unavailable?: boolean;
}): ProviderQuotaSnapshot {
	return {
		adapter: input.adapter,
		checkedAt: input.checkedAt,
		state: deriveProviderQuotaState(input),
		balances: input.balances,
		windows: input.windows,
	};
}

export function quotaCheckedAt(now?: () => Date): string {
	return (now ?? (() => new Date()))().toISOString();
}
