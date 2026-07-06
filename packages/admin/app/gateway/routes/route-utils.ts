import { compareModelsByReleasedAtDesc } from '@/lib/model-catalog-sort';
import { getModelVendorLabel, normalizeModelVendorInput } from '@/lib/model-vendor';
import { compareRouteGroupsForDisplay, normalizeRouteGroup } from '@/lib/route-group-ui';
import {
	UPSTREAM_PROTOCOLS,
	isUpstreamProtocol,
	type UpstreamProtocol,
} from '@/lib/upstream-protocol';
import {
	extractChargedProfileFromPriceOverrideJson,
	extractMeteredProfileFromPriceOverrideJson,
	parsePricingProfile,
} from '@octafuse/core/db/pricing-profile';
import { stickyRuleKey } from '@octafuse/core/db/model-sticky-config';
import {
	profileJsonToDraftRows,
	serializeDraftRowsToProfileJson,
	tierPricesToDraft,
	type PricingTierDraftRow,
} from '@/lib/pricing-tiers-draft';
import type { GatewayModel, GatewayModelRoute, GatewayProvider } from '@/lib/types';
import type { RouteFormData, RouteListRow, RouteProtocolGroupSection } from './types';
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

function recomputeCatalogTierDraftsFromFactor(
	factorText: string,
	model: GatewayModel | undefined
): { ok: true; tiers: PricingTierDraftRow[] } | { ok: false } {
	const trimmed = factorText.trim();
	const factor = trimmed === '' ? 1 : parseFloat(trimmed);
	if (!Number.isFinite(factor) || factor < 0) {
		return { ok: false };
	}
	if (!model) {
		return { ok: false };
	}
	const prof = parsePricingProfile(model.pricing_profile ?? undefined);
	if (!prof || prof.tiers.length === 0) {
		return { ok: false };
	}
	const scaledTiers = prof.tiers.map((t) => ({
		upto: t.upto,
		label: null,
		input_price: Number((t.input_price * factor).toFixed(6)),
		output_price: Number((t.output_price * factor).toFixed(6)),
		cache_read_price:
			t.cache_read_price != null ? Number((t.cache_read_price * factor).toFixed(6)) : null,
		cache_write_price:
			t.cache_write_price != null ? Number((t.cache_write_price * factor).toFixed(6)) : null,
	}));
	return { ok: true, tiers: scaledTiers.map((t) => tierPricesToDraft(t)) };
}

export function recomputeOverrideTiersFromProviderFactor(
	factorText: string,
	model: GatewayModel | undefined
): { ok: true; tiers: PricingTierDraftRow[] } | { ok: false } {
	return recomputeCatalogTierDraftsFromFactor(factorText, model);
}

export function recomputeChargedTiersFromChargedFactor(
	factorText: string,
	model: GatewayModel | undefined
): { ok: true; tiers: PricingTierDraftRow[] } | { ok: false } {
	const trimmed = factorText.trim();
	const factor = trimmed === '' ? 1 : parseFloat(trimmed);
	if (!Number.isFinite(factor) || factor < 0) {
		return { ok: false };
	}
	return recomputeCatalogTierDraftsFromFactor(factorText, model);
}

export function parsePriceOverride(json: string | null): {
	metered_override_tiers: PricingTierDraftRow[];
	charged_override_tiers: PricingTierDraftRow[];
	provider_factor?: string;
	charged_factor?: string;
} {
	if (!json) {
		return { metered_override_tiers: [], charged_override_tiers: [] };
	}
	try {
		const o = JSON.parse(json) as Record<string, unknown>;
		const nested = extractMeteredProfileFromPriceOverrideJson(json);
		const ucNested = extractChargedProfileFromPriceOverrideJson(json);
		return {
			metered_override_tiers: profileJsonToDraftRows(nested),
			charged_override_tiers: profileJsonToDraftRows(ucNested),
			charged_factor: (() => {
				const v = o.charged_factor;
				if (typeof v === 'number' && Number.isFinite(v)) return String(v);
				if (typeof v === 'string') {
					const n = parseFloat(v.trim());
					if (Number.isFinite(n)) return String(n);
				}
				return '';
			})(),
			provider_factor: (() => {
				const v = o.provider_factor;
				if (typeof v === 'number' && Number.isFinite(v)) return String(v);
				if (typeof v === 'string') {
					const n = parseFloat(v.trim());
					if (Number.isFinite(n)) return String(n);
				}
				return '';
			})(),
		};
	} catch {
		return { metered_override_tiers: [], charged_override_tiers: [] };
	}
}

