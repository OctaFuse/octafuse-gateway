import {
	isAudioModel,
	isAudioSpeechModel,
	isAudioTranscriptionModel,
	isImageGenerationModel,
	isTextLlmModel,
} from '@octafuse/core/db/model-modalities';
import {
	DEFAULT_ROUTE_STRATEGY,
	isRouteStrategyName,
	parseModelRoutePolicy,
	routePolicyRuleKey,
} from '@octafuse/core/db/model-route-policy';
import { parseRoutePoolTierStrategies } from '@octafuse/core/db/route-pool-tier-strategies';
import {
	ANTHROPIC_ENDPOINT_CAPABILITIES,
	DASHSCOPE_ENDPOINT_CAPABILITIES,
	GEMINI_ENDPOINT_CAPABILITIES,
	OPENAI_ENDPOINT_CAPABILITIES,
	listConfiguredCapabilities,
	parseProviderEndpoints,
	type ProviderEndpointCapability,
} from '@octafuse/core/provider-endpoints';
import {
	isRouteAdapterCompatible,
	REQUEST_OPERATIONS_BY_PROTOCOL,
	ROUTE_ADAPTERS,
} from '@octafuse/core/route-topology';
import {
	findDailyWindowOverlap,
	parseHhMmToMinutes,
	parseRouteBaseFactors,
	parseRoutePricingSchedule,
	type DailyScheduleWindow,
} from '@octafuse/core/db/pricing-schedule';
import { compareModelsByReleasedAtDesc } from '@/lib/model-catalog-sort';
import { getModelVendorLabel, normalizeModelVendorInput } from '@/lib/model-vendor';
import { compareRouteGroupsForDisplay, normalizeRouteGroup } from '@/lib/route-group-ui';
import { UPSTREAM_PROTOCOLS, isUpstreamProtocol, type UpstreamProtocol } from '@/lib/upstream-protocol';
import type { GatewayModel, GatewayModelRoute, GatewayProvider } from '@/lib/types';
import {
	DEFAULT_ROUTE_KIND_FILTER,
	FACTOR_CHIP_BASE,
	PROTOCOL_DISPLAY_LABEL,
	type RouteFormData,
	type RouteKindFilter,
	type RouteListRow,
	type RouteProtocolGroupSection,
	type RouteScheduleFormSide,
	type RouteStrategySource,
} from './types';

export function compareRouteProtocolsForDisplay(a: string, b: string): number {
	const knownA = isUpstreamProtocol(a);
	const knownB = isUpstreamProtocol(b);
	if (knownA && knownB) {
		return (UPSTREAM_PROTOCOLS as readonly string[]).indexOf(a) - (UPSTREAM_PROTOCOLS as readonly string[]).indexOf(b);
	}
	if (knownA !== knownB) return knownA ? -1 : 1;
	return a.localeCompare(b, undefined, { sensitivity: 'base' });
}

export function getProtocolDisplayLabel(protocol: string): string {
	return PROTOCOL_DISPLAY_LABEL[protocol] ?? protocol;
}

/** 将公开协议操作映射为客户端实际调用路径，避免把带点的操作名直接拼进 URL。 */
export function requestSurfacePath(protocol: string, operation: string, modelId: string): string {
	if (protocol === 'openai') {
		const paths: Record<string, string> = {
			chat: '/v1/chat/completions',
			responses: '/v1/responses',
			'images.generations': '/v1/images/generations',
			'images.edits': '/v1/images/edits',
			'audio.transcriptions': '/v1/audio/transcriptions',
			'audio.speech': '/v1/audio/speech',
		};
		return operation === '*' ? '/v1/*' : paths[operation] ?? `/v1/${operation}`;
	}
	if (protocol === 'anthropic') {
		return operation === '*' ? '/v1/*' : '/v1/messages';
	}
	if (protocol === 'gemini') {
		// `models.generate` 是路由族标识；真实客户端仍使用两种 Gemini wire action。
		if (operation === 'models.generate') {
			return `/v1beta/models/${modelId}:{generateContent|streamGenerateContent}`;
		}
		return `/v1beta/models/${modelId}:${operation}`;
	}
	if (protocol === 'dashscope' && operation.includes('.realtime.')) {
		// 原生实时操作共享一个 WSS 入口，模型与操作通过查询参数选择。
		return `/v1/dashscope/realtime?model=${encodeURIComponent(modelId)}&operation=${encodeURIComponent(operation)}`;
	}
	return operation === '*' ? '/*' : `/${operation}`;
}

export type EffectiveRouteStrategy = {
	strategy: string;
	source: RouteStrategySource;
	inherited: boolean;
};

/**
 * Mirrors the proxy's route strategy resolution order so the admin UI can show
 * both the configured value and the value that will actually take effect.
 *
 * When `priority` is provided, `poolTierStrategies[priority]` wins first
 * (source `'tier'`).
 */
