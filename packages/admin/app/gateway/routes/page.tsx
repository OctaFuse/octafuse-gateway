'use client';

/**
 * 模型路由：`model_routes` CRUD、协议与 route_group、URL 查询参数驱动列表筛选（`useSearchParams` + Suspense）。
 */
import { useState, useEffect, useMemo, Suspense, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  TrashIcon,
  PlusIcon,
  ClipboardDocumentIcon,
  DocumentDuplicateIcon,
  LinkIcon,
} from '@heroicons/react/24/outline';
import { readApiJson } from '@/lib/api-json';
import {
  getCatalogPricingTierRows,
  parseChargedFactorFromPriceOverride,
  parseMeteredFactorFromPriceOverride,
} from '@/lib/pricing-ui';
import { compareModelsByReleasedAtDesc } from '@/lib/model-catalog-sort';
import type { GatewayModelRoute, GatewayModel, GatewayProvider } from '@/lib/types';
import {
  extractMeteredProfileFromPriceOverrideJson,
  extractChargedProfileFromPriceOverrideJson,
  parsePricingProfile,
} from '@octafuse/core/db/pricing-profile';
import {
  parseModelStickyConfig,
  resolveStickyRouteRule,
  stickyRuleKey,
  STICKY_DEFAULT_TTL_SECONDS,
  STICKY_DEFAULT_SHORT_WAIT_MS,
} from '@octafuse/core/db/model-sticky-config';
import {
  profileJsonToDraftRows,
  serializeDraftRowsToProfileJson,
  tierPricesToDraft,
  type PricingTierDraftRow,
} from '@/lib/pricing-tiers-draft';
import { PricingTiersEditor } from '@/components/pricing-tiers-editor';
import { ReadOnlyPricingTiersTable } from '@/components/read-only-pricing-tiers-table';
import {
  UPSTREAM_PROTOCOLS,
  isUpstreamProtocol,
  providerSupportsUpstreamProtocol,
  type UpstreamProtocol,
} from '@/lib/upstream-protocol';
import {
  compareRouteGroupsForDisplay,
  normalizeRouteGroup,
} from '@/lib/route-group-ui';
import { UpstreamProtocolBrandIcon } from '@/components/upstream-brand-logo';
import { ModelVendorIcon } from '@/components/model-vendor-icon';
import { getModelVendorLabel, normalizeModelVendorInput } from '@/lib/model-vendor';
import { useBillingCurrency } from '@/lib/use-billing-currency';
import { useReplaceListPageQuery } from '@/lib/use-replace-list-query';

type RouteProtocolGroupSection<T> = {
  key: string;
  protocol: string;
  protocolLabel: string;
  group: string;
  routes: T[];
};

const PROTOCOL_DISPLAY_LABEL: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  gemini: 'Gemini',
};

const ROUTE_GROUP_CARD_BADGE_CLASS = 'bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200';

function compareRouteProtocolsForDisplay(a: string, b: string): number {
  const knownA = isUpstreamProtocol(a);
  const knownB = isUpstreamProtocol(b);
  if (knownA && knownB) {
    return (UPSTREAM_PROTOCOLS as readonly string[]).indexOf(a) - (UPSTREAM_PROTOCOLS as readonly string[]).indexOf(b);
  }
  if (knownA !== knownB) return knownA ? -1 : 1;
  return a.localeCompare(b, undefined, { sensitivity: 'base' });
}

function getProtocolDisplayLabel(protocol: string): string {
  return PROTOCOL_DISPLAY_LABEL[protocol] ?? protocol;
}