export function buildFormDataFromRoute(route: GatewayModelRoute, models: GatewayModel[]): RouteFormData {
	const po = parsePriceOverride(route.price_override ?? null);
	const routeModel = models.find((m) => m.id === route.model_id);
	let metered_override_tiers = po.metered_override_tiers;
	let charged_override_tiers = po.charged_override_tiers;
	let provider_factor = po.provider_factor ?? '';
	const charged_factor =
		po.charged_factor && po.charged_factor.trim() !== '' ? po.charged_factor : '1';
	if (routeModel) {
		if (charged_override_tiers.length === 0) {
			const c = recomputeChargedTiersFromChargedFactor(charged_factor, routeModel);
			if (c.ok) charged_override_tiers = c.tiers;
		}
		if (metered_override_tiers.length === 0) {
			const pfText = provider_factor.trim() === '' ? '1' : provider_factor;
			const m = recomputeOverrideTiersFromProviderFactor(pfText, routeModel);
			if (m.ok) {
				metered_override_tiers = m.tiers;
				if (provider_factor.trim() === '') provider_factor = '1';
			}
		}
	}
	return {
		model_id: route.model_id,
		provider_id: route.provider_id,
		provider_model_name: route.provider_model_name,
		upstream_protocol: (isUpstreamProtocol(route.upstream_protocol)
			? route.upstream_protocol
			: 'openai') as UpstreamProtocol,
		priority: route.priority,
		metered_override_tiers,
		charged_override_tiers,
		custom_params_json: route.custom_params ?? '',
		route_group: route.route_group ?? 'default',
		charged_factor,
		provider_factor,
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

	const priceOverride: Record<string, unknown> = {};
	const profileSerialized = serializeDraftRowsToProfileJson(formData.metered_override_tiers);
	if (!profileSerialized.ok) {
		throw new Error(profileSerialized.error);
	}
	if (!profileSerialized.json) {
		throw new Error(
			'Metered cost is required: add at least one tier (use Provider factor × Standard or edit manually).'
		);
	}
	priceOverride.metered = JSON.parse(profileSerialized.json) as { tiers: unknown };

	const chargedSerialized = serializeDraftRowsToProfileJson(formData.charged_override_tiers);
	if (!chargedSerialized.ok) {
		throw new Error(chargedSerialized.error);
	}
	if (!chargedSerialized.json) {
		throw new Error(
			'Charged cost is required: add at least one tier (use Charged factor × Standard or edit manually).'
		);
	}
	priceOverride.charged = JSON.parse(chargedSerialized.json) as { tiers: unknown };

	if (formData.provider_factor.trim() !== '') {
		const v = parseFloat(formData.provider_factor.trim());
		if (!Number.isFinite(v) || v < 0) {
			throw new Error('Provider factor must be a number ≥ 0');
		}
		priceOverride.provider_factor = v;
	}

	const cfText = formData.charged_factor.trim();
	const chargedFactorParsed = cfText === '' ? 1 : parseFloat(cfText);
	if (!Number.isFinite(chargedFactorParsed) || chargedFactorParsed < 0) {
		throw new Error('Charged factor must be a number ≥ 0');
	}
	priceOverride.charged_factor = chargedFactorParsed;

	const mfText = formData.provider_factor.trim();
	const meteredFactorParsed = mfText === '' ? 1 : parseFloat(mfText);
	if (!Number.isFinite(meteredFactorParsed) || meteredFactorParsed < 0) {
		throw new Error('Metered factor must be a number ≥ 0');
	}
	priceOverride.metered_factor = meteredFactorParsed;

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

export function buildRoutesByModel(params: {
	routes: RouteListRow[];
	models: GatewayModel[];
	modelMeta: Map<string, GatewayModel>;
	filterVendor: string;
	filterProviderId: string;
	filterRouteGroup: string;
	filterStatus: string;
}): RouteModelGroup[] {
	const { routes, models, modelMeta, filterVendor, filterProviderId, filterRouteGroup, filterStatus } =
		params;

	const modelMatchesVendor = (modelId: string) => {
		if (!filterVendor) return true;
		return normalizeModelVendorInput(modelMeta.get(modelId)?.vendor) === filterVendor;
	};

	const routeByModelId = new Map<string, RouteListRow[]>();
	for (const r of routes) {
		if (!modelMatchesVendor(r.model_id)) continue;
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
		candidateModelIds.add(model.id);
	}
	for (const route of routes) {
		if (!modelMatchesVendor(route.model_id)) continue;
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
	models: GatewayModel[],
	presetModelId?: string
): RouteFormData {
	const mid = presetModelId ?? '';
	const presetModel = models.find((m) => m.id === mid);
	let metered_override_tiers: PricingTierDraftRow[] = [];
	let charged_override_tiers: PricingTierDraftRow[] = [];
	if (presetModel) {
		const m = recomputeOverrideTiersFromProviderFactor('1', presetModel);
		if (m.ok) metered_override_tiers = m.tiers;
		const c = recomputeChargedTiersFromChargedFactor('1', presetModel);
		if (c.ok) charged_override_tiers = c.tiers;
	}
	return {
		model_id: mid,
		provider_id: '',
		provider_model_name: '',
		upstream_protocol: 'openai',
		priority: 0,
		metered_override_tiers,
		charged_override_tiers,
		custom_params_json: '',
		route_group: 'default',
		charged_factor: '1',
		provider_factor: '1',
	};
}
