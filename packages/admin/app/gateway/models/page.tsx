'use client';

/**
 * 模型目录：CRUD、标签、定价字段；数据来自 `/api/admin/models`。
 * 左侧 Vendor 列表 + 右侧当前 Vendor 模型表；含 All 总览；`?vendor=` 持久化选中项（`useSearchParams` + Suspense）。
 */
import { useState, useEffect, useCallback, useMemo, Suspense, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  TrashIcon,
  PlusIcon,
  ArrowDownTrayIcon,
} from '@heroicons/react/24/outline';
import { readApiJson } from '@/lib/api-json';
import { OCTAFUSE_GATEWAY_PRODUCT } from '@/lib/brand';
import {
  catalogInputPriceSortKey,
} from '@/lib/pricing-ui';
import {
	MODEL_INPUT_MODALITIES,
	MODEL_OUTPUT_MODALITIES,
	parseModelModalitiesJson,
} from '@octafuse/core/db/model-modalities';
import { parsePricingProfile, type PricingTierPrices } from '@octafuse/core/db/pricing-profile';
import {
	createDefaultNewModelTierRow,
	profileJsonToDraftRows,
	serializeDraftRowsToProfileJson,
	type PricingTierDraftRow,
} from '@/lib/pricing-tiers-draft';
import { ModelModalitiesBadgeFromRaw } from '@/components/model-modalities-badge';
import { PricingTiersEditor } from '@/components/pricing-tiers-editor';
import { formatGatewayMoneyCompact, formatPerMillionTokenUnit } from '@/lib/format-gateway-currency';
import { useBillingCurrency } from '@/lib/use-billing-currency';
import type { GatewayModel } from '@/lib/types';
import {
  getModelVendorLabel,
  MODEL_VENDOR_OPTIONS,
  normalizeModelVendorInput,
} from '@/lib/model-vendor';
import { useReplaceListPageQuery } from '@/lib/use-replace-list-query';

/** API returns models with tags parsed as string[] */
type ModelListItem = Omit<GatewayModel, 'tags'> & { tags: string[]; routes_count: number; active_routes_count: number };

/** `GET /admin/models/import/catalog` */
type PresetCatalogRow = {
	id: string;
	display_name: string | null;
	vendor: string;
	context_window: number | null;
	max_tokens: number | null;
	tier_count_usd: number;
	pricing_preview_usd: string | null;
};

const emptyForm = {
  id: '',
  display_name: '',
  vendor: 'other',
  context_window: '',
  max_tokens: '8192',
  input_modalities: ['text'] as string[],
  output_modalities: ['text'] as string[],
  released_at: '',
  tags: [] as string[],
  description: '',
  metadata: '',
};

/** Sidebar filter: show models from every vendor (`?vendor=all`). */
const ALL_VENDORS_KEY = 'all';

function parseVendorFilterParam(value: string | null): string {
  if (value == null || value.trim() === '') return ALL_VENDORS_KEY;
  if (value.trim().toLowerCase() === ALL_VENDORS_KEY) return ALL_VENDORS_KEY;
  return normalizeModelVendorInput(value);
}

/** Pretty-print in the editor when stored value is a JSON object. */
function formatMetadataForEditor(metadata: string | null | undefined): string {
  if (metadata == null || metadata.trim() === '') return '';
  try {
    const p = JSON.parse(metadata.trim()) as unknown;
    if (p != null && typeof p === 'object' && !Array.isArray(p)) {
      return JSON.stringify(p, null, 2);
    }
    return metadata.trim();
  } catch {
    return metadata.trim();
  }
}

/** Validate and normalize metadata for API (compact JSON string, or null to clear). */
function parseMetadataForSave(raw: string): { ok: true; value: string | null } | { ok: false; error: string } {
  const t = raw.trim();
  if (t === '') return { ok: true, value: null };
  try {
    const parsed = JSON.parse(t) as unknown;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {
        ok: false,
        error: 'Metadata must be a JSON object ({ ... }), not an array or primitive',
      };
    }
    return { ok: true, value: JSON.stringify(parsed) };
  } catch {
    return { ok: false, error: 'Metadata must be valid JSON' };
  }
}

type MetadataSummary =
  | { kind: 'empty' }
  | { kind: 'object'; keyCount: number; keyPreview: string[]; formatted: string }
  | { kind: 'raw'; formatted: string; label: string };

function buildMetadataSummary(metadata: string | null | undefined): MetadataSummary {
  if (metadata == null || metadata.trim() === '') {
    return { kind: 'empty' };
  }
  const trimmed = metadata.trim();
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed != null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const keys = Object.keys(parsed as Record<string, unknown>);
      return {
        kind: 'object',
        keyCount: keys.length,
        keyPreview: keys.slice(0, 3),
        formatted: JSON.stringify(parsed, null, 2),
      };
    }
    return { kind: 'raw', formatted: trimmed, label: 'Raw metadata' };
  } catch {
    return { kind: 'raw', formatted: trimmed, label: 'Raw metadata' };
  }
}

function getMetadataButtonLabel(summary: Exclude<MetadataSummary, { kind: 'empty' }>): string {
  if (summary.kind === 'raw') return summary.label;
  if (summary.keyCount === 0) return '0 keys';
  const preview = summary.keyPreview.join(', ');
  const extra = summary.keyCount - summary.keyPreview.length;
  if (extra > 0) {
    return `${summary.keyCount} keys: ${preview}, +${extra}`;
  }
  return `${summary.keyCount} key${summary.keyCount !== 1 ? 's' : ''}: ${preview}`;
}

