import { parsePricingProfile } from '@octafuse/core/db/pricing-profile';
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
import { parseRoutePoolStickyConfig } from '@octafuse/core/db/route-pool-sticky-types';
import { splitRouteCustomParams } from '@octafuse/core/route-custom-params';
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
	isDashScopeRealtimeAsrModelOperationCompatible,
	isRouteAdapterCompatible,
	REQUEST_OPERATIONS_BY_PROTOCOL,
	ROUTE_ADAPTERS,
} from '@octafuse/core/route-topology';
import {
	adaptersForModelKind,
	getAdapterByOptionKey,
	getAdapterByPresetIntent,
	listSelectableAdapters,
	requestOperationsFromRegistry,
	requestSurfacePath as requestSurfacePathFromRegistry,
	requiredCapabilitiesForUpstreamOperation,
	SURFACE_PATH_MODEL_PLACEHOLDER,
	upstreamOperationsFromRegistry,
	type AdapterDescriptor,
	type AdapterModelKind,
	type AdapterPresetIntent,
} from '@octafuse/core/adapters/registry';
import {
	findDailyWindowOverlap,
	formatIsoWeekdaysHint,
	mergeScheduleSidesToSharedWindows,
	normalizeIsoWeekdays,
	normalizeScheduleFactor,
	parseHhMmToMinutes,
	parseRouteBaseFactors,
	parseRoutePricingSchedule,
	scheduleWindowKey,
	type DailyScheduleWindow,
	type SharedScheduleWindow,
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
	type RouteCustomHeaderRow,
	type RouteFormData,
	type RouteKindFilter,
	type RouteListRow,
	type RouteProtocolGroupSection,
	type RouteScheduleFormSide,
	type RouteScheduleFormWindow,
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

/** 跨模型汇总时路径里的模型占位符（Gemini / DashScope 入口含 model）。 */
export { SURFACE_PATH_MODEL_PLACEHOLDER };

/** 将公开协议操作映射为客户端实际调用路径，避免把带点的操作名直接拼进 URL。 */
export function requestSurfacePath(protocol: string, operation: string, modelId?: string): string {
	return requestSurfacePathFromRegistry(protocol, operation, modelId);
}

/**
 * Request Logs 密集列表用协议端点：模型 ID 已另列，Gemini 不展开 `{model}:action`。
 * 是否流式由独立列展示，不写进路径。
 */
export function requestLogProtocolPath(protocol: string, operation: string): string {
	if (protocol === 'gemini') {
		return '/v1beta/models';
	}
	return requestSurfacePath(protocol, operation);
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
		pool_sticky_enabled?: boolean | number | null;
		pool_sticky_idle_ttl_seconds?: number | null;
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
			const sticky = parseRoutePoolStickyConfig({
				stickyEnabled: r.pool_sticky_enabled,
				stickyIdleTtlSeconds: r.pool_sticky_idle_ttl_seconds,
			});
			const section =
				bySection.get(key) ??
				{
					key,
					protocol,
					protocolLabel: getProtocolDisplayLabel(protocol),
					requestOperation,
					surfaceId: surface.id ?? null,
					poolId: r.route_pool_id ?? null,
					poolName: r.pool_name ?? null,
					poolStrategy: r.pool_strategy ?? null,
					poolTierStrategies: r.pool_tier_strategies ?? null,
					poolStickyEnabled: sticky.enabled,
					poolStickyIdleTtlSeconds: sticky.idleTtlSeconds,
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

export type RequestSurfaceGroup<T = RouteListRow> = {
	key: string;
	protocol: string;
	protocolLabel: string;
	requestOperation: string;
	sections: RouteProtocolGroupSection<T>[];
};

export function requestSurfaceGroupKey(protocol: string, requestOperation: string): string {
	return `${protocol}\u0000${requestOperation}`;
}

export function groupSectionsByRequestSurface<T>(
	sections: RouteProtocolGroupSection<T>[],
): RequestSurfaceGroup<T>[] {
	const groups = new Map<string, RequestSurfaceGroup<T>>();
	for (const section of sections) {
		const key = requestSurfaceGroupKey(section.protocol, section.requestOperation);
		const group =
			groups.get(key) ??
			{
				key,
				protocol: section.protocol,
				protocolLabel: section.protocolLabel,
				requestOperation: section.requestOperation,
				sections: [],
			};
		group.sections.push(section);
		groups.set(key, group);
	}
	return [...groups.values()].sort((a, b) => {
		const protocolCmp = compareRouteProtocolsForDisplay(a.protocol, b.protocol);
		if (protocolCmp !== 0) return protocolCmp;
		return a.requestOperation.localeCompare(b.requestOperation, undefined, { sensitivity: 'base' });
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
	return formatFactorValue(n);
}

export function formatFactorMultiplier(value: number): string {
	return `×${formatFactorValue(value)}`;
}

export function formatFactorMultiplierForChip(value: number): string {
	return formatFactorMultiplier(value);
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

function parseSharedWindowFactor(text: string, fieldLabel: string, index: number): number {
	const factor = text.trim() === '' ? Number.NaN : Number(text.trim());
	if (!Number.isFinite(factor) || factor < 0) {
		throw new Error(`Schedule window ${index + 1}: ${fieldLabel} must be a number ≥ 0`);
	}
	return factor;
}

export function buildRoutePriceOverride(formData: RouteFormData): Record<string, unknown> {
	const chargedFactor = parseNonNegativeFactorText(formData.charged_factor, 'Charged factor');
	const meteredFactor = parseNonNegativeFactorText(formData.metered_factor, 'Metered factor');
	const scheduleWindows = validateSharedScheduleWindows(formData.schedule_windows);
	const priceOverride: Record<string, unknown> = {
		charged_factor: chargedFactor,
		metered_factor: meteredFactor,
	};
	if (scheduleWindows.length > 0) {
		priceOverride.schedule = {
			mode: 'override',
			charged: scheduleWindows.map((w) => persistScheduleSideWindow(w, w.charged_factor)),
			metered: scheduleWindows.map((w) => persistScheduleSideWindow(w, w.metered_factor)),
		};
	}
	return priceOverride;
}

export function formatRoutePriceOverridePreview(formData: RouteFormData): {
	ok: true;
	text: string;
} | { ok: false; text: string } {
	try {
		return { ok: true, text: JSON.stringify(buildRoutePriceOverride(formData), null, 2) };
	} catch (error) {
		return {
			ok: false,
			text: error instanceof Error ? error.message : String(error),
		};
	}
}

function persistableScheduleDays(days: number[] | undefined): number[] | undefined {
	if (!days || days.length === 0) {
		return undefined;
	}
	const normalized = normalizeIsoWeekdays(days);
	if (normalized === null) {
		return undefined;
	}
	return normalized;
}

function persistScheduleSideWindow(
	w: Pick<SharedScheduleWindow, 'start' | 'end' | 'days'>,
	factor: number,
): DailyScheduleWindow {
	const days = persistableScheduleDays(w.days);
	return days ? { start: w.start, end: w.end, factor, days } : { start: w.start, end: w.end, factor };
}

function parseFormScheduleDays(days: number[] | undefined, index: number): number[] | undefined {
	if (!days || days.length === 0) {
		return undefined;
	}
	const normalized = normalizeIsoWeekdays(days);
	if (normalized === null) {
		throw new Error(`Schedule window ${index + 1}: days must be a non-empty unique array of integers 1–7`);
	}
	return normalized;
}

function validateSharedScheduleWindows(windows: RouteScheduleFormSide): SharedScheduleWindow[] {
	const cleaned: SharedScheduleWindow[] = [];
	for (let i = 0; i < windows.length; i++) {
		const w = windows[i]!;
		const start = String(w.start ?? '').trim();
		const end = String(w.end ?? '').trim();
		if (!start || !end) {
			throw new Error(`Schedule window ${i + 1}: start and end are required (HH:mm)`);
		}
		const startMinutes = parseHhMmToMinutes(start);
		const endMinutes = parseHhMmToMinutes(end);
		if (startMinutes == null || startMinutes === 24 * 60 || endMinutes == null || startMinutes === endMinutes) {
			throw new Error(
				`Schedule window ${i + 1}: start must be HH:mm, end may also be 24:00, and duration must be non-zero`,
			);
		}
		const days = parseFormScheduleDays(w.days, i);
		cleaned.push({
			start,
			end,
			charged_factor: parseSharedWindowFactor(w.charged_factor, 'Charged factor', i),
			metered_factor: parseSharedWindowFactor(w.metered_factor, 'Metered factor', i),
			...(days ? { days } : {}),
		});
	}
	const overlap = findDailyWindowOverlap(
		cleaned.map((w) => ({ start: w.start, end: w.end, factor: w.charged_factor, days: w.days })),
	);
	if (overlap) {
		throw new Error(`Schedule: ${overlap}`);
	}
	return cleaned;
}

export function formatScheduleFactorText(n: number): string {
	return String(normalizeScheduleFactor(n));
}

export function catalogScheduleWindowsFromModel(
	model: GatewayModel | undefined | null
): DailyScheduleWindow[] {
	return parsePricingProfile(model?.pricing_profile ?? undefined)?.schedule ?? [];
}

export function alignRouteScheduleWindowsToCatalog(
	catalog: DailyScheduleWindow[],
	existing: RouteScheduleFormWindow[],
	defaultFactor = '1'
): RouteScheduleFormWindow[] {
	if (catalog.length === 0) {
		return existing;
	}
	const byKey = new Map(existing.map((w) => [scheduleWindowKey(w), w]));
	return catalog.map((w) => {
		const prev = byKey.get(scheduleWindowKey(w));
		return {
			start: w.start,
			end: w.end,
			days: w.days ? [...w.days] : [],
			charged_factor: prev?.charged_factor ?? defaultFactor,
			metered_factor: prev?.metered_factor ?? defaultFactor,
		};
	});
}

export function emptyCustomHeaderRows(): RouteCustomHeaderRow[] {
	return [{ name: '', value: '' }];
}

export function customHeaderRowsHaveValues(rows: RouteCustomHeaderRow[]): boolean {
	return rows.some((row) => row.name.trim().length > 0 || row.value.trim().length > 0);
}

/** 将 `custom_params` JSON 拆成请求体编辑区与 HTTP 头行。 */
export function parseCustomParamsForm(raw: string | null | undefined): {
	custom_params_json: string;
	custom_headers: RouteCustomHeaderRow[];
} {
	const text = raw?.trim() ?? '';
	if (!text) {
		return { custom_params_json: '', custom_headers: emptyCustomHeaderRows() };
	}
	try {
		const parsed = JSON.parse(text) as unknown;
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
			return { custom_params_json: text, custom_headers: emptyCustomHeaderRows() };
		}
		const split = splitRouteCustomParams(parsed as Record<string, unknown>);
		const bodyJson = Object.keys(split.body).length > 0 ? JSON.stringify(split.body, null, 2) : '';
		const headerRows = Object.entries(split.extraHeaders).map(([name, value]) => ({ name, value }));
		return {
			custom_params_json: bodyJson,
			custom_headers: headerRows.length > 0 ? headerRows : emptyCustomHeaderRows(),
		};
	} catch {
		return { custom_params_json: text, custom_headers: emptyCustomHeaderRows() };
	}
}

/** 把表单的请求体 JSON 与头行合成保存用的 `custom_params`。空则返回 null。 */
export function composeCustomParamsJson(
	bodyJson: string,
	headers: RouteCustomHeaderRow[],
): string | null {
	const extraHeaders: Record<string, string> = {};
	for (const row of headers) {
		const name = row.name.trim();
		if (!name) continue;
		extraHeaders[name] = row.value;
	}

	const bodyText = bodyJson.trim();
	let body: Record<string, unknown> = {};
	if (bodyText) {
		const parsed = JSON.parse(bodyText) as unknown;
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
			throw new Error('custom_params must be a JSON object');
		}
		body = { ...(parsed as Record<string, unknown>) };
		delete body.headers;
	}

	if (Object.keys(extraHeaders).length > 0) {
		body.headers = extraHeaders;
	}
	if (Object.keys(body).length === 0) return null;
	return JSON.stringify(body);
}

export function buildFormDataFromRoute(route: GatewayModelRoute, models: GatewayModel[]): RouteFormData {
	const factors = parseRouteBaseFactors(route.price_override ?? null);
	const existingWindows = resolveRouteScheduleDisplay(route.price_override).map((w) => ({
		start: w.start,
		end: w.end,
		charged_factor: formatScheduleFactorText(w.charged_factor),
		metered_factor: formatScheduleFactorText(w.metered_factor),
		days: w.days ?? [],
	}));
	const catalog = catalogScheduleWindowsFromModel(models.find((m) => m.id === route.model_id));
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
		...parseCustomParamsForm(route.custom_params),
		route_group: route.route_group ?? 'default',
		charged_factor: String(factors.chargedFactor),
		metered_factor: String(factors.meteredFactor),
		schedule_windows: alignRouteScheduleWindowsToCatalog(catalog, existingWindows),
	};
}

export function buildRouteSavePayload(
	formData: RouteFormData,
	editingRoute: GatewayModelRoute | null,
): Record<string, unknown> {
	const priceOverride = buildRoutePriceOverride(formData);

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
		custom_params: composeCustomParamsJson(formData.custom_params_json, formData.custom_headers),
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

export function modelKindForModel(model: GatewayModel | undefined): AdapterModelKind {
	if (model && isImageGenerationModel(model)) return 'image';
	if (model && isAudioTranscriptionModel(model)) return 'audio.transcription';
	if (model && isAudioSpeechModel(model)) return 'audio.speech';
	return 'llm';
}

function sortOperationsForProtocol(protocol: UpstreamProtocol, operations: readonly string[]): string[] {
	const order = REQUEST_OPERATIONS_BY_PROTOCOL[protocol] as readonly string[];
	return [...operations].sort((a, b) => {
		const ia = order.indexOf(a);
		const ib = order.indexOf(b);
		return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
	});
}

function filterRealtimeOperations(operations: readonly string[], providerModelName: string): string[] {
	if (!providerModelName.trim()) return [...operations];
	return operations.filter((operation) =>
		isDashScopeRealtimeAsrModelOperationCompatible(providerModelName, operation),
	);
}

/** Public operations that make sense for the selected model modality. */
export function requestOperationsForModel(
	model: GatewayModel | undefined,
	protocol: UpstreamProtocol,
	providerModelName = '',
): readonly string[] {
	if (
		model &&
		(isImageGenerationModel(model) || isAudioTranscriptionModel(model) || isAudioSpeechModel(model) || (isTextLlmModel(model) && protocol === 'openai'))
	) {
		const kind = modelKindForModel(model);
		const operations = requestOperationsFromRegistry(protocol, kind);
		if (kind === 'audio.transcription' && protocol === 'dashscope') {
			return filterRealtimeOperations(operations, providerModelName);
		}
		return operations;
	}
	return REQUEST_OPERATIONS_BY_PROTOCOL[protocol];
}

export type DashScopeAsrRoutePreset = 'flash-convert' | 'flash-passthrough' | 'filetrans';
export type DashScopeTtsRoutePreset = 'realtime' | 'nonrealtime';
export type DashScopeImageRoutePreset = 'qwen' | 'wan';

/**
 * 将 DashScope ASR 的用户意图转换为完整路由拓扑。
 * flash 转换保持 OpenAI 兼容入口；透传使用原生 multimodal HTTP；filetrans 走异步 submit/poll。
 */
const ASR_PRESET_INTENT: Record<DashScopeAsrRoutePreset, AdapterPresetIntent> = {
	'flash-convert': 'dashscope-asr-flash-convert',
	'flash-passthrough': 'dashscope-asr-flash-passthrough',
	filetrans: 'dashscope-asr-filetrans',
};

export function applyAdapterDescriptorToForm(
	formData: RouteFormData,
	descriptor: AdapterDescriptor,
): RouteFormData {
	return {
		...formData,
		request_protocol: descriptor.request.protocol,
		request_operation: descriptor.request.operation,
		upstream_protocol: descriptor.upstream.protocol,
		upstream_operation: descriptor.upstream.operations[0] ?? descriptor.request.operation,
		adapter: descriptor.id,
	};
}

export function applyDashScopeAsrRoutePreset(formData: RouteFormData, preset: DashScopeAsrRoutePreset): RouteFormData {
	const descriptor = getAdapterByPresetIntent(ASR_PRESET_INTENT[preset]);
	if (!descriptor) return formData;
	return applyAdapterDescriptorToForm(formData, descriptor);
}

/**
 * 将 DashScope TTS 的用户意图转换为完整路由拓扑。
 * 非实时模式保持 OpenAI 兼容入口，实时模式使用网关原生 DashScope WSS 入口。
 */
const TTS_PRESET_INTENT: Record<DashScopeTtsRoutePreset, AdapterPresetIntent> = {
	nonrealtime: 'dashscope-tts-nonrealtime',
	realtime: 'dashscope-tts-realtime',
};

export function applyDashScopeTtsRoutePreset(formData: RouteFormData, preset: DashScopeTtsRoutePreset): RouteFormData {
	const descriptor = getAdapterByPresetIntent(TTS_PRESET_INTENT[preset]);
	if (!descriptor) return formData;
	return applyAdapterDescriptorToForm(formData, descriptor);
}

const IMAGE_PRESET_INTENT: Record<DashScopeImageRoutePreset, AdapterPresetIntent> = {
	qwen: 'dashscope-image-qwen',
	wan: 'dashscope-image-wan',
};

export function applyDashScopeImageRoutePreset(
	formData: RouteFormData,
	preset: DashScopeImageRoutePreset,
): RouteFormData {
	const descriptor = getAdapterByPresetIntent(IMAGE_PRESET_INTENT[preset]);
	if (!descriptor) return formData;
	return applyAdapterDescriptorToForm(formData, descriptor);
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
	providerModelName = '',
): readonly string[] {
	if (!provider) return [];
	const map = parseProviderEndpoints(provider);
	if (!map[protocol]) return [];
	const providerOperations = listConfiguredCapabilities(map, protocol);
	const capabilities = new Set(providerOperations);

	if (model && (isImageGenerationModel(model) || isAudioTranscriptionModel(model) || isAudioSpeechModel(model))) {
		const kind = modelKindForModel(model);
		const listed = sortOperationsForProtocol(protocol, upstreamOperationsFromRegistry(protocol, kind));
		const operations = listed.filter((operation) => {
			const required = requiredCapabilitiesForUpstreamOperation(protocol, operation);
			return required.every((capability) => capabilities.has(capability as ProviderEndpointCapability));
		});
		if (kind === 'audio.transcription') {
			return filterRealtimeOperations(operations, providerModelName);
		}
		return operations;
	}
	const modelOperations = new Set(requestOperationsForModel(model, protocol));
	return providerOperations.filter((operation) => modelOperations.has(operation));
}

export type AdapterOptionAvailability = {
	descriptor: AdapterDescriptor;
	available: boolean;
	missingCapabilities: readonly string[];
};

export function listAdapterOptionsForModel(
	model: GatewayModel | undefined,
	provider: GatewayProvider | undefined,
	providerModelName = '',
): AdapterOptionAvailability[] {
	const kind = modelKindForModel(model);
	const capabilities = new Set<string>();
	if (provider) {
		const map = parseProviderEndpoints(provider);
		for (const protocol of UPSTREAM_PROTOCOLS) {
			if (!map[protocol]) continue;
			for (const capability of listConfiguredCapabilities(map, protocol)) {
				capabilities.add(capability);
			}
		}
	}
	return adaptersForModelKind(kind)
		.filter((descriptor) => {
			if (kind !== 'audio.transcription') return true;
			return isDashScopeRealtimeAsrModelOperationCompatible(
				providerModelName,
				descriptor.request.operation,
			);
		})
		.map((descriptor) => {
			const missingCapabilities = provider
				? descriptor.requiredUpstreamCapabilities.filter((capability) => !capabilities.has(capability))
				: descriptor.requiredUpstreamCapabilities;
			return {
				descriptor,
				available: missingCapabilities.length === 0 && Boolean(provider),
				missingCapabilities,
			};
		});
}

export function resolveAdapterOptionKey(formData: Pick<RouteFormData, 'adapter' | 'request_protocol' | 'request_operation' | 'upstream_protocol' | 'upstream_operation'>): string | null {
	const match = listSelectableAdapters().find(
		(descriptor) =>
			descriptor.id === formData.adapter &&
			descriptor.request.protocol === formData.request_protocol &&
			descriptor.request.operation === formData.request_operation &&
			descriptor.upstream.protocol === formData.upstream_protocol &&
			descriptor.upstream.operations.includes(formData.upstream_operation),
	);
	return match?.optionKey ?? null;
}

export function applyAdapterOptionToForm(formData: RouteFormData, optionKey: string): RouteFormData {
	const descriptor = getAdapterByOptionKey(optionKey);
	if (!descriptor) return formData;
	return applyAdapterDescriptorToForm(formData, descriptor);
}

/** 下拉项后缀：透传只标 request；转换标 request → upstream。 */
export function adapterOptionMappingSuffix(descriptor: AdapterDescriptor): string {
	const from = `${descriptor.request.protocol}/${descriptor.request.operation}`;
	if (descriptor.id === 'passthrough') {
		return ` · ${from}`;
	}
	const to = descriptor.upstream.operations
		.map((operation) => `${descriptor.upstream.protocol}/${operation}`)
		.join(', ');
	return ` · ${from} → ${to}`;
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
		capability === 'responses' ||
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

export type SurfaceCatalogModel = {
	card: RouteModelGroup;
	sections: RouteProtocolGroupSection<RouteListRow>[];
};

export type SurfaceCatalogGroup = {
	key: string;
	protocol: string;
	protocolLabel: string;
	requestOperation: string;
	models: SurfaceCatalogModel[];
};

export type RouteSurfaceCatalogData = {
	surfaces: SurfaceCatalogGroup[];
	unrouted: RouteModelGroup[];
};

export function buildRouteSurfaceCatalog(cards: RouteModelGroup[]): RouteSurfaceCatalogData {
	const surfaces = new Map<string, SurfaceCatalogGroup>();
	const unrouted: RouteModelGroup[] = [];

	for (const card of cards) {
		const sections = splitRoutesByProtocolAndRouteGroup(card.groupRoutes);
		const grouped = groupSectionsByRequestSurface(sections);
		if (grouped.length === 0) {
			unrouted.push(card);
			continue;
		}
		for (const surface of grouped) {
			const existing =
				surfaces.get(surface.key) ??
				{
					key: surface.key,
					protocol: surface.protocol,
					protocolLabel: surface.protocolLabel,
					requestOperation: surface.requestOperation,
					models: [],
				};
			existing.models.push({ card, sections: surface.sections });
			surfaces.set(surface.key, existing);
		}
	}

	const sorted = [...surfaces.values()].sort((a, b) => {
		const protocolCmp = compareRouteProtocolsForDisplay(a.protocol, b.protocol);
		if (protocolCmp !== 0) return protocolCmp;
		return a.requestOperation.localeCompare(b.requestOperation, undefined, { sensitivity: 'base' });
	});

	return { surfaces: sorted, unrouted };
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
		custom_headers: emptyCustomHeaderRows(),
		route_group: 'default',
		charged_factor: '1',
		metered_factor: '1',
		schedule_windows: alignRouteScheduleWindowsToCatalog(
			catalogScheduleWindowsFromModel(presetModel),
			[]
		),
	};
}

function formatScheduleTime(value: string): string {
	const hhmm = value.length >= 5 ? value.slice(0, 5) : value;
	if (hhmm === '24:00') return '24:00';
	const match = /^(\d{2}):([0-5]\d)$/.exec(hhmm);
	if (!match) return hhmm;
	return `${Number(match[1])}:${match[2]}`;
}

export function formatScheduleRange(start: string, end: string): string {
	return `${formatScheduleTime(start)}-${formatScheduleTime(end)}`;
}

export type ScheduleWindowGroup = {
	ranges: string[];
	factor: number;
};

function formatScheduleRangeWithDays(start: string, end: string, days?: number[]): string {
	const range = formatScheduleRange(start, end);
	const daysHint = formatIsoWeekdaysHint(days);
	return daysHint ? `${daysHint} ${range}` : range;
}

export function groupScheduleWindows(windows: DailyScheduleWindow[]): ScheduleWindowGroup[] {
	const groups: ScheduleWindowGroup[] = [];
	for (const w of windows) {
		const range = formatScheduleRangeWithDays(w.start, w.end, w.days);
		const last = groups[groups.length - 1];
		if (last && last.factor === w.factor) {
			last.ranges.push(range);
		} else {
			groups.push({ ranges: [range], factor: w.factor });
		}
	}
	return groups;
}

export function scheduleWindowShapeKey(windows: DailyScheduleWindow[]): string {
	return windows
		.map((w) => `${w.start.slice(0, 5)}|${w.end.slice(0, 5)}|${(w.days ?? []).join('.')}`)
		.join(',');
}

/** Format schedule windows for tooltips, e.g. `9:00-12:00, 14:00-18:00 ×2`. */
export function formatScheduleWindowsHint(windows: DailyScheduleWindow[]): string | null {
	const groups = groupScheduleWindows(windows);
	if (groups.length === 0) return null;
	return groups
		.map((g) => `${g.ranges.join(', ')} ${formatFactorMultiplier(g.factor)}`)
		.join(' · ');
}

/** 列表 / 表单共用：把存量叠乘 bake 成对标准价的有效倍率。 */
export function resolveRouteScheduleDisplay(
	priceOverride: string | null | undefined,
): SharedScheduleWindow[] {
	const factors = parseRouteBaseFactors(priceOverride ?? null);
	const schedule = parseRoutePricingSchedule(priceOverride ?? null);
	return mergeScheduleSidesToSharedWindows(schedule.charged, schedule.metered, {
		mode: schedule.mode,
		chargedBase: factors.chargedFactor,
		meteredBase: factors.meteredFactor,
	});
}

export function formatSharedScheduleWindowsHint(windows: SharedScheduleWindow[]): string | null {
	if (windows.length === 0) return null;
	return windows
		.map((w) => {
			const range = formatScheduleRangeWithDays(w.start, w.end, w.days);
			const same = w.charged_factor === w.metered_factor;
			if (same) {
				return `${range} ${formatFactorMultiplier(w.charged_factor)}`;
			}
			return `${range} C ${formatFactorMultiplier(w.charged_factor)} · M ${formatFactorMultiplier(w.metered_factor)}`;
		})
		.join(' · ');
}
