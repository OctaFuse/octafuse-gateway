import {
	parseToolFactorPricing,
	resolveToolFactorPrices,
	type ToolFactorPricing,
	type ToolUnitPrices,
} from '@octafuse/core/lib/tool-pricing';

export type ToolPricingDraft = {
	standard: string;
	chargedFactor: string;
	meteredFactor: string;
	/** A zero legacy baseline cannot represent non-zero absolute prices as factors. */
	legacyNeedsReview?: boolean;
};
export type ToolPricingDraftError = 'invalidNumber';
export const DEFAULT_TOOL_PRICING_DRAFT: ToolPricingDraft = {
	standard: '0',
	chargedFactor: '0',
	meteredFactor: '1',
};

export function toolPricingDraftFromDefinition(pricing: ToolFactorPricing): ToolPricingDraft {
	return {
		standard: String(pricing.standard),
		chargedFactor: String(pricing.chargedFactor),
		meteredFactor: String(pricing.meteredFactor),
	};
}

export function toolPricingDraftFromPrices(prices: ToolUnitPrices): ToolPricingDraft {
	const { standard, charged, metered } = prices;
	const needsReview: ToolPricingDraft = {
		standard: '',
		chargedFactor: '',
		meteredFactor: '',
		legacyNeedsReview: true,
	};
	if (standard === 0 && (charged !== 0 || metered !== 0)) return needsReview;
	const draft = {
		standard: String(standard),
		chargedFactor: String(standard ? charged / standard : 0),
		meteredFactor: String(standard ? metered / standard : 1),
	};
	const parsed = toolPricingFromDraft(draft);
	if (!parsed.ok) return needsReview;
	const converted = resolveToolFactorPrices(parsed.pricing);
	return Object.entries(prices).some(([key, value]) => converted[key as keyof ToolUnitPrices] !== value)
		? needsReview
		: draft;
}

export function toolPricingFromDraft(
	draft: ToolPricingDraft
): { ok: true; pricing: ToolFactorPricing } | { ok: false; error: ToolPricingDraftError } {
	const pricing = parseToolFactorPricing({
		v: 2,
		standard: draft.standard,
		chargedFactor: draft.chargedFactor,
		meteredFactor: draft.meteredFactor,
	});
	return pricing ? { ok: true, pricing } : { ok: false, error: 'invalidNumber' };
}
