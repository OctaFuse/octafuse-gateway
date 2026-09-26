/** 显式「自定义」类型。空字符串表示尚未分类，图标仍按 URL / 名称推断。 */
export const CUSTOM_PROVIDER_KIND = '__custom__';

/** 筛选里表示「尚未分类」。不是入库的 kind，避免和「全部」的空查询参数冲突。 */
export const UNCLASSIFIED_PROVIDER_KIND_FILTER = '__unclassified__';

export type ProviderKindLabels = {
	en: string;
	zh: string;
};

export function providerNameKindKey(name: string, kind: string): string {
	return `${name.trim().toLowerCase()}\0${kind.trim().toLowerCase()}`;
}

/** 同一 `kind` 下为导入生成不冲突的显示名。不同 kind 可以共用同一个 name。 */
export function suggestUniqueProviderImportName(baseName: string, kind: string, existingKeys: Set<string>): string {
	const trimmed = baseName.trim();
	if (!existingKeys.has(providerNameKindKey(trimmed, kind))) {
		return trimmed;
	}
	for (let n = 2; n < 1000; n++) {
		const candidate = `${trimmed} (${n})`;
		if (!existingKeys.has(providerNameKindKey(candidate, kind))) {
			return candidate;
		}
	}
	throw new Error(`Unable to allocate unique provider name for: ${trimmed}`);
}

/** 未分类返回 null。自定义用调用方传入的文案。中文界面用模板中文名，其余用英文名。 */
export function providerKindDisplayLabel(
	provider: { kind?: string | null; kind_labels?: ProviderKindLabels | null },
	locale: string,
	customLabel: string
): string | null {
	const kind = String(provider.kind ?? '').trim();
	if (!kind) return null;
	if (kind === CUSTOM_PROVIDER_KIND) return customLabel;
	const labels = provider.kind_labels;
	if (!labels) return kind;
	return locale.toLowerCase().startsWith('zh') ? labels.zh || labels.en : labels.en || labels.zh;
}

/** 类型名与账号别名相同时不重复。账号在前，用于已经选定某一账号的展示。 */
export function formatProviderAccountLabel(name: string, kindLabel: string | null | undefined): string {
	const account = name.trim();
	const typeLabel = (kindLabel ?? '').trim();
	if (!account) return typeLabel;
	if (!typeLabel || typeLabel.toLowerCase() === account.toLowerCase()) return account;
	return `${account} · ${typeLabel}`;
}

export type ProviderAccountIdentity = {
	name: string;
	kind: string | null;
	title: string;
};

/** 表格里的账号：别名在上，类型在下。类型与别名相同或尚未分类时不显示类型。 */
export function providerAccountIdentity(
	provider: { name?: string | null; kind?: string | null; kind_labels?: ProviderKindLabels | null } | null | undefined,
	locale: string,
	customLabel: string,
	fallbackName = '',
): ProviderAccountIdentity {
	const name = provider?.name?.trim() || fallbackName.trim() || '—';
	const kindLabel = provider ? providerKindDisplayLabel(provider, locale, customLabel) : null;
	const kind = kindLabel && kindLabel.trim().toLowerCase() !== name.trim().toLowerCase() ? kindLabel : null;
	return { name, kind, title: formatProviderAccountLabel(name === '—' ? '' : name, kindLabel) || name };
}

/** 选择列表：类型在前，别名在后。尚未分类或类型与别名相同时只显示别名。 */
export function formatProviderPickerLabel(name: string, kindLabel: string | null | undefined): string {
	const account = name.trim();
	const typeLabel = (kindLabel ?? '').trim();
	if (!typeLabel) return account;
	if (!account) return typeLabel;
	if (typeLabel.toLowerCase() === account.toLowerCase()) return account;
	return `${typeLabel} · ${account}`;
}

export type ProviderKindSortable = {
	name?: string | null;
	kind?: string | null;
	kind_labels?: ProviderKindLabels | null;
};

/** 空 kind 在筛选里用独立键，已保存的 kind 原样作为键。 */
export function providerKindFilterKey(kind: string | null | undefined): string {
	const trimmed = String(kind ?? '').trim();
	return trimmed || UNCLASSIFIED_PROVIDER_KIND_FILTER;
}

