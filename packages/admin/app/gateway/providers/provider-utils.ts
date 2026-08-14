import type { GatewayProvider } from "@/lib/types";
import {
	listConfiguredCapabilities,
	parseProviderEndpoints,
	resolveUpstreamEndpoint,
	serializeProviderEndpoints,
	type ProviderEndpointCapability,
	type ProviderEndpointsMap,
	type ProtocolEndpointsConfig,
} from '@octafuse/core/provider-endpoints';
import { GEMINI_GENERATE_OPERATION } from '@octafuse/core/route-topology';
import type { UpstreamProtocol } from '@octafuse/core/upstream-protocol';
import type {
	GeminiLegacyPerActionEndpoints,
	ProtocolEndpointForm,
	ProviderCapabilityBadge,
	ProviderFormData,
	ProviderKeyStatusKind,
	ProviderListFilter,
	ProviderProtocolSummary,
} from "./types";
import { EMPTY_PROTOCOL_FORM } from "./types";

/** 完整 capability → 卡片紧凑标签（OpenAI images.* → images；audio.transcriptions → audio）。 */
export function capabilityDisplayBadges(
	capabilities: readonly ProviderEndpointCapability[]
): ProviderCapabilityBadge[] {
	const badges: ProviderCapabilityBadge[] = [];
	const set = new Set(capabilities);
	if (set.has('chat')) badges.push('chat');
	if (set.has('responses')) badges.push('responses');
	if (set.has('images.generations') || set.has('images.edits')) badges.push('images');
	if (capabilities.some((capability) => capability.startsWith('audio.'))) badges.push('audio');
	if (set.has('messages')) badges.push('messages');
	if (set.has(GEMINI_GENERATE_OPERATION) || set.has('generateContent') || set.has('streamGenerateContent')) {
		badges.push('modelsGenerate');
	}
	return badges;
}

/**
 * If both legacy URLs differ only by the trailing `:action`, collapse to a shared `{action}` template.
 */
export function tryCollapseGeminiLegacyEndpoints(
	generateContent: string,
	streamGenerateContent: string
): string | null {
	const gen = generateContent.trim();
	const stream = streamGenerateContent.trim();
	if (!gen || !stream) return null;
	const asTemplate = (url: string, action: string): string | null => {
		const suffix = `:${action}`;
		if (!url.endsWith(suffix)) return null;
		return `${url.slice(0, -suffix.length)}:{action}`;
	};
	const t1 = asTemplate(gen, 'generateContent');
	const t2 = asTemplate(stream, 'streamGenerateContent');
	if (t1 && t2 && t1 === t2) return t1;
	return null;
}

function protocolFormFromConfig(cfg: ProtocolEndpointsConfig | undefined): ProtocolEndpointForm {
	const form: ProtocolEndpointForm = { ...EMPTY_PROTOCOL_FORM, legacyPerAction: null };
	if (!cfg) return form;
	form.base = cfg.base ?? "";
	const eps = cfg.endpoints ?? {};
	form.chat = eps.chat ?? '';
	form.responses = eps.responses ?? '';
	form.images_generations = eps['images.generations'] ?? '';
	form.images_edits = eps['images.edits'] ?? '';
	form.audio_transcriptions = eps['audio.transcriptions'] ?? '';
	form.audio_transcriptions_multimodal = eps['audio.transcriptions.multimodal'] ?? '';
	form.audio_transcriptions_tasks = eps['audio.transcriptions.tasks'] ?? '';
	form.audio_speech = eps['audio.speech'] ?? '';
	form.audio_speech_multimodal = eps['audio.speech.multimodal'] ?? '';
	form.audio_realtime_inference = eps['audio.realtime.inference'] ?? '';
	form.audio_realtime_session = eps['audio.realtime.session'] ?? '';
	form.audio_hotwords = eps['audio.hotwords'] ?? '';
	form.audio_voices = eps['audio.voices'] ?? '';
	form.messages = eps.messages ?? '';

	const family = eps[GEMINI_GENERATE_OPERATION]?.trim() ?? '';
	const legacyGen = eps.generateContent?.trim() ?? '';
	const legacyStream = eps.streamGenerateContent?.trim() ?? '';
	if (family) {
		form.modelsGenerate = family;
		return form;
	}
	if (legacyGen && legacyStream) {
		const collapsed = tryCollapseGeminiLegacyEndpoints(legacyGen, legacyStream);
		if (collapsed) {
			form.modelsGenerate = collapsed;
			return form;
		}
		form.legacyPerAction = {
			generateContent: legacyGen,
			streamGenerateContent: legacyStream,
		};
		form.generateContent = legacyGen;
		form.streamGenerateContent = legacyStream;
		return form;
	}
	if (legacyGen || legacyStream) {
		const legacy: GeminiLegacyPerActionEndpoints = {
			generateContent: legacyGen,
			streamGenerateContent: legacyStream,
		};
		form.legacyPerAction = legacy;
		form.generateContent = legacyGen;
		form.streamGenerateContent = legacyStream;
	}
	return form;
}

