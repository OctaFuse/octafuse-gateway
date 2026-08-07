/**
 * Provider `endpoints` JSON：按协议配置 `base`（标准派生）或按 capability 的完整 URL 模板。
 * 权威列为 `providers.endpoints`。
 */
import {
	buildGeminiUpstreamActionUrl,
	type GeminiContentAction,
} from './gemini-upstream-url';
import {
	GEMINI_GENERATE_OPERATION,
	GEMINI_LEGACY_GENERATE_OPERATIONS,
	canonicalizeRequestOperation,
} from './route-topology';
import {
	buildOpenAiCompatibleImagesUrl,
	type UpstreamProtocol,
	UPSTREAM_PROTOCOLS,
} from './upstream-protocol';

/** 上游协议 capability；DashScope 音频把 HTTP、任务查询和两类 WSS 明确拆开。 */
export type ProviderEndpointCapability =
	| 'chat'
	| 'images.generations'
	| 'images.edits'
	| 'audio.transcriptions'
	| 'audio.transcriptions.multimodal'
	| 'audio.transcriptions.tasks'
	| 'audio.speech'
	| 'audio.speech.multimodal'
	| 'audio.realtime.inference'
	| 'audio.realtime.session'
	| 'audio.hotwords'
	| 'audio.voices'
	| 'messages'
	| 'models.generate'
	| 'generateContent'
	| 'streamGenerateContent';

export const OPENAI_ENDPOINT_CAPABILITIES = [
	'chat',
	'images.generations',
	'images.edits',
	'audio.transcriptions',
	'audio.speech',
] as const satisfies readonly ProviderEndpointCapability[];

export const ANTHROPIC_ENDPOINT_CAPABILITIES = ['messages'] as const satisfies readonly ProviderEndpointCapability[];

/** Canonical Gemini capability (drives UI / listConfiguredCapabilities). */
export const GEMINI_ENDPOINT_CAPABILITIES = [
	GEMINI_GENERATE_OPERATION,
] as const satisfies readonly ProviderEndpointCapability[];

/** Legacy per-action Gemini endpoint keys still accepted on read/write. */
export const GEMINI_LEGACY_ENDPOINT_CAPABILITIES = [
	...GEMINI_LEGACY_GENERATE_OPERATIONS,
] as const satisfies readonly ProviderEndpointCapability[];

/** DashScope 原生音频能力；同一 base 可派生官方 HTTP 与 WebSocket 路径。 */
export const DASHSCOPE_ENDPOINT_CAPABILITIES = [
	'audio.transcriptions',
	'audio.transcriptions.multimodal',
	'audio.transcriptions.tasks',
	'audio.speech',
	'audio.speech.multimodal',
	'audio.realtime.inference',
	'audio.realtime.session',
	'audio.hotwords',
	'audio.voices',
] as const satisfies readonly ProviderEndpointCapability[];

const CAPABILITIES_BY_PROTOCOL: Record<UpstreamProtocol, readonly ProviderEndpointCapability[]> = {
	openai: OPENAI_ENDPOINT_CAPABILITIES,
	anthropic: ANTHROPIC_ENDPOINT_CAPABILITIES,
	gemini: GEMINI_ENDPOINT_CAPABILITIES,
	dashscope: DASHSCOPE_ENDPOINT_CAPABILITIES,
};

/** Write-side whitelist: gemini accepts canonical + legacy keys. */
export const WRITABLE_CAPABILITIES_BY_PROTOCOL: Record<
	UpstreamProtocol,
	readonly ProviderEndpointCapability[]
> = {
	openai: OPENAI_ENDPOINT_CAPABILITIES,
	anthropic: ANTHROPIC_ENDPOINT_CAPABILITIES,
	gemini: [...GEMINI_ENDPOINT_CAPABILITIES, ...GEMINI_LEGACY_ENDPOINT_CAPABILITIES],
	dashscope: DASHSCOPE_ENDPOINT_CAPABILITIES,
};

const ALL_CAPABILITIES = new Set<string>([
	...OPENAI_ENDPOINT_CAPABILITIES,
	...ANTHROPIC_ENDPOINT_CAPABILITIES,
	...GEMINI_ENDPOINT_CAPABILITIES,
	...GEMINI_LEGACY_ENDPOINT_CAPABILITIES,
	...DASHSCOPE_ENDPOINT_CAPABILITIES,
]);