/** 先按本地化类型名，再按 kind 键，最后按别名。尚未分类排在最后。 */
export function compareProvidersByKindThenName(
	a: ProviderKindSortable,
	b: ProviderKindSortable,
	locale: string,
	customLabel: string,
): number {
	const aKindLabel = providerKindDisplayLabel(a, locale, customLabel);
	const bKindLabel = providerKindDisplayLabel(b, locale, customLabel);
	if (!aKindLabel !== !bKindLabel) return aKindLabel ? -1 : 1;
	if (aKindLabel && bKindLabel) {
		const byLabel = aKindLabel.localeCompare(bKindLabel, locale, { sensitivity: 'base' });
		if (byLabel !== 0) return byLabel;
	}
	const aKind = String(a.kind ?? '').trim();
	const bKind = String(b.kind ?? '').trim();
	if (aKind !== bKind) {
		const byKey = aKind.localeCompare(bKind, locale, { sensitivity: 'base' });
		if (byKey !== 0) return byKey;
	}
	return (a.name ?? '').trim().localeCompare((b.name ?? '').trim(), locale, { sensitivity: 'base' });
}

export function sortProvidersByKindThenName<T extends ProviderKindSortable>(
	providers: readonly T[],
	locale: string,
	customLabel: string,
): T[] {
	return [...providers].sort((a, b) => compareProvidersByKindThenName(a, b, locale, customLabel));
}

export type ProviderKindFilterOption = {
	key: string;
	label: string;
	count: number;
};

/** 按供应商类型聚合。计数是传入的路由供应商 id 命中次数；没有供应商的类型不出现。 */
export function buildProviderKindFilterOptions(params: {
	providers: ReadonlyArray<ProviderKindSortable & { id: string }>;
	routeProviderIds: Iterable<string>;
	locale: string;
	customLabel: string;
	unclassifiedLabel: string;
	selectedKey?: string;
}): ProviderKindFilterOption[] {
	const byKey = new Map<string, ProviderKindSortable>();
	const idToKey = new Map<string, string>();
	for (const provider of params.providers) {
		const key = providerKindFilterKey(provider.kind);
		idToKey.set(provider.id, key);
		if (!byKey.has(key)) byKey.set(key, provider);
	}
	const counts = new Map<string, number>();
	for (const providerId of params.routeProviderIds) {
		const key = idToKey.get(providerId);
		if (!key) continue;
		counts.set(key, (counts.get(key) ?? 0) + 1);
	}
	if (params.selectedKey && !byKey.has(params.selectedKey)) {
		byKey.set(params.selectedKey, { kind: params.selectedKey === UNCLASSIFIED_PROVIDER_KIND_FILTER ? '' : params.selectedKey });
	}
	const options = [...byKey.entries()].map(([key, sample]) => ({
		key,
		label:
			key === UNCLASSIFIED_PROVIDER_KIND_FILTER
				? params.unclassifiedLabel
				: providerKindDisplayLabel(sample, params.locale, params.customLabel) || key,
		count: counts.get(key) ?? 0,
	}));
	options.sort((a, b) => {
		const aUnclassified = a.key === UNCLASSIFIED_PROVIDER_KIND_FILTER;
		const bUnclassified = b.key === UNCLASSIFIED_PROVIDER_KIND_FILTER;
		if (aUnclassified !== bUnclassified) return aUnclassified ? 1 : -1;
		return a.label.localeCompare(b.label, params.locale, { sensitivity: 'base' });
	});
	return options;
}

export function liveProviderAccountLabel(
	provider: { name?: string | null; kind?: string | null; kind_labels?: ProviderKindLabels | null } | null | undefined,
	locale: string,
	customLabel: string,
	fallback = ''
): string {
	if (!provider) return fallback;
	const name = provider.name?.trim() || fallback;
	return formatProviderAccountLabel(name, providerKindDisplayLabel(provider, locale, customLabel)) || fallback;
}

export function liveProviderPickerLabel(
	provider: { name?: string | null; kind?: string | null; kind_labels?: ProviderKindLabels | null } | null | undefined,
	locale: string,
	customLabel: string,
	fallback = ''
): string {
	if (!provider) return fallback;
	const name = provider.name?.trim() || fallback;
	return formatProviderPickerLabel(name, providerKindDisplayLabel(provider, locale, customLabel)) || fallback;
}

export function routeProviderAccountLabel(
	route: { provider_id: string; provider_name?: string | null },
	provider: { name?: string | null; kind?: string | null; kind_labels?: ProviderKindLabels | null } | null | undefined,
	locale: string,
	customLabel: string
): string {
	if (provider) return liveProviderAccountLabel(provider, locale, customLabel, route.provider_id);
	return (route.provider_name ?? '').trim() || route.provider_id;
}
