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
 * - Gemini Vertex 兼容聚合：写到 `{model}` 前的完整前缀，并设 `gemini.auth: "bearer"`
 * - 正式 Vertex（项目级）：OpenAI 仅 Chat Completions（`.../endpoints/openapi/chat/completions`）；原生 Gemini 写项目级 `{model}` 前缀并设 `auth: "bearer"`
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
	type ProviderEndpointsSource,
} from '@octafuse/core/provider-endpoints';

export type StaticProviderImportPresetRow = {
	name: string;
	vendor_key: string;
	/**
	 * Provider 产品级图标。省略时回退 `vendor_key`。
	 * 例如 Xiaomi MiMo 使用 `xiaomimimo`，而不是 Xiaomi 企业 Logo。
	 * 仅用于静态目录与动态展示，不写入 providers 表。
	 */
	icon_key?: string;
	endpoints: ProviderEndpointsMap;
	/** 可选；JSON 中可省略，导入后写入 providers.description 时为 null */
	description?: string | null;
	/**
	 * 仅用于公开 Catalog / 文档展示，不写入 providers 表。
	 * `description` 继续承载导入后的运维说明；此处提供本地化的用户侧摘要与官方入口。
	 */
	catalog?: {
		i18n: {
			zh: { name: string; description: string };
			en: { name: string; description: string };
		};
		links?: {
			/** Provider 官方平台、控制台或本地产品下载页。 */
			platform?: string;
			/** 可确认稳定时填写的 API Key 管理直达页。 */
			api_keys?: string;
		};
	};
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

const STATIC_IDENTITY_BY_NAME = new Map(
	STATIC_ROWS.map((row) => [row.name.trim().toLowerCase(), identityForPreset(row)])
);
const STATIC_IDENTITY_BY_ENDPOINTS = new Map(
	STATIC_ROWS.map((row) => [providerEndpointSignature(row.endpoints), identityForPreset(row)]).filter(
		(entry): entry is [string, ProviderCatalogIdentity] => Boolean(entry[0])
	)
);

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
	if (hostnameMatches(hostname, 'maas.aliyuncs.com')) return identity('aliyun', 'qwen');
	if (
		hostnameMatches(hostname, 'dashscope.aliyuncs.com') ||
		hostnameMatches(hostname, 'dashscope-intl.aliyuncs.com')
	) {
		return identity('aliyun', 'bailian');
	}
	if (
		hostnameMatches(hostname, 'hunyuan.cloud.tencent.com') ||
		hostnameMatches(hostname, 'lkeap.cloud.tencent.com')
	) {
		return identity('tencent', 'hunyuan');
	}
	if (hostnameMatches(hostname, 'api.z.ai')) return identity('zhipu', 'zai');
	if (hostnameMatches(hostname, 'longcat.chat')) return identity('meituan', 'longcat');
	if (hostnameMatches(hostname, 'api.kimi.com')) return identity('moonshot', 'kimi');
	if (hostnameMatches(hostname, 'aiplatform.googleapis.com')) return identity('google', 'vertexai');
	if (hostnameMatches(hostname, 'xiaomimimo.com')) return identity('xiaomi', 'xiaomimimo');

	const domainRules: ReadonlyArray<readonly [string, ProviderCatalogIdentity]> = [
		['deepseek.com', identity('deepseek')],
		['volces.com', identity('volcengine')],
		['bytepluses.com', identity('volcengine')],
		['qianfan.baidubce.com', identity('baidu')],
		['bigmodel.cn', identity('zhipu')],
		['moonshot.cn', identity('moonshot')],
		['minimaxi.com', identity('minimax')],
		['openai.com', identity('openai')],
		['anthropic.com', identity('anthropic')],
		['generativelanguage.googleapis.com', identity('google')],
		['mistral.ai', identity('mistral')],
		['groq.com', identity('groq')],
		['cerebras.ai', identity('cerebras')],
		['sambanova.ai', identity('sambanova')],
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
		['modelink.ai', identity('qiniu')],
		['opencode.ai', identity('opencode')],
		['zenmux.ai', identity('zenmux')],
		['openrouter.ai', identity('openrouter')],
		['siliconflow.cn', identity('siliconflow')],
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
		[['openai'], identity('openai')],
		[['anthropic', 'claude'], identity('anthropic')],
		[['gemini', 'google', '谷歌'], identity('google')],
		[['mistral'], identity('mistral')],
		[['groq'], identity('groq')],
		[['cerebras'], identity('cerebras')],
		[['sambanova', 'samba nova'], identity('sambanova')],
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
		[['qiniu', '七牛', 'qnaigc'], identity('qiniu')],
		[['opencode', 'open code zen', 'opencode zen', 'opencode go'], identity('opencode')],
		[['zenmux'], identity('zenmux')],
		[['openrouter'], identity('openrouter')],
		[['siliconflow', '硅基流动'], identity('siliconflow')],
		[['ollama'], identity('ollama')],
	];
	for (const [keywords, matchedIdentity] of vendorRules) {
		if (nameIncludesAny(normalizedName, keywords)) return matchedIdentity;
	}
	return null;
}

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
export function inferStaticProviderVendorKey(provider: {
	name?: string | null;
	endpoints?: ProviderEndpointsSource['endpoints'];
}): string {
	return inferStaticProviderIdentity(provider)?.vendorKey ?? 'other';
}

/**
 * 不落库推导 Provider 产品图标：与 Vendor 共用同一识别结果，但保留百炼、千问、
 * 混元、Kimi、MiMo 等产品级 Logo。无法识别时回退调用方提供的 Vendor。
 */
export function inferStaticProviderIconKey(provider: {
	name?: string | null;
	endpoints?: ProviderEndpointsSource['endpoints'];
	vendor_key?: string | null;
}): string {
	return inferStaticProviderIdentity(provider)?.iconKey ?? normalizeModelVendorInput(provider.vendor_key);
}

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
			icon_key: p.icon_key?.trim() || vendorCanon,
			vendor_label: getModelVendorLabel(vendorCanon),
			protocols: protocolsForPreset(p),
			endpoints: serializeProviderEndpoints(map),
			description: p.description != null && String(p.description).trim() ? String(p.description).trim() : null,
		};
	});
}
