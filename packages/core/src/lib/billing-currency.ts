/**
 * 网关计费币种：`system_config.BILLING_CURRENCY`（ISO 4217 字母码）。
 * `pricing_profile` 单价与 `api_keys` 预算字段的**数值单位**均按此币种解释（每百万 token 价与累计消费同币）。
 */

export const BILLING_CURRENCY_KEY = 'BILLING_CURRENCY';

/** 与历史海外 D1 部署一致：未配置或非法值时回退为 USD。 */
export const DEFAULT_BILLING_CURRENCY = 'USD';

const ISO4217_ALPHA = /^[A-Z]{3}$/;

/**
 * 读取库内原始值并归一化：trim、大写、非法则回退 {@link DEFAULT_BILLING_CURRENCY}。
 */
export function normalizeBillingCurrencyCode(raw: string | null | undefined): string {
	const t = (raw ?? '').trim().toUpperCase();
	if (ISO4217_ALPHA.test(t)) {
		return t;
	}
	return DEFAULT_BILLING_CURRENCY;
}

/**
 * 管理端写入校验：须为 3 位大写字母 ISO 4217 码。
 * @returns 规范化后的大写码
 */
export function tryParseBillingCurrencyInput(raw: string | null | undefined): string | null {
	const t = String(raw ?? '').trim().toUpperCase();
	if (!ISO4217_ALPHA.test(t)) {
		return null;
	}
	return t;
}

/** Admin 可配置的计费币种白名单（与 `pricing_profile` / Key 预算数值单位一致）。 */
export const GATEWAY_SUPPORTED_BILLING_CURRENCIES = ['USD', 'CNY'] as const;
export type GatewaySupportedBillingCurrency = (typeof GATEWAY_SUPPORTED_BILLING_CURRENCIES)[number];

/**
 * 管理端写入 `BILLING_CURRENCY` 时的白名单校验。
 * @returns `USD`、`CNY`，或非法时 `null`
 */
export function tryParseGatewaySupportedBillingCurrencyInput(raw: string | null | undefined): GatewaySupportedBillingCurrency | null {
	const t = tryParseBillingCurrencyInput(raw);
	if (t === 'USD' || t === 'CNY') {
		return t;
	}
	return null;
}
