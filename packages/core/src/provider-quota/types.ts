/**
 * 上游供应商额度快照。路由与监控只读这些归一化字段，不依赖厂商原始响应。
 * 独立管理凭据（AK/SK、Admin Key）以后加在 `ProviderQuotaFetchContext.credentials` 上。
 */

export const PROVIDER_QUOTA_LOW_PERCENT = 90;
export const PROVIDER_QUOTA_EXHAUSTED_PERCENT = 100;

export type ProviderQuotaState = 'ok' | 'low' | 'exhausted' | 'unknown';

export type ProviderQuotaWindowUnit = 'tokens' | 'requests' | 'currency' | 'percent';

export type ProviderQuotaBalance = {
	currency: string;
	total: number;
	granted?: number;
	paid?: number;
};

export type ProviderQuotaWindow = {
	/** 稳定窗口 id，如 `5h`、`weekly`、`monthly`、`key_limit`。 */
	id: string;
	unit: ProviderQuotaWindowUnit;
	used?: number;
	limit?: number;
	remaining?: number;
	/** 0–100。厂商只给百分比时也能比较。 */
	usedPercent?: number;
	resetsAt?: string | null;
};

export type ProviderQuotaSnapshot = {
	adapter: string;
	checkedAt: string;
	state: ProviderQuotaState;
	balances: ProviderQuotaBalance[];
	windows: ProviderQuotaWindow[];
};

export type ProviderQuotaFetchContext = {
	apiKey: string;
	origin: string;
	fetchImpl: typeof fetch;
	signal?: AbortSignal;
	now?: () => Date;
};

export type ProviderQuotaAdapter = {
	id: string;
	defaultOrigin: string;
	fetch(ctx: ProviderQuotaFetchContext): Promise<ProviderQuotaSnapshot>;
};

/** 厂商 HTTP 非 2xx，或成功响应里的业务码表示失败。message 不含响应体。 */
export class ProviderQuotaUpstreamError extends Error {
	status: number;

	constructor(status: number, message: string) {
		super(message);
		this.name = 'ProviderQuotaUpstreamError';
		this.status = status;
	}
}

/** HTTP 成功但响应形状无法映射。 */
export class ProviderQuotaParseError extends Error {
	constructor(message = 'Upstream quota response could not be parsed') {
		super(message);
		this.name = 'ProviderQuotaParseError';
	}
}
