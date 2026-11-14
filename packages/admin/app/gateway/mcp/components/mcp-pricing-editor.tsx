'use client';

import { MultiplierBadge } from '@/components/financial-value';
import { ToolPricingEditor } from '@/components/tool-pricing-editor';
import { mcpPriceMultiplier } from '../mcp-price-display';
import { useLocale, useTranslations } from 'next-intl';
import { summarizeMcpPricingRule, type McpPricingRule } from '@octafuse/core/mcp/pricing';
import { formatGatewayMoneyCompact } from '@/lib/format-gateway-currency';
import { pricingRuleFromDraft, type PricingDraft } from '../mcp-pricing-draft';

export function McpPricingDraftSummary({
	value,
	currency,
}: {
	value: PricingDraft;
	currency: string;
}) {
	const t = useTranslations('mcp.pricing');
	const parsed = pricingRuleFromDraft(value);
	const amount = parsed.ok ? summarizeMcpPricingRule(parsed.rule).charged : null;
	return (
		<p className="text-xs font-medium text-gray-700">
			{amount === null
				? t('needsReview')
				: amount === 0
				? t('freeSummary')
				: t('fixedSummary', { amount: formatGatewayMoneyCompact(amount, currency) })}
		</p>
	);
}

export function McpPricingEditor({
	value,
	currency,
	onChange,
}: {
	value: PricingDraft;
	currency: string;
	onChange: (value: PricingDraft) => void;
}) {
	return <ToolPricingEditor compact value={value} currency={currency} onChange={onChange} />;
}

export function McpPricingInline({ rule, currency }: { rule: McpPricingRule; currency: string }) {
	const t = useTranslations('mcp');
	const prices = summarizeMcpPricingRule(rule);
	const locale = useLocale();
	const ui = useTranslations('mcp.ui');
	return (
		<span
			title={t('priceLegend', {
				standard: formatGatewayMoneyCompact(prices.standard, currency),
				charged: formatGatewayMoneyCompact(prices.charged, currency),
				metered: formatGatewayMoneyCompact(prices.metered, currency),
				unit: rule.unit,
			})}
		>
			<span className="inline-flex flex-wrap items-baseline gap-x-3 gap-y-1">
				{(['charged', 'metered'] as const).map((kind) => {
					const factor = mcpPriceMultiplier(rule, kind);
					return (
						<span key={kind}>
							{t(kind)}{' '}
							<span className="font-mono font-medium tabular-nums text-gray-900">
								{formatGatewayMoneyCompact(prices[kind], currency)}
							</span>
							{factor != null ? (
								<span className="ml-1">
									<MultiplierBadge title={ui('factorHint')}>
										×{new Intl.NumberFormat(locale, { maximumSignificantDigits: 6 }).format(factor)}
									</MultiplierBadge>
								</span>
							) : null}
						</span>
					);
				})}
			</span>
		</span>
	);
}

export function McpPricingDetails({ rule, currency }: { rule: McpPricingRule; currency: string }) {
	const t = useTranslations('mcp');
	const ui = useTranslations('mcp.ui');
	const locale = useLocale();
	const prices = summarizeMcpPricingRule(rule);
	return (
		<div className="mt-4 space-y-3">
			<p className="text-xs text-gray-500">{t('pricing.perCall')}</p>

			<dl className="grid gap-3 sm:grid-cols-3">
				{(['standard', 'charged', 'metered'] as const).map((key) => (
					<div key={key}>
						<dt className="text-xs text-gray-500">{t(key)}</dt>
						<dd className="mt-1 flex flex-wrap items-center gap-1.5">
							<span className="font-mono text-sm font-medium tabular-nums text-gray-900">
								{formatGatewayMoneyCompact(prices[key], currency)}
							</span>
							{key !== 'standard' && mcpPriceMultiplier(rule, key) != null ? (
								<MultiplierBadge title={ui('factorHint')}>
									×
									{new Intl.NumberFormat(locale, { maximumSignificantDigits: 6 }).format(
										mcpPriceMultiplier(rule, key)!
									)}
								</MultiplierBadge>
							) : null}
							<span className="text-xs text-gray-500">
								/ {rule.unit === 'request' ? t('ui.requestUnit') : rule.unit}
							</span>
						</dd>
					</div>
				))}
			</dl>
		</div>
	);
}