function tagBadgeClass(tag: string): string {
  if (tag === 'free') return 'bg-green-100 text-green-800';
  if (tag === 'lite') return 'bg-cyan-100 text-cyan-800';
  if (tag === 'pro') return 'bg-blue-100 text-blue-800';
  if (tag === 'max') return 'bg-purple-100 text-purple-800';
  return 'bg-gray-100 text-gray-700';
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

function getTierConditionLabel(
  tierIdx: number,
  previousUpto: number | null,
  upto: number | null
): string {
  if (tierIdx === 0 && upto != null) return `≤${formatCompactTokens(upto)}`;
  if (upto == null && previousUpto != null) return `>${formatCompactTokens(previousUpto)}`;
  if (upto != null && previousUpto != null) {
    return `>${formatCompactTokens(previousUpto)}–≤${formatCompactTokens(upto)}`;
  }
  return 'All';
}

type PricingMetricLine = {
  condition: string;
  price: number | null;
};

type PricingMetricColumn = {
  title: string;
  /** 悬停完整说明（表头缩写用） */
  headerTitle?: string;
  lines: PricingMetricLine[];
};

function buildPricingMetricColumns(pricingProfile: string | null | undefined): PricingMetricColumn[] {
  const profile = parsePricingProfile(pricingProfile ?? undefined);
  if (!profile || profile.tiers.length === 0) return [];

  const buildMetricLines = (
    pickPrice: (tier: PricingTierPrices) => number | null
  ): PricingMetricLine[] =>
    profile.tiers.map((tier, tierIdx) => {
      const previous = tierIdx === 0 ? null : profile.tiers[tierIdx - 1]!.upto;
      return {
        condition: getTierConditionLabel(tierIdx, previous, tier.upto),
        price: pickPrice(tier),
      };
    });

  const columns: PricingMetricColumn[] = [
    {
      title: 'Input Price',
      headerTitle: 'Input price (per 1M tokens)',
      lines: buildMetricLines((tier) => tier.input_price),
    },
    {
      title: 'Output Price',
      headerTitle: 'Output price (per 1M tokens)',
      lines: buildMetricLines((tier) => tier.output_price),
    },
    {
      title: 'Cache Read',
      headerTitle: 'Cache read (per 1M tokens)',
      lines: buildMetricLines((tier) => tier.cache_read_price ?? null),
    },
  ];

  if (profile.tiers.some((tier) => tier.cache_write_price != null)) {
    columns.push({
      title: 'Cache Write',
      headerTitle: 'Cache write (per 1M tokens)',
      lines: buildMetricLines((tier) => tier.cache_write_price ?? null),
    });
  }
  return columns;
}

function ModelLimitsBlock({ model }: { model: ModelListItem }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-nowrap items-start gap-x-4">
        <div className="shrink-0">
          <p className="text-[11px] text-gray-400 whitespace-nowrap">Total Context</p>
          <p className="mt-1 text-sm font-semibold text-gray-900 tabular-nums tracking-tight whitespace-nowrap">
            {formatCompactTokens(model.context_window)}
          </p>
        </div>
        <div className="shrink-0">
          <p className="text-[11px] text-gray-400 whitespace-nowrap">Max Output</p>
          <p className="mt-1 text-sm font-semibold text-gray-900 tabular-nums tracking-tight whitespace-nowrap">
            {formatCompactTokens(model.max_tokens)}
          </p>
        </div>
      </div>
      <div>
        <p className="text-[11px] text-gray-400 whitespace-nowrap">Modalities</p>
        <div className="mt-1">
          <ModelModalitiesBadgeFromRaw
            inputRaw={model.input_modalities}
            outputRaw={model.output_modalities}
            size="sm"
          />
        </div>
      </div>
      {model.released_at ? (
        <div>
          <p className="text-[11px] text-gray-400 whitespace-nowrap">Released</p>
          <p className="mt-0.5 text-xs text-gray-700 tabular-nums">{model.released_at}</p>
        </div>
      ) : null}
    </div>
  );
}

