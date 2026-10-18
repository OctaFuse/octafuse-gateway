import { maskProviderApiKeyForAdmin } from "@octafuse/core/db/provider-key-utils";
import type { GatewayProvider } from "@/lib/types";
import {
	listConfiguredCapabilities,
	parseProviderEndpoints,
	resolveUpstreamEndpoint,
	serializeProviderEndpoints,
	type ProviderEndpointCapability,
	type ProviderEndpointsMap,
	type ProtocolEndpointsConfig,
} from "@octafuse/core/provider-endpoints";
import { GEMINI_GENERATE_OPERATION } from "@octafuse/core/route-topology";
import type { UpstreamProtocol } from "@octafuse/core/upstream-protocol";
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
import { PROVIDER_ENDPOINT_FIELDS } from "./provider-endpoint-fields";

/** Fixed-width middle mask; never show short credentials or private service-account fields. */
export function providerApiKeyPreview(apiKey: string): string {
	if (!apiKey.trim()) return "";
	const masked = maskProviderApiKeyForAdmin(apiKey);
	const hidden = "••••••••••••";
	return masked === "***" ? hidden : masked.replace("…", hidden);
}

/** 完整 capability → 卡片紧凑标签（OpenAI images.* → images；audio.transcriptions → audio）。 */
export function capabilityDisplayBadges(
	capabilities: readonly ProviderEndpointCapability[]
): ProviderCapabilityBadge[] {
	const badges: ProviderCapabilityBadge[] = [];
	const set = new Set(capabilities);
	if (set.has("chat")) badges.push("chat");
	if (set.has("responses")) badges.push("responses");
	if (
		set.has("images.generations") ||
		set.has("images.edits") ||
		set.has("images.generations.multimodal")
	) {
		badges.push("images");
	}
	if (capabilities.some((capability) => capability.startsWith("audio.")))
		badges.push("audio");
	if (set.has("embeddings")) badges.push("embeddings");
	if (set.has("messages")) badges.push("messages");
	if (
		set.has(GEMINI_GENERATE_OPERATION) ||
		set.has("generateContent") ||
		set.has("streamGenerateContent")
	) {
		badges.push("modelsGenerate");
	}
	if (set.has("models.embed")) badges.push("modelsEmbed");
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
	const t1 = asTemplate(gen, "generateContent");
	const t2 = asTemplate(stream, "streamGenerateContent");
	if (t1 && t2 && t1 === t2) return t1;
	return null;
}