export function resolveEffectiveRouteStrategy(params: {
	poolStrategy?: string | null;
	poolTierStrategies?: string | null;
	priority?: number;
	routePolicyRaw?: string | null;
	protocol: string;
	requestOperation?: string | null;
	routeGroup: string;
	globalStrategy?: string | null;
}): EffectiveRouteStrategy {
	if (params.priority !== undefined) {
		const tierMap = parseRoutePoolTierStrategies(params.poolTierStrategies);
		const tierStrategy = tierMap.get(params.priority);
		if (tierStrategy) {
			return { strategy: tierStrategy, source: 'tier', inherited: false };
		}
	}

	if (params.poolStrategy && isRouteStrategyName(params.poolStrategy)) {
		return {
			strategy: params.poolStrategy,
			source: 'pool',
			inherited: params.priority !== undefined,
		};
	}

	const policy = parseModelRoutePolicy(params.routePolicyRaw);
	const operation = params.requestOperation?.trim();
	if (operation && operation !== '*') {
		const operationStrategy = policy?.rules.get(
			routePolicyRuleKey(params.protocol, operation, params.routeGroup),
		)?.strategy;
		if (operationStrategy) {
			return {
				strategy: operationStrategy,
				source: 'modelOperation',
				inherited: true,
			};
		}
	}

	const protocolStrategy = policy?.rules.get(routePolicyRuleKey(params.protocol, null, params.routeGroup))?.strategy;
	if (protocolStrategy) {
		return {
			strategy: protocolStrategy,
			source: 'modelProtocol',
			inherited: true,
		};
	}
	if (policy?.strategy) {
		return { strategy: policy.strategy, source: 'model', inherited: true };
	}
	if (params.globalStrategy && isRouteStrategyName(params.globalStrategy)) {
		return {
			strategy: params.globalStrategy,
			source: 'global',
			inherited: true,
		};
	}
	return {
		strategy: DEFAULT_ROUTE_STRATEGY,
		source: 'default',
		inherited: true,
	};
}

export function protocolBadgeClass(protocol: string): string {
	if (protocol === 'openai') {
		return 'bg-emerald-50 text-emerald-800 ring-emerald-200';
	}
	if (protocol === 'anthropic') {
		return 'bg-orange-50 text-orange-800 ring-orange-200';
	}
	if (protocol === 'gemini') {
		return 'bg-indigo-50 text-indigo-800 ring-indigo-200';
	}
	return 'bg-amber-50 text-amber-900 ring-amber-200';
}

type RouteSurfaceSummary = {
	id?: string;
	request_protocol?: string;
	request_operation?: string;
	status?: string;
};

function parseRouteSurfaces(raw: string | null | undefined): RouteSurfaceSummary[] {
	if (!raw) return [];
	try {
		const parsed = JSON.parse(raw) as unknown;
		return Array.isArray(parsed)
			? parsed.filter((entry): entry is RouteSurfaceSummary => Boolean(entry && typeof entry === 'object'))
			: [];
	} catch {
		return [];
	}
}

export function splitRoutesByProtocolAndRouteGroup<
	T extends {
		upstream_protocol: string;
		route_group?: string | null;
		route_pool_id?: string | null;
		pool_name?: string | null;
		pool_strategy?: string | null;
		pool_tier_strategies?: string | null;
		surfaces?: string | null;
	},
>(routes: T[]): RouteProtocolGroupSection<T>[] {
	const bySection = new Map<string, RouteProtocolGroupSection<T>>();
	for (const r of routes) {
		const g = normalizeRouteGroup(r.route_group);
		const surfaces = parseRouteSurfaces(r.surfaces);
		const entries =
			surfaces.length > 0
				? surfaces
				: [
						{
							request_protocol: r.upstream_protocol,
							request_operation: '*',
							status: 'active',
						},
				  ];
		for (const surface of entries) {
			if (surface.status === 'disabled') continue;
			const protocol = String(surface.request_protocol ?? r.upstream_protocol)
				.trim()
				.toLowerCase();
			const requestOperation = String(surface.request_operation ?? '*');
			const key = `${r.route_pool_id ?? 'legacy'}\u0000${surface.id ?? `${protocol}:${requestOperation}`}\u0000${g}`;
			const section = bySection.get(key) ?? {
				key,
				protocol,
				protocolLabel: getProtocolDisplayLabel(protocol),
				requestOperation,
				surfaceId: surface.id ?? null,
				poolId: r.route_pool_id ?? null,
				poolName: r.pool_name ?? null,
				poolStrategy: r.pool_strategy ?? null,
				poolTierStrategies: r.pool_tier_strategies ?? null,
				group: g,
				routes: [],
			};
			section.routes.push(r);
			bySection.set(key, section);
		}
	}
	return [...bySection.values()].sort((a, b) => {
		const protocolCmp = compareRouteProtocolsForDisplay(a.protocol, b.protocol);
		if (protocolCmp !== 0) return protocolCmp;
		return compareRouteGroupsForDisplay(a.group, b.group);
	});
}

