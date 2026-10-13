import type { McpPricingRule, McpFactorPricingRule } from '@octafuse/core/mcp/pricing';
import {
	DEFAULT_TOOL_PRICING_DRAFT,
	toolPricingFromDraft,
	toolPricingDraftFromDefinition,
	toolPricingDraftFromPrices,
	type ToolPricingDraft,
	type ToolPricingDraftError,
} from '../../../lib/tool-pricing-draft';

export type PricingDraft = ToolPricingDraft;
export type PricingDraftError = ToolPricingDraftError;
export const DEFAULT_PRICING_DRAFT = DEFAULT_TOOL_PRICING_DRAFT;
export function pricingDraftFromRule(rule: McpPricingRule | null | undefined): PricingDraft {
	if (rule === null) return { standard: '', chargedFactor: '', meteredFactor: '' };
	if (!rule) return { ...DEFAULT_PRICING_DRAFT };
	return rule.v === 2 ? toolPricingDraftFromDefinition(rule) : toolPricingDraftFromPrices(rule.prices);
}
export function pricingRuleFromDraft(
	draft: PricingDraft
): { ok: true; rule: McpFactorPricingRule } | { ok: false; error: PricingDraftError } {
	const parsed = toolPricingFromDraft(draft);
	return parsed.ok ? { ok: true, rule: { ...parsed.pricing, unit: 'request', config: {} } } : parsed;
}