function protocolBadgeClass(protocol: string): string {
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

/**
 * Runtime route pools are selected by request protocol first, then `route_group`.
 * Preserve list order within each protocol + group bucket.
 */
function splitRoutesByProtocolAndRouteGroup<T extends { upstream_protocol: string; route_group?: string | null }>(
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

/**
 * Card list order for routes under one logical model: known `upstream_protocol` in
 * `UPSTREAM_PROTOCOLS` order, unknown protocols after (alphabetically among themselves),
 * then priority desc, then stable tie-breakers.
 */
function compareModelRoutesForCardDisplay(
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

function compareModelVendorsForDisplay(a: string, b: string): number {
  if (a === 'other') return 1;
  if (b === 'other') return -1;
  return getModelVendorLabel(a).localeCompare(getModelVendorLabel(b), undefined, {
    sensitivity: 'base',
  });
}

function formatFactorValue(n: number): string {
  if (!Number.isFinite(n)) return '—';
  if (Number.isInteger(n)) return String(n);
  return String(Number(n.toFixed(6)));
}

function trimTrailingZeros(raw: string): string {
  if (!raw.includes('.')) return raw;
  return raw.replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '');
}

function formatCompactTokens(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${trimTrailingZeros((value / 1_000_000).toFixed(2))}M`;
  if (abs >= 1_000) return `${trimTrailingZeros((value / 1_000).toFixed(2))}K`;
  return String(value);
}

const FACTOR_CHIP_BASE =
  'inline-flex w-[3rem] shrink-0 justify-end rounded-md px-1.5 py-0 text-[10px] font-semibold font-mono tabular-nums leading-4 ring-1 ring-inset';

/** Compact chip display: fixed 2 decimal places so stacked multipliers align. */
function formatFactorValueForChip(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return n.toFixed(2);
}

function formatFactorMultiplier(value: number): string {
  return `×${formatFactorValue(value)}`;
}

function formatFactorMultiplierForChip(value: number): string {
  return `×${formatFactorValueForChip(value)}`;
}

function chargedFactorTooltip(value: number | null): string {
  if (value == null) {
    return 'Charged factor: not set · customer billing multiplier vs catalog price';
  }
  return `Charged factor: ${formatFactorMultiplier(value)} · customer billing multiplier vs catalog price`;
}

function meteredFactorTooltip(value: number | null): string {
  if (value == null) {
    return 'Metered factor: not set · provider cost multiplier vs catalog price';
  }
  return `Metered factor: ${formatFactorMultiplier(value)} · provider cost multiplier vs catalog price`;
}

/** Route list chips: neutral (=1), amber (>1), emerald (<1); floats near 1 count as =1. */
function factorChipClassForValue(n: number): string {
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

/** Catalog pricing_profile tiers × factor → draft rows (used for metered + charged generators). */
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

/** Catalog × provider factor → metered override tier drafts. */
function recomputeOverrideTiersFromProviderFactor(
  factorText: string,
  model: GatewayModel | undefined
): { ok: true; tiers: PricingTierDraftRow[] } | { ok: false } {
  return recomputeCatalogTierDraftsFromFactor(factorText, model);
}

/**
 * Charged factor scales Standard (catalog) into charged override rows.
 * Factor 1 (or empty treated as 1) copies catalog tiers at 1×; routes must persist explicit tiers.
 */
function recomputeChargedTiersFromChargedFactor(
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

const routePricePanelShell: Record<'neutral' | 'charged' | 'metered', string> = {
  neutral:
    'rounded-lg border border-gray-300/90 bg-gray-50/90 p-4 shadow-sm ring-1 ring-gray-200/50',
  charged:
    'rounded-lg border border-blue-200/90 bg-blue-50/45 p-4 shadow-sm ring-1 ring-blue-100/60',
  metered:
    'rounded-lg border border-emerald-200/90 bg-emerald-50/40 p-4 shadow-sm ring-1 ring-emerald-100/60',
};

const routePricePanelHeaderBorder: Record<'neutral' | 'charged' | 'metered', string> = {
  neutral: 'border-b border-gray-200/90',
  charged: 'border-b border-blue-200/80',
  metered: 'border-b border-emerald-200/80',
};

/** Left filter panel: compact grouped nav, low visual weight vs route cards. */
function FilterNavSection({
  title,
  ariaLabel,
  children,
}: {
  title: string;
  ariaLabel: string;
  children: ReactNode;
}) {
  return (
    <nav
      className="overflow-hidden rounded-lg border border-gray-200/70 bg-white/50"
      aria-label={ariaLabel}
    >
      <div className="px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
        {title}
      </div>
      <ul className="space-y-0.5 px-1 pb-1">{children}</ul>
    </nav>
  );
}

function FilterNavButton({
  label,
  count,
  isActive,
  onClick,
}: {
  label: string;
  count?: number;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        aria-current={isActive ? 'true' : undefined}
        className={
          (isActive
            ? 'bg-blue-100/80 text-blue-800 ring-1 ring-blue-200/80 '
            : 'text-gray-600 hover:bg-gray-100/80 hover:text-gray-900 ') +
          'flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors'
        }
      >
        <span className="truncate font-medium" title={label}>
          {label}
        </span>
        {count !== undefined ? (
          <span
            className={
              (isActive ? 'bg-blue-200/60 text-blue-800 ' : 'bg-gray-100/90 text-gray-500 ') +
              'shrink-0 rounded px-1.5 py-0.5 text-[10px] tabular-nums'
            }
          >
            {count}
          </span>
        ) : null}
      </button>
    </li>
  );
}

function RoutePricePanel({
  title,
  subtitle,
  variant,
  children,
  fillHeight = false,
}: {
  title: string;
  subtitle: string;
  variant: 'neutral' | 'charged' | 'metered';
  children: ReactNode;
  /** When true, panel stretches to fill grid cell height (paired columns). */
  fillHeight?: boolean;
}) {
  return (
    <section
      className={`${routePricePanelShell[variant]}${fillHeight ? ' flex h-full min-h-0 min-w-0 flex-col' : ''}`}
    >
      <header className={`shrink-0 pb-3 mb-4 ${routePricePanelHeaderBorder[variant]}`}>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-800">{title}</h4>
        <p className="mt-1.5 text-xs leading-relaxed text-gray-600">{subtitle}</p>
      </header>
      {fillHeight ? (
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      ) : (
        children
      )}
    </section>
  );
}

type RouteFormData = {
  model_id: string;
  provider_id: string;
  provider_model_name: string;
  upstream_protocol: UpstreamProtocol;
  priority: number;
  metered_override_tiers: PricingTierDraftRow[];
  charged_override_tiers: PricingTierDraftRow[];
  custom_params_json: string;
  route_group: string;
  charged_factor: string;
  provider_factor: string;
};

function parsePriceOverride(
  json: string | null
): {
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

function buildFormDataFromRoute(route: GatewayModelRoute, models: GatewayModel[]): RouteFormData {
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

function RoutesContent() {
  const searchParams = useSearchParams();
  const [routes, setRoutes] = useState<(GatewayModelRoute & { model_name?: string; provider_name?: string })[]>([]);
  const [models, setModels] = useState<GatewayModel[]>([]);
  const [providers, setProviders] = useState<GatewayProvider[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingRoute, setEditingRoute] = useState<GatewayModelRoute | null>(null);
  /** 新建弹窗由「复制」预填时，记录源 route id（仅 UI 提示） */
  const [duplicateSourceRouteId, setDuplicateSourceRouteId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    model_id: '',
    provider_id: '',
    provider_model_name: '',
    upstream_protocol: 'openai' as UpstreamProtocol,
    priority: 0,
    metered_override_tiers: [] as PricingTierDraftRow[],
    charged_override_tiers: [] as PricingTierDraftRow[],
    custom_params_json: '',
    route_group: 'default',
    charged_factor: '1',
    provider_factor: '1',
  });
  const [filterVendor, setFilterVendor] = useState('');
  const [filterProviderId, setFilterProviderId] = useState('');
  const [filterRouteGroup, setFilterRouteGroup] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [saveError, setSaveError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [copiedModelId, setCopiedModelId] = useState<string | null>(null);
  /** 粘性 key 路由配置弹窗：目标 model × 协议 × route_group */
  const [stickyDialog, setStickyDialog] = useState<{
    modelId: string;
    modelTitle: string;
    protocol: string;
    protocolLabel: string;
    group: string;
  } | null>(null);
  const [stickyForm, setStickyForm] = useState({ enabled: false, ttl_seconds: '', short_wait_ms: '' });
  const [stickySaving, setStickySaving] = useState(false);
  const [stickyError, setStickyError] = useState('');
  const { currency: billingCurrency } = useBillingCurrency();

  useEffect(() => {
    const vendor = searchParams.get('vendor');
    const providerId = searchParams.get('provider_id');
    const status = searchParams.get('status');
    const routeGroup = searchParams.get('route_group');
    setFilterVendor(vendor ? normalizeModelVendorInput(vendor) : '');
    setFilterProviderId(providerId ?? '');
    setFilterStatus(status ?? '');
    setFilterRouteGroup(routeGroup ?? '');
  }, [searchParams]);

  useReplaceListPageQuery(() => {
    const params = new URLSearchParams();
    if (filterVendor) params.set('vendor', filterVendor);
    if (filterProviderId) params.set('provider_id', filterProviderId);
    if (filterRouteGroup) params.set('route_group', filterRouteGroup);
    if (filterStatus) params.set('status', filterStatus);
    return params;
  }, [filterVendor, filterProviderId, filterRouteGroup, filterStatus]);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [routesRes, modelsRes, providersRes] = await Promise.all([
        fetch('/api/admin/routes'),
        fetch('/api/admin/models'),
        fetch('/api/admin/providers'),
      ]);
      type RouteRow = GatewayModelRoute & { model_name?: string; provider_name?: string };
      const routesData = await readApiJson<RouteRow[]>(routesRes);
      const modelsData = await readApiJson<GatewayModel[]>(modelsRes);
      const providersData = await readApiJson<GatewayProvider[]>(providersRes);

      if (routesData.success) setRoutes(routesData.data || []);
      if (modelsData.success) setModels(modelsData.data || []);
      if (providersData.success) {
        setProviders(
          [...(providersData.data || [])].sort((a, b) =>
            a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
          )
        );
      }
    } catch (error) {
      console.error('Fetch data error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreate = (presetModelId?: string) => {
    setEditingRoute(null);
    setDuplicateSourceRouteId(null);
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
    setFormData({
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
    });
    setShowModal(true);
    setSaveError('');
  };

  const handleEdit = (route: GatewayModelRoute) => {
    setEditingRoute(route);
    setDuplicateSourceRouteId(null);
    setFormData(buildFormDataFromRoute(route, models));
    setShowModal(true);
    setSaveError('');
  };

  const handleDuplicate = (route: GatewayModelRoute) => {
    setEditingRoute(null);
    setDuplicateSourceRouteId(route.id);
    setFormData(buildFormDataFromRoute(route, models));
    setShowModal(true);
    setSaveError('');
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this route?')) return;

    setIsDeleting(true);
    try {
      const response = await fetch(`/api/admin/routes/${encodeURIComponent(id)}`, { method: 'DELETE' });
      const data = await readApiJson(response);
      if (data.success) {
        setShowModal(false);
        setEditingRoute(null);
        setDuplicateSourceRouteId(null);
        fetchData();
      } else {
        alert(data.message || 'Delete failed');
      }
    } catch (error) {
      console.error('Delete error:', error);
      alert('Delete failed');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleToggleStatus = async (route: GatewayModelRoute & { model_name?: string; provider_name?: string }) => {
    const newStatus = route.status === 'active' ? 'inactive' : 'active';
    setTogglingId(route.id);
    try {
      const response = await fetch(`/api/admin/routes/${encodeURIComponent(route.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      const data = await readApiJson(response);
      if (data.success) {
        setRoutes((prev) =>
          prev.map((r) => (r.id === route.id ? { ...r, status: newStatus } : r))
        );
      } else {
        alert(data.message || 'Update failed');
      }
    } catch (error) {
      console.error('Toggle status error:', error);
      alert('Update failed, please try again');
    } finally {
      setTogglingId(null);
    }
  };

  const copyModelId = async (modelId: string) => {
    try {
      await navigator.clipboard.writeText(modelId);
      setCopiedModelId(modelId);
      setTimeout(() => setCopiedModelId((current) => (current === modelId ? null : current)), 2000);
    } catch (error) {
      console.error('Copy model id failed:', error);
    }
  };

  const handleSave = async () => {
    setSaveError('');
    setIsSaving(true);

    try {
      const normalizeJsonText = (raw: string, fieldName: string): string | null => {
        const text = raw.trim();
        if (!text) return null;
        try {
          const parsed = JSON.parse(text) as unknown;
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error(`${fieldName} must be a JSON object`);
          }
          return JSON.stringify(parsed);
        } catch (err) {
          throw new Error(err instanceof Error ? err.message : `${fieldName} must be valid JSON`);
        }
      };

      const priceOverride: Record<string, unknown> = {};
      const profileSerialized = serializeDraftRowsToProfileJson(formData.metered_override_tiers);
      if (!profileSerialized.ok) {
        throw new Error(profileSerialized.error);
      }
      if (!profileSerialized.json) {
        throw new Error('Metered cost is required: add at least one tier (use Provider factor × Standard or edit manually).');
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
      priceOverride.charged = JSON.parse(chargedSerialized.json) as {
        tiers: unknown;
      };
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
      let response: Response;
      if (editingRoute) {
        response = await fetch(`/api/admin/routes/${encodeURIComponent(editingRoute.id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } else {
        response = await fetch('/api/admin/routes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }

      const data = await readApiJson(response);

      if (data.success) {
        setShowModal(false);
        setEditingRoute(null);
        setDuplicateSourceRouteId(null);
        fetchData();
      } else {
        setSaveError(data.message || 'Save failed');
      }
    } catch (error) {
      console.error('Save error:', error);
      setSaveError(error instanceof Error ? error.message : 'Save failed, please try again');
    } finally {
      setIsSaving(false);
    }
  };

  const modelMeta = useMemo(() => {
    const map = new Map<string, GatewayModel>();
    for (const m of models) {
      map.set(m.id, m);
    }
    return map;
  }, [models]);

  const handleOpenStickyDialog = (
    modelId: string,
    modelTitle: string,
    protocol: string,
    protocolLabel: string,
    group: string
  ) => {
    const raw = modelMeta.get(modelId)?.sticky_config ?? null;
    const parsed = parseModelStickyConfig(raw);
    const rule = parsed?.rules.get(stickyRuleKey(protocol, group)) ?? null;
    setStickyForm({
      enabled: Boolean(rule?.enabled),
      ttl_seconds: rule?.ttlSeconds != null ? String(rule.ttlSeconds) : '',
      short_wait_ms: rule?.shortWaitMs != null ? String(rule.shortWaitMs) : '',
    });
    setStickyError('');
    setStickyDialog({ modelId, modelTitle, protocol, protocolLabel, group });
  };

  const handleSaveSticky = async () => {
    if (!stickyDialog) return;
    const ttl = stickyForm.ttl_seconds.trim() === '' ? null : parseInt(stickyForm.ttl_seconds, 10);
    const wait = stickyForm.short_wait_ms.trim() === '' ? null : parseInt(stickyForm.short_wait_ms, 10);
    if (stickyForm.enabled) {
      if (ttl != null && (!Number.isFinite(ttl) || ttl <= 0)) {
        setStickyError('Idle TTL must be a positive integer (seconds)');
        return;
      }
      if (wait != null && (!Number.isFinite(wait) || wait <= 0)) {
        setStickyError('Short wait must be a positive integer (ms)');
        return;
      }
    }
    setStickySaving(true);
    setStickyError('');
    try {
      // Preserve other protocol×group rules and top-level defaults; only touch this rule key.
      const raw = modelMeta.get(stickyDialog.modelId)?.sticky_config ?? null;
      let existing: Record<string, unknown> = {};
      try {
        existing = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      } catch {
        existing = {};
      }
      const existingRules =
        existing.rules && typeof existing.rules === 'object' && !Array.isArray(existing.rules)
          ? { ...(existing.rules as Record<string, unknown>) }
          : {};
      const key = stickyRuleKey(stickyDialog.protocol, stickyDialog.group);
      for (const k of Object.keys(existingRules)) {
        const idx = k.indexOf(':');
        if (idx > 0 && stickyRuleKey(k.slice(0, idx), k.slice(idx + 1)) === key) {
          delete existingRules[k];
        }
      }
      if (stickyForm.enabled) {
        const rule: Record<string, unknown> = { enabled: true };
        if (ttl != null) rule.ttl_seconds = ttl;
        if (wait != null) rule.short_wait_ms = wait;
        existingRules[key] = rule;
      }
      let nextStickyConfig: string | null = null;
      if (Object.keys(existingRules).length > 0) {
        const next: Record<string, unknown> = { rules: existingRules };
        if (typeof existing.ttl_seconds === 'number') next.ttl_seconds = existing.ttl_seconds;
        if (typeof existing.short_wait_ms === 'number') next.short_wait_ms = existing.short_wait_ms;
        nextStickyConfig = JSON.stringify(next);
      }
      const response = await fetch(`/api/admin/models/${encodeURIComponent(stickyDialog.modelId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sticky_config: nextStickyConfig }),
      });
      const data = await readApiJson(response);
      if (!data.success) {
        setStickyError(data.message || 'Save failed, please try again');
        return;
      }
      setStickyDialog(null);
      await fetchData();
    } catch (error) {
      setStickyError(error instanceof Error ? error.message : 'Save failed, please try again');
    } finally {
      setStickySaving(false);
    }
  };

  /** Distinct route_group values present in loaded routes (normalized), sorted for the filter dropdown. */
  const distinctRouteGroups = useMemo(() => {
    const set = new Set<string>();
    for (const r of routes) {
      set.add(normalizeRouteGroup(r.route_group));
    }
    return [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }, [routes]);

  const routeGroupFilterOptions = useMemo(() => {
    const list = [...distinctRouteGroups];
    if (filterRouteGroup && !list.includes(filterRouteGroup)) {
      list.push(filterRouteGroup);
    }
    return list.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }, [distinctRouteGroups, filterRouteGroup]);

  const vendorFilterOptions = useMemo(() => {
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
  }, [models, routes, modelMeta]);

  const providerRouteCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of routes) {
      counts.set(r.provider_id, (counts.get(r.provider_id) ?? 0) + 1);
    }
    return counts;
  }, [routes]);

  const routeGroupCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of routes) {
      const g = normalizeRouteGroup(r.route_group);
      counts.set(g, (counts.get(g) ?? 0) + 1);
    }
    return counts;
  }, [routes]);

  const statusCounts = useMemo(() => {
    let active = 0;
    let inactive = 0;
    for (const r of routes) {
      if (r.status === 'active') active += 1;
      else inactive += 1;
    }
    return { all: routes.length, active, inactive };
  }, [routes]);

  /** Groups routes by logical model; each model list is ordered by protocol group then priority. */
  const routesByModel = useMemo(() => {
    const modelMatchesVendor = (modelId: string) => {
      if (!filterVendor) return true;
      return normalizeModelVendorInput(modelMeta.get(modelId)?.vendor) === filterVendor;
    };

    const routeByModelId = new Map<string, (typeof routes)[number][]>();
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

    // Ensure models without routes are still visible for quick onboarding.
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
      .filter((group): group is { model_id: string; title: string; groupRoutes: (typeof routes)[number][]; activeCount: number; vendor: string } => group !== null);
  }, [routes, models, modelMeta, filterVendor, filterProviderId, filterRouteGroup, filterStatus]);

  const routeCards = useMemo(() => {
    return [...routesByModel].sort((a, b) => {
      const ma = modelMeta.get(a.model_id);
      const mb = modelMeta.get(b.model_id);
      return compareModelsByReleasedAtDesc(
        ma ?? { id: a.model_id, display_name: a.title },
        mb ?? { id: b.model_id, display_name: b.title }
      );
    });
  }, [routesByModel, modelMeta]);

  const routeCardVendorGroups = useMemo(() => {
    if (filterVendor) {
      return [{ vendor: filterVendor, cards: routeCards, showHeader: false }];
    }

    const byVendor = new Map<string, typeof routeCards>();
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
  }, [routeCards, filterVendor]);

  const visibleModelCount = routesByModel.length;
  const visibleRouteCount = useMemo(
    () => routesByModel.reduce((sum, g) => sum + g.groupRoutes.length, 0),
    [routesByModel]
  );

  const hasActiveFilters = Boolean(
    filterVendor || filterProviderId || filterRouteGroup || filterStatus
  );

  const clearAllFilters = () => {
    setFilterVendor('');
    setFilterProviderId('');
    setFilterRouteGroup('');
    setFilterStatus('');
  };

  const activeFilterSummary = useMemo(() => {
    const parts: string[] = [];
    if (filterStatus) parts.push(filterStatus === 'active' ? 'Active' : 'Inactive');
    if (filterRouteGroup) parts.push(`Group: ${filterRouteGroup}`);
    if (filterVendor) parts.push(getModelVendorLabel(filterVendor));
    if (filterProviderId) {
      const p = providers.find((x) => x.id === filterProviderId);
      parts.push(p?.name || filterProviderId);
    }
    return parts;
  }, [filterStatus, filterRouteGroup, filterVendor, filterProviderId, providers]);

  const selectedProvider = useMemo(
    () => providers.find((p) => p.id === formData.provider_id),
    [providers, formData.provider_id]
  );
  const selectedModel = useMemo(
    () => models.find((m) => m.id === formData.model_id),
    [models, formData.model_id]
  );

  /** 目录模型完整阶梯（标准价侧） */
  const catalogStandardTierRows = useMemo(() => {
    if (!selectedModel) return [];
    return getCatalogPricingTierRows(selectedModel, billingCurrency);
  }, [selectedModel, billingCurrency]);

  const allowedProtocolsForProvider = useMemo((): UpstreamProtocol[] => {
    if (!selectedProvider) return [];
    return UPSTREAM_PROTOCOLS.filter((proto) => providerSupportsUpstreamProtocol(proto, selectedProvider));
  }, [selectedProvider]);

  /** Keep upstream_protocol valid when Provider changes or modal opens with stale data */
  useEffect(() => {
    if (!showModal || !selectedProvider || allowedProtocolsForProvider.length === 0) return;
    setFormData((fd) => {
      if (allowedProtocolsForProvider.includes(fd.upstream_protocol)) return fd;
      return { ...fd, upstream_protocol: allowedProtocolsForProvider[0]! };
    });
  }, [showModal, formData.provider_id, selectedProvider, allowedProtocolsForProvider]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-600">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-w-0 overflow-x-hidden bg-gray-100/90 p-4 pb-6 sm:p-6 lg:p-8">
      {/* Page title */}
      <div className="mb-5 sm:mb-6">
        <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">Model Routes</h1>
        <p className="mt-1 text-sm text-gray-500">Configure model-to-provider routing</p>
      </div>

      {/* Workbench: filter panel (left) + route configurations (right) */}
      <div className="overflow-hidden rounded-2xl border border-gray-200/80 bg-white/70 shadow-sm ring-1 ring-black/[0.02]">
        <div className="flex min-w-0 flex-col lg:flex-row lg:items-start">
          {/* Filter panel — scroll with main; sticky when shorter than viewport (no nested scrollbar) */}
          <aside className="w-full shrink-0 border-b border-gray-200/80 bg-slate-50/80 lg:sticky lg:top-0 lg:w-60 lg:self-start lg:border-b-0 lg:border-r">
            <div className="space-y-3 p-4">
              <div>
                <h2 className="text-sm font-semibold text-gray-900">Filters</h2>
                <p className="mt-0.5 text-xs text-gray-500">Narrow models and routes</p>
              </div>

              <div className="flex items-center justify-between gap-2 rounded-lg border border-gray-200/60 bg-white/60 px-3 py-2">
                <span className="text-xs text-gray-600">
                  <span className="font-semibold tabular-nums text-gray-900">{visibleModelCount}</span>{' '}
                  models ·{' '}
                  <span className="font-semibold tabular-nums text-gray-900">{visibleRouteCount}</span>{' '}
                  routes
                </span>
                {hasActiveFilters ? (
                  <button
                    type="button"
                    onClick={clearAllFilters}
                    className="shrink-0 text-xs font-medium text-blue-600 hover:text-blue-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 rounded"
                  >
                    Clear
                  </button>
                ) : null}
              </div>

              <FilterNavSection title="Status" ariaLabel="Status filter">
                <FilterNavButton
                  label="All"
                  count={statusCounts.all}
                  isActive={!filterStatus}
                  onClick={() => setFilterStatus('')}
                />
                <FilterNavButton
                  label="Active"
                  count={statusCounts.active}
                  isActive={filterStatus === 'active'}
                  onClick={() => setFilterStatus('active')}
                />
                <FilterNavButton
                  label="Inactive"
                  count={statusCounts.inactive}
                  isActive={filterStatus === 'inactive'}
                  onClick={() => setFilterStatus('inactive')}
                />
              </FilterNavSection>

              <FilterNavSection title="Route Group" ariaLabel="Route group filter">
                <FilterNavButton
                  label="All"
                  count={routes.length}
                  isActive={!filterRouteGroup}
                  onClick={() => setFilterRouteGroup('')}
                />
                {routeGroupFilterOptions.map((g) => (
                  <FilterNavButton
                    key={g}
                    label={g}
                    count={routeGroupCounts.get(g) ?? 0}
                    isActive={filterRouteGroup === g}
                    onClick={() => setFilterRouteGroup(g)}
                  />
                ))}
              </FilterNavSection>

              <FilterNavSection title="Vendor" ariaLabel="Vendor filter">
                <FilterNavButton
                  label="All"
                  count={routes.length}
                  isActive={!filterVendor}
                  onClick={() => setFilterVendor('')}
                />
                {vendorFilterOptions.map(({ key, label, count }) => (
                  <FilterNavButton
                    key={key}
                    label={label}
                    count={count}
                    isActive={filterVendor === key}
                    onClick={() => setFilterVendor(key)}
                  />
                ))}
              </FilterNavSection>

              <FilterNavSection title="Provider" ariaLabel="Provider filter">
                <FilterNavButton
                  label="All"
                  count={routes.length}
                  isActive={!filterProviderId}
                  onClick={() => setFilterProviderId('')}
                />
                {providers.map((p) => {
                  const label = p.name ? `${p.name} (${p.id})` : p.id;
                  return (
                    <FilterNavButton
                      key={p.id}
                      label={label}
                      count={providerRouteCounts.get(p.id) ?? 0}
                      isActive={filterProviderId === p.id}
                      onClick={() => setFilterProviderId(p.id)}
                    />
                  );
                })}
              </FilterNavSection>
            </div>
          </aside>

          {/* Route configuration workspace */}
          <section className="min-w-0 flex-1 bg-slate-100/70">
            <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-gray-200/80 bg-white/95 px-4 py-3 backdrop-blur-sm sm:px-6">
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-gray-900">Route Configurations</h2>
                {activeFilterSummary.length > 0 ? (
                  <p className="mt-0.5 truncate text-xs text-gray-500" title={activeFilterSummary.join(' · ')}>
                    Filtered by: {activeFilterSummary.join(' · ')}
                  </p>
                ) : (
                  <p className="mt-0.5 text-xs text-gray-500">All models and routes</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => handleCreate()}
                className="flex shrink-0 items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <PlusIcon className="h-5 w-5" />
                New Route
              </button>
            </div>

            <div className="bg-slate-100/70 p-4 sm:p-6">
              {routesByModel.length === 0 ? (
                <div className="rounded-xl border border-dashed border-gray-300 bg-white/80 py-16 text-center text-gray-500 shadow-sm">
                  <p className="text-sm font-medium text-gray-600">No models or routes found</p>
                  {hasActiveFilters ? (
                    <p className="mt-1 text-xs text-gray-500">
                      Try adjusting filters or{' '}
                      <button
                        type="button"
                        onClick={clearAllFilters}
                        className="font-medium text-blue-600 hover:text-blue-800 focus:outline-none focus-visible:underline"
                      >
                        clear all filters
                      </button>
                    </p>
                  ) : null}
                </div>
              ) : (
                <div className={filterVendor ? '' : 'space-y-8'}>
                  {routeCardVendorGroups.map(({ vendor, cards, showHeader }, vendorGroupIdx) => (
                    <section key={vendor} className="min-w-0">
                      {showHeader ? (
                        <div
                          className={
                            (vendorGroupIdx > 0 ? 'border-t border-gray-200/80 pt-5 ' : '') +
                            'mb-3 flex items-center justify-between gap-3'
                          }
                        >
                          <div className="flex min-w-0 items-center gap-2.5">
                            <ModelVendorIcon vendor={vendor} size="default" />
                            <div className="min-w-0">
                              <h3 className="truncate text-sm font-semibold text-gray-900">
                                {getModelVendorLabel(vendor)}
                              </h3>
                              <p className="text-xs text-gray-500">Vendor</p>
                            </div>
                          </div>
                          <span className="shrink-0 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium tabular-nums text-gray-600 ring-1 ring-inset ring-gray-200">
                            {cards.length} model{cards.length === 1 ? '' : 's'}
                          </span>
                        </div>
                      ) : null}
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-5 xl:grid-cols-3 xl:gap-6 2xl:grid-cols-4">
                        {cards.map(({ model_id, title, groupRoutes, activeCount }) => {
                          const meta = modelMeta.get(model_id);
                          const modelStatsTitle = `Context: ${meta?.context_window ?? '—'} · Max output: ${meta?.max_tokens ?? '—'}`;
                          return (
                            <div
                              key={model_id}
                              className="group flex min-w-0 flex-col overflow-hidden rounded-xl border border-gray-200/80 bg-white shadow-sm transition-all duration-200 ease-out hover:-translate-y-1 hover:border-blue-300 hover:bg-blue-50/30 hover:shadow-lg hover:shadow-blue-100/70 hover:ring-1 hover:ring-blue-200 focus-within:border-blue-400 focus-within:bg-blue-50/30 focus-within:shadow-lg focus-within:ring-2 focus-within:ring-blue-500 active:translate-y-0"
                            >
                              <div className="flex items-start justify-between gap-2 border-b border-gray-100 bg-white px-4 py-3 transition-colors group-hover:bg-blue-50/30 group-focus-within:bg-blue-50/30">
                                <div className="min-w-0 flex-1">
                                  <div className="flex min-w-0 items-center gap-1">
                                    <h4
                                      className="min-w-0 truncate text-sm font-semibold leading-snug text-gray-900"
                                      title={title}
                                    >
                                      {title}
                                    </h4>
                                    <button
                                      type="button"
                                      onClick={() => void copyModelId(model_id)}
                                      className={`shrink-0 rounded-md p-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 ${
                                        copiedModelId === model_id
                                          ? 'text-green-600 hover:bg-green-50 hover:text-green-700'
                                          : 'text-gray-400 hover:bg-gray-100 hover:text-gray-700'
                                      }`}
                                      title={copiedModelId === model_id ? '已复制 model id' : `Copy model id: ${model_id}`}
                                      aria-label={`Copy model id ${model_id}`}
                                    >
                                      <ClipboardDocumentIcon className="h-4 w-4" />
                                    </button>
                                  </div>
                                  <div className="mt-0.5 flex min-w-0 items-center gap-1.5">
                                    <p className="min-w-0 truncate text-[11px] text-gray-500" title={modelStatsTitle}>
                                      Context {formatCompactTokens(meta?.context_window)} · Max output{' '}
                                      {formatCompactTokens(meta?.max_tokens)}
                                    </p>
                                    {copiedModelId === model_id ? (
                                      <span className="shrink-0 rounded bg-green-50 px-1.5 py-0.5 text-[10px] font-medium leading-4 text-green-700 ring-1 ring-inset ring-green-200">
                                        已复制
                                      </span>
                                    ) : null}
                                  </div>
                                </div>
                                <div className="flex shrink-0 items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => handleCreate(model_id)}
                                    className="rounded-md p-1 text-blue-600 hover:bg-blue-50 hover:text-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1"
                                    title={`New route for ${title}`}
                                    aria-label={`New route for ${title}`}
                                  >
                                    <PlusIcon className="h-5 w-5" />
                                  </button>
                                  <span
                                    className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-semibold tabular-nums ring-1 ring-inset ${
                                      activeCount === 0
                                        ? 'bg-red-50 text-red-700 ring-red-200'
                                        : 'bg-green-50 text-green-700 ring-green-200'
                                    }`}
                                    title={`${activeCount} active / ${groupRoutes.length} total routes`}
                                  >
                                    {activeCount}/{groupRoutes.length}
                                  </span>
                                </div>
                              </div>
                              {groupRoutes.length === 0 ? (
                                <div className="flex flex-1 items-center justify-center px-4 py-6 text-center">
                                  <div>
                                    <p className="text-sm text-gray-600">No routes yet</p>
                                    <p className="mt-1 text-xs text-gray-500">Click + to add the first route</p>
                                  </div>
                                </div>
                              ) : (
                                <div className="flex min-h-0 flex-1 flex-col">
                                  {(() => {
                                    const routeSections = splitRoutesByProtocolAndRouteGroup(groupRoutes);
                                    return routeSections.map((section, sectionIdx) => (
                                      <div
                                        key={section.key}
                                        className={sectionIdx > 0 ? 'border-t border-gray-200/80' : ''}
                                      >
                                        <div
                                          className="flex items-center gap-2 border-b border-gray-100 bg-gray-50/60 px-4 py-1.5 transition-colors group-hover:bg-blue-50/40 group-focus-within:bg-blue-50/40"
                                          role="presentation"
                                        >
                                          <div
                                            className="flex min-w-0 flex-1 items-center gap-2"
                                            title={`upstream_protocol: ${section.protocol} · route_group: ${section.group}`}
                                          >
                                            <span
                                              className={`inline-flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[11px] font-semibold leading-4 ring-1 ring-inset ${protocolBadgeClass(section.protocol)}`}
                                            >
                                              <UpstreamProtocolBrandIcon protocol={section.protocol} />
                                              {section.protocolLabel}
                                            </span>
                                            <span
                                              className={`inline-flex min-w-0 items-center rounded-md px-2 py-0.5 text-[11px] font-semibold leading-4 ${ROUTE_GROUP_CARD_BADGE_CLASS}`}
                                            >
                                              <span className="truncate">{section.group}</span>
                                            </span>
                                          </div>
                                          {(() => {
                                            const stickyRule = resolveStickyRouteRule(
                                              modelMeta.get(model_id)?.sticky_config ?? null,
                                              section.protocol,
                                              section.group
                                            );
                                            return (
                                              <button
                                                type="button"
                                                onClick={() =>
                                                  handleOpenStickyDialog(
                                                    model_id,
                                                    title,
                                                    section.protocol,
                                                    section.protocolLabel,
                                                    section.group
                                                  )
                                                }
                                                className={`inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold leading-4 ring-1 ring-inset transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 ${
                                                  stickyRule
                                                    ? 'bg-violet-50 text-violet-700 ring-violet-200 hover:bg-violet-100'
                                                    : 'bg-white text-gray-400 ring-gray-200 hover:bg-gray-100 hover:text-gray-600'
                                                }`}
                                                title={
                                                  stickyRule
                                                    ? `Sticky key routing on · idle TTL ${stickyRule.ttlSeconds}s · short wait ${stickyRule.shortWaitMs}ms (click to configure)`
                                                    : 'Sticky key routing off (click to configure)'
                                                }
                                              >
                                                <LinkIcon className="h-3 w-3" />
                                                {stickyRule ? `Sticky ${stickyRule.ttlSeconds}s` : 'Sticky off'}
                                              </button>
                                            );
                                          })()}
                                        </div>
                                        <ul className="flex flex-col divide-y divide-gray-100">
                                          {section.routes.map((route) => {
                                            const chargedF = parseChargedFactorFromPriceOverride(route.price_override);
                                            const meteredF = parseMeteredFactorFromPriceOverride(route.price_override);
                                            const chargedDisp =
                                              chargedF != null && Number.isFinite(chargedF) ? chargedF : null;
                                            const meteredDisp =
                                              meteredF != null && Number.isFinite(meteredF) ? meteredF : null;
                                            return (
                                              <li
                                                key={route.id}
                                                className="flex items-start gap-3 px-4 py-2.5 transition-colors hover:bg-gray-50/80"
                                              >
                                                <div className="shrink-0 pt-0.5">
                                                  <input
                                                    type="checkbox"
                                                    checked={route.status === 'active'}
                                                    disabled={togglingId === route.id}
                                                    onChange={() => handleToggleStatus(route)}
                                                    className="h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50"
                                                    aria-label={
                                                      route.status === 'active'
                                                        ? 'Route enabled (uncheck to disable)'
                                                        : 'Route disabled (check to enable)'
                                                    }
                                                  />
                                                </div>
                                                <div className="flex min-w-0 flex-1 items-start gap-3">
                                                  <button
                                                    type="button"
                                                    onClick={() => handleEdit(route)}
                                                    className="-mx-1 min-w-0 flex-1 rounded-md px-1 py-0.5 text-left hover:bg-gray-100/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1"
                                                  >
                                                    <div className="flex min-w-0 flex-col gap-0.5 text-xs leading-snug">
                                                      <div className="flex min-w-0 items-center gap-2">
                                                        <div
                                                          className="flex shrink-0 items-center"
                                                          title="Priority (failover order)"
                                                        >
                                                          <span
                                                            className="text-[11px] font-semibold tabular-nums text-gray-600"
                                                          >
                                                            {route.priority}
                                                          </span>
                                                        </div>
                                                        <span
                                                          className="min-w-0 flex-1 truncate font-medium text-gray-900"
                                                          title={route.provider_name || route.provider_id}
                                                        >
                                                          {route.provider_name || route.provider_id}
                                                        </span>
                                                      </div>
                                                      <div
                                                        className="min-w-0 truncate text-left font-mono text-[11px] text-gray-600"
                                                        title={route.provider_model_name}
                                                      >
                                                        {route.provider_model_name}
                                                      </div>
                                                    </div>
                                                  </button>
                                                  <div
                                                    className="flex shrink-0 flex-col items-end justify-start gap-1.5 self-stretch pt-0.5 text-right"
                                                    role="group"
                                                    aria-label="Charged and metered catalog factors"
                                                  >
                                                    <span
                                                      className={
                                                        chargedDisp != null
                                                          ? factorChipClassForValue(chargedDisp)
                                                          : `${FACTOR_CHIP_BASE} bg-zinc-50 text-zinc-400 ring-zinc-200/90`
                                                      }
                                                      title={chargedFactorTooltip(chargedDisp)}
                                                      aria-label={
                                                        chargedDisp != null
                                                          ? `Charged factor ${formatFactorMultiplier(chargedDisp)}`
                                                          : 'Charged factor not set'
                                                      }
                                                    >
                                                      {chargedDisp != null ? formatFactorMultiplierForChip(chargedDisp) : '—'}
                                                    </span>
                                                    <span
                                                      className={
                                                        meteredDisp != null
                                                          ? factorChipClassForValue(meteredDisp)
                                                          : `${FACTOR_CHIP_BASE} bg-zinc-50 text-zinc-400 ring-zinc-200/90`
                                                      }
                                                      title={meteredFactorTooltip(meteredDisp)}
                                                      aria-label={
                                                        meteredDisp != null
                                                          ? `Metered factor ${formatFactorMultiplier(meteredDisp)}`
                                                          : 'Metered factor not set'
                                                      }
                                                    >
                                                      {meteredDisp != null ? formatFactorMultiplierForChip(meteredDisp) : '—'}
                                                    </span>
                                                  </div>
                                                </div>
                                              </li>
                                            );
                                          })}
                                        </ul>
                                      </div>
                                    ));
                                  })()}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>
      </div>

      {/* Modal */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !isSaving && !isDeleting) {
              setShowModal(false);
            }
          }}
        >
          <div
            className="flex max-h-[95vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl bg-white shadow-xl ring-1 ring-black/5"
            role="dialog"
            aria-modal="true"
            aria-labelledby="route-modal-title"
          >
            <div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-5 py-4">
              <div>
                <h2 id="route-modal-title" className="text-lg font-semibold text-gray-900">
                  {editingRoute ? 'Edit Route' : 'New Route'}
                </h2>
                {!editingRoute && duplicateSourceRouteId && (
                  <p className="mt-1 text-xs text-gray-500">
                    Pre-filled from route{' '}
                    <code className="rounded border border-gray-200 bg-gray-50 px-1 py-0.5 font-mono text-[11px]">
                      {duplicateSourceRouteId}
                    </code>
                    . Review fields before saving.
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="rounded-md p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                disabled={isSaving || isDeleting}
                aria-label="Close"
              >
                <span className="block text-xl leading-none" aria-hidden>
                  ×
                </span>
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
              {saveError && (
                <div className="mb-5 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">{saveError}</div>
              )}

              <div className="space-y-5">
                {/* 1. Route mapping + routing */}
                <section className="rounded-lg border border-gray-200 bg-gray-50/80 p-4">
                  <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">Basic mapping & routing</h3>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-700">Model *</label>
                      <select
                        value={formData.model_id}
                        onChange={(e) => {
                          const nextModelId = e.target.value;
                          setFormData((prev) => {
                            const model = models.find((m) => m.id === nextModelId);
                            let charged = prev.charged_override_tiers;
                            let metered = prev.metered_override_tiers;
                            let pf = prev.provider_factor;
                            if (model) {
                              if (charged.length === 0) {
                                const rc = recomputeChargedTiersFromChargedFactor(prev.charged_factor, model);
                                if (rc.ok) charged = rc.tiers;
                              }
                              if (metered.length === 0) {
                                const pfText = pf.trim() === '' ? '1' : pf;
                                const rm = recomputeOverrideTiersFromProviderFactor(pfText, model);
                                if (rm.ok) {
                                  metered = rm.tiers;
                                  if (pf.trim() === '') pf = '1';
                                }
                              }
                            }
                            return {
                              ...prev,
                              model_id: nextModelId,
                              charged_override_tiers: charged,
                              metered_override_tiers: metered,
                              provider_factor: pf,
                            };
                          });
                        }}
                        className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                        required
                      >
                        <option value="">Select a model</option>
                        {models.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.display_name ? `${m.display_name} (${m.id})` : m.id}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-700">Provider *</label>
                      <select
                        value={formData.provider_id}
                        onChange={(e) => {
                          const nextId = e.target.value;
                          const nextProvider = providers.find((p) => p.id === nextId);
                          const allowed =
                            nextProvider != null
                              ? UPSTREAM_PROTOCOLS.filter((proto) => providerSupportsUpstreamProtocol(proto, nextProvider))
                              : [];
                          setFormData((fd) => {
                            let nextProto = fd.upstream_protocol;
                            if (allowed.length > 0 && !allowed.includes(nextProto)) {
                              nextProto = allowed[0]!;
                            }
                            return { ...fd, provider_id: nextId, upstream_protocol: nextProto };
                          });
                        }}
                        className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                        required
                      >
                        <option value="">Select a provider</option>
                        {providers.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name ? `${p.name} (${p.id})` : p.id}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-700">Upstream protocol</label>
                      <select
                        value={
                          allowedProtocolsForProvider.includes(formData.upstream_protocol)
                            ? formData.upstream_protocol
                            : (allowedProtocolsForProvider[0] ?? formData.upstream_protocol)
                        }
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            upstream_protocol: e.target.value as UpstreamProtocol,
                          })
                        }
                        disabled={!selectedProvider || allowedProtocolsForProvider.length === 0}
                        className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500"
                      >
                        {allowedProtocolsForProvider.length === 0 ? (
                          <option value="">—</option>
                        ) : (
                          allowedProtocolsForProvider.map((p) => (
                            <option key={p} value={p}>
                              {p}
                            </option>
                          ))
                        )}
                      </select>
                      <p className="mt-1.5 text-xs text-gray-500">
                        {selectedProvider
                          ? 'Only protocols with a configured base URL on this provider.'
                          : 'Select a provider first.'}
                      </p>
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-700">Provider model name *</label>
                      <input
                        type="text"
                        value={formData.provider_model_name}
                        onChange={(e) => setFormData({ ...formData, provider_model_name: e.target.value })}
                        className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 font-mono text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                        placeholder="e.g. gpt-4o-2024-11-20"
                        required
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-700">Route group</label>
                      <input
                        type="text"
                        value={formData.route_group}
                        onChange={(e) => setFormData({ ...formData, route_group: e.target.value })}
                        className="w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                        placeholder="default"
                      />
                      <p className="mt-1 text-xs text-gray-500">
                        Routing pool for client{' '}
                        <code className="rounded bg-gray-100 px-1 text-[11px]">modelId:group</code>. Omit{' '}
                        <code className="rounded bg-gray-100 px-1 text-[11px]">:group</code> →{' '}
                        <span className="font-medium">default</span> only. No active routes → 400.
                      </p>
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-700">Priority</label>
                      <input
                        type="number"
                        value={formData.priority}
                        onChange={(e) => setFormData({ ...formData, priority: parseInt(e.target.value, 10) || 0 })}
                        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm tabular-nums focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                      />
                      <p className="mt-1 text-xs text-gray-500">Higher = tried first within the same protocol group.</p>
                    </div>
                  </div>
                </section>

                {/* 2. Billing: Standard full width; Charged + Metered two columns on large screens */}
                <div className="space-y-5">
                  <RoutePricePanel
                    variant="neutral"
                    title="Standard (catalog)"
                    subtitle="Catalog baseline from the model’s pricing_profile. Read-only; use it as reference when editing charged or metered overrides."
                  >
                    <div className="min-h-0 flex-1">
                      <ReadOnlyPricingTiersTable
                        rows={catalogStandardTierRows}
                        emptyLabel={
                          selectedModel
                            ? 'This model has no catalog pricing_profile.'
                            : 'Select a model to load catalog tiers.'
                        }
                        tableTitle="Read-only: catalog standard rates"
                        billingCurrencyCode={billingCurrency}
                      />
                    </div>
                  </RoutePricePanel>

                  <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 lg:items-stretch">
                    <div className="flex h-full min-h-0 min-w-0 flex-col">
                      <RoutePricePanel
                        fillHeight
                        variant="charged"
                        title="Charged cost"
                        subtitle="Required: saved as price_override.charged and drives charged_cost. Charged factor multiplies Standard (catalog) into rows—default 1 copies catalog tiers; edit tiers after scaling. charged_factor is stored in price_override JSON."
                      >
                        <PricingTiersEditor
                          rows={formData.charged_override_tiers}
                          onChange={(rows) => setFormData({ ...formData, charged_override_tiers: rows })}
                          billingCurrencyCode={billingCurrency}
                          minRows={0}
                          toolbarStart={
                            <div className="flex items-center gap-1.5 border-r border-gray-200 pr-3">
                              <label
                                htmlFor="user-cost-charged-factor"
                                className="whitespace-nowrap text-[11px] font-medium text-gray-600"
                              >
                                Charged factor
                              </label>
                              <input
                                id="user-cost-charged-factor"
                                type="text"
                                inputMode="decimal"
                                value={formData.charged_factor}
                                title="Multiplies Standard (catalog) into charged tiers when the selected model has pricing_profile. Default 1 copies catalog at 1×."
                                onChange={(e) => {
                                  const next = e.target.value;
                                  setFormData((prev) => {
                                    const model = models.find((m) => m.id === prev.model_id);
                                    const r = recomputeChargedTiersFromChargedFactor(next, model);
                                    if (r.ok) {
                                      return {
                                        ...prev,
                                        charged_factor: next,
                                        charged_override_tiers: r.tiers,
                                      };
                                    }
                                    return { ...prev, charged_factor: next };
                                  });
                                }}
                                className="w-[4.25rem] rounded-md border border-gray-300 bg-white px-2 py-1 text-xs tabular-nums focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/30"
                                placeholder="1"
                              />
                            </div>
                          }
                        />
                      </RoutePricePanel>
                    </div>

                    <div className="flex h-full min-h-0 min-w-0 flex-col">
                      <RoutePricePanel
                        fillHeight
                        variant="metered"
                        title="Metered cost"
                        subtitle="Required: saved as price_override.metered and drives metered_cost. Provider factor multiplies Standard (catalog) into rows—default 1 copies catalog tiers; edit tiers after scaling. metered_factor is written to price_override on save (same numeric value)."
                      >
                        <PricingTiersEditor
                          rows={formData.metered_override_tiers}
                          onChange={(rows) => setFormData({ ...formData, metered_override_tiers: rows })}
                          billingCurrencyCode={billingCurrency}
                          minRows={0}
                          toolbarStart={
                            <div className="flex items-center gap-1.5 border-r border-gray-200 pr-3">
                              <label
                                htmlFor="gateway-route-provider-factor"
                                className="whitespace-nowrap text-[11px] font-medium text-gray-600"
                              >
                                Provider factor
                              </label>
                              <input
                                id="gateway-route-provider-factor"
                                type="text"
                                inputMode="decimal"
                                value={formData.provider_factor}
                                title="Multiplies Standard (catalog) into metered tiers when the selected model has pricing_profile. Default 1 copies catalog at 1×."
                                onChange={(e) => {
                                  const nextFactor = e.target.value;
                                  setFormData((prev) => {
                                    const model = models.find((m) => m.id === prev.model_id);
                                    const r = recomputeOverrideTiersFromProviderFactor(nextFactor, model);
                                    if (r.ok) {
                                      return {
                                        ...prev,
                                        provider_factor: nextFactor,
                                        metered_override_tiers: r.tiers,
                                      };
                                    }
                                    return { ...prev, provider_factor: nextFactor };
                                  });
                                }}
                                className="w-[3.5rem] rounded-md border border-gray-300 bg-white px-1.5 py-1 text-xs tabular-nums focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/30"
                                placeholder="1"
                              />
                            </div>
                          }
                        />
                      </RoutePricePanel>
                    </div>
                  </div>
                </div>

                {/* 3. Request defaults */}
                <section className="rounded-lg border border-gray-200 bg-white p-4">
                  <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">Request defaults (JSON)</h3>
                  <p className="mb-3 text-xs text-gray-600">
                    Route-level <code className="rounded bg-gray-100 px-1 py-0.5 font-mono">custom_params</code> is deep-merged
                    into the upstream request body; explicit client fields win. Put both standard fields (e.g.{' '}
                    <code className="rounded bg-gray-100 px-1 py-0.5 font-mono">temperature</code>) and vendor-specific keys
                    (e.g. <code className="rounded bg-gray-100 px-1 py-0.5 font-mono">eca_thinking_config</code>) here.
                  </p>
                  <div className="flex min-h-0 flex-col">
                    <label className="mb-1.5 text-sm font-medium text-gray-700">Custom params</label>
                    <textarea
                      rows={8}
                      value={formData.custom_params_json}
                      onChange={(e) => setFormData({ ...formData, custom_params_json: e.target.value })}
                      className="min-h-[160px] w-full flex-1 resize-y rounded-md border border-gray-300 px-3 py-2 font-mono text-xs leading-relaxed focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                      placeholder='{"temperature":0.7,"provider_options":{"foo":"bar"}}'
                      spellCheck={false}
                    />
                  </div>
                </section>

                {/* 4. Summary */}
                <section className="rounded-lg border border-gray-200 bg-white p-4">
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Summary</h3>
                  <div className="grid grid-cols-1 gap-2 text-xs text-gray-600 md:grid-cols-2">
                    <p>
                      <span className="font-medium text-gray-700">Route:</span>{' '}
                      <span className="font-mono">{formData.model_id || '—'}</span> →{' '}
                      <span className="font-mono">{formData.provider_id || '—'}</span> /{' '}
                      <span className="font-mono">{formData.provider_model_name || '—'}</span>
                    </p>
                    <p>
                      <span className="font-medium text-gray-700">Routing:</span>{' '}
                      <span className="font-mono">{formData.upstream_protocol}</span> · group{' '}
                      <span className="font-mono">{formData.route_group.trim() || 'default'}</span> · priority{' '}
                      <span className="font-mono">{formData.priority}</span> · status{' '}
                      <span className="font-mono">
                        {editingRoute ? editingRoute.status : 'inactive'}
                      </span>
                      {!editingRoute && (
                        <span className="text-gray-500"> (enable from list)</span>
                      )}
                    </p>
                    <p>
                      <span className="font-medium text-gray-700">User billing:</span>{' '}
                      <span className="font-mono">
                        Routes must persist <span className="whitespace-nowrap">price_override.charged</span> tiers;
                        charged_cost uses that profile. Charged factor scales Standard into the editor;{' '}
                        <span className="whitespace-nowrap">charged_factor</span> is stored in{' '}
                        <span className="whitespace-nowrap">price_override</span> JSON.
                      </span>
                    </p>
                    <p>
                      <span className="font-medium text-gray-700">Metered cost:</span>{' '}
                      <span className="font-mono">
                        Routes must persist <span className="whitespace-nowrap">price_override.metered</span> tiers;
                        metered_cost uses that profile.
                      </span>
                    </p>
                  </div>
                </section>
              </div>
            </div>

            <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-gray-200 bg-gray-50/50 px-5 py-4">
              <div className="flex flex-wrap items-center gap-2">
                {editingRoute && (
                  <button
                    type="button"
                    onClick={() => handleDelete(editingRoute.id)}
                    disabled={isSaving || isDeleting}
                    className="inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <TrashIcon className="h-4 w-4" aria-hidden />
                    {isDeleting ? 'Deleting...' : 'Delete route'}
                  </button>
                )}
              </div>
              <div className="ml-auto flex gap-2 sm:gap-3">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={isSaving || isDeleting}
                >
                  Cancel
                </button>
                {editingRoute && (
                  <button
                    type="button"
                    onClick={() => handleDuplicate(editingRoute)}
                    disabled={isSaving || isDeleting}
                    className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <DocumentDuplicateIcon className="h-4 w-4" aria-hidden />
                    Duplicate
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={isSaving || isDeleting}
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isSaving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Sticky key routing config dialog (per model × protocol × route_group) */}
      {stickyDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div
            className="w-full max-w-md overflow-hidden rounded-xl bg-white shadow-xl ring-1 ring-black/5"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sticky-dialog-title"
          >
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
              <div>
                <h2 id="sticky-dialog-title" className="text-base font-semibold text-gray-900">
                  Sticky key routing
                </h2>
                <p className="mt-1 text-xs text-gray-500">
                  {stickyDialog.modelTitle} · {stickyDialog.protocolLabel} ·{' '}
                  <span className="font-mono">{stickyDialog.group}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setStickyDialog(null)}
                className="rounded-md p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                aria-label="Close"
              >
                <span className="block text-xl leading-none" aria-hidden>
                  ×
                </span>
              </button>
            </div>
            <div className="space-y-4 px-5 py-5">
              {stickyError && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
                  {stickyError}
                </div>
              )}
              <label className="flex items-start gap-2.5">
                <input
                  type="checkbox"
                  checked={stickyForm.enabled}
                  onChange={(e) => setStickyForm({ ...stickyForm, enabled: e.target.checked })}
                  className="mt-0.5 h-4 w-4 rounded border-gray-300 text-violet-600 focus:ring-2 focus:ring-violet-500 focus:ring-offset-1"
                />
                <span className="text-sm text-gray-800">
                  <span className="font-medium">Enable sticky key routing</span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-gray-500">
                    Bind each user to one provider key for this protocol × group to maximize upstream
                    prompt-cache hits. The binding is released after the idle TTL.
                  </span>
                </span>
              </label>
              <div className={`grid grid-cols-2 gap-3 ${stickyForm.enabled ? '' : 'opacity-50'}`}>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Idle TTL (seconds)</label>
                  <input
                    type="number"
                    min={1}
                    value={stickyForm.ttl_seconds}
                    onChange={(e) => setStickyForm({ ...stickyForm, ttl_seconds: e.target.value })}
                    disabled={!stickyForm.enabled}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-50"
                    placeholder={`default ${STICKY_DEFAULT_TTL_SECONDS}`}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Short wait (ms)</label>
                  <input
                    type="number"
                    min={1}
                    value={stickyForm.short_wait_ms}
                    onChange={(e) => setStickyForm({ ...stickyForm, short_wait_ms: e.target.value })}
                    disabled={!stickyForm.enabled}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-50"
                    placeholder={`default ${STICKY_DEFAULT_SHORT_WAIT_MS}`}
                  />
                </div>
              </div>
              <p className="text-xs leading-relaxed text-gray-500">
                Short wait: if the bound key is briefly rate-limited and expected to recover within this
                window, the gateway waits instead of switching keys (preserves the cache).
              </p>
            </div>
            <div className="flex justify-end gap-2 border-t border-gray-200 bg-gray-50/60 px-5 py-3.5">
              <button
                type="button"
                onClick={() => setStickyDialog(null)}
                disabled={stickySaving}
                className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveSticky}
                disabled={stickySaving}
                className="rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {stickySaving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function GatewayRoutesPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-600">Loading...</div>
      </div>
    }>
      <RoutesContent />
    </Suspense>
  );
}
