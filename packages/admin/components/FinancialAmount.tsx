'use client';
import { useLocale, useTranslations } from 'next-intl';
import { relativeMoneyFactor } from '@/lib/financial-display';
import { formatGatewayMoneyCode, formatGatewayMoneyCompact } from '@/lib/format-gateway-currency';
export function FinancialAmount({
	value,
	standard,
	currency,
	compact = false,
}: {
	value: number;
	standard?: number | null;
	currency: string;
	compact?: boolean;
}) {
	const locale = useLocale();
	const t = useTranslations('remainingUi');
	const factor = relativeMoneyFactor(value, standard);
	return (
		<span className="inline-flex items-baseline gap-1.5 whitespace-nowrap font-mono tabular-nums">
			<span>
				{compact ? formatGatewayMoneyCompact(value, currency) : formatGatewayMoneyCode(value, currency, 4)}
			</span>
			{factor != null ? (
				<span title={t('effectiveFactor')} className="text-xs text-gray-500">
					{new Intl.NumberFormat(locale, {
						maximumSignificantDigits: 5,
						notation: factor > 1e6 || (factor > 0 && factor < 0.0001) ? 'scientific' : 'standard',
					}).format(factor)}
					×
				</span>
			) : null}
		</span>
	);
}
