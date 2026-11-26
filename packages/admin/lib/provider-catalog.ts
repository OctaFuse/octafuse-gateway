import { CUSTOM_PROVIDER_KIND, PROVIDER_CATALOG_LOCALES, type ProviderCatalogLocale, type ProviderKindLabels } from './provider-kind';
import { getModelVendorLabel, normalizeModelVendorInput } from './model-vendor';
import type { AdminProviderImportCatalogItem } from '@/lib/services/admin/types';
import { parseProviderEndpoints, serializeProviderEndpoints, type ProviderEndpointsMap, type ProviderEndpointsSource } from '@octafuse/core/provider-endpoints';
import { catalogLabelsFromRow, catalogLinksFromRow, providerPresetCatalogCopy, type ProviderCatalogLinks, type StaticProviderImportPresetRow } from './provider-catalog-pure';

export type { StaticProviderImportPresetRow } from './provider-catalog-pure';

/** 运行时 catalog 行键（模板英文名）；与入库 provider id 无关。 */
export type StaticProviderImportPresetWithKey = StaticProviderImportPresetRow & {
	catalog_key: string;
};

type ProviderCatalogIdentity = {
	vendorKey: string;
	iconKey: string;
};

function providerEndpointSignature(endpoints: ProviderEndpointsSource['endpoints']): string {
	try {
		return serializeProviderEndpoints(parseProviderEndpoints({ endpoints })) ?? '';
	} catch {
		return '';
	}
}

function identityForPreset(row: StaticProviderImportPresetRow): ProviderCatalogIdentity {
	const vendorKey = normalizeModelVendorInput(row.vendor_key);
	return {
		vendorKey,
		iconKey: row.icon_key?.trim() || vendorKey,
	};
}

function normalizedImportedProviderName(name: string | null | undefined): string {
	return String(name ?? '')
		.trim()
		.replace(/\s+\(\d+\)$/, '')
		.toLowerCase();
}

function hostnameMatches(hostname: string, domain: string): boolean {
	return hostname === domain || hostname.endsWith(`.${domain}`);
}

function endpointIdentity(url: URL): ProviderCatalogIdentity | null {
	const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
	const identity = (vendorKey: string, iconKey = vendorKey): ProviderCatalogIdentity => ({
		vendorKey,
		iconKey,
	});

	// Product-specific hosts must be checked before their parent cloud/vendor domains.
	if (hostnameMatches(hostname, 'qianwenaiapi.com')) return identity('aliyun', 'qwen');
	if (hostnameMatches(hostname, 'maas.aliyuncs.com')) return identity('aliyun', 'qwen');
	if (
		hostnameMatches(hostname, 'dashscope.aliyuncs.com') ||
		hostnameMatches(hostname, 'dashscope-intl.aliyuncs.com')
	) {
		return identity('aliyun', 'bailian');
	}
	if (
		hostnameMatches(hostname, 'hunyuan.cloud.tencent.com') ||
		hostnameMatches(hostname, 'lkeap.cloud.tencent.com') ||
		hostnameMatches(hostname, 'tencentmaas.com') ||
		hostnameMatches(hostname, 'tencentmaas.cn')
	) {
		return identity('tencent', 'hunyuan');
	}
	if (hostnameMatches(hostname, 'api.z.ai')) return identity('zhipu', 'zai');
	if (hostnameMatches(hostname, 'longcat.chat')) return identity('meituan', 'longcat');
	if (hostnameMatches(hostname, 'api.kimi.com')) return identity('moonshot', 'kimi');
	if (hostnameMatches(hostname, 'aiplatform.googleapis.com')) return identity('google', 'vertexai');
	if (hostnameMatches(hostname, 'xiaomimimo.com')) return identity('xiaomi', 'xiaomimimo');
	if (
		hostnameMatches(hostname, 'kspmas.ksyun.com') ||
		hostnameMatches(hostname, 'global-kspmas.ksyun.com')
	) {
		return identity('kingsoft');
	}

	const domainRules: ReadonlyArray<readonly [string, ProviderCatalogIdentity]> = [
		['deepseek.com', identity('deepseek')],
		['volces.com', identity('volcengine')],
		['bytepluses.com', identity('volcengine')],
		['qianfan.baidubce.com', identity('baidu')],
		['vod.gz.baidubce.com', identity('baidu')],
		['aigc.exp.bcevod.com', identity('baidu')],
		['bigmodel.cn', identity('zhipu')],
		['moonshot.cn', identity('moonshot')],
		['minimaxi.com', identity('minimax')],
		['minimax.io', identity('minimax')],
		['elevenlabs.io', identity('elevenlabs')],
		['openai.com', identity('openai')],
		['anthropic.com', identity('anthropic')],
		['generativelanguage.googleapis.com', identity('google')],
		['mistral.ai', identity('mistral')],
		['groq.com', identity('groq')],
		['cerebras.ai', identity('cerebras')],
		['sambanova.ai', identity('sambanova')],
		['scnet.cn', identity('scnet')],
		['x.ai', identity('xai')],
		['together.xyz', identity('together')],
		['fireworks.ai', identity('fireworks')],
		['deepinfra.com', identity('deepinfra')],
		['novita.ai', identity('novita')],
		['huggingface.co', identity('huggingface')],
		['commandcode.ai', identity('commandcode')],
		['ai-gateway.vercel.sh', identity('vercel')],
		['meta.ai', identity('meta')],
		['perplexity.ai', identity('perplexity')],
		['cohere.ai', identity('cohere')],
		['api.nvidia.com', identity('nvidia')],
		['openai.azure.com', identity('azure')],
		['services.ai.azure.com', identity('azure')],
		['models.inference.ai.azure.com', identity('azure')],
		['stepfun.com', identity('stepfun')],
		['baichuan-ai.com', identity('baichuan')],
		['qnaigc.com', identity('qiniu')],
		['openai.qiniu.com', identity('qiniu')],
		['modelink.ai', identity('modelink')],
		['open-design.ai', identity('opendesign')],
		['opencode.ai', identity('opencode')],
		['zenmux.ai', identity('zenmux')],
		['openrouter.ai', identity('openrouter')],
		['siliconflow.cn', identity('siliconflow')],
		['siliconflow.com', identity('siliconflow')],
		['edgecloudapp.com', identity('wangsu')],
	];
	for (const [domain, matchedIdentity] of domainRules) {
		if (hostnameMatches(hostname, domain)) return matchedIdentity;
	}

	const isLocalOllama =
		(hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]') &&
		url.port === '11434';
	return isLocalOllama ? identity('ollama') : null;
}

