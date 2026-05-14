'use client';

/**
 * 模型目录：CRUD、标签、定价字段；数据来自 `/api/admin/models`。
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
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
import { parsePricingProfile, type PricingTierPrices } from '@octafuse/core/db/pricing-profile';
import {
	createDefaultNewModelTierRow,
	profileJsonToDraftRows,
	serializeDraftRowsToProfileJson,
	type PricingTierDraftRow,
} from '@/lib/pricing-tiers-draft';
import { PricingTiersEditor } from '@/components/pricing-tiers-editor';
import { formatGatewayMoneyCompact, formatPerMillionTokenUnit } from '@/lib/format-gateway-currency';
import { useBillingCurrency } from '@/lib/use-billing-currency';
import type { GatewayModel } from '@/lib/types';
import {
  getModelVendorLabel,
  MODEL_VENDOR_OPTIONS,
  normalizeModelVendorInput,
} from '@/lib/model-vendor';

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
  supports_images: false,
  tags: [] as string[],
  description: '',
  metadata: '',
};

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

function ModelContextPricingBlock(props: {
  model: ModelListItem;
  pricingColumns: PricingMetricColumn[];
  billingCurrency: string;
}) {
  const { model, pricingColumns, billingCurrency } = props;

  return (
    <div className="flex flex-nowrap items-start gap-x-3 overflow-x-auto">
      <div className="shrink-0 w-[4.25rem]">
        <p className="text-[11px] text-gray-400 leading-tight">Total Context</p>
        <p className="mt-1 text-sm font-semibold text-gray-900 tabular-nums tracking-tight">
          {formatCompactTokens(model.context_window)}
        </p>
      </div>
      <div className="shrink-0 w-[3.75rem]">
        <p className="text-[11px] text-gray-400 leading-tight">Max Output</p>
        <p className="mt-1 text-sm font-semibold text-gray-900 tabular-nums tracking-tight">
          {formatCompactTokens(model.max_tokens)}
        </p>
      </div>
      {pricingColumns.length === 0 ? (
        <div className="flex min-h-[2.25rem] shrink-0 items-end pb-0.5">
          <span className="text-sm text-gray-400">—</span>
        </div>
      ) : (
        pricingColumns.map((col) => (
          <div key={col.title} className="min-w-[6.25rem] shrink-0 w-[6.25rem]">
            <p
              className="truncate text-[11px] text-gray-400 leading-tight"
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
                  <span className="shrink-0 text-[11px] text-gray-400">{line.condition}</span>
                  <span className="shrink-0 text-xs font-semibold text-gray-900">
                    {line.price == null ? '—' : formatGatewayMoneyCompact(line.price, billingCurrency)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

export default function GatewayModelsPage() {
  const [models, setModels] = useState<ModelListItem[]>([]);
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
  const { currency: billingCurrency } = useBillingCurrency();

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
      supports_images: !!model.supports_images,
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
          supports_images: !!fullModel.supports_images,
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
        pricing_profile: tierJson.json,
        supports_images: formData.supports_images ? 1 : 0,
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

  return (
    <div className="min-h-full bg-gray-100/90 p-8 pb-12">
      {/* Header */}
      <div className="flex justify-between items-start gap-6 mb-6">
        <div className="min-w-0 flex-1">
          <h1 className="text-3xl font-bold text-gray-900">Models</h1>
          <p className="text-sm text-gray-500 mt-1">
            Maintain the models {OCTAFUSE_GATEWAY_PRODUCT} exposes to clients. Seed rows from the built-in catalog with
            Import, or add definitions manually with New.
          </p>
          <p className="text-xs text-gray-400 mt-0.5">
            {models.length} model{models.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-3 pt-1">
          <button
            type="button"
            onClick={openImportCatalogModal}
            disabled={importSubmitting}
            className="flex items-center gap-2 px-4 py-2 border border-gray-300 bg-white text-gray-800 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-400 disabled:opacity-50"
          >
            <ArrowDownTrayIcon className="h-5 w-5" />
            Import
          </button>
          <button
            type="button"
            onClick={() => handleCreate()}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <PlusIcon className="h-5 w-5" />
            New
          </button>
        </div>
      </div>

      {/* Vendor groups: one table per vendor */}
      <div className="space-y-8">
        {modelsByVendor.map(([vendorKey, items]) => {
          const title = getModelVendorLabel(vendorKey);
          return (
            <section key={vendorKey} className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold text-gray-900 truncate" title={title}>{title}</h2>
                  <p className="text-xs text-gray-500">{items.length} model{items.length !== 1 ? 's' : ''}</p>
                </div>
                <button
                  type="button"
                  onClick={() => handleCreate(vendorKey)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-sm border border-blue-200 text-blue-700 bg-blue-50 rounded-md hover:bg-blue-100"
                  title={`New model under ${title}`}
                  aria-label={`New model under ${title}`}
                >
                  <PlusIcon className="h-4 w-4" />
                  New
                </button>
              </div>

              <div className="bg-white rounded-lg shadow-md overflow-x-auto">
                <table className="w-full min-w-[105rem] table-fixed divide-y divide-gray-200">
                  <colgroup>
                    <col className="w-[13%]" />
                    <col className="w-[46%]" />
                    <col className="w-[14%]" />
                    <col className="w-[11%]" />
                    <col className="w-[8%]" />
                    <col className="w-[8%]" />
                  </colgroup>
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Model
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                        <span className="inline-flex max-w-full flex-nowrap items-baseline gap-x-2">
                          <span>Context & pricing</span>
                          <span className="text-[11px] font-normal normal-case tracking-normal text-gray-400 tabular-nums">
                            {formatPerMillionTokenUnit(billingCurrency)}
                          </span>
                        </span>
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Metadata
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Tags
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                        Capabilities
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider max-w-xs">
                        Notes
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {items.map((model) => {
                      const tagShown = model.tags?.length ? model.tags.slice(0, 4) : [];
                      const tagExtra = (model.tags?.length ?? 0) - tagShown.length;
                      const notesTitle = model.description?.trim() || undefined;
                      const pricingColumns = buildPricingMetricColumns(model.pricing_profile);
                      return (
                        <tr
                          key={model.id}
                          className="hover:bg-gray-50 cursor-pointer"
                          onClick={() => void handleEdit(model)}
                        >
                          <td className="px-4 py-3 align-top">
                            <div className="text-sm font-medium text-gray-900 truncate" title={model.display_name || model.id}>
                              {model.display_name || model.id}
                            </div>
                            <div className="text-xs font-mono text-gray-500 break-all leading-snug mt-0.5" title={model.id}>
                              {model.id}
                            </div>
                          </td>
                          <td className="px-4 py-3 align-top text-gray-800">
                            <ModelContextPricingBlock
                              model={model}
                              pricingColumns={pricingColumns}
                              billingCurrency={billingCurrency}
                            />
                          </td>
                          <td className="px-4 py-3 align-top text-xs text-gray-600">
                            {model.metadata?.trim() ? (
                              <p className="line-clamp-3 break-all font-mono" title={model.metadata}>
                                {model.metadata}
                              </p>
                            ) : (
                              <span className="text-gray-400">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3 align-top">
                            <div className="flex flex-wrap gap-1 max-w-[200px]">
                              {tagShown.length ? (
                                <>
                                  {tagShown.map((tag) => (
                                    <span
                                      key={tag}
                                      className={`px-1.5 py-0.5 text-[10px] rounded font-medium ${tagBadgeClass(tag)}`}
                                    >
                                      {tag}
                                    </span>
                                  ))}
                                  {tagExtra > 0 ? (
                                    <span className="text-[10px] text-gray-400 self-center">+{tagExtra}</span>
                                  ) : null}
                                </>
                              ) : (
                                <span className="text-xs text-gray-400">—</span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3 align-top text-xs whitespace-nowrap">
                            {model.supports_images ? (
                              <span className="inline-flex rounded px-2 py-0.5 font-medium bg-green-50 text-green-800" title="Supports images">
                                Images
                              </span>
                            ) : (
                              <span className="inline-flex rounded px-2 py-0.5 font-medium bg-gray-100 text-gray-600" title="No images">
                                Text only
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 align-top text-xs text-gray-600 max-w-xs">
                            {model.description?.trim() ? (
                              <p className="line-clamp-2 break-words" title={notesTitle}>
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
            </section>
          );
        })}

        {models.length === 0 && (
          <div className="bg-white rounded-xl border border-gray-300/90 shadow-md shadow-gray-300/40 ring-1 ring-black/[0.04] text-center py-12 text-gray-500">
            No models found
          </div>
        )}
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
                <div className="col-span-2 flex gap-6">
                  <label className="flex items-center">
                    <input type="checkbox" checked={formData.supports_images} onChange={(e) => setFormData({ ...formData, supports_images: e.target.checked })} className="mr-2" />
                    Supports Images
                  </label>
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
