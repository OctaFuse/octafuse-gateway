import { isImageGenerationModel } from '@octafuse/core/db/model-modalities';
import { stickyRuleKey } from '@octafuse/core/db/model-sticky-config';
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
import {
	UPSTREAM_PROTOCOLS,
	isUpstreamProtocol,
	type UpstreamProtocol,
} from '@/lib/upstream-protocol';
import type { GatewayModel, GatewayModelRoute, GatewayProvider } from '@/lib/types';
import {
	DEFAULT_KIND_FILTER,
	type ModelKindFilter,
} from '../models/types';
import type {
	RouteFormData,
	RouteListRow,
	RouteProtocolGroupSection,
	RouteScheduleFormSide,
} from './types';
import { FACTOR_CHIP_BASE, PROTOCOL_DISPLAY_LABEL } from './types';

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

export function splitRoutesByProtocolAndRouteGroup<T extends { upstream_protocol: string; route_group?: string | null }>(
	routes: T[]
): RouteProtocolGroupSection<T>[] {
	const bySection = new Map<string, RouteProtocolGroupSection<T>>();
	for (const r of routes) {
		const protocol = r.upstream_protocol.trim().toLowerCase();
		const g = normalizeRouteGroup(r.route_group);
		const key = `${protocol}\u0000${g}`;
		const section =
			bySection.get(key) ??
			{
				key,
				protocol,
				protocolLabel: getProtocolDisplayLabel(protocol),
				group: g,
				routes: [],
			};
		section.routes.push(r);
		bySection.set(key, section);
	}
	return [...bySection.values()].sort((a, b) => {
		const protocolCmp = compareRouteProtocolsForDisplay(a.protocol, b.protocol);
		if (protocolCmp !== 0) return protocolCmp;
		return compareRouteGroupsForDisplay(a.group, b.group);
	});
}