type EndpointIdentityResult =
	| { status: 'matched'; identity: ProviderCatalogIdentity }
	| { status: 'conflict' }
	| { status: 'none' };

function identityFromEndpointHosts(
	endpoints: ProviderEndpointsSource['endpoints']
): EndpointIdentityResult {
	let map: ProviderEndpointsMap;
	try {
		map = parseProviderEndpoints({ endpoints });
	} catch {
		return { status: 'none' };
	}

	const matches: ProviderCatalogIdentity[] = [];
	for (const config of Object.values(map)) {
		const rawUrls = [config?.base, ...Object.values(config?.endpoints ?? {})];
		for (const rawUrl of rawUrls) {
			if (!rawUrl) continue;
			try {
				const matched = endpointIdentity(new URL(rawUrl));
				if (matched) matches.push(matched);
			} catch {
				// Custom endpoint templates can be non-URL strings. They simply do not identify a preset.
			}
		}
	}

	if (matches.length === 0) return { status: 'none' };
	const vendorKeys = new Set(matches.map((match) => match.vendorKey));
	if (vendorKeys.size !== 1) return { status: 'conflict' };

	const vendorKey = matches[0].vendorKey;
	const iconKeys = new Set(matches.map((match) => match.iconKey));
	return {
		status: 'matched',
		identity: {
			vendorKey,
			// Multiple products from one parent vendor are safe at vendor level, but not at product level.
			iconKey: iconKeys.size === 1 ? matches[0].iconKey : vendorKey,
		},
	};
}

function nameIncludesAny(name: string, keywords: readonly string[]): boolean {
	return keywords.some((keyword) => name.includes(keyword));
}

