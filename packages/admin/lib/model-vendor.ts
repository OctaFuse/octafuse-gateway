/**
 * 模型厂商 `vendor`：**权威 key 列表**见 `model-vendors.json`（下拉、归一化、展示名）。
 * 管理端静态价目：仅有自研模型的 catalog key 才有 `model-presets/<key>.json`（见 `model-preset.ts`）；聚合/托管类 key 仅用于下拉与归一化。
 */
import modelVendorsJson from './model-vendors.json';

export type ModelVendorCatalogEntry = {
	key: string;
	label: string;
};

const rawCatalog = modelVendorsJson as ModelVendorCatalogEntry[];

/** 按 JSON 顺序的稳定选项列表（用于下拉框）。 */
export const MODEL_VENDOR_OPTIONS: readonly ModelVendorCatalogEntry[] = rawCatalog;

const canonicalByLower = new Map<string, string>();
for (const { key } of MODEL_VENDOR_OPTIONS) {
	canonicalByLower.set(key.toLowerCase(), key);
}

const labelByCanonical = new Map<string, string>();
for (const { key, label } of MODEL_VENDOR_OPTIONS) {
	labelByCanonical.set(key, label);
}

/**
 * 写入/分组用：空 → `other`；仅当 `lower(trim)` 命中 catalog 的 key 时返回规范小写 key；否则 `other`。
 * 历史 PascalCase 数据已一次性对齐为 catalog key。
 */
export function normalizeModelVendorInput(v: unknown): string {
	const s = typeof v === 'string' ? v.trim() : '';
	if (!s) return 'other';
	return canonicalByLower.get(s.toLowerCase()) ?? 'other';
}

/** 展示用：catalog 命中用 label；否则归为 Other（与 normalize 一致）。 */
export function getModelVendorLabel(vendorKey: string | null | undefined): string {
	const s = typeof vendorKey === 'string' ? vendorKey.trim() : '';
	if (!s) return labelByCanonical.get('other') ?? 'Other';
	const canon = canonicalByLower.get(s.toLowerCase()) ?? 'other';
	return labelByCanonical.get(canon) ?? (labelByCanonical.get('other') ?? 'Other');
}