/** 单协议配置：`base` 与/或按 capability 的完整 URL 模板。 */
export type ProtocolEndpointsConfig = {
	base?: string;
	endpoints?: Partial<Record<ProviderEndpointCapability, string>>;
};

/** 解析后的 `providers.endpoints` 对象（仅含已配置协议）。 */
export type ProviderEndpointsMap = Partial<Record<UpstreamProtocol, ProtocolEndpointsConfig>>;

/** 供 `parseProviderEndpoints` 读取的 provider 行字段。 */
export type ProviderEndpointsSource = {
	endpoints?: string | ProviderEndpointsMap | null;
};

function trimSlash(url: string): string {
	return url.replace(/\/+$/, '');
}

function nonEmptyTrimmed(raw: unknown): string | null {
	if (raw == null) return null;
	const s = String(raw).trim();
	return s === '' ? null : s;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function normalizeProtocolConfig(raw: unknown): ProtocolEndpointsConfig | null {
	if (!isPlainObject(raw)) return null;
	const base = nonEmptyTrimmed(raw.base);
	const endpointsRaw = raw.endpoints;
	let endpoints: ProtocolEndpointsConfig['endpoints'];
	if (isPlainObject(endpointsRaw)) {
		const mapped: Partial<Record<ProviderEndpointCapability, string>> = {};
		for (const [cap, url] of Object.entries(endpointsRaw)) {
			const trimmed = nonEmptyTrimmed(url);
			if (!trimmed) continue;
			if (!ALL_CAPABILITIES.has(cap)) continue;
			mapped[cap as ProviderEndpointCapability] = trimmed;
		}
		if (Object.keys(mapped).length > 0) endpoints = mapped;
	}
	if (!base && !endpoints) return null;
	const cfg: ProtocolEndpointsConfig = {};
	if (base) cfg.base = trimSlash(base);
	if (endpoints) cfg.endpoints = endpoints;
	return cfg;
}

function normalizeEndpointsMap(raw: unknown): ProviderEndpointsMap | null {
	if (!isPlainObject(raw)) return null;
	const out: ProviderEndpointsMap = {};
	for (const protocol of UPSTREAM_PROTOCOLS) {
		if (!(protocol in raw)) continue;
		const cfg = normalizeProtocolConfig(raw[protocol]);
		if (cfg) out[protocol] = cfg;
	}
	return Object.keys(out).length > 0 ? out : null;
}

/**
 * 解析 provider 的 endpoints 配置（`providers.endpoints` 列）。
 * NULL / 非法 / 空对象时返回空 map。
 */
export function parseProviderEndpoints(provider: ProviderEndpointsSource): ProviderEndpointsMap {
	const col = provider.endpoints;
	if (col != null && col !== '') {
		if (typeof col === 'string') {
			try {
				const parsed = normalizeEndpointsMap(JSON.parse(col) as unknown);
				if (parsed) return parsed;
			} catch {
				return {};
			}
		} else {
			const parsed = normalizeEndpointsMap(col);
			if (parsed) return parsed;
		}
	}
	return {};
}

/** 该协议下是否配置了 `base` 或任一 capability endpoint。 */
export function protocolHasEndpointsConfig(
	map: ProviderEndpointsMap,
	protocol: UpstreamProtocol
): boolean {
	const cfg = map[protocol];
	if (!cfg) return false;
	if (cfg.base) return true;
	return !!(cfg.endpoints && Object.keys(cfg.endpoints).length > 0);
}

/** 序列化为入库 JSON 文本；空配置返回 null。 */
export function serializeProviderEndpoints(map: ProviderEndpointsMap): string | null {
	const cleaned: ProviderEndpointsMap = {};
	for (const protocol of UPSTREAM_PROTOCOLS) {
		const cfg = map[protocol];
		if (!cfg) continue;
		const entry: ProtocolEndpointsConfig = {};
		if (cfg.base) entry.base = trimSlash(cfg.base);
		if (cfg.endpoints) {
			const eps: Partial<Record<ProviderEndpointCapability, string>> = {};
			for (const [cap, url] of Object.entries(cfg.endpoints)) {
				const t = nonEmptyTrimmed(url);
				if (t) eps[cap as ProviderEndpointCapability] = t;
			}
			if (Object.keys(eps).length > 0) entry.endpoints = eps;
		}
		if (entry.base || entry.endpoints) cleaned[protocol] = entry;
	}
	return Object.keys(cleaned).length > 0 ? JSON.stringify(cleaned) : null;
}

function assertHttpUrl(url: string, label: string): void {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		throw new Error(`${label} is not a valid URL`);
	}
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
		throw new Error(`${label} must be http(s)`);
	}
}

