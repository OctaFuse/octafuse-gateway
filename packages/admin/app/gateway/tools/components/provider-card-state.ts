/**
 * Tools Provider 卡片：纯状态判定（可单测、无 React 依赖）。
 */

export type PriceTripleDraft = {
	metered: string;
	standard: string;
	charged: string;
};

export type ProviderCardStatusFlags = {
	/** 服务端当前 Active */
	isActive: boolean;
	/** 本地选中编辑 */
	isSelected: boolean;
	/** 草稿相对已保存快照有变更 */
	isDirty: boolean;
	/** 凭证齐全，可设为 Active */
	isConfigured: boolean;
	/** 引擎已实现（AI Detection 等） */
	isImplemented: boolean;
	/** charged < metered */
	isLossPricing: boolean;
};

export type ProviderCardActionFlags = {
	/** 待保存的 catalog 价格合法时可保存配置 */
	canSaveConfig: boolean;
	/** 当前选中可「保存并启用」 */
	canSaveAndActivate: boolean;
};

export function parseDraftMoney(raw: string): number | null {
	if (!raw.trim()) return null;
	const n = Number(raw.trim());
	if (!Number.isFinite(n) || n < 0) return null;
	return n;
}

export function draftPricesOk(d: PriceTripleDraft): boolean {
	return (
		parseDraftMoney(d.metered) != null &&
		parseDraftMoney(d.standard) != null &&
		parseDraftMoney(d.charged) != null
	);
}

export function isLossPricing(value: Pick<PriceTripleDraft, 'metered' | 'charged'>): boolean {
	const metered = parseDraftMoney(value.metered);
	const charged = parseDraftMoney(value.charged);
	if (metered == null || charged == null) {
		return false;
	}
	return charged < metered;
}

/** 浅比较对象草稿（字段顺序无关：按 key 排序后 JSON）。 */
export function isDraftDirty(draft: unknown, saved: unknown): boolean {
	return stableStringify(draft) !== stableStringify(saved);
}

function stableStringify(value: unknown): string {
	return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(sortKeysDeep);
	}
	if (value != null && typeof value === 'object') {
		const obj = value as Record<string, unknown>;
		const out: Record<string, unknown> = {};
		for (const key of Object.keys(obj).sort()) {
			out[key] = sortKeysDeep(obj[key]);
		}
		return out;
	}
	return value;
}

export function cloneDrafts<T>(value: T): T {
	return structuredClone(value);
}

export function resolveProviderCardStatus(input: {
	providerId: string;
	selectedId: string;
	savedActiveId: string | null;
	isConfigured: boolean;
	isImplemented?: boolean;
	prices: PriceTripleDraft;
	draft: unknown;
	savedDraft: unknown;
}): ProviderCardStatusFlags {
	const isImplemented = input.isImplemented !== false;
	return {
		isActive: input.savedActiveId != null && input.providerId === input.savedActiveId,
		isSelected: input.providerId === input.selectedId,
		isDirty: isDraftDirty(input.draft, input.savedDraft),
		isConfigured: input.isConfigured,
		isImplemented,
		isLossPricing: isLossPricing(input.prices),
	};
}

export function resolveProviderCardActions(input: {
	catalogPricesValid: boolean;
	selectedIsActive: boolean;
	selectedConfigured: boolean;
	selectedImplemented?: boolean;
}): ProviderCardActionFlags {
	const selectedImplemented = input.selectedImplemented !== false;
	return {
		canSaveConfig: input.catalogPricesValid,
		canSaveAndActivate:
			input.catalogPricesValid && !input.selectedIsActive && selectedImplemented && input.selectedConfigured,
	};
}

/** 清空当前 Active 的凭证前，须先切到其他仍有凭证的引擎。 */
export function wouldClearSavedActiveCredentials(input: {
	savedActiveId: string | null;
	nextActiveId: string;
	/** 保存后 catalog 中各 provider 是否仍有凭证 */
	hasCredentialsAfterSave: (providerId: string) => boolean;
}): boolean {
	if (!input.savedActiveId) {
		return false;
	}
	if (input.savedActiveId === input.nextActiveId) {
		return false;
	}
	return !input.hasCredentialsAfterSave(input.savedActiveId);
}

/** 紧凑总览价格摘要：`S 0.003 · C 0.002 · M 0.001`（Standard / Charged / Metered）。 */
export function formatPriceSummary(prices: PriceTripleDraft): string {
	const standard = prices.standard.trim() || '—';
	const charged = prices.charged.trim() || '—';
	const metered = prices.metered.trim() || '—';
	return `S ${standard} · C ${charged} · M ${metered}`;
}

export type PriceSummaryParts = {
	standard: string;
	charged: string;
	metered: string;
};

export function getPriceSummaryParts(prices: PriceTripleDraft): PriceSummaryParts {
	return {
		standard: prices.standard.trim() || '—',
		charged: prices.charged.trim() || '—',
		metered: prices.metered.trim() || '—',
	};
}

/** 紧凑总览上显示为文字的异常/关键状态（不含普通「已配置」）。 */
export type CompactStatusBadgeKind = 'active' | 'unsaved' | 'missing' | 'unavailable' | 'loss';

/**
 * 紧凑徽章优先级：Active → 未保存 → 不可用/缺凭证 → 亏损。
 * 正常「已配置」用状态点表示，不出现在此列表。
 */
export function resolveCompactStatusBadges(status: ProviderCardStatusFlags): CompactStatusBadgeKind[] {
	const badges: CompactStatusBadgeKind[] = [];
	if (status.isActive) {
		badges.push('active');
	}
	if (status.isDirty) {
		badges.push('unsaved');
	}
	if (!status.isImplemented) {
		badges.push('unavailable');
	} else if (!status.isConfigured) {
		badges.push('missing');
	}
	if (status.isLossPricing) {
		badges.push('loss');
	}
	return badges;
}

/** 已实现且有凭证、非 Active 时显示「已配置」状态点。 */
export function showConfiguredDot(status: ProviderCardStatusFlags): boolean {
	return status.isImplemented && status.isConfigured && !status.isActive;
}

/** A provider dialog saves only its own draft; other providers keep their saved values. */
export function draftsForProviderSave<T extends Record<string, unknown>>(
	saved: T,
	drafts: T,
	selected: keyof T
): T {
	return cloneDrafts({ ...saved, [selected]: drafts[selected] });
}

/** Zero standard prices and invalid drafts have no meaningful price multiplier. */
export function priceMultiplier(amount: string, standard: string): number | null {
	const numerator = parseDraftMoney(amount);
	const denominator = parseDraftMoney(standard);
	if (numerator == null || denominator == null || denominator === 0) return null;
	const ratio = numerator / denominator;
	return Number.isFinite(ratio) ? ratio : null;
}