export function compareModelRoutesForCardDisplay(
	a: Pick<GatewayModelRoute, 'upstream_protocol' | 'priority' | 'provider_model_name' | 'id'>,
	b: Pick<GatewayModelRoute, 'upstream_protocol' | 'priority' | 'provider_model_name' | 'id'>
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
	const nameCmp = a.provider_model_name.localeCompare(b.provider_model_name, undefined, {
		sensitivity: 'base',
	});
	if (nameCmp !== 0) return nameCmp;
	return a.id.localeCompare(b.id, undefined, { sensitivity: 'base' });
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

export function factorChipClassForValue(n: number): string {
	if (!Number.isFinite(n)) {
		return `${FACTOR_CHIP_BASE} bg-zinc-100 text-zinc-700 ring-zinc-200/90`;
	}
	if (Math.abs(n - 1) < 1e-6) {
		return `${FACTOR_CHIP_BASE} bg-zinc-100 text-zinc-700 ring-zinc-200/90`;
	}
	if (n > 1) {
		return `${FACTOR_CHIP_BASE} bg-amber-100 text-amber-950 ring-amber-200/90`;
	}
	return `${FACTOR_CHIP_BASE} bg-emerald-100 text-emerald-900 ring-emerald-200/90`;
}

function parseNonNegativeFactorText(text: string, fieldLabel: string): number {
	const trimmed = text.trim();
	const n = trimmed === '' ? 1 : Number(trimmed);
	if (!Number.isFinite(n) || n < 0) {
		throw new Error(`${fieldLabel} must be a number ≥ 0`);
	}
	return n;
}

function validateScheduleSide(
	windows: RouteScheduleFormSide,
	sideLabel: string
): DailyScheduleWindow[] {
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
		if (
			startMinutes == null ||
			startMinutes === 24 * 60 ||
			endMinutes == null ||
			startMinutes === endMinutes
		) {
			throw new Error(
				`${sideLabel} window ${i + 1}: start must be HH:mm, end may also be 24:00, and duration must be non-zero`
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
		upstream_protocol: (isUpstreamProtocol(route.upstream_protocol)
			? route.upstream_protocol
			: 'openai') as UpstreamProtocol,
		priority: route.priority,
		custom_params_json: route.custom_params ?? '',
		route_group: route.route_group ?? 'default',
		charged_factor: String(factors.chargedFactor),
		metered_factor: String(factors.meteredFactor),
		schedule_charged: schedule.charged.map((w) => ({ ...w, factor: String(w.factor) })),
		schedule_metered: schedule.metered.map((w) => ({ ...w, factor: String(w.factor) })),
	};
}

export function buildRouteSavePayload(
	formData: RouteFormData,
	editingRoute: GatewayModelRoute | null
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
		upstream_protocol: formData.upstream_protocol,
		priority: formData.priority,
		route_group: formData.route_group.trim() || 'default',
		price_override: JSON.stringify(priceOverride),
		custom_params: normalizeJsonText(formData.custom_params_json, 'custom_params'),
	};
	if (!editingRoute) {
		payload.status = 'inactive';
	}
	return payload;
}

export function buildStickyConfigPatch(
	existingRaw: string | null | undefined,
	protocol: string,
	group: string,
	form: { enabled: boolean; ttl_seconds: string; short_wait_ms: string },
	ttl: number | null,
	wait: number | null
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
	const key = stickyRuleKey(protocol, group);
	for (const k of Object.keys(existingRules)) {
		const idx = k.indexOf(':');
		if (idx > 0 && stickyRuleKey(k.slice(0, idx), k.slice(idx + 1)) === key) {
			delete existingRules[k];
		}
	}
	if (form.enabled) {
		const rule: Record<string, unknown> = { enabled: true };
		if (ttl != null) rule.ttl_seconds = ttl;
		if (wait != null) rule.short_wait_ms = wait;
		existingRules[key] = rule;
	}
	if (Object.keys(existingRules).length > 0) {
		const next: Record<string, unknown> = { rules: existingRules };
		if (typeof existing.ttl_seconds === 'number') next.ttl_seconds = existing.ttl_seconds;
		if (typeof existing.short_wait_ms === 'number') next.short_wait_ms = existing.short_wait_ms;
		return JSON.stringify(next);
	}
	return null;
}

export type RouteModelGroup = {
	model_id: string;
	title: string;
	groupRoutes: RouteListRow[];
	activeCount: number;
	vendor: string;
};

export function modelMatchesKindFilter(
	meta: GatewayModel | undefined,
	filterKind: ModelKindFilter
): boolean {
	const isImage = meta ? isImageGenerationModel(meta) : false;
	return filterKind === 'image' ? isImage : !isImage;
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
	filterKind?: ModelKindFilter;
}): RouteModelGroup[] {
	const {
		routes,
		models,
		modelMeta,
		filterVendor,
		filterProviderId,
		filterRouteGroup,
		filterStatus,
		filterKind = DEFAULT_KIND_FILTER,
	} = params;

	const modelMatchesVendor = (modelId: string) => {
		if (!filterVendor) return true;
		return normalizeModelVendorInput(modelMeta.get(modelId)?.vendor) === filterVendor;
	};

	const modelMatchesKind = (modelId: string) =>
		modelMatchesKindFilter(modelMeta.get(modelId), filterKind);

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
	modelMeta: Map<string, GatewayModel>
): RouteModelGroup[] {
	return [...routesByModel].sort((a, b) => {
		const ma = modelMeta.get(a.model_id);
		const mb = modelMeta.get(b.model_id);
		return compareModelsByReleasedAtDesc(
			ma ?? { id: a.model_id, display_name: a.title },
			mb ?? { id: b.model_id, display_name: b.title }
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
	filterVendor: string
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

export function createInitialRouteForm(
	_models: GatewayModel[],
	presetModelId?: string
): RouteFormData {
	return {
		model_id: presetModelId ?? '',
		provider_id: '',
		provider_model_name: '',
		upstream_protocol: 'openai',
		priority: 0,
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