function assertWebSocketUrl(url: string, label: string): void {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		throw new Error(`${label} is not a valid URL`);
	}
	if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
		throw new Error(`${label} must be ws(s)`);
	}
}

function isDashScopeRealtimeCapability(capability: string): boolean {
	return capability === 'audio.realtime.inference' || capability === 'audio.realtime.session';
}

/**
 * 校验并规范化 admin 写入的 endpoints（对象或 JSON 字符串）。
 * @throws Error 结构 / 协议名 / capability / URL / Gemini `{model}` 不合法
 */
export function validateAndNormalizeProviderEndpoints(raw: unknown): ProviderEndpointsMap {
	let value: unknown = raw;
	if (typeof raw === 'string') {
		const trimmed = raw.trim();
		if (trimmed === '') return {};
		try {
			value = JSON.parse(trimmed) as unknown;
		} catch {
			throw new Error('endpoints must be valid JSON');
		}
	}
	if (value == null) return {};
	if (!isPlainObject(value)) {
		throw new Error('endpoints must be a JSON object');
	}

	const out: ProviderEndpointsMap = {};
	for (const [key, protoRaw] of Object.entries(value)) {
		if (!(UPSTREAM_PROTOCOLS as readonly string[]).includes(key)) {
			throw new Error(`endpoints: unknown protocol ${JSON.stringify(key)}`);
		}
		const protocol = key as UpstreamProtocol;
		if (!isPlainObject(protoRaw)) {
			throw new Error(`endpoints.${protocol} must be an object`);
		}
		const allowed = new Set<string>(WRITABLE_CAPABILITIES_BY_PROTOCOL[protocol]);
		const base = nonEmptyTrimmed(protoRaw.base);
		if (base) assertHttpUrl(base, `endpoints.${protocol}.base`);

		let endpoints: ProtocolEndpointsConfig['endpoints'];
		if (protoRaw.endpoints !== undefined && protoRaw.endpoints !== null) {
			if (!isPlainObject(protoRaw.endpoints)) {
				throw new Error(`endpoints.${protocol}.endpoints must be an object`);
			}
			const mapped: Partial<Record<ProviderEndpointCapability, string>> = {};
			for (const [cap, urlRaw] of Object.entries(protoRaw.endpoints)) {
				if (!allowed.has(cap)) {
					throw new Error(
						`endpoints.${protocol}.endpoints: unknown capability ${JSON.stringify(cap)}`
					);
				}
				const url = nonEmptyTrimmed(urlRaw);
				if (!url) continue;
				const urlForValidation = url
					.replace(/\{model\}/g, 'm')
					.replace(/\{action\}/g, 'a')
					.replace(/\{task_id\}/g, 't');
				if (protocol === 'dashscope' && isDashScopeRealtimeCapability(cap)) {
					assertWebSocketUrl(urlForValidation, `endpoints.${protocol}.endpoints.${cap}`);
				} else {
					assertHttpUrl(urlForValidation, `endpoints.${protocol}.endpoints.${cap}`);
				}
				if (protocol === 'gemini') {
					if (!url.includes('{model}')) {
						throw new Error(
							`endpoints.${protocol}.endpoints.${cap} must include {model} placeholder`
						);
					}
					if (cap === GEMINI_GENERATE_OPERATION && !url.includes('{action}')) {
						throw new Error(
							`endpoints.${protocol}.endpoints.${cap} must include {action} placeholder`
						);
					}
				}
				if (
					protocol === 'dashscope' &&
					cap === 'audio.transcriptions.tasks' &&
					!url.includes('{task_id}')
				) {
					throw new Error(
						`endpoints.${protocol}.endpoints.${cap} must include {task_id} placeholder`
					);
				}
				mapped[cap as ProviderEndpointCapability] = url;
			}
			if (Object.keys(mapped).length > 0) endpoints = mapped;
		}

		if (!base && !endpoints) {
			continue;
		}
		const cfg: ProtocolEndpointsConfig = {};
		if (base) cfg.base = trimSlash(base);
		if (endpoints) cfg.endpoints = endpoints;
		out[protocol] = cfg;
	}
	return out;
}

