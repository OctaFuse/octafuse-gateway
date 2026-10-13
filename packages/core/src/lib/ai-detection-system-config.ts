/**
 * Agent AI Detection（`POST /v1/tools/ai-detection`）的 `system_config` 键与解析。
 * 权威配置：`AI_DETECTION_ACTIVE` + `AI_DETECTION_CATALOG`（JSON）；无 legacy 分支。
 *
 * 多 provider 架构：catalog 按引擎存凭证并集 + Active 选型；解析时用
 * {@link AI_DETECTION_PROVIDER_REQUIRED_CREDENTIALS}（与已实现 driver 对齐）校验。
 * Catalog 新价格存 pricing（标准价与倍率）；旧三账本单价及 `cost` 继续兼容读取。
 */

import type { GatewayRepositories } from '../storage/repositories';
import {
	parseToolCatalogPricing,
	toolCatalogPricingForStorage,
	type ToolCatalogPricingFields,
	parseToolMoneyField,
} from './tool-pricing';

export const AI_DETECTION_ACTIVE_KEY = 'AI_DETECTION_ACTIVE';
export const AI_DETECTION_CATALOG_KEY = 'AI_DETECTION_CATALOG';

/** 引擎白名单（可扩展；当前仅 tencent_tms） */
export const AI_DETECTION_PROVIDERS = ['tencent_tms'] as const;
export type AiDetectionProvider = (typeof AI_DETECTION_PROVIDERS)[number];

/** 已实现、可设为 Active 的引擎 */
export const AI_DETECTION_IMPLEMENTED_PROVIDERS = ['tencent_tms'] as const;
export type AiDetectionImplementedProvider = (typeof AI_DETECTION_IMPLEMENTED_PROVIDERS)[number];

export const DEFAULT_AI_DETECTION_PROVIDER: AiDetectionImplementedProvider = 'tencent_tms';

/** 计费粒度默认值；与各引擎技术分段上限无关 */
export const DEFAULT_AI_DETECTION_BILLING_UNIT_CHARS = 2000;
/** 默认单价；单位随 Gateway `system_config.BILLING_CURRENCY` */
export const DEFAULT_AI_DETECTION_COST = 0.01;

/**
 * Catalog 可选字段并集（为后续引擎预留形态）。
 * - `secretId` + `secretKey`：tencent_tms（及未来同类 AK/SK 引擎）
 * - `apiKey` / `email`：未来单 key / 双段鉴权引擎
 * - `region` / `bizType`：腾讯云可选
 */
export type AiDetectionCatalogEntry = {
	apiKey?: string;
	secretId?: string;
	secretKey?: string;
	email?: string;
	region?: string;
	bizType?: string;
	/** @deprecated 兼容别名；等于 charged */
	cost: number;
	metered: number;
	standard: number;
	charged: number;
	pricing?: ToolCatalogPricingFields['pricing'];
	/** 计费粒度（字符）；默认 {@link DEFAULT_AI_DETECTION_BILLING_UNIT_CHARS} */
	billingUnitChars?: number;
};

export type AiDetectionCatalog = Partial<Record<AiDetectionProvider, AiDetectionCatalogEntry>>;

/** 凭证类字段（不含 cost / billingUnitChars） */
export type AiDetectionCredentialField = 'apiKey' | 'secretId' | 'secretKey' | 'email';

/**
 * 已实现引擎的必填凭证声明（与 proxy driver `requiredCredentials` 对齐）。
 * 未列入此表的白名单引擎 → resolve / Admin 均禁止设为 Active。
 */
export const AI_DETECTION_PROVIDER_REQUIRED_CREDENTIALS: Record<
	AiDetectionImplementedProvider,
	readonly AiDetectionCredentialField[]
> = {
	tencent_tms: ['secretId', 'secretKey'],
};

export function isAiDetectionProvider(value: string): value is AiDetectionProvider {
	return (AI_DETECTION_PROVIDERS as readonly string[]).includes(value);
}

export function isAiDetectionImplementedProvider(value: string): value is AiDetectionImplementedProvider {
	return (AI_DETECTION_IMPLEMENTED_PROVIDERS as readonly string[]).includes(value);
}

export function parseAiDetectionProviderInput(raw: string | null | undefined): AiDetectionProvider | null {
	const v = raw?.trim().toLowerCase() ?? '';
	if (!v) {
		return null;
	}
	return isAiDetectionProvider(v) ? v : null;
}

export function parseAiDetectionActiveInput(raw: string | null | undefined): AiDetectionProvider | null {
	return parseAiDetectionProviderInput(raw);
}

export function parseAiDetectionCostInput(raw: string | null | undefined): number | null {
	return parseToolMoneyField(raw);
}

export function parseAiDetectionBillingUnitCharsInput(raw: string | null | undefined): number | null {
	if (raw == null || !String(raw).trim()) {
		return null;
	}
	const n = Number(String(raw).trim());
	if (!Number.isFinite(n) || n < 1 || !Number.isInteger(n)) {
		return null;
	}
	return n;
}

