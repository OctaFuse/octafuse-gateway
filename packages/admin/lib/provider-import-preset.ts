/**
 * 管理端内置 **上游 Provider** 静态模板：用于一键导入 `providers` 行（预填 `endpoints`）。
 *
 * 权威列表见 [provider-import-presets.json](./provider-import-presets.json)。`vendor_key` 应对齐
 * [model-vendors.json](./model-vendors.json) 中的 `key`（展示名用 `getModelVendorLabel`）。
 *
 * Endpoint 约定（与 `listConfiguredCapabilities` / Admin 卡片展示一致）：
 * - **全能力 OpenAI 上游**（含 Images）：写 `openai.base`
 * - **仅 LLM / Chat Completions**：写 `openai.endpoints.chat`（完整 URL），**不要**写 `base`
 * - Anthropic / Gemini：协议本身无 Images 分支时可用 `base`（Anthropic 仅 messages；Gemini 为 generate/stream）
 *
 * 导入后不含 API Key，须在 Edit Provider 中手动添加。
 */
import rawPresets from './provider-import-presets.json';
import { getModelVendorLabel, normalizeModelVendorInput } from './model-vendor';
import type { AdminProviderImportCatalogItem } from '@/lib/services/admin/types';
import {
	listConfiguredCapabilities,
	parseProviderEndpoints,
	serializeProviderEndpoints,
	type ProviderEndpointCapability,
	type ProviderEndpointsMap,
} from '@octafuse/core/provider-endpoints';

export type StaticProviderImportPresetRow = {
	name: string;
	vendor_key: string;
	endpoints: ProviderEndpointsMap;
	/** 可选；JSON 中可省略，导入后写入 providers.description 时为 null */
	description?: string | null;
};

/** 运行时 catalog 行键（JSON 数组下标字符串）；与入库 provider id 无关。 */
export type StaticProviderImportPresetWithKey = StaticProviderImportPresetRow & {
	catalog_key: string;
};

/** Import 弹窗 / catalog 摘要用的 OpenAI 端点一行展示。 */
export type ProviderImportOpenAiSummary = {
	/** 复制/展示用的主 URL（base 或 chat） */
	url: string;
	/** 是否配置了 openai.base（全能力） */
	hasBase: boolean;
	capabilities: ProviderEndpointCapability[];
};

const STATIC_ROWS = rawPresets as StaticProviderImportPresetRow[];

function protocolsForPreset(p: StaticProviderImportPresetRow): AdminProviderImportCatalogItem['protocols'] {
	const map = parseProviderEndpoints({ endpoints: p.endpoints });
	const out: AdminProviderImportCatalogItem['protocols'] = [];
	if (map.openai) out.push('openai');
	if (map.anthropic) out.push('anthropic');
	if (map.gemini) out.push('gemini');
	return out;
}

/** 从已解析的 endpoints map 取 OpenAI 协议展示摘要（base 或 chat-only）。 */
export function summarizeOpenAiImportEndpoints(
	map: ProviderEndpointsMap
): ProviderImportOpenAiSummary | null {
	const cfg = map.openai;
	if (!cfg) return null;
	const url =
		cfg.base ||
		cfg.endpoints?.chat ||
		Object.values(cfg.endpoints ?? {})[0] ||
		'';
	if (!url) return null;
	return {
		url,
		hasBase: Boolean(cfg.base),
		capabilities: listConfiguredCapabilities(map, 'openai'),
	};
}

/** 全部静态模板行（含 catalog 键与 endpoints）。 */
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
		const map = parseProviderEndpoints({ endpoints: p.endpoints });
		return {
			id: p.catalog_key,
			name: String(p.name ?? '').trim(),
			vendor_key: vendorCanon,
			vendor_label: getModelVendorLabel(vendorCanon),
			protocols: protocolsForPreset(p),
			endpoints: serializeProviderEndpoints(map),
			description: p.description != null && String(p.description).trim() ? String(p.description).trim() : null,
		};
	});
}
