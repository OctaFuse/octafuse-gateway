import { catalogInputPriceSortKey } from '@/lib/pricing-ui';
import { formatCompactTokens } from '@/lib/format-compact-tokens';
import { normalizeModelVendorInput } from '@/lib/model-vendor';
import { parsePricingProfile, profileHasImagePerImagePricing, type PricingTierPrices } from '@octafuse/core/db/pricing-profile';
import type { MetadataSummary, ModelListItem, PresetCatalogRow } from './types';
import { ALL_VENDORS_KEY } from './types';

export function parseVendorFilterParam(value: string | null): string {
	if (value == null || value.trim() === '') return ALL_VENDORS_KEY;
	if (value.trim().toLowerCase() === ALL_VENDORS_KEY) return ALL_VENDORS_KEY;
	return normalizeModelVendorInput(value);
}

/** Pretty-print in the editor when stored value is a JSON object. */
export function formatMetadataForEditor(metadata: string | null | undefined): string {
	if (metadata == null || metadata.trim() === '') return '';
	try {
		const p = JSON.parse(metadata.trim()) as unknown;
		if (p != null && typeof p === 'object' && !Array.isArray(p)) {
			return JSON.stringify(p, null, 2);
		}
		return metadata.trim();
	} catch {
		return metadata.trim();
	}
}

/** Validate and normalize metadata for API (compact JSON string, or null to clear). */
export function parseMetadataForSave(
	raw: string
): { ok: true; value: string | null } | { ok: false; error: string } {
	const t = raw.trim();
	if (t === '') return { ok: true, value: null };
	try {
		const parsed = JSON.parse(t) as unknown;
		if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
			return {
				ok: false,
				error: 'Metadata must be a JSON object ({ ... }), not an array or primitive',
			};
		}
		return { ok: true, value: JSON.stringify(parsed) };
	} catch {
		return { ok: false, error: 'Metadata must be valid JSON' };
	}
}

export function buildMetadataSummary(metadata: string | null | undefined): MetadataSummary {
	if (metadata == null || metadata.trim() === '') {
		return { kind: 'empty' };
	}
	const trimmed = metadata.trim();
	try {
		const parsed = JSON.parse(trimmed) as unknown;
		if (parsed != null && typeof parsed === 'object' && !Array.isArray(parsed)) {
			const keys = Object.keys(parsed as Record<string, unknown>);
			return {
				kind: 'object',
				keyCount: keys.length,
				keyPreview: keys.slice(0, 3),
				formatted: JSON.stringify(parsed, null, 2),
			};
		}
		return { kind: 'raw', formatted: trimmed, label: 'Raw metadata' };
	} catch {
		return { kind: 'raw', formatted: trimmed, label: 'Raw metadata' };
	}
}

export function getMetadataButtonLabel(summary: Exclude<MetadataSummary, { kind: 'empty' }>): string {
	if (summary.kind === 'raw') return summary.label;
	if (summary.keyCount === 0) return '0 keys';
	const preview = summary.keyPreview.join(', ');
	const extra = summary.keyCount - summary.keyPreview.length;
	if (extra > 0) {
		return `${summary.keyCount} keys: ${preview}, +${extra}`;
	}
	return `${summary.keyCount} key${summary.keyCount !== 1 ? 's' : ''}: ${preview}`;
}

export function tagBadgeClass(tag: string): string {
	if (tag === 'free') return 'bg-green-100 text-green-800';
	if (tag === 'lite') return 'bg-cyan-100 text-cyan-800';
	if (tag === 'pro') return 'bg-blue-100 text-blue-800';
	if (tag === 'max') return 'bg-purple-100 text-purple-800';
	return 'bg-gray-100 text-gray-700';
}

function getTierConditionLabel(
	tierIdx: number,
	previousUpto: number | null,
	upto: number | null
): string {
	if (tierIdx === 0 && upto != null) return `≤${formatCompactTokens(upto)}`;
	if (upto == null && previousUpto != null) return `>${formatCompactTokens(previousUpto)}`;
	if (upto != null && previousUpto != null) {
		return `>${formatCompactTokens(previousUpto)}–≤${formatCompactTokens(upto)}`;
	}
	return 'All';
}

export type PricingMetricLine = {
	condition: string;
	price: number | null;
};

export type PricingMetricColumn = {
	title: string;
	/** 悬停完整说明（表头缩写用） */
	headerTitle?: string;
	/** 单价单位：token 按百万；图片按张 */
	unitKind?: 'per_m' | 'per_image';
	lines: PricingMetricLine[];
};

function hasNonZeroTokenTiers(tiers: PricingTierPrices[]): boolean {
	return tiers.some(
		(t) =>
			t.input_price > 0 ||
			t.output_price > 0 ||
			(t.cache_read_price != null && t.cache_read_price > 0) ||
			(t.cache_write_price != null && t.cache_write_price > 0) ||
			(t.image_input_price != null && t.image_input_price > 0) ||
			(t.image_output_price != null && t.image_output_price > 0)
	);
}