/** Provider 行 → 弹窗表单（endpoints + status；api_key 留空表示不改）。 */
export function providerToFormData(
	provider: GatewayProvider
): Omit<ProviderFormData, "id" | "name" | "description"> {
	const map = parseProviderEndpoints(provider);
	return {
		api_key: "",
		status: provider.status === "disabled" ? "disabled" : "active",
		openai: protocolFormFromConfig(map.openai),
		anthropic: protocolFormFromConfig(map.anthropic),
		gemini: protocolFormFromConfig(map.gemini),
		dashscope: protocolFormFromConfig(map.dashscope),
	};
}

function configFromProtocolForm(
	protocol: UpstreamProtocol,
	form: ProtocolEndpointForm
): ProtocolEndpointsConfig | undefined {
	const base = form.base.trim();
	const endpoints: NonNullable<ProtocolEndpointsConfig["endpoints"]> = {};
	if (protocol === "openai") {
		if (form.chat.trim()) endpoints.chat = form.chat.trim();
		if (form.responses.trim()) endpoints.responses = form.responses.trim();
		if (form.images_generations.trim())
			endpoints["images.generations"] = form.images_generations.trim();
		if (form.images_edits.trim())
			endpoints["images.edits"] = form.images_edits.trim();
		if (form.audio_transcriptions.trim()) {
			endpoints["audio.transcriptions"] = form.audio_transcriptions.trim();
		}
		if (form.audio_speech.trim())
			endpoints["audio.speech"] = form.audio_speech.trim();
	} else if (protocol === "anthropic") {
		if (form.messages.trim()) endpoints.messages = form.messages.trim();
	} else if (protocol === "gemini") {
		if (form.legacyPerAction) {
			const gen = form.legacyPerAction.generateContent.trim();
			const stream = form.legacyPerAction.streamGenerateContent.trim();
			if (gen) endpoints.generateContent = gen;
			if (stream) endpoints.streamGenerateContent = stream;
		} else if (form.modelsGenerate.trim()) {
			endpoints[GEMINI_GENERATE_OPERATION] = form.modelsGenerate.trim();
		}
	} else {
		if (form.audio_transcriptions.trim())
			endpoints["audio.transcriptions"] = form.audio_transcriptions.trim();
		if (form.audio_transcriptions_multimodal.trim()) {
			endpoints["audio.transcriptions.multimodal"] =
				form.audio_transcriptions_multimodal.trim();
		}
		if (form.audio_transcriptions_tasks.trim()) {
			endpoints["audio.transcriptions.tasks"] =
				form.audio_transcriptions_tasks.trim();
		}
		if (form.audio_speech.trim())
			endpoints["audio.speech"] = form.audio_speech.trim();
		if (form.audio_speech_multimodal.trim()) {
			endpoints["audio.speech.multimodal"] =
				form.audio_speech_multimodal.trim();
		}
		if (form.audio_realtime_inference.trim()) {
			endpoints["audio.realtime.inference"] =
				form.audio_realtime_inference.trim();
		}
		if (form.audio_realtime_session.trim()) {
			endpoints["audio.realtime.session"] = form.audio_realtime_session.trim();
		}
		if (form.audio_hotwords.trim())
			endpoints["audio.hotwords"] = form.audio_hotwords.trim();
		if (form.audio_voices.trim())
			endpoints["audio.voices"] = form.audio_voices.trim();
	}
	if (!base && Object.keys(endpoints).length === 0) return undefined;
	const cfg: ProtocolEndpointsConfig = {};
	if (base) cfg.base = base;
	if (Object.keys(endpoints).length > 0) cfg.endpoints = endpoints;
	return cfg;
}

/** 表单 → API `endpoints` 对象。 */
export function formDataToEndpointsMap(
	form: ProviderFormData
): ProviderEndpointsMap {
	const map: ProviderEndpointsMap = {};
	const openai = configFromProtocolForm("openai", form.openai);
	const anthropic = configFromProtocolForm("anthropic", form.anthropic);
	const gemini = configFromProtocolForm("gemini", form.gemini);
	const dashscope = configFromProtocolForm("dashscope", form.dashscope);
	if (openai) map.openai = openai;
	if (anthropic) map.anthropic = anthropic;
	if (gemini) map.gemini = gemini;
	if (dashscope) map.dashscope = dashscope;
	return map;
}

export function formDataToEndpointsJson(form: ProviderFormData): string | null {
	return serializeProviderEndpoints(formDataToEndpointsMap(form));
}