function fillEndpointTemplate(
	template: string,
	vars: { model?: string; action?: string; taskId?: string }
): string {
	return template
		.replace(/\{model\}/g, () => encodeURIComponent(vars.model ?? ''))
		.replace(/\{action\}/g, () => encodeURIComponent(vars.action ?? ''))
		.replace(/\{task_id\}/g, () => encodeURIComponent(vars.taskId ?? ''));
}

export type ResolveUpstreamEndpointOptions = {
	model?: string;
	/** Gemini action；与 capability 一致时可省略 */
	action?: string;
	providerId?: string;
	/** DashScope 异步文件识别任务查询 ID。 */
	taskId?: string;
};

function resolveGeminiWireAction(
	capability: ProviderEndpointCapability,
	options: ResolveUpstreamEndpointOptions
): GeminiContentAction {
	const fromOptions = options.action?.trim();
	if (fromOptions === 'generateContent' || fromOptions === 'streamGenerateContent') {
		return fromOptions;
	}
	if (capability === 'generateContent' || capability === 'streamGenerateContent') {
		return capability;
	}
	throw new Error(
		'Gemini upstream endpoint requires action (generateContent or streamGenerateContent)'
	);
}

/** DashScope WSS 与 HTTP 共用 host，但协议和固定 API 根不同。 */
function buildDashScopeWebSocketUrl(base: string, endpoint: 'inference' | 'realtime'): string {
	const url = new URL(base);
	url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
	url.pathname = `/api-ws/v1/${endpoint}`;
	url.search = '';
	url.hash = '';
	return url.toString();
}

/**
 * 解析实际上游完整 URL：capability 模板优先，否则用 `base` 按协议派生。
 * Gemini：`models.generate` 模板 → 旧 per-action 模板 → base 派生。
 */
export function resolveUpstreamEndpoint(
	protocol: UpstreamProtocol,
	capability: ProviderEndpointCapability,
	providerEndpoints: ProviderEndpointsMap,
	options: ResolveUpstreamEndpointOptions = {}
): string {
	const canonicalCapability = canonicalizeRequestOperation(
		protocol,
		capability
	) as ProviderEndpointCapability;
	const writable = WRITABLE_CAPABILITIES_BY_PROTOCOL[protocol];
	if (!(writable as readonly string[]).includes(capability) &&
		!(CAPABILITIES_BY_PROTOCOL[protocol] as readonly string[]).includes(canonicalCapability)) {
		throw new Error(
			`Capability ${JSON.stringify(capability)} is not valid for protocol "${protocol}"`
		);
	}

	const cfg = providerEndpoints[protocol];

	if (protocol === 'gemini') {
		const action = resolveGeminiWireAction(capability, options);
		const model = options.model;
		const familyTemplate = cfg?.endpoints?.[GEMINI_GENERATE_OPERATION];
		if (familyTemplate) {
			if (!model) throw new Error('Gemini upstream endpoint requires model name');
			return fillEndpointTemplate(familyTemplate, { model, action });
		}
		const legacyTemplate = cfg?.endpoints?.[action];
		if (legacyTemplate) {
			if (!model) throw new Error('Gemini upstream endpoint requires model name');
			return fillEndpointTemplate(legacyTemplate, { model, action });
		}
		const base = cfg?.base;
		if (base) {
			if (!model) throw new Error('Gemini upstream endpoint requires model name');
			return buildGeminiUpstreamActionUrl(trimSlash(base), model, action);
		}
		const who =
			options.providerId != null && options.providerId !== ''
				? `provider_id=${JSON.stringify(options.providerId)}`
				: 'provider';
		throw new Error(
			`${who}: no upstream endpoint for protocol "gemini" capability "${GEMINI_GENERATE_OPERATION}" (configure providers.endpoints.gemini)`
		);
	}

	const resolvedCapability = canonicalCapability;
	const allowed = CAPABILITIES_BY_PROTOCOL[protocol];
	if (!(allowed as readonly string[]).includes(resolvedCapability)) {
		throw new Error(
			`Capability ${JSON.stringify(capability)} is not valid for protocol "${protocol}"`
		);
	}

	const template = cfg?.endpoints?.[resolvedCapability];
	if (template) {
		if (resolvedCapability === 'audio.transcriptions.tasks' && !options.taskId) {
			throw new Error('DashScope task endpoint requires taskId');
		}
		return fillEndpointTemplate(template, {
			model: options.model,
			action: options.action,
			taskId: options.taskId,
		});
	}

	const base = cfg?.base;
	if (base) {
		const root = trimSlash(base);
		switch (resolvedCapability) {
			case 'chat':
				return `${root}/chat/completions`;
			case 'images.generations':
				return buildOpenAiCompatibleImagesUrl(root, 'generations');
			case 'images.edits':
				return buildOpenAiCompatibleImagesUrl(root, 'edits');
			case 'audio.transcriptions':
				return protocol === 'dashscope'
					? `${root}/services/audio/asr/transcription`
					: `${root}/audio/transcriptions`;
			case 'audio.transcriptions.multimodal':
				return `${root}/services/aigc/multimodal-generation/generation`;
			case 'audio.transcriptions.tasks':
				if (!options.taskId) {
					throw new Error('DashScope task endpoint requires taskId');
				}
				return `${root}/tasks/${encodeURIComponent(options.taskId)}`;
			case 'audio.speech':
				return protocol === 'dashscope'
					? `${root}/services/audio/tts/SpeechSynthesizer`
					: `${root}/audio/speech`;
			case 'audio.speech.multimodal':
				return `${root}/services/aigc/multimodal-generation/generation`;
			case 'audio.realtime.inference':
				return buildDashScopeWebSocketUrl(root, 'inference');
			case 'audio.realtime.session':
				return buildDashScopeWebSocketUrl(root, 'realtime');
			case 'audio.hotwords':
				return `${root}/services/audio/asr/customization`;
			case 'audio.voices':
				return `${root}/services/audio/tts/customization`;
			case 'messages':
				return `${root}/v1/messages`;
			default: {
				throw new Error(`Unhandled capability: ${JSON.stringify(resolvedCapability)}`);
			}
		}
	}

	const who =
		options.providerId != null && options.providerId !== ''
			? `provider_id=${JSON.stringify(options.providerId)}`
			: 'provider';
	throw new Error(
		`${who}: no upstream endpoint for protocol "${protocol}" capability "${resolvedCapability}" (configure providers.endpoints.${protocol})`
	);
}

