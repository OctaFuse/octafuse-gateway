import {
	perCallMcpPricingRule,
	resolveMcpUnitPrices,
	type McpPricingRule,
	type McpFactorPricingRule,
} from '@octafuse/core/mcp/pricing';

export type PricingDraft = {
	standard: string;
	chargedFactor: string;
	meteredFactor: string;
	/** A zero legacy baseline cannot represent non-zero absolute prices as factors. */
	legacyNeedsReview?: boolean;
};
export type PricingDraftError = 'invalidNumber';
export const DEFAULT_PRICING_DRAFT: PricingDraft = { standard: '0', chargedFactor: '0', meteredFactor: '1' };

export function pricingDraftFromRule(rule: McpPricingRule | null | undefined): PricingDraft {
	if (rule === null) return { standard: '', chargedFactor: '', meteredFactor: '' };
	if (!rule) return { ...DEFAULT_PRICING_DRAFT };
	if (rule.v === 2)
		return {
			standard: String(rule.standard),
			chargedFactor: String(rule.chargedFactor),
			meteredFactor: String(rule.meteredFactor),
		};
	const { standard, charged, metered } = rule.prices;
	if (standard === 0 && (charged !== 0 || metered !== 0))
		return { standard: '', chargedFactor: '', meteredFactor: '', legacyNeedsReview: true };
	const draft = {
		standard: String(standard),
		chargedFactor: String(standard ? charged / standard : 0),
		meteredFactor: String(standard ? metered / standard : 1),
	};
	const converted = pricingRuleFromDraft(draft);
	// Refuse an inexact conversion rather than change existing charges or costs on save.
	if (
		!converted.ok ||
		Object.entries(rule.prices).some(
			([key, value]) => resolveMcpUnitPrices(converted.rule)[key as keyof typeof rule.prices] !== value
		)
	)
		return { standard: '', chargedFactor: '', meteredFactor: '', legacyNeedsReview: true };
	return draft;
}

export function pricingRuleFromDraft(
	draft: PricingDraft
): { ok: true; rule: McpFactorPricingRule } | { ok: false; error: PricingDraftError } {
	if (
		[draft.standard, draft.chargedFactor, draft.meteredFactor].some(
			(value) => !value.trim() || !Number.isFinite(Number(value)) || Number(value) < 0
		)
	)
		return { ok: false, error: 'invalidNumber' };
	try {
		return {
			ok: true,
			rule: perCallMcpPricingRule(
				Number(draft.standard),
				Number(draft.chargedFactor),
				Number(draft.meteredFactor)
			),
		};
	} catch {
		return { ok: false, error: 'invalidNumber' };
	}
}