function protocolFormFromConfig(
	cfg: ProtocolEndpointsConfig | undefined
): ProtocolEndpointForm {
	const form: ProtocolEndpointForm = {
		...EMPTY_PROTOCOL_FORM,
		legacyPerAction: null,
	};
	if (!cfg) return form;
	form.base = cfg.base ?? "";
	form.auth = cfg.auth ?? "auto";
	const eps = cfg.endpoints ?? {};
	form.chat = eps.chat ?? "";
	form.responses = eps.responses ?? "";
	form.images_generations = eps["images.generations"] ?? "";
	form.images_generations_multimodal =
		eps["images.generations.multimodal"] ?? "";
	form.images_edits = eps["images.edits"] ?? "";
	form.embeddings = eps.embeddings ?? "";
	form.modelsEmbed = eps["models.embed"] ?? "";
	form.audio_transcriptions = eps["audio.transcriptions"] ?? "";
	form.audio_transcriptions_multimodal =
		eps["audio.transcriptions.multimodal"] ?? "";
	form.audio_transcriptions_tasks = eps["audio.transcriptions.tasks"] ?? "";
	form.audio_speech = eps["audio.speech"] ?? "";
	form.audio_speech_realtime = eps["audio.speech.realtime"] ?? "";
	form.audio_transcriptions_realtime =
		eps["audio.transcriptions.realtime"] ?? "";
	form.audio_speech_multimodal = eps["audio.speech.multimodal"] ?? "";
	form.audio_realtime_inference = eps["audio.realtime.inference"] ?? "";
	form.audio_realtime_session = eps["audio.realtime.session"] ?? "";
	form.audio_hotwords = eps["audio.hotwords"] ?? "";
	form.audio_voices = eps["audio.voices"] ?? "";
	form.messages = eps.messages ?? "";

	const family = eps[GEMINI_GENERATE_OPERATION]?.trim() ?? "";
	const legacyGen = eps.generateContent?.trim() ?? "";
	const legacyStream = eps.streamGenerateContent?.trim() ?? "";
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

/** Provider 行 → 弹窗表单；真实密钥由编辑器单独加载。 */
export function providerToFormData(
	provider: GatewayProvider
): Omit<ProviderFormData, "id" | "name" | "note"> {
	const map = parseProviderEndpoints(provider);
	return {
		api_key: "",
		kind: provider.kind?.trim() || "",
		status: provider.status === "disabled" ? "disabled" : "active",
		openai: protocolFormFromConfig(map.openai),
		anthropic: protocolFormFromConfig(map.anthropic),
		gemini: protocolFormFromConfig(map.gemini),
		dashscope: protocolFormFromConfig(map.dashscope),
		minimax: protocolFormFromConfig(map.minimax),
		volcengine: protocolFormFromConfig(map.volcengine),
		elevenlabs: protocolFormFromConfig(map.elevenlabs),
	};
}

function configFromProtocolForm(
	protocol: UpstreamProtocol,
	form: ProtocolEndpointForm
): ProtocolEndpointsConfig | undefined {
	const base = form.mode === "partial" ? "" : form.base.trim();
	const endpoints: NonNullable<ProtocolEndpointsConfig["endpoints"]> = {};
	if (form.mode !== "all") {
		for (const { field, capability } of PROVIDER_ENDPOINT_FIELDS[protocol]) {
			if (
				protocol === "gemini" &&
				field === "modelsGenerate" &&
				form.legacyPerAction
			) {
				const { generateContent, streamGenerateContent } = form.legacyPerAction;
				if (generateContent.trim())
					endpoints.generateContent = generateContent.trim();
				if (streamGenerateContent.trim())
					endpoints.streamGenerateContent = streamGenerateContent.trim();
			} else if (form[field].trim()) {
				endpoints[capability] = form[field].trim();
			}
		}
	}
	if (!base && Object.keys(endpoints).length === 0) return undefined;
	const cfg: ProtocolEndpointsConfig = {};
	if (base) cfg.base = base;
	if (Object.keys(endpoints).length > 0) cfg.endpoints = endpoints;
	if (
		protocol === "gemini" &&
		(form.auth === "query-key" || form.auth === "bearer")
	) {
		cfg.auth = form.auth;
	}
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
	const minimax = configFromProtocolForm("minimax", form.minimax);
	const volcengine = configFromProtocolForm("volcengine", form.volcengine);
	const elevenlabs = configFromProtocolForm("elevenlabs", form.elevenlabs);
	if (openai) map.openai = openai;
	if (anthropic) map.anthropic = anthropic;
	if (gemini) map.gemini = gemini;
	if (dashscope) map.dashscope = dashscope;
	if (minimax) map.minimax = minimax;
	if (volcengine) map.volcengine = volcengine;
	if (elevenlabs) map.elevenlabs = elevenlabs;
	return map;
}

export function formDataToEndpointsJson(form: ProviderFormData): string | null {
	return serializeProviderEndpoints(formDataToEndpointsMap(form));
}

export function protocolSummariesFromEndpoints(
	endpoints: GatewayProvider["endpoints"],
	providerId = ""
): ProviderProtocolSummary[] {
	const map = parseProviderEndpoints({ endpoints });
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
					model: "{model}",
					action: key === "gemini" ? "generateContent" : undefined,
					// 异步任务 URL 必须保留任务占位符，供应商卡片才能展示完整端点。
					taskId: key === "dashscope" ? "{task_id}" : undefined,
					// ElevenLabs 文本转语音的音色是路径参数，卡片上保留占位符。
					voiceId: key === "elevenlabs" ? "{voice_id}" : undefined,
					providerId,
				})
					.replace(/%7Bmodel%7D/gi, "{model}")
					.replace(/%7Btask_id%7D/gi, "{task_id}")
					.replace(/%7Bvoice_id%7D/gi, "{voice_id}")
					.replace(/:generateContent$/i, ":{action}");
				const override =
					Boolean(config.endpoints?.[capability]) ||
					(key === "gemini" &&
						(Boolean(config.endpoints?.[GEMINI_GENERATE_OPERATION]) ||
							Boolean(config.endpoints?.generateContent) ||
							Boolean(config.endpoints?.streamGenerateContent)));
				return [
					{
						capability,
						url: resolved,
						source: override ? ("override" as const) : ("base" as const),
					},
				];
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
	appendProtocol("minimax", "MiniMax");
	appendProtocol("volcengine", "Volcengine");
	appendProtocol("elevenlabs", "ElevenLabs");
	return rows;
}

export function getProviderProtocolSummaries(
	provider: GatewayProvider
): ProviderProtocolSummary[] {
	return protocolSummariesFromEndpoints(provider.endpoints, provider.id);
}

export function providerHasApiKey(provider: GatewayProvider): boolean {
	const masked = provider.api_key?.trim() || "";
	return Boolean(masked) && masked !== "(empty)" && !provider.has_pending_key;
}

/** 只反映密钥是否已填写，与供应商启用/停用无关。 */
export function getProviderKeyStatus(
	provider: GatewayProvider
): Exclude<ProviderKeyStatusKind, "disabled"> {
	if (provider.has_pending_key) return "pending";
	if (!providerHasApiKey(provider)) return "no_key";
	return "key_set";
}