/** Same-priority layer: active first, then weight DESC, then name / id. */
export function compareRoutesWithinPriorityLayer(
	a: Pick<GatewayModelRoute, 'status' | 'weight' | 'provider_model_name' | 'id'>,
	b: Pick<GatewayModelRoute, 'status' | 'weight' | 'provider_model_name' | 'id'>,
): number {
	const enabledA = a.status === 'active' ? 1 : 0;
	const enabledB = b.status === 'active' ? 1 : 0;
	if (enabledB !== enabledA) return enabledB - enabledA;
	const dw = (b.weight ?? 1) - (a.weight ?? 1);
	if (dw !== 0) return dw;
	const nameCmp = a.provider_model_name.localeCompare(b.provider_model_name, undefined, {
		sensitivity: 'base',
	});
	if (nameCmp !== 0) return nameCmp;
	return a.id.localeCompare(b.id, undefined, { sensitivity: 'base' });
}

export function compareModelRoutesForCardDisplay(
	a: Pick<GatewayModelRoute, 'upstream_protocol' | 'priority' | 'status' | 'weight' | 'provider_model_name' | 'id'>,
	b: Pick<GatewayModelRoute, 'upstream_protocol' | 'priority' | 'status' | 'weight' | 'provider_model_name' | 'id'>,
): number {
	const knownA = isUpstreamProtocol(a.upstream_protocol);
	const knownB = isUpstreamProtocol(b.upstream_protocol);
	if (knownA && knownB) {
		const ia = (UPSTREAM_PROTOCOLS as readonly string[]).indexOf(a.upstream_protocol);
		const ib = (UPSTREAM_PROTOCOLS as readonly string[]).indexOf(b.upstream_protocol);
		if (ia !== ib) return ia - ib;
	} else if (knownA !== knownB) {
		return knownA ? -1 : 1;
	} else {
		const protoCmp = a.upstream_protocol.localeCompare(b.upstream_protocol, undefined, {
			sensitivity: 'base',
		});
		if (protoCmp !== 0) return protoCmp;
	}
	const dp = b.priority - a.priority;
	if (dp !== 0) return dp;
	return compareRoutesWithinPriorityLayer(a, b);
}

export function compareModelVendorsForDisplay(a: string, b: string): number {
	if (a === 'other') return 1;
	if (b === 'other') return -1;
	return getModelVendorLabel(a).localeCompare(getModelVendorLabel(b), undefined, {
		sensitivity: 'base',
	});
}

export function formatFactorValue(n: number): string {
	if (!Number.isFinite(n)) return '—';
	if (Number.isInteger(n)) return String(n);
	return String(Number(n.toFixed(6)));
}

export function formatFactorValueForChip(n: number): string {
	if (!Number.isFinite(n)) return '—';
	return n.toFixed(2);
}

export function formatFactorMultiplier(value: number): string {
	return `×${formatFactorValue(value)}`;
}

export function formatFactorMultiplierForChip(value: number): string {
	return `×${formatFactorValueForChip(value)}`;
}

export function chargedFactorTooltip(value: number | null): string {
	if (value == null) {
		return 'Charged factor: not set · customer billing multiplier vs catalog price';
	}
	return `Charged factor: ${formatFactorMultiplier(value)} · customer billing multiplier vs catalog price`;
}

export function meteredFactorTooltip(value: number | null): string {
	if (value == null) {
		return 'Metered factor: not set · provider cost multiplier vs catalog price';
	}
	return `Metered factor: ${formatFactorMultiplier(value)} · provider cost multiplier vs catalog price`;
}

export type RouteFactorKind = 'charged' | 'metered';

export type RouteFactorLevel = 'invalid' | 'zero' | 'veryLow' | 'low' | 'baseline' | 'high' | 'veryHigh';

/**
 * Keep small pricing fluctuations visually quiet, then increase emphasis when a
 * factor moves farther away from the catalog baseline.
 */
export function factorLevelForValue(n: number): RouteFactorLevel {
	if (!Number.isFinite(n) || n < 0) return 'invalid';
	if (n === 0) return 'zero';
	if (n < 0.8) return 'veryLow';
	if (n < 0.95) return 'low';
	if (n <= 1.05) return 'baseline';
	if (n <= 1.2) return 'high';
	return 'veryHigh';
}

