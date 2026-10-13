import {
	parseToolCatalogPricing,
	resolveToolFactorPrices,
	toToolPricingFields,
	type ToolCatalogPricingFields,
} from '@octafuse/core/lib/tool-pricing';
import {
	toolPricingDraftFromDefinition,
	toolPricingDraftFromPrices,
	toolPricingFromDraft,
	type ToolPricingDraft,
} from '../../../lib/tool-pricing-draft';
import type { PriceTripleDraft } from './components/provider-card-state';
export type RestToolPricingDraft = PriceTripleDraft & { factorPricing?: ToolPricingDraft };

export function restPricingDraftFromEntry(entry: ToolCatalogPricingFields): RestToolPricingDraft {
	return {
		standard: String(entry.standard),
		charged: String(entry.charged),
		metered: String(entry.metered),
		...(entry.pricing ? { factorPricing: toolPricingDraftFromDefinition(entry.pricing) } : {}),
	};
}
export function restFactorDraft(value: RestToolPricingDraft): ToolPricingDraft {
	return (
		value.factorPricing ??
		toolPricingDraftFromPrices({
			standard: Number(value.standard),
			charged: Number(value.charged),
			metered: Number(value.metered),
		})
	);
}
export function restPricingDraftChanged(factorPricing: ToolPricingDraft): RestToolPricingDraft {
	const parsed = toolPricingFromDraft(factorPricing);
	const prices = parsed.ok ? resolveToolFactorPrices(parsed.pricing) : null;
	return {
		factorPricing,
		standard: prices ? String(prices.standard) : '',
		charged: prices ? String(prices.charged) : '',
		metered: prices ? String(prices.metered) : '',
	};
}
export function restPricingFieldsFromDraft(value: RestToolPricingDraft): ToolCatalogPricingFields | null {
	if (!value.factorPricing) {
		if ([value.standard, value.charged, value.metered].some((amount) => !amount.trim())) return null;
		return parseToolCatalogPricing(
			{ standard: value.standard, charged: value.charged, metered: value.metered },
			0,
			true
		);
	}
	const parsed = toolPricingFromDraft(value.factorPricing);
	return parsed.ok
		? { ...toToolPricingFields(resolveToolFactorPrices(parsed.pricing)), pricing: parsed.pricing }
		: null;
}