export function getProviderProtocolSummaries(
	provider: GatewayProvider
): ProviderProtocolSummary[] {
	const map = parseProviderEndpoints(provider);
	const rows: ProviderProtocolSummary[] = [];

	const appendProtocol = (
		key: ProviderProtocolSummary["key"],
		label: string
	) => {
		const config = map[key];
		if (!config) return;
		const capabilities = listConfiguredCapabilities(map, key);
		if (capabilities.length === 0) return;
		const endpoints = capabilities.flatMap((capability) => {
			try {
				const resolved = resolveUpstreamEndpoint(key, capability, map, {
					model: '{model}',
					action: key === 'gemini' ? 'generateContent' : undefined,
					// 异步任务 URL 必须保留任务占位符，供应商卡片才能展示完整端点。
					taskId: key === 'dashscope' ? '{task_id}' : undefined,
					providerId: provider.id,
				})
					.replace(/%7Bmodel%7D/gi, '{model}')
					.replace(/%7Btask_id%7D/gi, '{task_id}')
					.replace(/:generateContent$/i, ':{action}');
				const override =
					Boolean(config.endpoints?.[capability]) ||
					(key === 'gemini' &&
						(Boolean(config.endpoints?.[GEMINI_GENERATE_OPERATION]) ||
							Boolean(config.endpoints?.generateContent) ||
							Boolean(config.endpoints?.streamGenerateContent)));
				return [{
					capability,
						url: resolved,
						source: override ? 'override' as const : 'base' as const,
					}];
			} catch {
				return [];
			}
		});
		if (endpoints.length === 0) return;
		rows.push({
			key,
			label,
			baseUrl: config.base ?? null,
			overrideCount: Object.keys(config.endpoints ?? {}).length,
			capabilities,
			badges: capabilityDisplayBadges(capabilities),
			endpoints,
		});
	};

	appendProtocol("openai", "OpenAI");
	appendProtocol("anthropic", "Anthropic");
	appendProtocol("gemini", "Gemini");
	appendProtocol("dashscope", "DashScope");
	return rows;
}

export function providerHasApiKey(provider: GatewayProvider): boolean {
	const masked = provider.api_key?.trim() || '';
	return Boolean(masked) && masked !== '(empty)' && !provider.has_pending_key;
}

export function getProviderKeyStatus(provider: GatewayProvider): ProviderKeyStatusKind {
	if (provider.has_pending_key) return 'pending';
	if (provider.status === 'disabled') return 'disabled';
	if (!providerHasApiKey(provider)) return 'no_key';
	return 'key_set';
}

export function providerMatchesSearch(provider: GatewayProvider, query: string): boolean {
	const normalized = query.trim().toLowerCase();
	if (!normalized) return true;
	const endpointSearch = getProviderProtocolSummaries(provider)
		.flatMap((protocol) => [
			protocol.label,
			protocol.baseUrl ?? '',
			...protocol.capabilities,
			...protocol.endpoints.map((endpoint) => endpoint.url),
		])
		.join(' ');
	return [provider.name, provider.id, provider.description ?? '', provider.status ?? '', endpointSearch]
		.join(' ')
		.toLowerCase()
		.includes(normalized);
}

export function providerMatchesListFilter(
	provider: GatewayProvider,
	filter: ProviderListFilter
): boolean {
	if (filter === 'all') return true;
	if (filter === 'active') return provider.status !== 'disabled';
	if (filter === 'disabled') return provider.status === 'disabled';
	if (filter === 'pending') return Boolean(provider.has_pending_key);
	if (filter === 'no_key') {
		return !providerHasApiKey(provider) && !provider.has_pending_key;
	}
	return getProviderProtocolSummaries(provider).some((protocol) => protocol.key === filter);
}

export function suggestDuplicateProviderId(
	sourceId: string,
	existingIds: Set<string>
): string {
	const base = `${sourceId}-copy`;
	if (!existingIds.has(base)) return base;
	for (let n = 2; n < 1000; n++) {
		const candidate = `${base}-${n}`;
		if (!existingIds.has(candidate)) return candidate;
	}
	return "";
}

/** 某协议 Advanced 区是否有任意覆盖（用于默认展开）。 */
export function protocolFormHasOverrides(
	protocol: UpstreamProtocol,
	form: ProtocolEndpointForm
): boolean {
	if (protocol === "openai") {
		return !!(
			form.chat.trim() ||
			form.responses.trim() ||
			form.images_generations.trim() ||
			form.images_edits.trim() ||
			form.audio_transcriptions.trim() ||
			form.audio_speech.trim()
		);
	}
	if (protocol === 'anthropic') return !!form.messages.trim();
	if (protocol === "gemini") {
		return !!(
			form.modelsGenerate.trim() ||
			form.legacyPerAction ||
			form.generateContent.trim() ||
			form.streamGenerateContent.trim()
		);
	}
	return !!(
		form.audio_transcriptions.trim() ||
		form.audio_transcriptions_multimodal.trim() ||
		form.audio_transcriptions_tasks.trim() ||
		form.audio_speech.trim() ||
		form.audio_speech_multimodal.trim() ||
		form.audio_realtime_inference.trim() ||
		form.audio_realtime_session.trim() ||
		form.audio_hotwords.trim() ||
		form.audio_voices.trim()
	);
}

export function protocolFormIsConfigured(
	protocol: UpstreamProtocol,
	form: ProtocolEndpointForm
): boolean {
	return Boolean(form.base.trim()) || protocolFormHasOverrides(protocol, form);
}