export function factorChipClassForValue(n: number, kind: RouteFactorKind): string {
	const level = factorLevelForValue(n);
	if (level === 'invalid' || level === 'zero') {
		return `${FACTOR_CHIP_BASE} bg-rose-100 text-rose-950 ring-rose-300/90`;
	}
	if (level === 'baseline') {
		return `${FACTOR_CHIP_BASE} bg-zinc-100 text-zinc-700 ring-zinc-200/90`;
	}
	if (level === 'veryHigh') {
		return `${FACTOR_CHIP_BASE} bg-rose-100 text-rose-950 ring-rose-300/90`;
	}
	if (level === 'high') {
		return `${FACTOR_CHIP_BASE} bg-amber-100 text-amber-950 ring-amber-300/90`;
	}

	if (kind === 'charged') {
		return level === 'veryLow'
			? `${FACTOR_CHIP_BASE} bg-orange-100 text-orange-950 ring-orange-300/90`
			: `${FACTOR_CHIP_BASE} bg-sky-100 text-sky-900 ring-sky-300/90`;
	}
	return level === 'veryLow'
		? `${FACTOR_CHIP_BASE} bg-emerald-200 text-emerald-950 ring-emerald-400/80`
		: `${FACTOR_CHIP_BASE} bg-emerald-100 text-emerald-900 ring-emerald-300/90`;
}

/** Base factors only; schedule windows may change the effective relationship. */
export function hasBasePricingInversion(charged: number, metered: number): boolean {
	return (
		Number.isFinite(charged) && Number.isFinite(metered) && charged >= 0 && metered >= 0 && charged + 1e-6 < metered
	);
}

function parseNonNegativeFactorText(text: string, fieldLabel: string): number {
	const trimmed = text.trim();
	const n = trimmed === '' ? 1 : Number(trimmed);
	if (!Number.isFinite(n) || n < 0) {
		throw new Error(`${fieldLabel} must be a number ≥ 0`);
	}
	return n;
}

function validateScheduleSide(windows: RouteScheduleFormSide, sideLabel: string): DailyScheduleWindow[] {
	const cleaned: DailyScheduleWindow[] = [];
	for (let i = 0; i < windows.length; i++) {
		const w = windows[i]!;
		const start = String(w.start ?? '').trim();
		const end = String(w.end ?? '').trim();
		const factorText = w.factor.trim();
		const factor = factorText === '' ? Number.NaN : Number(factorText);
		if (!start || !end) {
			throw new Error(`${sideLabel} window ${i + 1}: start and end are required (HH:mm)`);
		}
		const startMinutes = parseHhMmToMinutes(start);
		const endMinutes = parseHhMmToMinutes(end);
		if (startMinutes == null || startMinutes === 24 * 60 || endMinutes == null || startMinutes === endMinutes) {
			throw new Error(
				`${sideLabel} window ${i + 1}: start must be HH:mm, end may also be 24:00, and duration must be non-zero`,
			);
		}
		if (!Number.isFinite(factor) || factor < 0) {
			throw new Error(`${sideLabel} window ${i + 1}: factor must be a number ≥ 0`);
		}
		cleaned.push({ start, end, factor });
	}
	const overlap = findDailyWindowOverlap(cleaned);
	if (overlap) {
		throw new Error(`${sideLabel}: ${overlap}`);
	}
	return cleaned;
}

export function buildFormDataFromRoute(route: GatewayModelRoute, _models: GatewayModel[]): RouteFormData {
	const factors = parseRouteBaseFactors(route.price_override ?? null);
	const schedule = parseRoutePricingSchedule(route.price_override ?? null);
	return {
		model_id: route.model_id,
		provider_id: route.provider_id,
		provider_model_name: route.provider_model_name,
		request_protocol: (() => {
			const [surface] = parseRouteSurfaces(route.surfaces);
			return typeof surface?.request_protocol === 'string' && isUpstreamProtocol(surface.request_protocol)
				? surface.request_protocol
				: isUpstreamProtocol(route.upstream_protocol)
				? route.upstream_protocol
				: 'openai';
		})(),
		request_operation: parseRouteSurfaces(route.surfaces)[0]?.request_operation ?? '*',
		upstream_protocol: (isUpstreamProtocol(route.upstream_protocol)
			? route.upstream_protocol
			: 'openai') as UpstreamProtocol,
		upstream_operation: route.upstream_operation ?? '*',
		adapter: route.adapter ?? 'passthrough',
		priority: route.priority,
		weight: Number(route.weight ?? 1) || 1,
		custom_params_json: route.custom_params ?? '',
		route_group: route.route_group ?? 'default',
		charged_factor: String(factors.chargedFactor),
		metered_factor: String(factors.meteredFactor),
		schedule_charged: schedule.charged.map((w) => ({
			...w,
			factor: String(w.factor),
		})),
		schedule_metered: schedule.metered.map((w) => ({
			...w,
			factor: String(w.factor),
		})),
	};
}

