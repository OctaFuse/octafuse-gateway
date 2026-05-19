/**
 * 与网关 `BILLING_CURRENCY` 对齐的金额展示：窄货币符号 + 固定小数位（避免 JPY 等 Intl 小数位差异）。
 */
import { GATEWAY_MONEY_DECIMAL_PLACES } from '@/lib/gateway-money';

function normCode(currencyCode: string): string {
	const t = (currencyCode || 'USD').trim().toUpperCase();
	return /^[A-Z]{3}$/.test(t) ? t : 'USD';
}

/** 常见 ISO 4217 窄符号；其余用 Intl，失败则回退字母码。 */
const BILLING_SYMBOL_OVERRIDE: Readonly<Record<string, string>> = {
	USD: '$',
	CNY: '¥',
	EUR: '€',
	GBP: '£',
	JPY: '¥',
	KRW: '₩',
	HKD: 'HK$',
	TWD: 'NT$',
};

export function getGatewayCurrencySymbol(currencyCode: string): string {
	const c = normCode(currencyCode);
	const o = BILLING_SYMBOL_OVERRIDE[c];
	if (o) {
		return o;
	}
	try {
		const parts = new Intl.NumberFormat('en-US', {
			style: 'currency',
			currency: c,
			currencyDisplay: 'narrowSymbol',
		}).formatToParts(1);
		const cur = parts.find((p) => p.type === 'currency');
		if (cur?.value) {
			return cur.value;
		}
	} catch {
		/* invalid currency for Intl */
	}
	return c;
}

function joinSymbolAmount(sym: string, fixed: string): string {
	// 回退为 ISO 字母码时与数字之间加空格，避免 `USD1.00`
	if (/^[A-Z]{3}$/.test(sym)) {
		return `${sym} ${fixed}`;
	}
	return `${sym}${fixed}`;
}

function coerceMoneyAmount(value: number | string | null | undefined): number {
	const n = typeof value === 'number' ? value : Number(value);
	return Number.isFinite(n) ? n : 0;
}

export function formatGatewayMoneyCode(
	amount: number | string | null | undefined,
	currencyCode: string,
	decimals: number = GATEWAY_MONEY_DECIMAL_PLACES
): string {
	const sym = getGatewayCurrencySymbol(currencyCode);
	return joinSymbolAmount(sym, coerceMoneyAmount(amount).toFixed(decimals));
}

export function formatGatewayMoneyCodeSigned(
	amount: number | string | null | undefined,
	currencyCode: string,
	decimals: number = GATEWAY_MONEY_DECIMAL_PLACES
): string {
	const sym = getGatewayCurrencySymbol(currencyCode);
	const normalized = coerceMoneyAmount(amount);
	const fixed = Math.abs(normalized).toFixed(decimals);
	const zeroFixed = (0).toFixed(decimals);
	const zero = joinSymbolAmount(sym, zeroFixed);
	if (normalized > 0) {
		return `+${joinSymbolAmount(sym, fixed)}`;
	}
	if (normalized < 0) {
		return `-${joinSymbolAmount(sym, fixed)}`;
	}
	return zero;
}

/** 去掉小数尾随零（列表等紧凑展示；内部仍按 maxDecimals 四舍五入）。 */
function trimGatewayDecimalZeros(fixed: string): string {
	if (!fixed.includes('.')) {
		return fixed;
	}
	return fixed.replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '');
}

/**
 * 紧凑金额：符号 + 去尾随零的小数（默认最多 6 位小数，与网关存储精度一致）。
 */
export function formatGatewayMoneyCompact(
	amount: number | string | null | undefined,
	currencyCode: string,
	maxDecimals: number = GATEWAY_MONEY_DECIMAL_PLACES
): string {
	const sym = getGatewayCurrencySymbol(currencyCode);
	const fixed = trimGatewayDecimalZeros(coerceMoneyAmount(amount).toFixed(maxDecimals));
	return joinSymbolAmount(sym, fixed);
}

/** 表头或说明：`¥/1M` */
export function formatPerMillionTokenUnit(currencyCode: string): string {
	return `${getGatewayCurrencySymbol(currencyCode)}/1M`;
}