function hasImageTokenTiers(tiers: PricingTierPrices[]): boolean {
	return tiers.some(
		(t) =>
			(t.image_input_price != null && t.image_input_price > 0) ||
			(t.image_input_cache_price != null && t.image_input_cache_price > 0) ||
			(t.image_output_price != null && t.image_output_price > 0)
	);
}

export function buildPricingMetricColumns(pricingProfile: string | null | undefined): PricingMetricColumn[] {
	const profile = parsePricingProfile(pricingProfile ?? undefined);
	if (!profile) return [];

	const columns: PricingMetricColumn[] = [];
	const buildMetricLines = (pickPrice: (tier: PricingTierPrices) => number | null): PricingMetricLine[] =>
		profile.tiers.map((tier, tierIdx) => {
			const previous = tierIdx === 0 ? null : profile.tiers[tierIdx - 1]!.upto;
			return {
				condition: getTierConditionLabel(tierIdx, previous, tier.upto),
				price: pickPrice(tier),
			};
		});

	if (profileHasImagePerImagePricing(profile) && profile.image) {
		columns.push({
			title: 'Output',
			headerTitle: 'Output (per image)',
			unitKind: 'per_image',
			lines: [{ condition: 'All', price: profile.image.default }],
		});
		const inputDefault = profile.image.input?.default;
		if (inputDefault != null && inputDefault > 0) {
			columns.push({
				title: 'Input Ref',
				headerTitle: 'Reference input (per image)',
				unitKind: 'per_image',
				lines: [{ condition: 'All', price: inputDefault }],
			});
		}
		return columns;
	}

	if (hasImageTokenTiers(profile.tiers)) {
		columns.push(
			{
				title: 'Text Input',
				headerTitle: 'Text input (per 1M tokens)',
				unitKind: 'per_m',
				lines: buildMetricLines((tier) => tier.input_price),
			},
			{
				title: 'Cached Text',
				headerTitle: 'Cached text input (per 1M tokens)',
				unitKind: 'per_m',
				lines: buildMetricLines((tier) => tier.cache_read_price ?? null),
			},
			{
				title: 'Image Input',
				headerTitle: 'Image input (per 1M tokens)',
				unitKind: 'per_m',
				lines: buildMetricLines((tier) => tier.image_input_price ?? null),
			},
			{
				title: 'Cached Image Input',
				headerTitle: 'Cached image input (per 1M tokens)',
				unitKind: 'per_m',
				lines: buildMetricLines((tier) => tier.image_input_cache_price ?? null),
			},
			{
				title: 'Image Output',
				headerTitle: 'Image output (per 1M tokens)',
				unitKind: 'per_m',
				lines: buildMetricLines((tier) => tier.image_output_price ?? null),
			}
		);
		return columns;
	}

	const showTokenColumns = profile.tiers.length > 0 && hasNonZeroTokenTiers(profile.tiers);

	if (showTokenColumns) {
		columns.push(
			{
				title: 'Input Price',
				headerTitle: 'Input price (per 1M tokens)',
				unitKind: 'per_m',
				lines: buildMetricLines((tier) => tier.input_price),
			},
			{
				title: 'Output Price',
				headerTitle: 'Output price (per 1M tokens)',
				unitKind: 'per_m',
				lines: buildMetricLines((tier) => tier.output_price),
			},
			{
				title: 'Cache Read',
				headerTitle: 'Cache read (per 1M tokens)',
				unitKind: 'per_m',
				lines: buildMetricLines((tier) => tier.cache_read_price ?? null),
			}
		);

		if (profile.tiers.some((tier) => tier.cache_write_price != null)) {
			columns.push({
				title: 'Cache Write',
				headerTitle: 'Cache write (per 1M tokens)',
				unitKind: 'per_m',
				lines: buildMetricLines((tier) => tier.cache_write_price ?? null),
			});
		}
	}

	return columns;
}

export function groupModelsByVendor(models: ModelListItem[]): [string, ModelListItem[]][] {
	const g = new Map<string, ModelListItem[]>();
	for (const m of models) {
		const key = normalizeModelVendorInput(m.vendor);
		const list = g.get(key) ?? [];
		list.push(m);
		g.set(key, list);
	}
	for (const list of g.values()) {
		list.sort((a, b) => {
			const pa = catalogInputPriceSortKey(a);
			const pb = catalogInputPriceSortKey(b);
			if (pb !== pa) return pb - pa;
			return (a.display_name || a.id).localeCompare(b.display_name || b.id, undefined, {
				sensitivity: 'base',
			});
		});
	}
	return [...g.entries()].sort(([a], [b]) => {
		if (a === 'other') return 1;
		if (b === 'other') return -1;
		return a.localeCompare(b, undefined, { sensitivity: 'base' });
	});
}

export function sortImportCatalogRows(rows: PresetCatalogRow[]): PresetCatalogRow[] {
	return [...rows].sort((a, b) => {
		const va = normalizeModelVendorInput(a.vendor);
		const vb = normalizeModelVendorInput(b.vendor);
		if (va !== vb) {
			return va.localeCompare(vb, undefined, { sensitivity: 'base' });
		}
		return a.id.localeCompare(b.id, undefined, { sensitivity: 'base' });
	});
}

export { formatCompactTokens };