export function buildRouteSavePayload(
	formData: RouteFormData,
	editingRoute: GatewayModelRoute | null,
): Record<string, unknown> {
	const normalizeJsonText = (raw: string, fieldName: string): string | null => {
		const text = raw.trim();
		if (!text) return null;
		const parsed = JSON.parse(text) as unknown;
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
			throw new Error(`${fieldName} must be a JSON object`);
		}
		return JSON.stringify(parsed);
	};

	const chargedFactor = parseNonNegativeFactorText(formData.charged_factor, 'Charged factor');
	const meteredFactor = parseNonNegativeFactorText(formData.metered_factor, 'Metered factor');
	const scheduleCharged = validateScheduleSide(formData.schedule_charged, 'Charged schedule');
	const scheduleMetered = validateScheduleSide(formData.schedule_metered, 'Metered schedule');

	const priceOverride: Record<string, unknown> = {
		charged_factor: chargedFactor,
		metered_factor: meteredFactor,
	};
	if (scheduleCharged.length > 0 || scheduleMetered.length > 0) {
		priceOverride.schedule = {
			...(scheduleCharged.length > 0 ? { charged: scheduleCharged } : {}),
			...(scheduleMetered.length > 0 ? { metered: scheduleMetered } : {}),
		};
	}

	const payload: Record<string, unknown> = {
		model_id: formData.model_id,
		provider_id: formData.provider_id,
		provider_model_name: formData.provider_model_name,
		request_protocol: formData.request_protocol,
		request_operation: formData.request_operation,
		upstream_protocol: formData.upstream_protocol,
		upstream_operation: formData.upstream_operation,
		adapter: formData.adapter,
		priority: formData.priority,
		weight: Math.max(1, Math.floor(Number(formData.weight) || 1)),
		route_group: formData.route_group.trim() || 'default',
		price_override: JSON.stringify(priceOverride),
		custom_params: normalizeJsonText(formData.custom_params_json, 'custom_params'),
	};
	if (!editingRoute) {
		payload.status = 'inactive';
	}
	return payload;
}

export const CAPABILITIES_BY_PROTOCOL: Record<string, readonly ProviderEndpointCapability[]> = {
	openai: OPENAI_ENDPOINT_CAPABILITIES,
	anthropic: ANTHROPIC_ENDPOINT_CAPABILITIES,
	gemini: GEMINI_ENDPOINT_CAPABILITIES,
	dashscope: DASHSCOPE_ENDPOINT_CAPABILITIES,
};

/** Public operations that make sense for the selected model modality. */
export function requestOperationsForModel(
	model: GatewayModel | undefined,
	protocol: UpstreamProtocol,
): readonly string[] {
	if (model && isImageGenerationModel(model)) {
		return protocol === 'openai' ? ['images.generations', 'images.edits'] : [];
	}
	if (model && isAudioTranscriptionModel(model)) {
		if (protocol === 'openai') return ['audio.transcriptions'];
		if (protocol === 'dashscope') {
			return ['audio.transcriptions.realtime.inference', 'audio.transcriptions.realtime.session'];
		}
		return [];
	}
	if (model && isAudioSpeechModel(model)) {
		if (protocol === 'openai') return ['audio.speech'];
		if (protocol === 'dashscope') {
			// Qwen-Audio-TTS/CosyVoice 实时接口使用 inference 任务协议；
			// Qwen-TTS-Realtime session 不在本项目支持范围内。
			return ['audio.speech.realtime.inference'];
		}
		return [];
	}
	if (model && isTextLlmModel(model) && protocol === 'openai') {
		return ['chat', 'responses'];
	}
	return REQUEST_OPERATIONS_BY_PROTOCOL[protocol];
}

export type DashScopeTtsRoutePreset = 'realtime' | 'nonrealtime';

/**
 * 将 DashScope TTS 的用户意图转换为完整路由拓扑。
 * 非实时模式保持 OpenAI 兼容入口，实时模式使用网关原生 DashScope WSS 入口。
 */
export function applyDashScopeTtsRoutePreset(formData: RouteFormData, preset: DashScopeTtsRoutePreset): RouteFormData {
	if (preset === 'nonrealtime') {
		return {
			...formData,
			request_protocol: 'openai',
			request_operation: 'audio.speech',
			upstream_protocol: 'dashscope',
			upstream_operation: 'audio.speech',
			adapter: 'dashscope-tts-speech',
		};
	}
	return {
		...formData,
		request_protocol: 'dashscope',
		request_operation: 'audio.speech.realtime.inference',
		upstream_protocol: 'dashscope',
		upstream_operation: 'audio.speech.realtime.inference',
		adapter: 'passthrough',
	};
}

/**
 * Provider-side operations supported by both the provider endpoint config and
 * the selected model modality. A protocol base enables its standard derived
 * capabilities; otherwise only explicitly configured capability URLs qualify.
 */
