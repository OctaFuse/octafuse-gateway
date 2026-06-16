/**
 * 管理端内置 **上游 Provider** 静态模板：用于一键导入 `providers` 行（预填各协议 base URL）。
 *
 * 权威列表见 [provider-import-presets.json](./provider-import-presets.json)。`vendor_key` 应对齐
 * [model-vendors.json](./model-vendors.json) 中的 `key`（展示名用 `getModelVendorLabel`）。
 *
 * 导入后不含 API Key，须在 Edit Provider 中手动添加。
 */
import rawPresets from './provider-import-presets.json';
import { getModelVendorLabel, normalizeModelVendorInput } from './model-vendor';
import type { AdminProviderImportCatalogItem } from '@/lib/services/admin/types';

export type StaticProviderImportPresetRow = {
	name: string;
	vendor_key: string;
	base_url_openai: string | null;
	base_url_anthropic: string | null;
	base_url_gemini: string | null;
	/** 可选；JSON 中可省略，导入后写入 providers.description 时为 null */
	description?: string | null;
};

/** 运行时 catalog 行键（JSON 数组下标字符串）；与入库 provider id 无关。 */
export type StaticProviderImportPresetWithKey = StaticProviderImportPresetRow & {
	catalog_key: string;
};

const STATIC_ROWS = rawPresets as StaticProviderImportPresetRow[];

function protocolsForPreset(p: StaticProviderImportPresetRow): AdminProviderImportCatalogItem['protocols'] {
	const out: AdminProviderImportCatalogItem['protocols'] = [];
	if (p.base_url_openai?.trim()) out.push('openai');
	if (p.base_url_anthropic?.trim()) out.push('anthropic');
	if (p.base_url_gemini?.trim()) out.push('gemini');
	return out;
}

/** 全部静态模板行（含 catalog 键与各协议 base URL）。 */
export function listStaticProviderImportPresets(): StaticProviderImportPresetWithKey[] {
	return STATIC_ROWS.filter((r) => String(r.name ?? '').trim().length > 0).map((row, index) => ({
		...row,
		catalog_key: String(index),
	}));
}

/** 供 `GET /admin/providers/import/catalog`：摘要不含密钥。 */
export function listStaticProviderImportCatalogForAdmin(): AdminProviderImportCatalogItem[] {
	return listStaticProviderImportPresets().map((p) => {
		const vendorCanon = normalizeModelVendorInput(p.vendor_key);
		return {
			id: p.catalog_key,
			name: String(p.name ?? '').trim(),
			vendor_key: vendorCanon,
			vendor_label: getModelVendorLabel(vendorCanon),
			protocols: protocolsForPreset(p),
			base_url_openai: p.base_url_openai?.trim() || null,
			base_url_anthropic: p.base_url_anthropic?.trim() || null,
			base_url_gemini: p.base_url_gemini?.trim() || null,
			description: p.description != null && String(p.description).trim() ? String(p.description).trim() : null,
		};
	});
}