/** 校验 catalog entry 是否具备指定必填凭证（非空 trim）。 */
export function entryHasRequiredCredentials(
	entry: AiDetectionCatalogEntry | undefined,
	required: readonly AiDetectionCredentialField[]
): boolean {
	if (!entry) {
		return false;
	}
	for (const field of required) {
		const v = entry[field];
		if (typeof v !== 'string' || !v.trim()) {
			return false;
		}
	}
	return true;
}

function parseBillingUnitCharsField(raw: unknown, strict: boolean): number | undefined | null {
	if (raw === undefined || raw === null || raw === '') {
		return undefined;
	}
	if (typeof raw === 'number') {
		if (!Number.isFinite(raw) || raw < 1 || !Number.isInteger(raw)) {
			return strict ? null : undefined;
		}
		return raw;
	}
	if (typeof raw === 'string') {
		const parsed = parseAiDetectionBillingUnitCharsInput(raw);
		if (parsed == null) {
			return strict ? null : undefined;
		}
		return parsed;
	}
	return strict ? null : undefined;
}

function parseOptionalString(raw: unknown): string | undefined {
	if (typeof raw !== 'string') {
		return undefined;
	}
	const t = raw.trim();
	return t || undefined;
}

function parseCatalogEntry(rec: Record<string, unknown>, strict: boolean): AiDetectionCatalogEntry | null {
	const prices = parseToolCatalogPricing(rec, DEFAULT_AI_DETECTION_COST, strict);
	if (!prices) {
		return null;
	}
	const billingUnitChars = parseBillingUnitCharsField(rec.billingUnitChars, strict);
	if (billingUnitChars === null) {
		return null;
	}
	const entry: AiDetectionCatalogEntry = { ...prices };
	if (billingUnitChars !== undefined) {
		entry.billingUnitChars = billingUnitChars;
	}
	const apiKey = parseOptionalString(rec.apiKey);
	if (apiKey !== undefined) {
		entry.apiKey = apiKey;
	}
	const secretId = parseOptionalString(rec.secretId);
	if (secretId !== undefined) {
		entry.secretId = secretId;
	}
	const secretKey = parseOptionalString(rec.secretKey);
	if (secretKey !== undefined) {
		entry.secretKey = secretKey;
	}
	const email = parseOptionalString(rec.email);
	if (email !== undefined) {
		entry.email = email;
	}
	const region = parseOptionalString(rec.region);
	if (region !== undefined) {
		entry.region = region;
	}
	const bizType = parseOptionalString(rec.bizType);
	if (bizType !== undefined) {
		entry.bizType = bizType;
	}
	return entry;
}

/**
 * 严格解析 catalog JSON。非法 JSON / 非对象 / 未知 provider / 单项非法 → `null`。
 */
export function parseAiDetectionCatalogInput(raw: string | null | undefined): AiDetectionCatalog | null {
	if (raw == null || !String(raw).trim()) {
		return null;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(String(raw)) as unknown;
	} catch {
		return null;
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		return null;
	}
	const out: AiDetectionCatalog = {};
	for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
		const provider = parseAiDetectionProviderInput(key);
		if (!provider) {
			return null;
		}
		if (!value || typeof value !== 'object' || Array.isArray(value)) {
			return null;
		}
		const entry = parseCatalogEntry(value as Record<string, unknown>, true);
		if (!entry) {
			return null;
		}
		out[provider] = entry;
	}
	return out;
}

/** 宽松解析：丢弃非法单项与未知 provider（供 resolve / UI seed）。 */
export function parseAiDetectionCatalogLenient(raw: string | null | undefined): AiDetectionCatalog | null {
	if (raw == null || !String(raw).trim()) {
		return null;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(String(raw)) as unknown;
	} catch {
		return null;
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		return null;
	}
	const out: AiDetectionCatalog = {};
	for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
		const provider = parseAiDetectionProviderInput(key);
		if (!provider || !value || typeof value !== 'object' || Array.isArray(value)) {
			continue;
		}
		const entry = parseCatalogEntry(value as Record<string, unknown>, false);
		if (!entry) {
			continue;
		}
		out[provider] = entry;
	}
	return out;
}

export function serializeAiDetectionCatalog(catalog: AiDetectionCatalog): string {
	const normalized: Record<string, unknown> = {};
	for (const [key, entry] of Object.entries(catalog) as [
		AiDetectionProvider,
		AiDetectionCatalogEntry | undefined
	][]) {
		if (!entry) continue;
		const { apiKey, secretId, secretKey, email, region, bizType, billingUnitChars } = entry;
		normalized[key] = {
			...toolCatalogPricingForStorage(entry),
			...(apiKey !== undefined ? { apiKey } : {}),
			...(secretId !== undefined ? { secretId } : {}),
			...(secretKey !== undefined ? { secretKey } : {}),
			...(email !== undefined ? { email } : {}),
			...(region !== undefined ? { region } : {}),
			...(bizType !== undefined ? { bizType } : {}),
			...(billingUnitChars !== undefined ? { billingUnitChars } : {}),
		};
	}
	return JSON.stringify(normalized);
}