export function upstreamOperationsForProviderModel(
	provider: GatewayProvider | undefined,
	model: GatewayModel | undefined,
	protocol: UpstreamProtocol,
): readonly string[] {
	if (!provider) return [];
	const map = parseProviderEndpoints(provider);
	if (!map[protocol]) return [];
	const providerOperations = listConfiguredCapabilities(map, protocol);
	const capabilities = new Set(providerOperations);

	// DashScope 路由能力表示协议生命周期，供应商能力表示具体端点；此处显式映射。
	if (model && isAudioTranscriptionModel(model)) {
		if (protocol === 'openai') {
			return capabilities.has('audio.transcriptions') ? ['audio.transcriptions'] : [];
		}
		if (protocol === 'dashscope') {
			const operations: string[] = [];
			if (capabilities.has('audio.transcriptions') && capabilities.has('audio.transcriptions.tasks')) {
				operations.push('audio.transcriptions.async');
			}
			if (capabilities.has('audio.realtime.inference')) {
				operations.push('audio.transcriptions.realtime.inference');
			}
			if (capabilities.has('audio.realtime.session')) {
				operations.push('audio.transcriptions.realtime.session');
			}
			return operations;
		}
		return [];
	}
	if (model && isAudioSpeechModel(model)) {
		if (protocol === 'openai') {
			return capabilities.has('audio.speech') ? ['audio.speech'] : [];
		}
		if (protocol === 'dashscope') {
			const operations: string[] = [];
			if (capabilities.has('audio.speech')) operations.push('audio.speech');
			if (capabilities.has('audio.realtime.inference')) {
				operations.push('audio.speech.realtime.inference');
			}
			return operations;
		}
		return [];
	}
	const modelOperations = new Set(requestOperationsForModel(model, protocol));
	return providerOperations.filter((operation) => modelOperations.has(operation));
}

/** 返回能精确连接当前对外端点与上游目标的 adapter。 */
export function compatibleAdaptersForRoute(
	input: Pick<RouteFormData, 'request_protocol' | 'request_operation' | 'upstream_protocol' | 'upstream_operation'>,
): readonly string[] {
	return ROUTE_ADAPTERS.filter((adapter) =>
		isRouteAdapterCompatible({
			adapter,
			requestProtocol: input.request_protocol,
			requestOperation: input.request_operation,
			upstreamProtocol: input.upstream_protocol,
			upstreamOperation: input.upstream_operation,
		}),
	);
}

/** Prompt-cache-sensitive capabilities (affinity preferred). */
export function isPromptCacheSensitiveCapability(capability: string): boolean {
	return (
		capability === 'chat' ||
		capability === 'messages' ||
		capability === 'models.generate' ||
		capability === 'generateContent' ||
		capability === 'streamGenerateContent'
	);
}

export function readRoutePolicyFormFromRaw(
	existingRaw: string | null | undefined,
	protocol: string,
	group: string,
): {
	protocolStrategy: string;
	tierStrategy: string;
	capabilityStrategies: Record<string, string>;
} {
	const parsed = parseModelRoutePolicy(existingRaw);
	const protocolStrategy = parsed?.rules.get(routePolicyRuleKey(protocol, null, group))?.strategy ?? '';
	const capabilityStrategies: Record<string, string> = {};
	for (const cap of CAPABILITIES_BY_PROTOCOL[protocol] ?? []) {
		capabilityStrategies[cap] = parsed?.rules.get(routePolicyRuleKey(protocol, cap, group))?.strategy ?? '';
	}
	return { protocolStrategy, tierStrategy: '', capabilityStrategies };
}

/**
 * Merge protocol×group (+ capability) strategy edits into models.route_policy JSON.
 * Empty strategy = remove that rule (inherit). Returns null when no rules/top strategy remain.
 */
export function buildRoutePolicyPatch(
	existingRaw: string | null | undefined,
	protocol: string,
	group: string,
	form: {
		protocolStrategy: string;
		capabilityStrategies: Record<string, string>;
	},
): string | null {
	let existing: Record<string, unknown> = {};
	try {
		existing = existingRaw ? (JSON.parse(existingRaw) as Record<string, unknown>) : {};
	} catch {
		existing = {};
	}

	const existingRules =
		existing.rules && typeof existing.rules === 'object' && !Array.isArray(existing.rules)
			? { ...(existing.rules as Record<string, unknown>) }
			: {};

	const keysToClear = [
		routePolicyRuleKey(protocol, null, group),
		...(CAPABILITIES_BY_PROTOCOL[protocol] ?? []).map((cap) => routePolicyRuleKey(protocol, cap, group)),
	];
	for (const k of keysToClear) {
		delete existingRules[k];
	}

	const proto = form.protocolStrategy.trim().toLowerCase();
	if (proto && isRouteStrategyName(proto)) {
		existingRules[routePolicyRuleKey(protocol, null, group)] = {
			strategy: proto,
		};
	}
	for (const [cap, raw] of Object.entries(form.capabilityStrategies)) {
		const s = raw.trim().toLowerCase();
		if (s && isRouteStrategyName(s)) {
			existingRules[routePolicyRuleKey(protocol, cap, group)] = { strategy: s };
		}
	}

	const topStrategy =
		typeof existing.strategy === 'string' && isRouteStrategyName(existing.strategy.trim().toLowerCase())
			? existing.strategy.trim().toLowerCase()
			: null;

	if (!topStrategy && Object.keys(existingRules).length === 0) {
		return null;
	}
	const next: Record<string, unknown> = {};
	if (topStrategy) next.strategy = topStrategy;
	if (Object.keys(existingRules).length > 0) next.rules = existingRules;
	return JSON.stringify(next);
}