/**
 * 解析某协议下的 `base`（去尾斜杠）；仅 capability 模板、无 base 时抛错。
 * 新代码应优先使用 {@link resolveUpstreamEndpoint}。
 */
export function resolveEffectiveBaseUrl(
	protocol: UpstreamProtocol,
	provider: ProviderEndpointsSource,
	providerId?: string
): string {
	const map = parseProviderEndpoints(provider);
	const base = map[protocol]?.base;
	if (base) return base;
	const who =
		providerId != null && providerId !== ''
			? `provider_id=${JSON.stringify(providerId)}`
			: 'provider';
	throw new Error(
		`${who}: no upstream base URL for protocol "${protocol}" (configure providers.endpoints.${protocol}.base)`
	);
}

/**
 * 是否已为该协议配置 `base` 或任一 capability endpoint（创建路由前校验）。
 */
export function providerSupportsUpstreamProtocol(
	protocol: UpstreamProtocol,
	provider: ProviderEndpointsSource
): boolean {
	return protocolHasEndpointsConfig(parseProviderEndpoints(provider), protocol);
}

/**
 * 列出某协议在配置下可用的 capability（与 {@link resolveUpstreamEndpoint} 语义一致）：
 * - 有 `base` → 该协议全部 canonical capability
 * - 无 `base`、仅有 overrides → 仅已配置的那些（gemini：任一 family/legacy 键 → models.generate）
 * - 未配置协议 → 空数组
 */
export function listConfiguredCapabilities(
	map: ProviderEndpointsMap,
	protocol: UpstreamProtocol
): ProviderEndpointCapability[] {
	const cfg = map[protocol];
	if (!cfg) return [];
	const all = CAPABILITIES_BY_PROTOCOL[protocol];
	if (cfg.base) return [...all];
	const endpoints = cfg.endpoints;
	if (!endpoints) return [];
	if (protocol === 'gemini') {
		const hasAny =
			Boolean(endpoints[GEMINI_GENERATE_OPERATION]) ||
			Boolean(endpoints.generateContent) ||
			Boolean(endpoints.streamGenerateContent);
		return hasAny ? [GEMINI_GENERATE_OPERATION] : [];
	}
	return all.filter((cap) => Boolean(endpoints[cap]));
}