export type ResolvedAiDetectionConfig = {
	provider: AiDetectionImplementedProvider;
	/** 合并后的 catalog entry（含凭证） */
	entry: AiDetectionCatalogEntry;
	/**
	 * @deprecated 等于 {@link charged}；保留给旧调用方。
	 */
	cost: number;
	metered: number;
	standard: number;
	charged: number;
	billingUnitChars: number;
	sources: {
		provider: 'system_config' | 'default';
		cost: 'system_config' | 'default';
		billingUnitChars: 'system_config' | 'default';
		mode: 'catalog';
	};
	pricing?: ToolCatalogPricingFields['pricing'];
};

export type ResolveAiDetectionConfigResult =
	| { ok: true; config: ResolvedAiDetectionConfig }
	| { ok: false; reason: 'invalid_provider'; raw: string }
	| { ok: false; reason: 'invalid_catalog' }
	| { ok: false; reason: 'active_missing_key'; provider: string }
	| { ok: false; reason: 'provider_not_implemented'; provider: string };

/**
 * 从 catalog 解析指定引擎配置（不依赖 Active）。
 * Playground Tools 直连验证密钥时使用；Active 选型仍走 {@link resolveAiDetectionConfig}。
 */
export function resolveAiDetectionConfigForProvider(
	catalog: AiDetectionCatalog,
	provider: string
): ResolveAiDetectionConfigResult {
	const parsed = parseAiDetectionProviderInput(provider);
	if (!parsed) {
		return { ok: false, reason: 'invalid_provider', raw: provider };
	}
	if (!isAiDetectionImplementedProvider(parsed)) {
		return { ok: false, reason: 'provider_not_implemented', provider: parsed };
	}
	const required = AI_DETECTION_PROVIDER_REQUIRED_CREDENTIALS[parsed];
	const entry = catalog[parsed];
	if (!entryHasRequiredCredentials(entry, required)) {
		return { ok: false, reason: 'active_missing_key', provider: parsed };
	}
	const charged = entry!.charged ?? entry!.cost;
	const metered = entry!.metered ?? charged;
	const standard = entry!.standard ?? charged;
	const billingUnitChars = entry!.billingUnitChars ?? DEFAULT_AI_DETECTION_BILLING_UNIT_CHARS;
	return {
		ok: true,
		config: {
			provider: parsed,
			entry: entry!,
			...(entry?.pricing ? { pricing: entry.pricing } : {}),
			cost: charged,
			metered,
			standard,
			charged,
			billingUnitChars,
			sources: {
				provider: 'system_config',
				cost: 'system_config',
				billingUnitChars: entry!.billingUnitChars != null ? 'system_config' : 'default',
				mode: 'catalog',
			},
		},
	};
}

/**
 * 从 `system_config` 解析 AI Detection 配置。
 * Active 必须是已实现引擎，且 catalog entry 满足该引擎 `requiredCredentials`。
 */
export async function resolveAiDetectionConfig(
	repos: GatewayRepositories
): Promise<ResolveAiDetectionConfigResult> {
	const [catalogRaw, activeRaw] = await Promise.all([
		repos.systemConfig.getConfig(AI_DETECTION_CATALOG_KEY),
		repos.systemConfig.getConfig(AI_DETECTION_ACTIVE_KEY),
	]);

	const catalogPresent = catalogRaw != null && String(catalogRaw).trim().length > 0;
	if (!catalogPresent) {
		return { ok: false, reason: 'active_missing_key', provider: DEFAULT_AI_DETECTION_PROVIDER };
	}

	const catalog = parseAiDetectionCatalogLenient(catalogRaw);
	if (catalog == null) {
		return { ok: false, reason: 'invalid_catalog' };
	}

	const activeTrimmed = activeRaw?.trim() ?? '';
	let provider: AiDetectionProvider;
	let providerSource: ResolvedAiDetectionConfig['sources']['provider'];
	if (activeTrimmed) {
		const parsed = parseAiDetectionActiveInput(activeTrimmed);
		if (!parsed) {
			return { ok: false, reason: 'invalid_provider', raw: activeTrimmed };
		}
		provider = parsed;
		providerSource = 'system_config';
	} else {
		provider = DEFAULT_AI_DETECTION_PROVIDER;
		providerSource = 'default';
	}

	const forProvider = resolveAiDetectionConfigForProvider(catalog, provider);
	if (!forProvider.ok) {
		return forProvider;
	}
	return {
		ok: true,
		config: {
			...forProvider.config,
			sources: {
				...forProvider.config.sources,
				provider: providerSource,
			},
		},
	};
}