export type RouteModelGroup = {
	model_id: string;
	title: string;
	groupRoutes: RouteListRow[];
	activeCount: number;
	vendor: string;
};

export function modelMatchesKindFilter(meta: GatewayModel | undefined, filterKind: RouteKindFilter): boolean {
	if (filterKind === 'all') return true;
	if (!meta) {
		return filterKind === 'llm';
	}
	if (filterKind === 'image') return isImageGenerationModel(meta);
	if (filterKind === 'audio') return isAudioModel(meta);
	return isTextLlmModel(meta);
}

/** Normalize API tags (string[] or JSON string) for route card display. */
export function parseModelTagsList(meta: GatewayModel | undefined): string[] {
	if (!meta) return [];
	const raw = (meta as { tags?: unknown }).tags;
	if (Array.isArray(raw)) {
		return raw.map((t) => String(t).trim()).filter(Boolean);
	}
	if (typeof raw === 'string' && raw.trim()) {
		try {
			const parsed = JSON.parse(raw) as unknown;
			if (Array.isArray(parsed)) {
				return parsed.map((t) => String(t).trim()).filter(Boolean);
			}
		} catch {
			// ignore
		}
	}
	return [];
}

export function buildRoutesByModel(params: {
	routes: RouteListRow[];
	models: GatewayModel[];
	modelMeta: Map<string, GatewayModel>;
	filterVendor: string;
	filterProviderId: string;
	filterRouteGroup: string;
	filterStatus: string;
	filterKind?: RouteKindFilter;
}): RouteModelGroup[] {
	const {
		routes,
		models,
		modelMeta,
		filterVendor,
		filterProviderId,
		filterRouteGroup,
		filterStatus,
		filterKind = DEFAULT_ROUTE_KIND_FILTER,
	} = params;

	const modelMatchesVendor = (modelId: string) => {
		if (!filterVendor) return true;
		return normalizeModelVendorInput(modelMeta.get(modelId)?.vendor) === filterVendor;
	};

	const modelMatchesKind = (modelId: string) => modelMatchesKindFilter(modelMeta.get(modelId), filterKind);

	const routeByModelId = new Map<string, RouteListRow[]>();
	for (const r of routes) {
		if (!modelMatchesVendor(r.model_id)) continue;
		if (!modelMatchesKind(r.model_id)) continue;
		if (filterProviderId && r.provider_id !== filterProviderId) continue;
		if (filterStatus && r.status !== filterStatus) continue;
		if (filterRouteGroup && normalizeRouteGroup(r.route_group) !== filterRouteGroup) continue;
		const list = routeByModelId.get(r.model_id) ?? [];
		list.push(r);
		routeByModelId.set(r.model_id, list);
	}

	for (const list of routeByModelId.values()) {
		list.sort(compareModelRoutesForCardDisplay);
	}

	const candidateModelIds = new Set<string>();
	for (const model of models) {
		if (!modelMatchesVendor(model.id)) continue;
		if (!modelMatchesKind(model.id)) continue;
		candidateModelIds.add(model.id);
	}
	for (const route of routes) {
		if (!modelMatchesVendor(route.model_id)) continue;
		if (!modelMatchesKind(route.model_id)) continue;
		candidateModelIds.add(route.model_id);
	}

	const hasRouteLevelFilter = Boolean(filterProviderId || filterStatus || filterRouteGroup);
	const entries = [...candidateModelIds].sort((idA, idB) => {
		const nameA = modelMeta.get(idA)?.display_name || idA;
		const nameB = modelMeta.get(idB)?.display_name || idB;
		return nameA.localeCompare(nameB, undefined, { sensitivity: 'base' });
	});

	return entries
		.map((model_id) => {
			const groupRoutes = routeByModelId.get(model_id) ?? [];
			if (hasRouteLevelFilter && groupRoutes.length === 0) {
				return null;
			}
			const active = groupRoutes.filter((r) => r.status === 'active').length;
			const meta = modelMeta.get(model_id);
			const title = meta?.display_name || groupRoutes[0]?.model_name || model_id;
			const vendor = normalizeModelVendorInput(meta?.vendor);
			return { model_id, title, groupRoutes, activeCount: active, vendor };
		})
		.filter((group): group is RouteModelGroup => group !== null);
}