function ModelPricingBlock(props: {
  pricingColumns: PricingMetricColumn[];
  billingCurrency: string;
}) {
  const { pricingColumns, billingCurrency } = props;

  if (pricingColumns.length === 0) {
    return <span className="text-sm text-gray-400">—</span>;
  }

  return (
    <div className="flex flex-nowrap items-start gap-x-3">
      {pricingColumns.map((col) => (
        <div key={col.title} className="shrink-0 w-[6.25rem]">
          <p
            className="truncate text-[11px] text-gray-400 leading-tight whitespace-nowrap"
            title={col.headerTitle ?? col.title}
          >
            {col.title}
          </p>
          <div className="mt-1 space-y-0.5 tabular-nums leading-snug">
            {col.lines.map((line, lineIdx) => (
              <div
                key={`${col.title}-${lineIdx}`}
                className="flex flex-nowrap items-baseline gap-x-1"
                title={
                  line.price == null
                    ? line.condition
                    : `${line.condition} ${formatGatewayMoneyCompact(line.price, billingCurrency)}`
                }
              >
                <span className="shrink-0 text-[11px] text-gray-400 whitespace-nowrap">{line.condition}</span>
                <span className="shrink-0 text-xs font-semibold text-gray-900">
                  {line.price == null ? '—' : formatGatewayMoneyCompact(line.price, billingCurrency)}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ModelMetadataCell(props: { model: ModelListItem; onView: (model: ModelListItem) => void }) {
  const summary = useMemo(() => buildMetadataSummary(props.model.metadata), [props.model.metadata]);
  if (summary.kind === 'empty') {
    return <span className="text-xs text-gray-400">—</span>;
  }
  const label = getMetadataButtonLabel(summary);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        props.onView(props.model);
      }}
      className="inline-flex max-w-full items-center truncate rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-[11px] font-medium text-gray-700 hover:border-gray-300 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
      title="View metadata JSON"
    >
      {label}
    </button>
  );
}

type MetadataPreviewState = {
  model: ModelListItem;
  summary: Exclude<MetadataSummary, { kind: 'empty' }>;
};

function MetadataPreviewModal(props: {
  preview: MetadataPreviewState;
  onClose: () => void;
}) {
  const { preview, onClose } = props;
  const displayName = preview.model.display_name || preview.model.id;
  return (
    <div
      className="fixed inset-0 z-[55] flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg bg-white shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="metadata-preview-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b px-6 py-4">
          <div className="min-w-0">
            <h2 id="metadata-preview-title" className="text-lg font-bold text-gray-900">
              Metadata
            </h2>
            <p className="mt-1 truncate text-sm text-gray-700" title={displayName}>
              {displayName}
            </p>
            <p className="truncate font-mono text-xs text-gray-500" title={preview.model.id}>
              {preview.model.id}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 text-gray-400 hover:text-gray-600"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          <pre className="whitespace-pre-wrap break-words rounded-md border border-gray-200 bg-gray-50 p-4 font-mono text-xs leading-relaxed text-gray-800">
            {preview.summary.formatted}
          </pre>
        </div>
        <div className="flex shrink-0 justify-end border-t bg-gray-50 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-white"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/** Left filter panel: compact vendor nav, aligned with Model Routes page. */
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

function ModelsContent() {
  const searchParams = useSearchParams();
  const [models, setModels] = useState<ModelListItem[]>([]);
  const [selectedVendor, setSelectedVendor] = useState(ALL_VENDORS_KEY);
  const [isLoading, setIsLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingModel, setEditingModel] = useState<ModelListItem | null>(null);
  const [formData, setFormData] = useState(emptyForm);
  const [pricingTierRows, setPricingTierRows] = useState<PricingTierDraftRow[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [saveError, setSaveError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showImportCatalogModal, setShowImportCatalogModal] = useState(false);
  const [importCatalogRows, setImportCatalogRows] = useState<PresetCatalogRow[]>([]);
  const [importCatalogLoading, setImportCatalogLoading] = useState(false);
  const [importCatalogError, setImportCatalogError] = useState('');
  const [importSelected, setImportSelected] = useState<Record<string, boolean>>({});
  const [importSubmitting, setImportSubmitting] = useState(false);
  const [metadataPreview, setMetadataPreview] = useState<MetadataPreviewState | null>(null);
  const { currency: billingCurrency } = useBillingCurrency();

  const openMetadataPreview = useCallback((model: ModelListItem) => {
    const summary = buildMetadataSummary(model.metadata);
    if (summary.kind === 'empty') return;
    setMetadataPreview({ model, summary });
  }, []);

  const importSelectedCount = useMemo(
    () => Object.values(importSelected).filter(Boolean).length,
    [importSelected]
  );

  const existingModelIds = useMemo(() => new Set(models.map((m) => m.id)), [models]);

  const importableCatalogCount = useMemo(
    () => importCatalogRows.filter((r) => !existingModelIds.has(r.id)).length,
    [importCatalogRows, existingModelIds]
  );

  const sortedImportCatalogRows = useMemo(() => {
    return [...importCatalogRows].sort((a, b) => {
      const va = normalizeModelVendorInput(a.vendor);
      const vb = normalizeModelVendorInput(b.vendor);
      if (va !== vb) {
        return va.localeCompare(vb, undefined, { sensitivity: 'base' });
      }
      return a.id.localeCompare(b.id, undefined, { sensitivity: 'base' });
    });
  }, [importCatalogRows]);

  const modelsByVendor = useMemo(() => {
    const g = new Map<string, ModelListItem[]>();
    for (const m of models) {
      const key = normalizeModelVendorInput(m.vendor);
      const list = g.get(key) ?? [];
      list.push(m);
      g.set(key, list);
    }
    for (const list of g.values()) {
      list.sort((a, b) => {
        const pa = catalogInputPriceSortKey(a);
        const pb = catalogInputPriceSortKey(b);
        if (pb !== pa) return pb - pa;
        return (a.display_name || a.id).localeCompare(b.display_name || b.id, undefined, { sensitivity: 'base' });
      });
    }
    return [...g.entries()].sort(([a], [b]) => {
      if (a === 'other') return 1;
      if (b === 'other') return -1;
      return a.localeCompare(b, undefined, { sensitivity: 'base' });
    });
  }, [models]);

  const vendorKeys = useMemo(() => modelsByVendor.map(([key]) => key), [modelsByVendor]);

  const selectedVendorItems = useMemo(() => {
    if (selectedVendor === ALL_VENDORS_KEY) {
      return modelsByVendor.flatMap(([, items]) => items);
    }
    const entry = modelsByVendor.find(([key]) => key === selectedVendor);
    return entry?.[1] ?? [];
  }, [modelsByVendor, selectedVendor]);

  useEffect(() => {
    const vendorParam = searchParams.get('vendor');
    if (vendorParam !== null) {
      setSelectedVendor(parseVendorFilterParam(vendorParam));
    }
  }, [searchParams]);

  useEffect(() => {
    if (modelsByVendor.length === 0) return;
    setSelectedVendor((prev) => {
      if (prev === ALL_VENDORS_KEY) return ALL_VENDORS_KEY;
      if (prev && vendorKeys.includes(prev)) return prev;
      const fromUrl = searchParams.get('vendor');
      if (fromUrl !== null) {
        const parsed = parseVendorFilterParam(fromUrl);
        if (parsed === ALL_VENDORS_KEY) return ALL_VENDORS_KEY;
        if (vendorKeys.includes(parsed)) return parsed;
      }
      return ALL_VENDORS_KEY;
    });
  }, [modelsByVendor, vendorKeys, searchParams]);

  useReplaceListPageQuery(() => {
    const params = new URLSearchParams();
    if (selectedVendor) params.set('vendor', selectedVendor);
    return params;
  }, [selectedVendor]);

  const fetchModels = useCallback(async () => {
    try {
      setIsLoading(true);
      const response = await fetch('/api/admin/models');
      const data = await readApiJson<ModelListItem[]>(response);
      if (data.success && data.data) {
        setModels(data.data);
      }
    } catch (error) {
      console.error('Fetch models error:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchModels();
  }, [fetchModels]);

  /** 目录里已入库的 id 不可勾选：打开目录或列表变化时清掉误选。 */
  useEffect(() => {
    if (!showImportCatalogModal || importCatalogRows.length === 0) return;
    setImportSelected((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const k of Object.keys(next)) {
        if (!next[k]) continue;
        if (existingModelIds.has(k)) {
          delete next[k];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [showImportCatalogModal, importCatalogRows, existingModelIds]);

  const loadImportCatalog = useCallback(async () => {
    setImportCatalogLoading(true);
    setImportCatalogError('');
    try {
      const response = await fetch('/api/admin/models/import/catalog');
      const data = await readApiJson<PresetCatalogRow[]>(response);
      if (data.success && Array.isArray(data.data)) {
        setImportCatalogRows(data.data);
        setImportSelected({});
      } else {
        setImportCatalogError(data.message || 'Failed to load catalog');
        setImportCatalogRows([]);
      }
    } catch (e) {
      console.error('Load import catalog error:', e);
      setImportCatalogError('Failed to load catalog');
      setImportCatalogRows([]);
    } finally {
      setImportCatalogLoading(false);
    }
  }, []);

  const openImportCatalogModal = () => {
    setShowImportCatalogModal(true);
    setImportCatalogError('');
    setImportSelected({});
    void loadImportCatalog();
  };

  const toggleImportPreset = (id: string) => {
    if (existingModelIds.has(id)) return;
    setImportSelected((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const selectAllImportPresets = () => {
    const next: Record<string, boolean> = {};
    for (const row of importCatalogRows) {
      if (!existingModelIds.has(row.id)) {
        next[row.id] = true;
      }
    }
    setImportSelected(next);
  };

  const clearImportPresetSelection = () => {
    setImportSelected({});
  };

  const runImportSelectedPresets = async () => {
    const ids = importCatalogRows
      .filter((r) => importSelected[r.id] && !existingModelIds.has(r.id))
      .map((r) => r.id);
    if (ids.length === 0) {
      alert('Select at least one preset that is not already in the gateway.');
      return;
    }
    if (
      !confirm(
        `Import ${ids.length} new model(s)? Prices use the catalog’s ${billingCurrency} branch (USD/CNY tiers). Existing model IDs are never overwritten.`
      )
    ) {
      return;
    }
    setImportSubmitting(true);
    try {
      const response = await fetch('/api/admin/models/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      const data = await readApiJson<{
        billing_currency_used: string;
        created: number;
        skipped_existing: string[];
        failed: Array<{ id: string; message: string }>;
      }>(response);
      if (data.success && data.data) {
        const { created, failed, billing_currency_used, skipped_existing } = data.data;
        const skipN = skipped_existing?.length ?? 0;
        const failLines =
          failed.length > 0
            ? `\n\nFailed (${failed.length}):\n${failed.map((f) => `${f.id}: ${f.message}`).join('\n')}`
            : '';
        const skipLines =
          skipN > 0
            ? `\nSkipped (already in gateway): ${skipN}${skipN <= 5 ? ` — ${skipped_existing!.join(', ')}` : ''}`
            : '';
        alert(
          `Import finished (billing: ${billing_currency_used}).\nCreated: ${created}${skipLines}${failLines}`
        );
        setShowImportCatalogModal(false);
        await fetchModels();
      } else {
        alert(data.message || 'Import failed');
      }
    } catch (e) {
      console.error('Import models error:', e);
      alert('Import failed');
    } finally {
      setImportSubmitting(false);
    }
  };

  const handleCreate = (presetVendorKey?: string) => {
    setEditingModel(null);
    setFormData({
      ...emptyForm,
      vendor: presetVendorKey !== undefined ? presetVendorKey : emptyForm.vendor,
    });
    setPricingTierRows([createDefaultNewModelTierRow()]);
    setShowModal(true);
    setSaveError('');
  };

  const handleEdit = async (model: ModelListItem) => {
    setEditingModel(model);
    const listTags = Array.isArray(model.tags) ? model.tags : [];
    setFormData({
      id: model.id,
      display_name: model.display_name || '',
      vendor: normalizeModelVendorInput(model.vendor),
      context_window: model.context_window?.toString() || '',
      max_tokens: model.max_tokens?.toString() || '4096',
      input_modalities: parseModelModalitiesJson(model.input_modalities) ?? ['text'],
      output_modalities: parseModelModalitiesJson(model.output_modalities) ?? ['text'],
      released_at: model.released_at ?? '',
      tags: listTags,
      description: model.description ?? '',
      metadata: formatMetadataForEditor(model.metadata),
    });
    setPricingTierRows(profileJsonToDraftRows(model.pricing_profile));
    try {
      const response = await fetch(`/api/admin/models/${encodeURIComponent(model.id)}`);
      const data = await readApiJson<ModelListItem>(response);
      if (data.success && data.data) {
        const fullModel = data.data;
        const tags = Array.isArray(fullModel.tags) ? fullModel.tags : [];
        setFormData({
          id: fullModel.id,
          display_name: fullModel.display_name || '',
          vendor: normalizeModelVendorInput(fullModel.vendor),
          context_window: fullModel.context_window?.toString() || '',
          max_tokens: fullModel.max_tokens?.toString() || '4096',
          input_modalities: parseModelModalitiesJson(fullModel.input_modalities) ?? ['text'],
          output_modalities: parseModelModalitiesJson(fullModel.output_modalities) ?? ['text'],
          released_at: fullModel.released_at ?? '',
          tags,
          description: fullModel.description ?? '',
          metadata: formatMetadataForEditor(fullModel.metadata),
        });
        setPricingTierRows(profileJsonToDraftRows(fullModel.pricing_profile));
      }
    } catch (error) {
      console.error('Fetch model details error:', error);
    }
    setShowModal(true);
    setSaveError('');
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this model? This will also delete all associated routes.')) return;

    setIsDeleting(true);
    try {
      const response = await fetch(`/api/admin/models/${encodeURIComponent(id)}`, { method: 'DELETE' });
      const data = await readApiJson(response);
      if (data.success) {
        setShowModal(false);
        setEditingModel(null);
        fetchModels();
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

  const handleAddTag = () => {
    const t = tagInput.trim();
    if (t && !formData.tags.includes(t)) {
      setFormData({ ...formData, tags: [...formData.tags, t] });
      setTagInput('');
    }
  };

  const handleRemoveTag = (tag: string) => {
    setFormData({ ...formData, tags: formData.tags.filter((x) => x !== tag) });
  };

  const toggleFormModality = (
    kind: 'input_modalities' | 'output_modalities',
    modality: string
  ) => {
    setFormData((prev) => {
      const current = prev[kind];
      const next = current.includes(modality)
        ? current.filter((m) => m !== modality)
        : [...current, modality];
      return { ...prev, [kind]: next.length > 0 ? next : [modality] };
    });
  };

  const handleSave = async () => {
    setSaveError('');
    setIsSaving(true);

    try {
      const tierJson = serializeDraftRowsToProfileJson(pricingTierRows);
      if (!tierJson.ok) {
        setSaveError(tierJson.error);
        return;
      }
      const metaParsed = parseMetadataForSave(formData.metadata);
      if (!metaParsed.ok) {
        setSaveError(metaParsed.error);
        return;
      }

      const payload = {
        ...formData,
        tags: formData.tags,
        vendor: normalizeModelVendorInput(formData.vendor),
        context_window: formData.context_window ? parseInt(formData.context_window, 10) : null,
        max_tokens: parseInt(formData.max_tokens, 10) || 4096,
        input_modalities: formData.input_modalities,
        output_modalities: formData.output_modalities,
        released_at: formData.released_at.trim() || null,
        pricing_profile: tierJson.json,
        metadata: metaParsed.value,
      };

      let response: Response;
      if (editingModel) {
        const { id: _unusedModelId, ...patchBody } = payload;
        void _unusedModelId;
        response = await fetch(`/api/admin/models/${encodeURIComponent(editingModel.id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patchBody),
        });
      } else {
        response = await fetch('/api/admin/models', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }

      const data = await readApiJson(response);

      if (data.success) {
        setShowModal(false);
        fetchModels();
      } else {
        setSaveError(data.message || 'Save failed');
      }
    } catch (error) {
      console.error('Save error:', error);
      setSaveError('Save failed, please try again');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-600">Loading...</div>
      </div>
    );
  }

  const isAllVendors = selectedVendor === ALL_VENDORS_KEY;
  const activeVendorKey = isAllVendors ? vendorKeys[0] ?? 'other' : selectedVendor || vendorKeys[0] || 'other';
  const activeVendorTitle = isAllVendors ? 'All vendors' : getModelVendorLabel(activeVendorKey);
  const hasVendorFilter = !isAllVendors;

  return (
    <div className="min-w-0 overflow-x-hidden bg-gray-100/90 p-4 pb-6 sm:p-6 lg:p-8">
      {/* Page title */}
      <div className="mb-5 sm:mb-6">
        <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">Models</h1>
        <p className="mt-1 text-sm text-gray-500">
          Maintain the models {OCTAFUSE_GATEWAY_PRODUCT} exposes to clients. Seed rows from the built-in catalog with
          Import, or add definitions manually with New.
        </p>
      </div>

      {/* Workbench: vendor filter (left) + model catalog (right) */}
      <div className="overflow-hidden rounded-2xl border border-gray-200/80 bg-white/70 shadow-sm ring-1 ring-black/[0.02]">
        <div className="flex min-w-0 flex-col lg:flex-row lg:items-start">
          {/* Vendor filter panel — scroll with main; sticky when shorter than viewport */}
          {models.length > 0 ? (
            <aside className="w-full shrink-0 border-b border-gray-200/80 bg-slate-50/80 lg:sticky lg:top-0 lg:w-60 lg:self-start lg:border-b-0 lg:border-r">
              <div className="space-y-3 p-4">
                <div>
                  <h2 className="text-sm font-semibold text-gray-900">Filters</h2>
                  <p className="mt-0.5 text-xs text-gray-500">Browse by vendor</p>
                </div>

                <div className="flex items-center justify-between gap-2 rounded-lg border border-gray-200/60 bg-white/60 px-3 py-2">
                  <span className="text-xs text-gray-600">
                    <span className="font-semibold tabular-nums text-gray-900">{models.length}</span> models
                    {hasVendorFilter ? (
                      <>
                        {' '}
                        · showing{' '}
                        <span className="font-semibold tabular-nums text-gray-900">
                          {selectedVendorItems.length}
                        </span>
                      </>
                    ) : null}
                  </span>
                  {hasVendorFilter ? (
                    <button
                      type="button"
                      onClick={() => setSelectedVendor(ALL_VENDORS_KEY)}
                      className="shrink-0 rounded text-xs font-medium text-blue-600 hover:text-blue-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1"
                    >
                      Clear
                    </button>
                  ) : null}
                </div>

                <FilterNavSection title="Vendor" ariaLabel="Vendor filter">
                  <FilterNavButton
                    label="All"
                    count={models.length}
                    isActive={isAllVendors}
                    onClick={() => setSelectedVendor(ALL_VENDORS_KEY)}
                  />
                  {modelsByVendor.map(([vendorKey, items]) => (
                    <FilterNavButton
                      key={vendorKey}
                      label={getModelVendorLabel(vendorKey)}
                      count={items.length}
                      isActive={selectedVendor === vendorKey}
                      onClick={() => setSelectedVendor(vendorKey)}
                    />
                  ))}
                </FilterNavSection>
              </div>
            </aside>
          ) : null}

          {/* Model catalog workspace */}
          <section className="min-w-0 flex-1 bg-white">
            <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-gray-200/80 bg-white/95 px-4 py-3 backdrop-blur-sm sm:px-6">
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-gray-900">Model Catalog</h2>
                {models.length > 0 ? (
                  <p className="mt-0.5 truncate text-xs text-gray-500" title={activeVendorTitle}>
                    {activeVendorTitle} · {selectedVendorItems.length} model
                    {selectedVendorItems.length !== 1 ? 's' : ''}
                  </p>
                ) : (
                  <p className="mt-0.5 text-xs text-gray-500">No models yet</p>
                )}
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={openImportCatalogModal}
                  disabled={importSubmitting}
                  className="flex items-center gap-2 rounded-md border border-gray-300 bg-white px-4 py-2 text-gray-800 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-400 disabled:opacity-50"
                >
                  <ArrowDownTrayIcon className="h-5 w-5" />
                  Import
                </button>
                <button
                  type="button"
                  onClick={() => handleCreate(isAllVendors ? undefined : activeVendorKey)}
                  className="flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  title={
                    isAllVendors
                      ? 'Create a new model'
                      : `New model under ${activeVendorTitle}`
                  }
                >
                  <PlusIcon className="h-5 w-5" />
                  New
                </button>
              </div>
            </div>

            <div className="p-4 sm:p-6">
              {models.length === 0 ? (
                <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50/50 py-16 text-center text-gray-500">
                  <p className="text-sm font-medium text-gray-600">No models found</p>
                  <p className="mt-1 text-xs text-gray-500">
                    Import from the built-in catalog or create a model manually
                  </p>
                </div>
              ) : (
                <div className="overflow-hidden rounded-lg border border-gray-200/80 bg-white shadow-sm">
                  <div className="overflow-x-auto">
                    <table className="w-full table-fixed divide-y divide-gray-200">
                      <colgroup>
                        <col className="w-56" />
                        <col className="w-48" />
                        <col className="w-[28rem]" />
                        <col className="w-28" />
                        <col />
                        <col />
                      </colgroup>
                      <thead className="bg-gray-50/80">
                        <tr>
                          <th className="w-56 px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                            Model
                          </th>
                          <th
                            className="w-48 whitespace-nowrap px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500"
                            title="Total context window and max output tokens"
                          >
                            Limits
                          </th>
                          <th className="w-[28rem] whitespace-nowrap px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                            <span className="inline-flex flex-nowrap items-baseline gap-x-2">
                              <span>Pricing</span>
                              <span className="text-[11px] font-normal normal-case tracking-normal text-gray-400 tabular-nums">
                                {formatPerMillionTokenUnit(billingCurrency)}
                              </span>
                            </span>
                          </th>
                          <th className="w-28 px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                            Tags
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                            Metadata
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                            Description
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 bg-white">
                        {selectedVendorItems.map((model) => {
                          const tagShown = model.tags?.length ? model.tags.slice(0, 4) : [];
                          const tagExtra = (model.tags?.length ?? 0) - tagShown.length;
                          const descriptionTitle = model.description?.trim() || undefined;
                          const pricingColumns = buildPricingMetricColumns(model.pricing_profile);
                          return (
                            <tr
                              key={model.id}
                              className="cursor-pointer transition-colors hover:bg-gray-50/80"
                              onClick={() => void handleEdit(model)}
                            >
                              <td className="w-56 px-4 py-3 align-top">
                                <div
                                  className="truncate text-sm font-medium text-gray-900"
                                  title={model.display_name || model.id}
                                >
                                  {model.display_name || model.id}
                                </div>
                                <div
                                  className="mt-0.5 truncate font-mono text-xs leading-snug text-gray-500"
                                  title={model.id}
                                >
                                  {model.id}
                                </div>
                              </td>
                              <td className="w-48 px-4 py-3 align-top text-gray-800">
                                <ModelLimitsBlock model={model} />
                              </td>
                              <td className="w-[28rem] px-4 py-3 align-top text-gray-800">
                                <ModelPricingBlock
                                  pricingColumns={pricingColumns}
                                  billingCurrency={billingCurrency}
                                />
                              </td>
                              <td className="w-28 px-4 py-3 align-top">
                                <div className="flex flex-wrap gap-1">
                                  {tagShown.length ? (
                                    <>
                                      {tagShown.map((tag) => (
                                        <span
                                          key={tag}
                                          className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${tagBadgeClass(tag)}`}
                                        >
                                          {tag}
                                        </span>
                                      ))}
                                      {tagExtra > 0 ? (
                                        <span className="self-center text-[10px] text-gray-400">+{tagExtra}</span>
                                      ) : null}
                                    </>
                                  ) : (
                                    <span className="text-xs text-gray-400">—</span>
                                  )}
                                </div>
                              </td>
                              <td className="px-4 py-3 align-top">
                                <ModelMetadataCell model={model} onView={openMetadataPreview} />
                              </td>
                              <td className="px-4 py-3 align-top text-xs text-gray-600">
                                {model.description?.trim() ? (
                                  <p className="line-clamp-2 break-words" title={descriptionTitle}>
                                    {model.description}
                                  </p>
                                ) : (
                                  <span className="text-gray-400">—</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b flex justify-between items-center sticky top-0 bg-white">
              <h2 className="text-xl font-bold text-gray-900">{editingModel ? 'Edit Model' : 'New Model'}</h2>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600">x</button>
            </div>

            <div className="p-6">
              {saveError && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-red-600 text-sm">{saveError}</div>}

              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Model ID *</label>
                  <input type="text" value={formData.id} onChange={(e) => setFormData({ ...formData, id: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="gpt-4o" required disabled={!!editingModel} />
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Display Name</label>
                  <input type="text" value={formData.display_name} onChange={(e) => setFormData({ ...formData, display_name: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="GPT-4o" />
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Vendor</label>
                  <select
                    value={
                      MODEL_VENDOR_OPTIONS.some((o) => o.key === formData.vendor)
                        ? formData.vendor
                        : 'other'
                    }
                    onChange={(e) => setFormData({ ...formData, vendor: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                  >
                    {MODEL_VENDOR_OPTIONS.map((o) => (
                      <option key={o.key} value={o.key}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Context Window</label>
                  <input type="number" value={formData.context_window} onChange={(e) => setFormData({ ...formData, context_window: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="128000" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Max Tokens</label>
                  <input type="number" value={formData.max_tokens} onChange={(e) => setFormData({ ...formData, max_tokens: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="4096" />
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Released</label>
                  <input
                    type="date"
                    value={formData.released_at}
                    onChange={(e) => setFormData({ ...formData, released_at: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Input Modalities</label>
                  <div className="flex flex-wrap gap-3">
                    {MODEL_INPUT_MODALITIES.map((m) => (
                      <label key={m} className="inline-flex items-center gap-1.5 text-sm text-gray-700">
                        <input
                          type="checkbox"
                          checked={formData.input_modalities.includes(m)}
                          onChange={() => toggleFormModality('input_modalities', m)}
                          className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        {m}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Output Modalities</label>
                  <div className="flex flex-wrap gap-3">
                    {MODEL_OUTPUT_MODALITIES.map((m) => (
                      <label key={m} className="inline-flex items-center gap-1.5 text-sm text-gray-700">
                        <input
                          type="checkbox"
                          checked={formData.output_modalities.includes(m)}
                          onChange={() => toggleFormModality('output_modalities', m)}
                          className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        {m}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="col-span-2 rounded-md border border-gray-200 bg-gray-50/80 px-3 py-2">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">Preview</p>
                  <div className="mt-1.5">
                    <ModelModalitiesBadgeFromRaw
                      inputRaw={JSON.stringify(formData.input_modalities)}
                      outputRaw={JSON.stringify(formData.output_modalities)}
                      size="md"
                    />
                  </div>
                </div>
                <div className="col-span-2">
                  <PricingTiersEditor
                    title="Pricing Profile"
                    rows={pricingTierRows}
                    onChange={setPricingTierRows}
                    billingCurrencyCode={billingCurrency}
                    minRows={0}
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Tags</label>
                  <div className="flex flex-wrap gap-2 mb-2">
                    {formData.tags.map((tag) => (
                      <span
                        key={tag}
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-sm ${
                          tag === 'free'
                            ? 'bg-green-100 text-green-800'
                            : tag === 'lite'
                              ? 'bg-cyan-100 text-cyan-800'
                              : tag === 'pro'
                                ? 'bg-blue-100 text-blue-800'
                                : tag === 'max'
                                  ? 'bg-purple-100 text-purple-800'
                                  : 'bg-gray-100 text-gray-800'
                        }`}
                      >
                        {tag}
                        <button type="button" onClick={() => handleRemoveTag(tag)} className="text-gray-500 hover:text-red-600" aria-label={`Remove ${tag}`}>×</button>
                      </span>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={tagInput}
                      onChange={(e) => setTagInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); handleAddTag(); } }}
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="e.g. free, lite, pro, max — press Enter to add"
                    />
                    <button type="button" onClick={handleAddTag} className="px-3 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50">Add</button>
                  </div>
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                  <textarea
                    rows={3}
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Optional, for internal notes"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Metadata (JSON)</label>
                  <textarea
                    rows={6}
                    value={formData.metadata}
                    onChange={(e) => setFormData({ ...formData, metadata: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                    placeholder='{"key": "value"}'
                  />
                </div>
              </div>
            </div>

            <div className="px-6 py-4 border-t flex flex-wrap items-center justify-between gap-3 sticky bottom-0 bg-gray-50">
              <div>
                {editingModel && (
                  <button
                    type="button"
                    onClick={() => handleDelete(editingModel.id)}
                    disabled={isSaving || isDeleting}
                    className="inline-flex items-center gap-1.5 px-3 py-2 border border-red-200 rounded-md text-sm font-medium text-red-700 bg-red-50 hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <TrashIcon className="h-4 w-4" />
                    {isDeleting ? 'Deleting...' : 'Delete model'}
                  </button>
                )}
              </div>
              <div className="flex gap-3 ml-auto">
                <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50" disabled={isSaving || isDeleting}>Cancel</button>
                <button type="button" onClick={handleSave} disabled={isSaving || isDeleting} className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50">{isSaving ? 'Saving...' : 'Save'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {metadataPreview && (
        <MetadataPreviewModal preview={metadataPreview} onClose={() => setMetadataPreview(null)} />
      )}

      {showImportCatalogModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
          <div
            className="flex max-h-[90vh] w-full max-w-7xl flex-col overflow-hidden rounded-lg bg-white shadow-xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="import-catalog-title"
          >
            <div className="flex shrink-0 items-center justify-between border-b px-6 py-4">
              <div>
                <h2 id="import-catalog-title" className="text-xl font-bold text-gray-900">
                  Import from Static Catalog
                </h2>
                <p className="mt-1 text-xs text-gray-500">
                  Presets already in the gateway (same model id) are disabled and are never overwritten on import.
                  Prices use the catalog’s{' '}
                  <span className="font-mono tabular-nums">{billingCurrency}</span> branch (USD/CNY tiers; see{' '}
                  {formatPerMillionTokenUnit(billingCurrency)}).
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowImportCatalogModal(false)}
                className="text-gray-400 hover:text-gray-600"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-gray-50 px-6 py-3">
              <button
                type="button"
                onClick={selectAllImportPresets}
                disabled={importCatalogLoading || importCatalogRows.length === 0}
                className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-800 hover:bg-gray-50 disabled:opacity-50"
              >
                Select all
              </button>
              <button
                type="button"
                onClick={clearImportPresetSelection}
                disabled={importCatalogLoading || importCatalogRows.length === 0}
                className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-800 hover:bg-gray-50 disabled:opacity-50"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={() => void loadImportCatalog()}
                disabled={importCatalogLoading}
                className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-800 hover:bg-gray-50 disabled:opacity-50"
              >
                Reload
              </button>
              <span className="ml-auto text-sm text-gray-600">
                Selected <span className="font-semibold tabular-nums">{importSelectedCount}</span> /{' '}
                <span className="tabular-nums">{importableCatalogCount}</span> available
                {importCatalogRows.length > importableCatalogCount ? (
                  <span className="text-gray-400">
                    {' '}
                    ({importCatalogRows.length - importableCatalogCount} already in gateway)
                  </span>
                ) : null}
              </span>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
              {importCatalogLoading && (
                <div className="py-12 text-center text-gray-600">Loading catalog…</div>
              )}
              {!importCatalogLoading && importCatalogError && (
                <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">{importCatalogError}</div>
              )}
              {!importCatalogLoading && !importCatalogError && importCatalogRows.length === 0 && (
                <div className="py-12 text-center text-gray-500">Catalog is empty</div>
              )}
              {!importCatalogLoading && !importCatalogError && importCatalogRows.length > 0 && (
                <div className="overflow-x-auto rounded-lg border border-gray-200">
                  <table className="min-w-full divide-y divide-gray-200 text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="w-10 px-3 py-2 text-left" scope="col">
                          <span className="sr-only">Select</span>
                        </th>
                        <th className="px-3 py-2 text-left font-medium text-gray-600">Model ID</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-600">Display Name</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-600">Vendor</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-600">Context</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-600">Max Tokens</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-600">Pricing</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 bg-white">
                      {sortedImportCatalogRows.map((row) => {
                        const alreadyInGateway = existingModelIds.has(row.id);
                        return (
                        <tr
                          key={row.id}
                          className={
                            alreadyInGateway
                              ? 'bg-gray-50 text-gray-400'
                              : 'hover:bg-gray-50'
                          }
                        >
                          <td className="px-3 py-2 align-middle">
                            <input
                              type="checkbox"
                              checked={alreadyInGateway ? false : !!importSelected[row.id]}
                              disabled={alreadyInGateway}
                              onChange={() => toggleImportPreset(row.id)}
                              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
                              aria-label={
                                alreadyInGateway
                                  ? `${row.id} already in gateway`
                                  : `Import preset ${row.id}`
                              }
                            />
                          </td>
                          <td className="px-3 py-2 font-mono text-xs text-gray-900">{row.id}</td>
                          <td className="px-3 py-2 text-gray-900">{row.display_name || '—'}</td>
                          <td className="px-3 py-2 text-gray-700">{getModelVendorLabel(normalizeModelVendorInput(row.vendor))}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-gray-700">
                            {row.context_window != null ? formatCompactTokens(row.context_window) : '—'}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-gray-700">
                            {row.max_tokens != null ? formatCompactTokens(row.max_tokens) : '—'}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-gray-700">
                            <span className="group relative inline-flex items-center justify-end">
                              <span
                                className="inline-flex cursor-help items-center justify-end"
                                aria-label={
                                  row.pricing_preview_usd ??
                                  `USD tiers: ${row.tier_count_usd}`
                                }
                              >
                                💰
                              </span>
                              <span className="pointer-events-none absolute right-0 top-full z-20 mt-1 hidden w-max max-w-[32rem] whitespace-pre-line rounded-md bg-gray-900 px-2 py-1 text-left text-xs leading-snug text-white shadow-lg group-hover:block">
                                {row.pricing_preview_usd ?? `USD tiers: ${row.tier_count_usd}`}
                              </span>
                            </span>
                          </td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="flex shrink-0 flex-wrap items-center justify-end gap-3 border-t bg-gray-50 px-6 py-4">
              <button
                type="button"
                onClick={() => setShowImportCatalogModal(false)}
                disabled={importSubmitting}
                className="rounded-md border border-gray-300 px-4 py-2 text-gray-700 hover:bg-white disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void runImportSelectedPresets()}
                disabled={
                  importSubmitting ||
                  importCatalogLoading ||
                  !importCatalogRows.some((r) => importSelected[r.id] && !existingModelIds.has(r.id))
                }
                className="rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {importSubmitting ? 'Importing…' : `Import selected (${importSelectedCount})`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function GatewayModelsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-full">
          <div className="text-gray-600">Loading...</div>
        </div>
      }
    >
      <ModelsContent />
    </Suspense>
  );
}
