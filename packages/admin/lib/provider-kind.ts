/** 显式「自定义」类型。空字符串表示尚未分类，图标仍按 URL / 名称推断。 */
export const CUSTOM_PROVIDER_KIND = '__custom__';

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

/** 类型名与账号别名相同时不重复。 */
export function formatProviderAccountLabel(name: string, kindLabel: string | null | undefined): string {
	const account = name.trim();
	const typeLabel = (kindLabel ?? '').trim();
	if (!account) return typeLabel;
	if (!typeLabel || typeLabel.toLowerCase() === account.toLowerCase()) return account;
	return `${account} · ${typeLabel}`;
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

export function routeProviderAccountLabel(
	route: { provider_id: string; provider_name?: string | null },
	provider: { name?: string | null; kind?: string | null; kind_labels?: ProviderKindLabels | null } | null | undefined,
	locale: string,
	customLabel: string
): string {
	if (provider) return liveProviderAccountLabel(provider, locale, customLabel, route.provider_id);
	return (route.provider_name ?? '').trim() || route.provider_id;
}