export function sortRouteCards(
	routesByModel: RouteModelGroup[],
	modelMeta: Map<string, GatewayModel>,
): RouteModelGroup[] {
	return [...routesByModel].sort((a, b) => {
		const ma = modelMeta.get(a.model_id);
		const mb = modelMeta.get(b.model_id);
		return compareModelsByReleasedAtDesc(
			ma ?? { id: a.model_id, display_name: a.title },
			mb ?? { id: b.model_id, display_name: b.title },
		);
	});
}

export function buildVendorFilterOptions(params: {
	models: GatewayModel[];
	routes: RouteListRow[];
	modelMeta: Map<string, GatewayModel>;
}) {
	const { models, routes, modelMeta } = params;
	const routeCountByVendor = new Map<string, number>();
	for (const r of routes) {
		const key = normalizeModelVendorInput(modelMeta.get(r.model_id)?.vendor);
		routeCountByVendor.set(key, (routeCountByVendor.get(key) ?? 0) + 1);
	}
	const keys = new Set<string>();
	for (const m of models) {
		keys.add(normalizeModelVendorInput(m.vendor));
	}
	for (const key of routeCountByVendor.keys()) {
		keys.add(key);
	}
	return [...keys]
		.sort((a, b) => {
			if (a === 'other') return 1;
			if (b === 'other') return -1;
			return a.localeCompare(b, undefined, { sensitivity: 'base' });
		})
		.map((key) => ({
			key,
			label: getModelVendorLabel(key),
			count: routeCountByVendor.get(key) ?? 0,
		}));
}

export function buildRouteCardVendorGroups(
	routeCards: RouteModelGroup[],
	filterVendor: string,
): Array<{ vendor: string; cards: RouteModelGroup[]; showHeader: boolean }> {
	if (filterVendor) {
		return [{ vendor: filterVendor, cards: routeCards, showHeader: false }];
	}

	const byVendor = new Map<string, RouteModelGroup[]>();
	for (const card of routeCards) {
		const list = byVendor.get(card.vendor) ?? [];
		list.push(card);
		byVendor.set(card.vendor, list);
	}

	return [...byVendor.keys()].sort(compareModelVendorsForDisplay).map((vendor) => ({
		vendor,
		cards: byVendor.get(vendor)!,
		showHeader: true,
	}));
}

export function buildActiveFilterSummary(params: {
	filterStatus: string;
	filterRouteGroup: string;
	filterVendor: string;
	filterProviderId: string;
	providers: GatewayProvider[];
}): string[] {
	const { filterStatus, filterRouteGroup, filterVendor, filterProviderId, providers } = params;
	const parts: string[] = [];
	if (filterStatus) parts.push(filterStatus === 'active' ? 'Active' : 'Inactive');
	if (filterRouteGroup) parts.push(`Group: ${filterRouteGroup}`);
	if (filterVendor) parts.push(getModelVendorLabel(filterVendor));
	if (filterProviderId) {
		const p = providers.find((x) => x.id === filterProviderId);
		parts.push(p?.name || filterProviderId);
	}
	return parts;
}

export function createInitialRouteForm(models: GatewayModel[], presetModelId?: string): RouteFormData {
	const presetModel = presetModelId ? models.find((model) => model.id === presetModelId) : undefined;
	const defaultOperation =
		presetModel && isImageGenerationModel(presetModel)
			? 'images.generations'
			: presetModel && isAudioTranscriptionModel(presetModel)
			? 'audio.transcriptions'
			: presetModel && isAudioSpeechModel(presetModel)
			? 'audio.speech'
			: 'chat';
	return {
		model_id: presetModelId ?? '',
		provider_id: '',
		provider_model_name: '',
		request_protocol: 'openai',
		request_operation: defaultOperation,
		upstream_protocol: 'openai',
		upstream_operation: defaultOperation,
		adapter: 'passthrough',
		priority: 0,
		weight: 1,
		custom_params_json: '',
		route_group: 'default',
		charged_factor: '1',
		metered_factor: '1',
		schedule_charged: [],
		schedule_metered: [],
	};
}

/** Format schedule windows for list-card hint, e.g. `00–08×0.5`. */
export function formatScheduleWindowsHint(windows: DailyScheduleWindow[]): string | null {
	if (windows.length === 0) return null;
	return windows
		.map((w) => {
			const a = w.start.slice(0, 5);
			const b = w.end.slice(0, 5);
			return `${a.slice(0, 2)}–${b.slice(0, 2)}×${formatFactorValue(w.factor)}`;
		})
		.join(' ');
}
