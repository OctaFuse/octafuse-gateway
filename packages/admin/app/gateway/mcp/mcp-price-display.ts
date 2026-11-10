import { summarizeMcpPricingRule, type McpPricingRule } from '@octafuse/core/mcp/pricing';

/** v2 factors remain meaningful for a zero standard price; legacy prices may have no ratio. */
export function mcpPriceMultiplier(rule: McpPricingRule, kind: 'charged' | 'metered'): number | null {
	const prices = summarizeMcpPricingRule(rule);
	const factor =
		rule.v === 2
			? rule[kind === 'charged' ? 'chargedFactor' : 'meteredFactor']
			: prices.standard > 0
			? prices[kind] / prices.standard
			: null;
	return factor != null && Number.isFinite(factor) && factor >= 0 ? factor : null;
}