function identityFromNameHint(normalizedName: string): ProviderCatalogIdentity | null {
	const identity = (vendorKey: string, iconKey = vendorKey): ProviderCatalogIdentity => ({
		vendorKey,
		iconKey,
	});

	// Product names precede parent-company names so the more useful product icon wins.
	const productRules: ReadonlyArray<readonly [readonly string[], ProviderCatalogIdentity]> = [
		[['百炼', 'bailian', 'dashscope'], identity('aliyun', 'bailian')],
		[['千问', '通义', 'qwen'], identity('aliyun', 'qwen')],
		[['混元', 'hunyuan', 'tokenhub'], identity('tencent', 'hunyuan')],
		[['vertex'], identity('google', 'vertexai')],
		[['z.ai'], identity('zhipu', 'zai')],
		[['longcat', '龙猫'], identity('meituan', 'longcat')],
		[['kimi'], identity('moonshot', 'kimi')],
		[['mimo'], identity('xiaomi', 'xiaomimimo')],
	];
	for (const [keywords, matchedIdentity] of productRules) {
		if (nameIncludesAny(normalizedName, keywords)) return matchedIdentity;
	}

	const vendorRules: ReadonlyArray<readonly [readonly string[], ProviderCatalogIdentity]> = [
		[['azure openai', 'azure', '微软云'], identity('azure')],
		[['deepseek', '深度求索'], identity('deepseek')],
		[['volcengine', '火山方舟', '火山引擎', 'byteplus'], identity('volcengine')],
		[['alibaba', 'aliyun', '阿里云'], identity('aliyun')],
		[['tencent', '腾讯云'], identity('tencent')],
		[['qianfan', '千帆', '百度'], identity('baidu')],
		[['zhipu', '智谱'], identity('zhipu')],
		[['meituan', '美团'], identity('meituan')],
		[['moonshot', '月之暗面'], identity('moonshot')],
		[['minimax'], identity('minimax')],
		[['elevenlabs'], identity('elevenlabs')],
		[['opendesign', 'open design'], identity('opendesign')],
		[['openai'], identity('openai')],
		[['anthropic', 'claude'], identity('anthropic')],
		[['gemini', 'google', '谷歌'], identity('google')],
		[['mistral'], identity('mistral')],
		[['groq'], identity('groq')],
		[['cerebras'], identity('cerebras')],
		[['sambanova', 'samba nova'], identity('sambanova')],
		[['scnet', '超算互联网', '超算'], identity('scnet')],
		[['x.ai', 'xai', 'grok'], identity('xai')],
		[['together'], identity('together')],
		[['fireworks'], identity('fireworks')],
		[['deepinfra', 'deep infra'], identity('deepinfra')],
		[['novita'], identity('novita')],
		[['huggingface', 'hugging face'], identity('huggingface')],
		[['commandcode', 'command code'], identity('commandcode')],
		[['vercel'], identity('vercel')],
		[['meta', 'muse spark'], identity('meta')],
		[['perplexity'], identity('perplexity')],
		[['cohere'], identity('cohere')],
		[['nvidia', '英伟达', 'nim'], identity('nvidia')],
		[['stepfun', '阶跃'], identity('stepfun')],
		[['baichuan', '百川'], identity('baichuan')],
		[['xiaomi', '小米'], identity('xiaomi')],
		[['modelink'], identity('modelink')],
		[['qiniu', '七牛', 'qnaigc'], identity('qiniu')],
		[['kingsoft', '金山云', '星流', 'xingliu', 'starflow', 'kspmas'], identity('kingsoft')],
		[['opencode', 'open code zen', 'opencode zen', 'opencode go'], identity('opencode')],
		[['zenmux'], identity('zenmux')],
		[['openrouter'], identity('openrouter')],
		[['siliconflow', '硅基流动'], identity('siliconflow')],
		[['wangsu', '网宿', 'edgecloudapp'], identity('wangsu')],
		[['ollama'], identity('ollama')],
	];
	for (const [keywords, matchedIdentity] of vendorRules) {
		if (nameIncludesAny(normalizedName, keywords)) return matchedIdentity;
	}
	return null;
}

export type StoredProviderPresentation = {
	vendorKey: string;
	iconKey: string;
	catalogLinks: ProviderCatalogLinks | null;
	/** 未分类或自定义时为 null。自定义文案由 UI 翻译。 */
	kindLabels: ProviderKindLabels | null;
	/** 已保存类型的中、英、日、韩介绍。自定义、未分类或模板没有介绍时为 null。 */
	kindDescriptions: Record<ProviderCatalogLocale, string> | null;
};

function providerKindLabelsForPreset(row: StaticProviderImportPresetRow): ProviderKindLabels {
	const en = row.catalog?.i18n?.en?.name?.trim() || row.name;
	return {
		en,
		zh: row.catalog?.i18n?.zh?.name?.trim() || en,
		ja: row.catalog?.i18n?.ja?.name?.trim() || en,
		ko: row.catalog?.i18n?.ko?.name?.trim() || en,
	};
}

function protocolsForPreset(p: StaticProviderImportPresetRow): AdminProviderImportCatalogItem['protocols'] {
	const map = parseProviderEndpoints({ endpoints: p.endpoints });
	const out: AdminProviderImportCatalogItem['protocols'] = [];
	if (map.openai) out.push('openai');
	if (map.anthropic) out.push('anthropic');
	if (map.gemini) out.push('gemini');
	return out;
}

