import type { GatewaySupportedBillingCurrency } from '@octafuse/core/lib/billing-currency';

export type StaticModelPresetModalities = {
	input: string[];
	output: string[];
};

export type StaticModelPresetRow = {
	id: string;
	display_name?: string | null;
	/** English catalog summary. Shown when `i18n.en` is absent. */
	description?: string | null;
	/** Localized catalog introductions. Admin displays these; they are not stored. */
	i18n?: {
		en: string;
		zh: string;
		ja: string;
		ko: string;
	};
	vendor?: string | null;
	context_window?: number | null;
	max_tokens?: number | null;
	/** OpenRouter-style input/output modalities. */
	modalities?: StaticModelPresetModalities;
	/** Model release date `YYYY-MM-DD`. */
	released?: string | null;
	/** Vendor retirement date `YYYY-MM-DD`; omitted/null = still offered. */
	retired?: string | null;
	pricing: {
		/** Catalog branch written as `pricing_profile` (tiers / image / audio plus optional `schedule`). */
		usd?: unknown;
		cny?: unknown;
	};
};

export type ModelCatalogCopy = {
	en: string | null;
	zh: string | null;
	ja: string | null;
	ko: string | null;
};

/** 目录介绍。英文缺省时用顶层 `description`；其他语言缺省时回退英文。 */
export function modelPresetCatalogCopy(
	preset: Pick<StaticModelPresetRow, 'description' | 'i18n'>
): ModelCatalogCopy {
	const en = preset.i18n?.en?.trim() || preset.description?.trim() || '';
	const zh = preset.i18n?.zh?.trim() || en;
	const ja = preset.i18n?.ja?.trim() || en;
	const ko = preset.i18n?.ko?.trim() || en;
	return {
		en: en || null,
		zh: zh || null,
		ja: ja || null,
		ko: ko || null,
	};
}

export function buildModelCatalogPresentation(rows: readonly StaticModelPresetRow[]) {
	const retiredByModelId = new Map<string, string>();
	const copyByModelId = new Map<string, Record<keyof ModelCatalogCopy, string>>();
	for (const preset of rows) {
		const id = preset.id.trim();
		if (!id) continue;
		const retired = preset.retired?.trim();
		if (retired) retiredByModelId.set(id, retired);
		const { en, zh, ja, ko } = modelPresetCatalogCopy(preset);
		if (en || zh || ja || ko) {
			copyByModelId.set(id, { en: en ?? '', zh: zh ?? '', ja: ja ?? '', ko: ko ?? '' });
		}
	}
	return { retiredByModelId, copyByModelId };
}

/** Returns the `usd` / `cny` object as-is, including optional catalog `schedule`. */
export function pickPresetPricingRawForBillingCurrency(
	preset: StaticModelPresetRow,
	billing: GatewaySupportedBillingCurrency
): unknown {
	return billing === 'CNY' ? preset.pricing.cny : preset.pricing.usd;
}