export function providerMatchesSearch(
	provider: GatewayProvider,
	query: string
): boolean {
	const normalized = query.trim().toLowerCase();
	if (!normalized) return true;
	const endpointSearch = getProviderProtocolSummaries(provider)
		.flatMap((protocol) => [
			protocol.label,
			protocol.baseUrl ?? "",
			...protocol.capabilities,
			...protocol.endpoints.map((endpoint) => endpoint.url),
		])
		.join(" ");
	return [
		provider.name,
		provider.id,
		provider.note ?? "",
		provider.kind_descriptions?.en ?? "",
		provider.kind_descriptions?.zh ?? "",
		provider.kind_descriptions?.ja ?? "",
		provider.kind_descriptions?.ko ?? "",
		provider.status ?? "",
		endpointSearch,
	]
		.join(" ")
		.toLowerCase()
		.includes(normalized);
}

/** 与官方模板有差异，或 kind 已不在官方模板中（需要处理）。 */
export function providerHasOfficialUpdate(provider: GatewayProvider): boolean {
	return (
		Number(provider.official_update_count ?? 0) > 0 ||
		Boolean(provider.kind_orphaned)
	);
}

export function providerMatchesListFilter(
	provider: GatewayProvider,
	filter: ProviderListFilter
): boolean {
	if (filter === "all") return true;
	if (filter === "active") return provider.status !== "disabled";
	if (filter === "disabled") return provider.status === "disabled";
	if (filter === "pending") return Boolean(provider.has_pending_key);
	if (filter === "no_key") {
		return !providerHasApiKey(provider) && !provider.has_pending_key;
	}
	if (filter === "outdated") return providerHasOfficialUpdate(provider);
	return getProviderProtocolSummaries(provider).some(
		(protocol) => protocol.key === filter
	);
}

/** 原始单项地址是否存在；包括未启用模式的草稿。 */
export function protocolFormHasOverrides(
	protocol: UpstreamProtocol,
	form: ProtocolEndpointForm
): boolean {
	return (
		PROVIDER_ENDPOINT_FIELDS[protocol].some(({ field }) =>
			Boolean(form[field].trim())
		) ||
		(protocol === "gemini" && Boolean(form.legacyPerAction))
	);
}

export function getProtocolEndpointMode(
	protocol: UpstreamProtocol,
	form: ProtocolEndpointForm
): "all" | "partial" {
	return (
		form.mode ?? (protocolFormHasOverrides(protocol, form) ? "partial" : "all")
	);
}

/** Materialize Base URL fallbacks without changing existing custom URLs or templates. */
export function partialProtocolForm(
	protocol: UpstreamProtocol,
	form: ProtocolEndpointForm
): ProtocolEndpointForm {
	if (form.partialDraftReady || form.mode === "partial" || !form.base.trim())
		return form;
	const next = { ...form };
	const baseMap = { [protocol]: { base: form.base.trim() } };
	const derived = (
		capability: ProviderEndpointCapability,
		action = "generateContent"
	) => {
		try {
			return resolveUpstreamEndpoint(protocol, capability, baseMap, {
				model: "{model}",
				action: capability === "models.embed" ? "embedContent" : action,
				taskId: "{task_id}",
				voiceId: "{voice_id}",
			})
				.replace(/%7B(model|task_id|voice_id)%7D/gi, "{$1}")
				.replace(
					/:(generateContent|streamGenerateContent|embedContent)$/,
					":{action}"
				);
		} catch {
			// Incomplete/invalid Base URLs remain editable; do not invent a usable endpoint.
			return "";
		}
	};
	for (const { field, capability } of PROVIDER_ENDPOINT_FIELDS[protocol]) {
		if (
			protocol === "gemini" &&
			field === "modelsGenerate" &&
			next.legacyPerAction
		) {
			next.legacyPerAction = { ...next.legacyPerAction };
			for (const action of [
				"generateContent",
				"streamGenerateContent",
			] as const) {
				if (!next.legacyPerAction[action].trim()) {
					next.legacyPerAction[action] = derived(capability, action).replace(
						"{action}",
						action
					);
				}
			}
		} else if (!next[field].trim()) {
			next[field] = derived(capability);
		}
	}
	return next;
}

export function switchProtocolEndpointMode(
	protocol: UpstreamProtocol,
	form: ProtocolEndpointForm,
	mode: "all" | "partial"
): ProtocolEndpointForm {
	return {
		...partialProtocolForm(protocol, form),
		mode,
		partialDraftReady: true,
	};
}

export function protocolFormIsConfigured(
	protocol: UpstreamProtocol,
	form: ProtocolEndpointForm
): boolean {
	return Boolean(configFromProtocolForm(protocol, form));
}