export function createProviderCatalog(rows: readonly StaticProviderImportPresetRow[]) {
	const STATIC_IDENTITY_BY_NAME = new Map(
		rows.map((row) => [row.name.trim().toLowerCase(), identityForPreset(row)])
	);
	const STATIC_IDENTITY_BY_ENDPOINTS = new Map(
		rows.map((row) => [providerEndpointSignature(row.endpoints), identityForPreset(row)]).filter(
			(entry): entry is [string, ProviderCatalogIdentity] => Boolean(entry[0])
		)
	);

	const STATIC_LINKS_BY_NAME = new Map(
		rows.flatMap((row) => {
			const links = catalogLinksFromRow(row);
			return links ? ([[row.name.trim().toLowerCase(), links]] as const) : [];
		})
	);
	const STATIC_LINKS_BY_ENDPOINTS = new Map(
		rows.flatMap((row) => {
			const links = catalogLinksFromRow(row);
			const signature = providerEndpointSignature(row.endpoints);
			return links && signature ? ([[signature, links]] as const) : [];
		})
	);

	const PRESET_BY_EXACT_NAME = new Map(rows.map((row) => [row.name.trim(), row]));

	function inferStaticProviderIdentity(provider: {
		name?: string | null;
		endpoints?: ProviderEndpointsSource['endpoints'];
	}): ProviderCatalogIdentity | null {
		const normalizedName = normalizedImportedProviderName(provider.name);
		const exactName = STATIC_IDENTITY_BY_NAME.get(normalizedName);
		if (exactName) return exactName;

		const signature = providerEndpointSignature(provider.endpoints);
		const exactEndpoints = signature && STATIC_IDENTITY_BY_ENDPOINTS.get(signature);
		if (exactEndpoints) return exactEndpoints;

		const endpointResult = identityFromEndpointHosts(provider.endpoints);
		if (endpointResult.status === 'matched') return endpointResult.identity;
		if (endpointResult.status === 'conflict') return null;

		return identityFromNameHint(normalizedName);
	}

	/**
	 * 不落库推导 Provider Vendor：精确模板名 / Endpoint 优先，其次按 Endpoint 域名、
	 * 中英文名称关键词识别；自定义且无法识别或 Endpoint 厂商冲突时回退 `other`。
	 */
	function inferStaticProviderVendorKey(provider: {
		name?: string | null;
		endpoints?: ProviderEndpointsSource['endpoints'];
	}): string {
		return inferStaticProviderIdentity(provider)?.vendorKey ?? 'other';
	}

	/**
	 * 不落库推导 Provider 产品图标：与 Vendor 共用同一识别结果，但保留百炼、千问、
	 * 混元、Kimi、MiMo 等产品级 Logo。无法识别时回退调用方提供的 Vendor。
	 */
	function inferStaticProviderIconKey(provider: {
		name?: string | null;
		endpoints?: ProviderEndpointsSource['endpoints'];
		vendor_key?: string | null;
	}): string {
		return inferStaticProviderIdentity(provider)?.iconKey ?? normalizeModelVendorInput(provider.vendor_key);
	}

	/**
	 * 按精确模板名（忽略导入去重后缀）或 endpoint 签名取 catalog 链接。
	 * 不按厂商域名回退，避免 OpenCode Zen / Go 等共用域名的模板串台。
	 */
	function lookupStaticProviderCatalogLinks(provider: {
		name?: string | null;
		endpoints?: ProviderEndpointsSource['endpoints'];
	}): ProviderCatalogLinks | null {
		const exactName = STATIC_LINKS_BY_NAME.get(normalizedImportedProviderName(provider.name));
		if (exactName) return exactName;
		const signature = providerEndpointSignature(provider.endpoints);
		return (signature && STATIC_LINKS_BY_ENDPOINTS.get(signature)) || null;
	}

	/** `kind` 已设置时只用模板身份；空 kind 才回退 URL / 名称推断。 */
	function resolveStoredProviderPresentation(provider: {
		kind?: string | null;
		name?: string | null;
		endpoints?: ProviderEndpointsSource['endpoints'];
		vendor_key?: string | null;
	}): StoredProviderPresentation {
		const kind = String(provider.kind ?? '').trim();
		if (!kind) {
			const vendorKey = inferStaticProviderVendorKey(provider);
			return {
				vendorKey,
				iconKey: inferStaticProviderIconKey({ ...provider, vendor_key: vendorKey }),
				catalogLinks: lookupStaticProviderCatalogLinks(provider),
				kindLabels: null,
				kindDescriptions: null,
			};
		}
		if (kind === CUSTOM_PROVIDER_KIND) {
			return {
				vendorKey: 'other',
				iconKey: 'other',
				catalogLinks: null,
				kindLabels: null,
				kindDescriptions: null,
			};
		}
		const preset = PRESET_BY_EXACT_NAME.get(kind);
		if (!preset) {
			return {
				vendorKey: 'other',
				iconKey: 'other',
				catalogLinks: null,
				kindLabels: { en: kind, zh: kind, ja: kind, ko: kind },
				kindDescriptions: null,
			};
		}
		const identity = identityForPreset(preset);
		const copy = providerPresetCatalogCopy(preset);
		return {
			vendorKey: identity.vendorKey,
			iconKey: identity.iconKey,
			catalogLinks: catalogLinksFromRow(preset),
			kindLabels: providerKindLabelsForPreset(preset),
			kindDescriptions: PROVIDER_CATALOG_LOCALES.some((locale) => copy[locale])
				? {
						en: copy.en ?? '',
						zh: copy.zh ?? '',
						ja: copy.ja ?? '',
						ko: copy.ko ?? '',
					}
				: null,
		};
	}

	function isKnownProviderKind(kind: string): boolean {
		return kind === CUSTOM_PROVIDER_KIND || PRESET_BY_EXACT_NAME.has(kind);
	}

	/** 按 `providers.kind`（模板英文名）取官方模板；自定义 / 未分类 / 未知返回 undefined。 */
	function getStaticProviderPresetByKind(kind: string | null | undefined): StaticProviderImportPresetRow | undefined {
		const key = String(kind ?? '').trim();
		if (!key || key === CUSTOM_PROVIDER_KIND) return undefined;
		return PRESET_BY_EXACT_NAME.get(key);
	}

	/** 模板被改名后，按 endpoints 签名猜旧 kind 对应的新模板名；猜不到返回 null。 */
	function suggestStaticProviderKindByEndpoints(
		endpoints: ProviderEndpointsSource['endpoints']
	): string | null {
		const signature = providerEndpointSignature(endpoints);
		if (!signature) return null;
		const hit = rows.find((row) => providerEndpointSignature(row.endpoints) === signature);
		return hit ? hit.name.trim() : null;
	}

	function listProviderKindChoices(): Array<{
		kind: string;
		labels: ProviderKindLabels;
		vendorKey: string;
		iconKey: string;
	}> {
		return rows.filter((row) => row.name.trim().length > 0).map((row) => {
			const identity = identityForPreset(row);
			return {
				kind: row.name.trim(),
				labels: providerKindLabelsForPreset(row),
				vendorKey: identity.vendorKey,
				iconKey: identity.iconKey,
			};
		});
	}

	/** 全部静态模板行（含 catalog 键与 endpoints）。 */
	function listStaticProviderImportPresets(): StaticProviderImportPresetWithKey[] {
		return rows.filter((r) => String(r.name ?? '').trim().length > 0).map((row) => ({
			...row,
			catalog_key: row.name.trim(),
		}));
	}

	/** 供 `GET /admin/providers/import/catalog`：摘要不含密钥。 */
	function listStaticProviderImportCatalogForAdmin(): AdminProviderImportCatalogItem[] {
		return listStaticProviderImportPresets().map((p) => {
			const vendorCanon = normalizeModelVendorInput(p.vendor_key);
			const map = parseProviderEndpoints({ endpoints: p.endpoints });
			return {
				id: p.catalog_key,
				name: String(p.name ?? '').trim(),
				vendor_key: vendorCanon,
				icon_key: p.icon_key?.trim() || vendorCanon,
				vendor_label: getModelVendorLabel(vendorCanon),
				protocols: protocolsForPreset(p),
				endpoints: serializeProviderEndpoints(map),
				description: p.description != null && String(p.description).trim() ? String(p.description).trim() : null,
				labels: catalogLabelsFromRow(p),
				links: catalogLinksFromRow(p) ?? undefined,
			};
		});
	}

	return {
		inferStaticProviderVendorKey,
		inferStaticProviderIconKey,
		lookupStaticProviderCatalogLinks,
		resolveStoredProviderPresentation,
		isKnownProviderKind,
		getStaticProviderPresetByKind,
		suggestStaticProviderKindByEndpoints,
		listProviderKindChoices,
		listStaticProviderImportPresets,
		listStaticProviderImportCatalogForAdmin,
	};
}

export type ProviderCatalog = ReturnType<typeof createProviderCatalog>;

const catalogs = new WeakMap<readonly StaticProviderImportPresetRow[], ProviderCatalog>();

export function getProviderCatalog(rows: readonly StaticProviderImportPresetRow[]): ProviderCatalog {
	let catalog = catalogs.get(rows);
	if (!catalog) {
		catalog = createProviderCatalog(rows);
		catalogs.set(rows, catalog);
	}
	return catalog;
}
