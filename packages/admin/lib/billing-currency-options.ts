/** Gateway Config 计费币种下拉：仅 USD / CNY（与 `system_config.BILLING_CURRENCY` 写入白名单一致）。 */
import { getGatewayCurrencySymbol } from '@/lib/format-gateway-currency';

export const BILLING_CURRENCY_KEY = 'BILLING_CURRENCY';

function opt(value: string, nameEn: string): { value: string; label: string } {
	const sym = getGatewayCurrencySymbol(value);
	return { value, label: `${sym} · ${value} — ${nameEn}` };
}

export const BILLING_CURRENCY_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
	opt('USD', 'US Dollar'),
	opt('CNY', 'Chinese Yuan'),
];
