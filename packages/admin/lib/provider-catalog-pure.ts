import { PROVIDER_CATALOG_LOCALES, providerCatalogLocale, type ProviderCatalogLocale } from './provider-kind';
import type { AdminProviderImportCatalogItem } from '@/lib/services/admin/types';
import type { ProviderEndpointsMap } from '@octafuse/core/provider-endpoints';

export type StaticProviderImportPresetRow = {
	name: string;
	vendor_key: string;
	/**
	 * Provider 产品级图标。省略时回退 `vendor_key`。
	 * 例如 Xiaomi MiMo 使用 `xiaomimimo`，而不是 Xiaomi 企业 Logo。
	 * 不单独写入 providers 表；入库类型用本行的英文 `name`（`providers.kind`）。
	 */
	icon_key?: string;
	endpoints: ProviderEndpointsMap;
	/**
	 * 可选运维说明。目录 `catalog.i18n` 缺摘要时，导入列表用它做介绍回退；不写入数据库。
	 */
	description?: string | null;
	/**
	 * 导入列表展示文案。`en` / `zh` / `ja` / `ko` 分别对应四种界面语言。
	 * `name` 仍是 `providers.kind` 的稳定英文键，不随语言改变，也不写入介绍。
	 */
	catalog?: {
		i18n?: Partial<Record<ProviderCatalogLocale, { name?: string; description?: string }>>;
		links?: ProviderCatalogLinks;
	};
};

/** 公开 Catalog / Admin 出站链接；不写入 providers 表。 */
export type ProviderCatalogLinks = {
	/** Provider 官方平台、控制台或本地产品下载页。 */
	platform?: string;
	/** 可确认稳定时填写的 API Key 管理直达页。 */
	api_keys?: string;
	/** 可选邀请/注册链接；出站 CTA 优先于 api_keys / platform。 */
	referral?: string;
};

export type ProviderCatalogOutboundKind = 'referral' | 'api_keys' | 'platform';

export type ProviderCatalogOutbound = {
	href: string;
	kind: ProviderCatalogOutboundKind;
};

function httpsHref(value: string | undefined | null): string | null {
	const trimmed = String(value ?? '').trim();
	if (!trimmed) return null;
	try {
		const url = new URL(trimmed);
		return url.protocol === 'https:' ? trimmed : null;
	} catch {
		return null;
	}
}

export function catalogLabelsFromRow(
	row: StaticProviderImportPresetRow
): AdminProviderImportCatalogItem['labels'] {
	const i18n = row.catalog?.i18n;
	if (!i18n) return undefined;
	const labels = {} as Record<ProviderCatalogLocale, { name: string; description: string }>;
	for (const locale of PROVIDER_CATALOG_LOCALES) {
		const name = i18n[locale]?.name?.trim() ?? '';
		const description = i18n[locale]?.description?.trim() ?? '';
		if (!name || !description) return undefined;
		labels[locale] = { name, description };
	}
	return labels;
}

/** 目录介绍。缺本地化摘要时回退模板运维说明。 */
export function providerPresetCatalogCopy(
	row: StaticProviderImportPresetRow
): Record<ProviderCatalogLocale, string | null> {
	const labels = catalogLabelsFromRow(row);
	const fallback = row.description?.trim() || '';
	const copy = {} as Record<ProviderCatalogLocale, string | null>;
	for (const locale of PROVIDER_CATALOG_LOCALES) {
		copy[locale] = labels?.[locale].description?.trim() || fallback || null;
	}
	return copy;
}

/** 导入列表展示文案。按界面语言取目录文案；缺该语言时回退英文，再回退稳定英文名和运维说明。 */
export function providerImportCatalogCopy(
	row: {
		name: string;
		description?: string | null;
		labels?: AdminProviderImportCatalogItem['labels'];
	},
	locale: string
): { name: string; description: string | null } {
	const key = providerCatalogLocale(locale);
	const localized = row.labels?.[key] ?? (key === 'en' ? undefined : row.labels?.en);
	return {
		name: localized?.name?.trim() || row.name,
		description: localized?.description?.trim() || row.description?.trim() || null,
	};
}

/**
 * 导入时使用的显示名和类型。
 * `kind` 固定为模板英文 `name`；`name` 与导入列表当前语言一致。
 * `description` 只给导入列表展示，不写入数据库。
 */
export function providerImportStoredFields(
	row: StaticProviderImportPresetRow,
	locale: string | null | undefined
): { name: string; kind: string; description: string | null } {
	const copy = providerImportCatalogCopy(
		{
			name: row.name,
			description: row.description,
			labels: catalogLabelsFromRow(row),
		},
		locale ?? ''
	);
	return {
		name: copy.name,
		kind: row.name.trim(),
		description: copy.description,
	};
}

/** 搜索同时匹配稳定英文名、四种语言的名称和摘要，以及运维说明。 */
export function providerImportCatalogMatchesQuery(
	row: {
		name: string;
		description?: string | null;
		vendor_label?: string | null;
		labels?: AdminProviderImportCatalogItem['labels'];
	},
	query: string
): boolean {
	const needle = query.trim().toLowerCase();
	if (!needle) return true;
	const haystack = [
		row.name,
		row.description,
		row.vendor_label,
		...PROVIDER_CATALOG_LOCALES.flatMap((locale) => [
			row.labels?.[locale]?.name,
			row.labels?.[locale]?.description,
		]),
	]
		.filter((part): part is string => Boolean(part?.trim()))
		.join('\n')
		.toLowerCase();
	return haystack.includes(needle);
}

export function catalogLinksFromRow(row: StaticProviderImportPresetRow): ProviderCatalogLinks | null {
	const links = row.catalog?.links;
	if (!links) return null;
	const out: ProviderCatalogLinks = {};
	const platform = httpsHref(links.platform);
	const apiKeys = httpsHref(links.api_keys);
	const referral = httpsHref(links.referral);
	if (platform) out.platform = platform;
	if (apiKeys) out.api_keys = apiKeys;
	if (referral) out.referral = referral;
	return platform || apiKeys || referral ? out : null;
}

/** 出站 CTA：邀请链接优先，其次密钥页，再次官网。 */
export function resolveProviderCatalogOutbound(
	links: ProviderCatalogLinks | null | undefined
): ProviderCatalogOutbound | null {
	if (!links) return null;
	const referral = httpsHref(links.referral);
	if (referral) return { href: referral, kind: 'referral' };
	const apiKeys = httpsHref(links.api_keys);
	if (apiKeys) return { href: apiKeys, kind: 'api_keys' };
	const platform = httpsHref(links.platform);
	if (platform) return { href: platform, kind: 'platform' };
	return null;
}

export function providerCatalogOutboundRel(kind: ProviderCatalogOutboundKind): string {
	return kind === 'referral' ? 'sponsored noopener noreferrer' : 'noopener noreferrer';
}

