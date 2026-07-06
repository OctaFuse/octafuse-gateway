'use client';

/**
 * 上游供应商：CRUD、各协议 base URL 与 API Key；对应 Worker `/admin/providers`。
 */
import { Fragment, useState, useEffect, useCallback, useMemo } from 'react';
import {
  TrashIcon,
  PlusIcon,
  CheckIcon,
  ArrowDownTrayIcon,
  DocumentDuplicateIcon,
  ClipboardDocumentIcon,
  PencilSquareIcon,
  ChevronDownIcon,
  KeyIcon,
  ServerStackIcon,
  ExclamationTriangleIcon,
  MagnifyingGlassIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import {
  OpenAiEndpointIcon,
  AnthropicEndpointIcon,
  GeminiEndpointIcon,
} from '@/components/upstream-brand-logo';
import { readApiJson } from '@/lib/api-json';
import { OCTAFUSE_GATEWAY_PRODUCT } from '@/lib/brand';
import type { GatewayProvider } from '@/lib/types';

/** `GET /admin/providers/import/catalog` */
type ProviderImportCatalogRow = {
  id: string;
  name: string;
  vendor_key: string;
  vendor_label: string;
  protocols: Array<'openai' | 'anthropic' | 'gemini'>;
  base_url_openai: string | null;
  base_url_anthropic: string | null;
  base_url_gemini: string | null;
  description: string | null;
};

type ProviderKeyRow = {
  id: string;
  provider_id: string;
  label: string;
  status: string;
  weight: number;
  priority: number;
  /** 限流配置 JSON（`{"rpm":…,"tpm":…,"max_concurrency":…}`）；null=不限流 */
  limit_config: string | null;
  masked_api_key: string;
  is_pending_import: boolean;
  created_at: string;
  updated_at: string;
};

const emptyKeyForm = {
  label: '',
  api_key: '',
  weight: '1',
  priority: '0',
  rpm: '',
  tpm: '',
  max_concurrency: '',
};

const emptyKeyEditForm = {
  ...emptyKeyForm,
  status: 'active',
};

/** 表单三个限流输入 → limit_config JSON 字符串；全空返回 null（不限流）。 */
function buildLimitConfigJson(form: { rpm: string; tpm: string; max_concurrency: string }): string | null {
  const out: Record<string, number> = {};
  const rpm = Number(form.rpm);
  const tpm = Number(form.tpm);
  const maxConcurrency = Number(form.max_concurrency);
  if (form.rpm.trim() !== '' && Number.isFinite(rpm) && rpm > 0) out.rpm = Math.floor(rpm);
  if (form.tpm.trim() !== '' && Number.isFinite(tpm) && tpm > 0) out.tpm = Math.floor(tpm);
  if (form.max_concurrency.trim() !== '' && Number.isFinite(maxConcurrency) && maxConcurrency > 0) {
    out.max_concurrency = Math.floor(maxConcurrency);
  }
  return Object.keys(out).length > 0 ? JSON.stringify(out) : null;
}

/** limit_config JSON → 表单字段（编辑既有 key 时预填）。 */
function limitConfigToFormFields(raw: string | null): { rpm: string; tpm: string; max_concurrency: string } {
  const empty = { rpm: '', tpm: '', max_concurrency: '' };
  if (!raw) return empty;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      rpm: typeof parsed.rpm === 'number' ? String(parsed.rpm) : '',
      tpm: typeof parsed.tpm === 'number' ? String(parsed.tpm) : '',
      max_concurrency: typeof parsed.max_concurrency === 'number' ? String(parsed.max_concurrency) : '',
    };
  } catch {
    return empty;
  }
}

/** 表格「Limits」列展示文本。 */
function formatLimitConfig(raw: string | null): string {
  const fields = limitConfigToFormFields(raw);
  const parts: string[] = [];
  if (fields.rpm) parts.push(`RPM ${fields.rpm}`);
  if (fields.tpm) parts.push(`TPM ${fields.tpm}`);
  if (fields.max_concurrency) parts.push(`Conc ${fields.max_concurrency}`);
  return parts.length > 0 ? parts.join(' · ') : '—';
}

type ProviderProtocolSummary = {
  key: 'openai' | 'anthropic' | 'gemini';
  label: string;
  url: string;
};

function getProviderProtocolSummaries(provider: GatewayProvider): ProviderProtocolSummary[] {
  const rows: ProviderProtocolSummary[] = [];
  const openaiUrl = provider.base_url_openai?.trim() ?? '';
  const anthropicUrl = provider.base_url_anthropic?.trim() ?? '';
  const geminiUrl = provider.base_url_gemini?.trim() ?? '';
  if (openaiUrl) rows.push({ key: 'openai', label: 'OpenAI', url: openaiUrl });
  if (anthropicUrl) rows.push({ key: 'anthropic', label: 'Anthropic', url: anthropicUrl });
  if (geminiUrl) rows.push({ key: 'gemini', label: 'Gemini', url: geminiUrl });
  return rows;
}

function ProviderProtocolIcon(props: { protocol: ProviderProtocolSummary['key'] }) {
  if (props.protocol === 'openai') return <OpenAiEndpointIcon label="OpenAI" className="inline-flex" />;
  if (props.protocol === 'anthropic') return <AnthropicEndpointIcon label="Anthropic" className="h-4 w-4" />;
  return <GeminiEndpointIcon label="Gemini" className="h-4 w-4" />;
}

const emptyForm = {
  id: '',
  name: '',
  base_url_openai: '',
  base_url_anthropic: '',
  base_url_gemini: '',
  api_key: '',
  description: '',
};

function suggestDuplicateProviderId(sourceId: string, existingIds: Set<string>): string {
  const base = `${sourceId}-copy`;
  if (!existingIds.has(base)) return base;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base}-${n}`;
    if (!existingIds.has(candidate)) return candidate;
  }
  return '';
}

export default function GatewayProvidersPage() {
  const [providers, setProviders] = useState<GatewayProvider[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [providerSearch, setProviderSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingProvider, setEditingProvider] = useState<GatewayProvider | null>(null);
  /** 新建弹窗由「复制」预填时，记录源 Provider id（仅 UI 提示） */
  const [duplicateSourceId, setDuplicateSourceId] = useState<string | null>(null);
  const [formData, setFormData] = useState(emptyForm);
  const [saveError, setSaveError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  /** 复制成功反馈：`apikey:<id>` | `endpoint:<id>:openai|anthropic|gemini` */
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importCatalogRows, setImportCatalogRows] = useState<ProviderImportCatalogRow[]>([]);
  const [importCatalogLoading, setImportCatalogLoading] = useState(false);
  const [importCatalogError, setImportCatalogError] = useState('');
  const [importSelected, setImportSelected] = useState<Record<string, boolean>>({});
  const [importSubmitting, setImportSubmitting] = useState(false);
  const [providerKeys, setProviderKeys] = useState<ProviderKeyRow[]>([]);
  const [keysLoading, setKeysLoading] = useState(false);
  const [expandedProviderId, setExpandedProviderId] = useState<string | null>(null);
  const [providerKeyPreviewById, setProviderKeyPreviewById] = useState<Record<string, ProviderKeyRow[]>>({});
  const [keyPreviewLoadingId, setKeyPreviewLoadingId] = useState<string | null>(null);
  const [keyPreviewErrorById, setKeyPreviewErrorById] = useState<Record<string, string>>({});
  const [providerKeyTogglingId, setProviderKeyTogglingId] = useState<string | null>(null);
  const [editingProviderKey, setEditingProviderKey] = useState<{ providerId: string; key: ProviderKeyRow } | null>(null);
  const [keyEditForm, setKeyEditForm] = useState(emptyKeyEditForm);
  const [keyEditSaving, setKeyEditSaving] = useState(false);
  const [keyEditError, setKeyEditError] = useState('');
  const [keyForm, setKeyForm] = useState(emptyKeyForm);
  const [showKeyForm, setShowKeyForm] = useState(false);
  const [keySaving, setKeySaving] = useState(false);
  const [keyError, setKeyError] = useState('');
  /** 正在编辑限流配置的 key id（行内编辑区） */
  const [editingLimitsKeyId, setEditingLimitsKeyId] = useState<string | null>(null);
  const [limitsForm, setLimitsForm] = useState({ rpm: '', tpm: '', max_concurrency: '' });
  const [limitsSaving, setLimitsSaving] = useState(false);

  const existingProviderIds = useMemo(() => new Set(providers.map((p) => p.id)), [providers]);
  const pendingKeyCount = useMemo(
    () => providers.filter((p) => p.has_pending_key).length,
    [providers]
  );
  const filteredProviders = useMemo(() => {
    const query = providerSearch.trim().toLowerCase();
    if (!query) return providers;
    return providers.filter((provider) => provider.name.toLowerCase().includes(query));
  }, [providerSearch, providers]);
  const providerOverview = useMemo(() => {
    const protocols = filteredProviders.reduce(
      (acc, provider) => {
        if (provider.base_url_openai?.trim()) acc.openai++;
        if (provider.base_url_anthropic?.trim()) acc.anthropic++;
        if (provider.base_url_gemini?.trim()) acc.gemini++;
        return acc;
      },
      { openai: 0, anthropic: 0, gemini: 0 }
    );
    return {
      total: filteredProviders.length,
      activeKeys: filteredProviders.reduce((sum, provider) => sum + (provider.active_key_count ?? 0), 0),
      withoutKeys: filteredProviders.filter((provider) => (provider.active_key_count ?? 0) === 0).length,
      protocols,
    };
  }, [filteredProviders]);
  const importSelectedCount = useMemo(
    () => Object.values(importSelected).filter(Boolean).length,
    [importSelected]
  );

  const loadProviderKeyRows = useCallback(async (providerId: string): Promise<ProviderKeyRow[]> => {
    const response = await fetch(`/api/admin/providers/${encodeURIComponent(providerId)}/keys`);
    const data = await readApiJson<ProviderKeyRow[]>(response);
    if (data.success && data.data) {
      return data.data;
    }
    throw new Error(data.message || 'Failed to load keys');
  }, []);

  const fetchProviderKeys = useCallback(async (providerId: string) => {
    setKeysLoading(true);
    setKeyError('');
    try {
      const rows = await loadProviderKeyRows(providerId);
      setProviderKeys(rows);
      setProviderKeyPreviewById((prev) => ({ ...prev, [providerId]: rows }));
      setKeyPreviewErrorById((prev) => {
        const next = { ...prev };
        delete next[providerId];
        return next;
      });
    } catch (error) {
      console.error('Fetch provider keys error:', error);
      setProviderKeys([]);
      setKeyError(error instanceof Error ? error.message : 'Failed to load keys');
    } finally {
      setKeysLoading(false);
    }
  }, [loadProviderKeyRows]);

  const handleToggleProviderKeyPreview = useCallback(async (providerId: string) => {
    if (expandedProviderId === providerId) {
      setExpandedProviderId(null);
      return;
    }
    setExpandedProviderId(providerId);
    if (providerKeyPreviewById[providerId]) return;

    setKeyPreviewLoadingId(providerId);
    setKeyPreviewErrorById((prev) => {
      const next = { ...prev };
      delete next[providerId];
      return next;
    });
    try {
      const rows = await loadProviderKeyRows(providerId);
      setProviderKeyPreviewById((prev) => ({ ...prev, [providerId]: rows }));
    } catch (error) {
      console.error('Fetch provider key preview error:', error);
      setKeyPreviewErrorById((prev) => ({
        ...prev,
        [providerId]: error instanceof Error ? error.message : 'Failed to load keys',
      }));
    } finally {
      setKeyPreviewLoadingId((current) => (current === providerId ? null : current));
    }
  }, [expandedProviderId, loadProviderKeyRows, providerKeyPreviewById]);

  useEffect(() => {
    setEditingLimitsKeyId(null);
    if (editingProvider) {
      void fetchProviderKeys(editingProvider.id);
    } else {
      setProviderKeys([]);
      setKeyForm(emptyKeyForm);
      setShowKeyForm(false);
      setKeyError('');
    }
  }, [editingProvider, fetchProviderKeys]);

  const handleAddProviderKey = async () => {
    if (!editingProvider) return;
    const label = keyForm.label.trim();
    const apiKey = keyForm.api_key.trim();
    if (!label || !apiKey) {
      setKeyError('Label and API key are required');
      return;
    }
    setKeySaving(true);
    setKeyError('');
    try {
      const response = await fetch(`/api/admin/providers/${encodeURIComponent(editingProvider.id)}/keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label,
          api_key: apiKey,
          weight: Number(keyForm.weight) || 1,
          priority: Number(keyForm.priority) || 0,
          limit_config: buildLimitConfigJson(keyForm),
        }),
      });
      const data = await readApiJson(response);
      if (data.success) {
        setKeyForm(emptyKeyForm);
        setShowKeyForm(false);
        void fetchProviderKeys(editingProvider.id);
        void fetchProviders();
      } else {
        setKeyError(data.message || 'Failed to add key');
      }
    } catch (error) {
      console.error('Add provider key error:', error);
      setKeyError('Failed to add key');
    } finally {
      setKeySaving(false);
    }
  };

  const handleCopyProviderKey = async (key: ProviderKeyRow) => {
    const providerId = key.provider_id || editingProvider?.id;
    if (!providerId) return;
    try {
      const response = await fetch(
        `/api/admin/providers/${encodeURIComponent(providerId)}/keys/${encodeURIComponent(key.id)}`
      );
      const data = await readApiJson<{ api_key: string }>(response);
      if (data.success && data.data?.api_key) {
        await navigator.clipboard.writeText(data.data.api_key);
        setCopiedId(`provider-key:${key.id}`);
        setTimeout(() => setCopiedId(null), 2000);
      } else {
        setKeyError(data.message || 'Failed to copy API key');
      }
    } catch (error) {
      console.error('Copy provider key error:', error);
      setKeyError('Failed to copy API key');
    }
  };

  const handleToggleProviderKeyStatus = async (key: ProviderKeyRow, providerIdOverride?: string) => {
    const providerId = providerIdOverride || editingProvider?.id || key.provider_id;
    if (!providerId) return;
    const nextStatus = key.status === 'active' ? 'disabled' : 'active';
    setProviderKeyTogglingId(key.id);
    try {
      const response = await fetch(
        `/api/admin/providers/${encodeURIComponent(providerId)}/keys/${encodeURIComponent(key.id)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: nextStatus }),
        }
      );
      const data = await readApiJson(response);
      if (data.success) {
        const rows = await loadProviderKeyRows(providerId);
        setProviderKeyPreviewById((prev) => ({ ...prev, [providerId]: rows }));
        if (editingProvider?.id === providerId) {
          setProviderKeys(rows);
        }
        void fetchProviders();
      } else {
        alert(data.message || 'Update failed');
      }
    } catch (error) {
      console.error('Toggle provider key error:', error);
      alert('Update failed');
    } finally {
      setProviderKeyTogglingId(null);
    }
  };

  const openProviderKeyEditor = (providerId: string, key: ProviderKeyRow) => {
    const limits = limitConfigToFormFields(key.limit_config);
    setEditingProviderKey({ providerId, key });
    setKeyEditForm({
      label: key.label,
      api_key: '',
      status: key.status,
      weight: String(key.weight),
      priority: String(key.priority),
      rpm: limits.rpm,
      tpm: limits.tpm,
      max_concurrency: limits.max_concurrency,
    });
    setKeyEditError('');
  };

  const closeProviderKeyEditor = () => {
    if (keyEditSaving) return;
    setEditingProviderKey(null);
    setKeyEditForm(emptyKeyEditForm);
    setKeyEditError('');
  };

  const handleSaveProviderKeyEdit = async () => {
    if (!editingProviderKey) return;
    const label = keyEditForm.label.trim();
    if (!label) {
      setKeyEditError('Label is required');
      return;
    }
    setKeyEditSaving(true);
    setKeyEditError('');
    try {
      const body: Record<string, unknown> = {
        label,
        status: keyEditForm.status === 'disabled' ? 'disabled' : 'active',
        weight: Number(keyEditForm.weight) || 1,
        priority: Number(keyEditForm.priority) || 0,
        limit_config: buildLimitConfigJson(keyEditForm),
      };
      const apiKey = keyEditForm.api_key.trim();
      if (apiKey) body.api_key = apiKey;

      const response = await fetch(
        `/api/admin/providers/${encodeURIComponent(editingProviderKey.providerId)}/keys/${encodeURIComponent(editingProviderKey.key.id)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      );
      const data = await readApiJson(response);
      if (data.success) {
        const rows = await loadProviderKeyRows(editingProviderKey.providerId);
        setProviderKeyPreviewById((prev) => ({ ...prev, [editingProviderKey.providerId]: rows }));
        if (editingProvider?.id === editingProviderKey.providerId) {
          setProviderKeys(rows);
        }
        void fetchProviders();
        setEditingProviderKey(null);
        setKeyEditForm(emptyKeyEditForm);
      } else {
        setKeyEditError(data.message || 'Failed to update key');
      }
    } catch (error) {
      console.error('Update provider key error:', error);
      setKeyEditError('Failed to update key');
    } finally {
      setKeyEditSaving(false);
    }
  };

  const handleStartEditLimits = (key: ProviderKeyRow) => {
    setEditingLimitsKeyId(key.id);
    setLimitsForm(limitConfigToFormFields(key.limit_config));
    setKeyError('');
  };

  const handleSaveKeyLimits = async (key: ProviderKeyRow) => {
    if (!editingProvider) return;
    setLimitsSaving(true);
    setKeyError('');
    try {
      const response = await fetch(
        `/api/admin/providers/${encodeURIComponent(editingProvider.id)}/keys/${encodeURIComponent(key.id)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ limit_config: buildLimitConfigJson(limitsForm) }),
        }
      );
      const data = await readApiJson(response);
      if (data.success) {
        setEditingLimitsKeyId(null);
        void fetchProviderKeys(editingProvider.id);
      } else {
        setKeyError(data.message || 'Failed to update limits');
      }
    } catch (error) {
      console.error('Update key limits error:', error);
      setKeyError('Failed to update limits');
    } finally {
      setLimitsSaving(false);
    }
  };

  const handleDeleteProviderKey = async (key: ProviderKeyRow) => {
    if (!editingProvider) return;
    if (!confirm(`Delete key "${key.label}" (${key.masked_api_key})? This cannot be undone.`)) return;
    try {
      const response = await fetch(
        `/api/admin/providers/${encodeURIComponent(editingProvider.id)}/keys/${encodeURIComponent(key.id)}`,
        { method: 'DELETE' }
      );
      const data = await readApiJson(response);
      if (data.success) {
        void fetchProviderKeys(editingProvider.id);
        void fetchProviders();
      } else {
        alert(data.message || 'Delete failed');
      }
    } catch (error) {
      console.error('Delete provider key error:', error);
      alert('Delete failed');
    }
  };

  useEffect(() => {
    fetchProviders();
  }, []);

  const fetchProviders = async () => {
    try {
      const response = await fetch('/api/admin/providers');
      const data = await readApiJson<GatewayProvider[]>(response);
      if (data.success && data.data) {
        setProviders(
          [...data.data].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
        );
      }
    } catch (error) {
      console.error('Fetch providers error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreate = () => {
    setEditingProvider(null);
    setDuplicateSourceId(null);
    setFormData({ ...emptyForm, id: '' });
    setShowKeyForm(false);
    setShowModal(true);
    setSaveError('');
  };

  const handleEdit = (provider: GatewayProvider) => {
    setEditingProvider(provider);
    setDuplicateSourceId(null);
    setFormData({
      id: provider.id,
      name: provider.name,
      base_url_openai: provider.base_url_openai ?? '',
      base_url_anthropic: provider.base_url_anthropic ?? '',
      base_url_gemini: provider.base_url_gemini ?? '',
      api_key: '',
      description: provider.description ?? '',
    });
    setKeyForm(emptyKeyForm);
    setShowKeyForm(false);
    setShowModal(true);
    setSaveError('');
  };

  const handleDuplicate = (provider: GatewayProvider) => {
    setEditingProvider(null);
    setDuplicateSourceId(provider.id);
    setFormData({
      id: suggestDuplicateProviderId(provider.id, existingProviderIds),
      name: `${provider.name} (copy)`,
      base_url_openai: provider.base_url_openai ?? '',
      base_url_anthropic: provider.base_url_anthropic ?? '',
      base_url_gemini: provider.base_url_gemini ?? '',
      api_key: '',
      description: provider.description ?? '',
    });
    setShowKeyForm(false);
    setShowModal(true);
    setSaveError('');
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this provider?')) return;

    setIsDeleting(true);
    try {
      const response = await fetch(`/api/admin/providers/${encodeURIComponent(id)}`, { method: 'DELETE' });
      const data = await readApiJson(response);
      if (data.success) {
        setShowModal(false);
        setEditingProvider(null);
        setShowKeyForm(false);
        void fetchProviders();
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

  const loadImportCatalog = useCallback(async () => {
    setImportCatalogLoading(true);
    setImportCatalogError('');
    try {
      const response = await fetch('/api/admin/providers/import/catalog');
      const data = await readApiJson<ProviderImportCatalogRow[]>(response);
      if (data.success && data.data) {
        setImportCatalogRows(data.data);
        setImportSelected({});
      } else {
        setImportCatalogError(data.message || 'Failed to load catalog');
        setImportCatalogRows([]);
      }
    } catch (e) {
      console.error('Load provider import catalog error:', e);
      setImportCatalogError('Failed to load catalog');
      setImportCatalogRows([]);
    } finally {
      setImportCatalogLoading(false);
    }
  }, []);

  const openImportModal = () => {
    setShowImportModal(true);
    setImportCatalogError('');
    setImportSelected({});
    void loadImportCatalog();
  };

  const toggleImportPreset = (id: string) => {
    setImportSelected((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const selectAllImportPresets = () => {
    const next: Record<string, boolean> = {};
    for (const row of importCatalogRows) {
      next[row.id] = true;
    }
    setImportSelected(next);
  };

  const clearImportPresetSelection = () => {
    setImportSelected({});
  };

  const runImportSelectedPresets = async () => {
    const ids = Object.entries(importSelected)
      .filter(([, v]) => v)
      .map(([k]) => k);
    if (ids.length === 0) {
      alert('Select at least one template.');
      return;
    }
    if (!confirm(`Import ${ids.length} provider template(s)? Endpoints will be prefilled; replace the placeholder API key after import.`)) {
      return;
    }
    setImportSubmitting(true);
    try {
      const response = await fetch('/api/admin/providers/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      const data = await readApiJson<{
        created: number;
        failed: Array<{ id: string; message: string }>;
      }>(response);
      if (data.success && data.data) {
        const { created, failed } = data.data;
        const failLines =
          failed.length > 0
            ? `\nFailed:\n${failed.map((f) => `  ${f.id}: ${f.message}`).join('\n')}`
            : '';
        alert(`Import finished.\nCreated: ${created}${failLines}`);
        setShowImportModal(false);
        void fetchProviders();
      } else {
        alert(data.message || 'Import failed');
      }
    } catch (e) {
      console.error('Import providers error:', e);
      alert('Import failed');
    } finally {
      setImportSubmitting(false);
    }
  };

  const handleSave = async () => {
    setSaveError('');
    if (
      editingProvider &&
      editingProvider.has_pending_key &&
      providerKeys.every((k) => k.status !== 'active' || k.is_pending_import)
    ) {
      setSaveError('Add at least one active real upstream API key before saving.');
      return;
    }
    setIsSaving(true);

    try {
      const payload: Record<string, unknown> = {
        ...formData,
        base_url_openai: formData.base_url_openai.trim() || null,
        base_url_anthropic: formData.base_url_anthropic.trim() || null,
        base_url_gemini: formData.base_url_gemini.trim() || null,
      };
      delete payload.api_key;
      let response: Response;
      if (editingProvider) {
        const patchBody = { ...payload };
        delete patchBody.id;
        response = await fetch(`/api/admin/providers/${encodeURIComponent(editingProvider.id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patchBody),
        });
      } else {
        if (formData.id.trim()) {
          payload.id = formData.id.trim();
        }
        response = await fetch('/api/admin/providers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }

      const data = await readApiJson(response);

      if (data.success) {
        setShowModal(false);
        setShowKeyForm(false);
        fetchProviders();
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

  const copyToClipboard = async (text: string, feedbackId: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(feedbackId);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (error) {
      console.error('Copy failed:', error);
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
    <div className="p-8">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Providers</h1>
          <p className="text-sm text-gray-500 mt-1">
            Upstream AI endpoints consumed by {OCTAFUSE_GATEWAY_PRODUCT}
          </p>
          <p className="text-xs text-gray-400 mt-1">
            Use <strong>Import</strong> to seed common CN-region endpoints; then click a row and replace the placeholder API key.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={openImportModal}
            className="flex items-center gap-2 px-4 py-2 border border-gray-300 bg-white text-gray-800 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <ArrowDownTrayIcon className="h-5 w-5" />
            Import
          </button>
          <button
            type="button"
            onClick={handleCreate}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <PlusIcon className="h-5 w-5" />
            New
          </button>
        </div>
      </div>

      {pendingKeyCount > 0 && (
        <div
          className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          role="status"
        >
          <strong>{pendingKeyCount}</strong> provider(s) still use the import placeholder API key. Click a row to
          edit and enter a real upstream key before routing traffic.
        </div>
      )}

      <div className="mb-5 rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="relative min-w-0 flex-1">
            <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" aria-hidden />
            <input
              type="search"
              value={providerSearch}
              onChange={(e) => setProviderSearch(e.target.value)}
              className="w-full rounded-md border border-gray-300 bg-white py-2 pl-10 pr-10 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Search provider name"
              aria-label="Search provider name"
              autoComplete="off"
            />
            {providerSearch.trim() && (
              <button
                type="button"
                onClick={() => setProviderSearch('')}
                className="absolute right-2 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
                aria-label="Clear provider search"
              >
                <XMarkIcon className="h-4 w-4" aria-hidden />
              </button>
            )}
          </div>
          <div className="shrink-0 text-sm text-gray-500">
            Showing <span className="font-semibold tabular-nums text-gray-900">{filteredProviders.length}</span> /{' '}
            <span className="tabular-nums">{providers.length}</span>
          </div>
        </div>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <div className="rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-sm">
          <div className="text-xs font-medium uppercase tracking-wide text-gray-500">Providers</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-gray-900">{providerOverview.total}</div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-sm">
          <div className="text-xs font-medium uppercase tracking-wide text-gray-500">Active Keys</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-gray-900">{providerOverview.activeKeys}</div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-sm">
          <div className="text-xs font-medium uppercase tracking-wide text-gray-500">OpenAI</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-emerald-700">{providerOverview.protocols.openai}</div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-sm">
          <div className="text-xs font-medium uppercase tracking-wide text-gray-500">Anthropic</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-orange-700">{providerOverview.protocols.anthropic}</div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-sm">
          <div className="text-xs font-medium uppercase tracking-wide text-gray-500">Gemini</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-indigo-700">{providerOverview.protocols.gemini}</div>
        </div>
      </div>

      {providerOverview.withoutKeys > 0 && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="status">
          <strong>{providerOverview.withoutKeys}</strong> provider(s) have no active upstream key.
        </div>
      )}

      {filteredProviders.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white py-12 text-center text-gray-500 shadow-sm">
          {providerSearch.trim() ? 'No providers match this name' : 'No providers found'}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {filteredProviders.map((provider) => {
            const protocols = getProviderProtocolSummaries(provider);
            const pendingKey = Boolean(provider.has_pending_key);
            const activeKeyCount = provider.active_key_count ?? 0;
            const isExpanded = expandedProviderId === provider.id;
            const previewRows = providerKeyPreviewById[provider.id] ?? [];
            const previewError = keyPreviewErrorById[provider.id];
            const isPreviewLoading = keyPreviewLoadingId === provider.id;
            const inactiveKeyCount = previewRows.filter((key) => key.status !== 'active').length;

            return (
              <article
                key={provider.id}
                role="button"
                tabIndex={0}
                onClick={() => handleEdit(provider)}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleEdit(provider);
                  }
                }}
                className={
                  'relative cursor-pointer overflow-hidden rounded-xl border bg-white shadow-md shadow-slate-200/70 ring-1 ring-black/[0.03] transition-all duration-200 ease-out hover:-translate-y-1 hover:border-blue-300 hover:bg-blue-50/30 hover:shadow-xl hover:shadow-blue-100/80 hover:ring-1 hover:ring-blue-200 focus:outline-none focus-visible:border-blue-400 focus-visible:bg-blue-50/30 focus-visible:shadow-lg focus-visible:ring-2 focus-visible:ring-blue-500 active:translate-y-0 ' +
                  (pendingKey
                    ? 'border-amber-300 ring-amber-100'
                    : activeKeyCount === 0
                      ? 'border-red-300 ring-red-100'
                      : 'border-slate-200')
                }
              >
                <div
                  aria-hidden
                  className={
                    'h-1 w-full ' +
                    (pendingKey
                      ? 'bg-amber-300'
                      : activeKeyCount === 0
                        ? 'bg-red-300'
                        : 'bg-slate-200')
                  }
                />
                <div className="p-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <h2 className="truncate text-base font-semibold leading-6 text-gray-900" title={provider.name}>
                        {provider.name}
                      </h2>
                      {pendingKey && (
                        <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-900">
                          <ExclamationTriangleIcon className="h-3.5 w-3.5" aria-hidden />
                          Pending
                        </span>
                      )}
                      {activeKeyCount === 0 && (
                        <span className="inline-flex items-center gap-1 rounded-md bg-red-100 px-1.5 py-0.5 text-[11px] font-medium text-red-800">
                          <ExclamationTriangleIcon className="h-3.5 w-3.5" aria-hidden />
                          No key
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 break-all font-mono text-[11px] leading-4 text-gray-500" title={provider.id}>
                      {provider.id}
                    </div>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-gray-600">
                    <span className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-2 py-1 font-medium text-gray-700">
                        <KeyIcon className="h-4 w-4" aria-hidden />
                        <span className="tabular-nums">{activeKeyCount}</span> active
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-2 py-1 font-medium text-gray-700">
                      <ServerStackIcon className="h-4 w-4" aria-hidden />
                      <span className="tabular-nums">{protocols.length}</span> protocol{protocols.length === 1 ? '' : 's'}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-gray-500" title={provider.description ?? undefined}>
                      {provider.description || 'No description'}
                    </span>
                  </div>

                  <div className="mt-2">
                    {protocols.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {protocols.map((protocol) => {
                          const feedbackId = `endpoint:${provider.id}:${protocol.key}`;
                          return (
                            <button
                              key={protocol.key}
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                void copyToClipboard(protocol.url, feedbackId);
                              }}
                              className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2 py-1 text-left hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                              title={`${protocol.label} — ${protocol.url} (click to copy)`}
                            >
                              {copiedId === feedbackId ? (
                                <CheckIcon className="h-4 w-4 shrink-0 text-green-600" aria-hidden />
                              ) : (
                                <ProviderProtocolIcon protocol={protocol.key} />
                              )}
                              <span className="shrink-0 text-xs font-medium text-gray-700">{protocol.label}</span>
                              <span className="min-w-0 truncate text-[11px] text-gray-500">{protocol.url}</span>
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="rounded-md border border-dashed border-gray-200 px-2 py-1.5 text-xs text-gray-400">
                        No endpoint configured
                      </div>
                    )}
                  </div>
                </div>

                <div className="border-t border-gray-100 bg-gray-50/70 px-3 py-2">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleToggleProviderKeyPreview(provider.id);
                    }}
                    className="flex w-full items-center justify-between gap-3 rounded-md px-1 py-0.5 text-left focus:outline-none focus:ring-2 focus:ring-blue-500"
                    aria-expanded={isExpanded}
                  >
                    <span className="text-xs font-medium text-gray-800">
                      Keys
                      {previewRows.length > 0 && (
                        <span className="ml-2 font-normal text-gray-500">
                          {previewRows.length} total
                          {inactiveKeyCount > 0 ? ` · ${inactiveKeyCount} inactive` : ''}
                        </span>
                      )}
                    </span>
                    <ChevronDownIcon
                      className={`h-5 w-5 shrink-0 text-gray-500 transition ${isExpanded ? 'rotate-180' : ''}`}
                      aria-hidden
                    />
                  </button>

                  {isExpanded && (
                    <div
                      className="mt-2"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {isPreviewLoading ? (
                        <div className="py-3 text-sm text-gray-500">Loading keys…</div>
                      ) : previewError ? (
                        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                          {previewError}
                        </div>
                      ) : previewRows.length === 0 ? (
                        <div className="rounded-md border border-dashed border-gray-200 bg-white px-3 py-3 text-sm text-gray-500">
                          No keys configured.
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {previewRows
                            .slice()
                            .sort((a, b) => b.priority - a.priority || b.weight - a.weight || a.label.localeCompare(b.label))
                            .map((key) => (
                              <div
                                key={key.id}
                                role="button"
                                tabIndex={0}
                                onClick={() => openProviderKeyEditor(provider.id, key)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    openProviderKeyEditor(provider.id, key);
                                  }
                                }}
                                className="grid grid-cols-[auto_minmax(5rem,0.8fr)_minmax(5rem,1fr)_auto] items-center gap-2 rounded-md border border-gray-200 bg-white px-2 py-1.5 transition hover:border-blue-200 hover:bg-blue-50/40"
                              >
                                <input
                                  type="checkbox"
                                  checked={key.status === 'active'}
                                  disabled={providerKeyTogglingId === key.id}
                                  onClick={(e) => e.stopPropagation()}
                                  onChange={() => void handleToggleProviderKeyStatus(key, provider.id)}
                                  className="h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50"
                                  aria-label={
                                    key.status === 'active'
                                      ? `Key ${key.label} enabled (uncheck to disable)`
                                      : `Key ${key.label} disabled (check to enable)`
                                  }
                                />
                                <div className="min-w-0">
                                  <span className="flex min-w-0 items-center gap-1.5">
                                    <span className="truncate font-mono text-xs font-semibold leading-4 text-gray-900" title={key.label}>
                                      {key.label}
                                    </span>
                                    {key.is_pending_import && (
                                      <span className="shrink-0 rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-900">
                                        placeholder
                                      </span>
                                    )}
                                    {copiedId === `provider-key:${key.id}` && (
                                      <span className="shrink-0 rounded-md bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-800">
                                        copied
                                      </span>
                                    )}
                                  </span>
                                </div>
                                <div className="flex min-w-0 items-center justify-start gap-1.5">
                                  <span className="min-w-0 max-w-full truncate font-mono text-[11px] leading-4 text-gray-500" title={key.masked_api_key}>
                                    {key.masked_api_key}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      void handleCopyProviderKey(key);
                                    }}
                                    className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    title={copiedId === `provider-key:${key.id}` ? 'Copied' : `Copy ${key.label}`}
                                    aria-label={copiedId === `provider-key:${key.id}` ? `Copied ${key.label}` : `Copy ${key.label}`}
                                  >
                                    {copiedId === `provider-key:${key.id}` ? (
                                      <CheckIcon className="h-4 w-4 text-green-600" aria-hidden />
                                    ) : (
                                      <ClipboardDocumentIcon className="h-4 w-4" aria-hidden />
                                    )}
                                  </button>
                                </div>
                                <div className="flex shrink-0 flex-wrap items-center justify-end gap-1 text-[11px] text-gray-600">
                                  <span className="rounded-md bg-gray-100 px-1.5 py-0.5">P {key.priority}</span>
                                  <span className="rounded-md bg-gray-100 px-1.5 py-0.5">W {key.weight}</span>
                                  <span className="rounded-md bg-gray-100 px-1.5 py-0.5">{formatLimitConfig(key.limit_config)}</span>
                                </div>
                              </div>
                            ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {editingProviderKey && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !keyEditSaving) {
              closeProviderKeyEditor();
            }
          }}
        >
          <div className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-lg bg-white shadow-xl">
            <div className="flex shrink-0 items-center justify-between border-b px-6 py-4">
              <div className="min-w-0">
                <h2 className="text-xl font-bold text-gray-900">Edit Provider Key</h2>
                <p className="mt-1 truncate font-mono text-xs text-gray-500" title={editingProviderKey.key.masked_api_key}>
                  {editingProviderKey.key.masked_api_key}
                </p>
              </div>
              <button
                type="button"
                onClick={closeProviderKeyEditor}
                className="text-gray-400 hover:text-gray-600"
                disabled={keyEditSaving}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-6">
              {keyEditError && (
                <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-600">
                  {keyEditError}
                </div>
              )}
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">Label</label>
                    <input
                      type="text"
                      value={keyEditForm.label}
                      onChange={(e) => setKeyEditForm({ ...keyEditForm, label: e.target.value })}
                      className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      autoComplete="off"
                    />
                  </div>
                  <div className="flex items-end">
                    <label className="inline-flex items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
                      <input
                        type="checkbox"
                        checked={keyEditForm.status === 'active'}
                        onChange={(e) =>
                          setKeyEditForm({ ...keyEditForm, status: e.target.checked ? 'active' : 'disabled' })
                        }
                        className="h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
                      />
                      Active
                    </label>
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Replace API key</label>
                  <input
                    type="password"
                    value={keyEditForm.api_key}
                    onChange={(e) => setKeyEditForm({ ...keyEditForm, api_key: e.target.value })}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Leave blank to keep current key"
                    autoComplete="new-password"
                  />
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">Priority</label>
                    <input
                      type="number"
                      value={keyEditForm.priority}
                      onChange={(e) => setKeyEditForm({ ...keyEditForm, priority: e.target.value })}
                      className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">Weight</label>
                    <input
                      type="number"
                      min={1}
                      value={keyEditForm.weight}
                      onChange={(e) => setKeyEditForm({ ...keyEditForm, weight: e.target.value })}
                      className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">RPM limit</label>
                    <input
                      type="number"
                      min={1}
                      value={keyEditForm.rpm}
                      onChange={(e) => setKeyEditForm({ ...keyEditForm, rpm: e.target.value })}
                      className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="unlimited"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">TPM limit</label>
                    <input
                      type="number"
                      min={1}
                      value={keyEditForm.tpm}
                      onChange={(e) => setKeyEditForm({ ...keyEditForm, tpm: e.target.value })}
                      className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="unlimited"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">Concurrency</label>
                    <input
                      type="number"
                      min={1}
                      value={keyEditForm.max_concurrency}
                      onChange={(e) => setKeyEditForm({ ...keyEditForm, max_concurrency: e.target.value })}
                      className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="unlimited"
                    />
                  </div>
                </div>
              </div>
            </div>
            <div className="flex shrink-0 justify-end gap-3 border-t bg-gray-50 px-6 py-4">
              <button
                type="button"
                onClick={closeProviderKeyEditor}
                className="rounded-md border border-gray-300 px-4 py-2 text-gray-700 hover:bg-white"
                disabled={keyEditSaving}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleSaveProviderKeyEdit()}
                disabled={keyEditSaving}
                className="rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {keyEditSaving ? 'Saving…' : 'Save key'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showImportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div
            className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg bg-white shadow-xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="provider-import-title"
          >
            <div className="flex shrink-0 items-center justify-between border-b px-6 py-4">
              <div>
                <h2 id="provider-import-title" className="text-xl font-bold text-gray-900">
                  Import from templates
                </h2>
                <p className="mt-1 text-xs text-gray-500">
                  Prefills OpenAI-compatible base URLs (CN-first catalog). Each import creates a new provider row.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowImportModal(false)}
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
              <span className="ml-auto text-sm text-gray-600">
                Selected <span className="font-semibold tabular-nums">{importSelectedCount}</span> /{' '}
                <span className="tabular-nums">{importCatalogRows.length}</span> available
              </span>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
              {importCatalogLoading && (
                <div className="py-12 text-center text-gray-600">Loading catalog…</div>
              )}
              {!importCatalogLoading && importCatalogError && (
                <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                  {importCatalogError}
                </div>
              )}
              {!importCatalogLoading && !importCatalogError && importCatalogRows.length === 0 && (
                <div className="py-12 text-center text-gray-500">Catalog is empty</div>
              )}
              {!importCatalogLoading && !importCatalogError && importCatalogRows.length > 0 && (
                <ul className="divide-y divide-gray-200 rounded-lg border border-gray-200">
                  {importCatalogRows.map((row) => {
                    const checked = Boolean(importSelected[row.id]);
                    return (
                      <li key={row.id} className="flex flex-wrap items-start gap-3 px-4 py-3 hover:bg-gray-50">
                        <input
                          type="checkbox"
                          className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          checked={checked}
                          onChange={() => toggleImportPreset(row.id)}
                          aria-label={`Select ${row.name}`}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-gray-900">{row.name}</p>
                          <p className="text-xs text-gray-500">
                            {row.vendor_label} · protocols: {row.protocols.join(', ') || '—'}
                          </p>
                          {row.base_url_openai && (
                            <p className="mt-1 break-all text-[11px] text-gray-400" title={row.base_url_openai}>
                              OpenAI base: {row.base_url_openai}
                            </p>
                          )}
                          {row.description && (
                            <p className="mt-1 text-xs text-gray-600">{row.description}</p>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="flex shrink-0 flex-wrap items-center justify-end gap-3 border-t bg-gray-50 px-6 py-4">
              <button
                type="button"
                onClick={() => void runImportSelectedPresets()}
                disabled={importSubmitting || importCatalogLoading || importSelectedCount === 0}
                className="rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {importSubmitting ? 'Importing…' : `Import selected (${importSelectedCount})`}
              </button>
            </div>
          </div>
        </div>
      )}

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
          <div className={`flex max-h-[90vh] w-full flex-col overflow-hidden rounded-lg bg-white shadow-xl ${editingProvider ? 'max-w-3xl' : 'max-w-2xl'}`}>
            <div className="flex shrink-0 items-center justify-between border-b px-6 py-4">
              <div>
                <h2 className="text-xl font-bold text-gray-900">
                  {editingProvider ? 'Edit Provider' : 'New Provider'}
                </h2>
                {!editingProvider && duplicateSourceId && (
                  <p className="mt-1 text-xs text-gray-500">
                    Pre-filled from{' '}
                    <code className="rounded border border-gray-200 bg-gray-50 px-1 py-0.5 font-mono text-[11px]">
                      {duplicateSourceId}
                    </code>
                    . Set a new ID and review fields before saving.
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="text-gray-400 hover:text-gray-600"
                disabled={isSaving || isDeleting}
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-6">
              {saveError && (
                <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-600">{saveError}</div>
              )}

              <div className="space-y-6">
                {/* General */}
                <section className="rounded-lg border border-gray-200 bg-slate-50/70 p-4 space-y-3">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900">General</h3>
                    <p className="text-xs text-gray-500 mt-0.5">Display name and optional custom ID (new providers only).</p>
                  </div>
                  <div className="space-y-3">
                    {!editingProvider && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">ID</label>
                        <input
                          type="text"
                          value={formData.id}
                          onChange={(e) => setFormData({ ...formData, id: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono bg-white"
                          placeholder="Optional: custom ID (auto-generated if empty)"
                          autoComplete="off"
                        />
                        <p className="mt-1 text-xs text-gray-500">Leave empty to auto-generate a UUID</p>
                      </div>
                    )}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
                      <input
                        type="text"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                        placeholder="e.g., OpenAI"
                        autoComplete="off"
                        required
                      />
                    </div>
                  </div>
                </section>

                {/* Endpoints */}
                <section className="rounded-lg border border-gray-200 bg-slate-50/70 p-4 space-y-3">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900">Endpoints</h3>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Base URLs per upstream protocol. Model routes choose which protocol to use; the gateway calls OpenAI-compatible{' '}
                      <code className="text-[11px] bg-white px-1 py-0.5 rounded border border-gray-200">/chat/completions</code>{' '}
                      against the matching base.
                    </p>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        OpenAI <span className="ml-1 text-xs font-normal text-gray-400">(optional)</span>
                      </label>
                      <input
                        type="url"
                        value={formData.base_url_openai}
                        onChange={(e) => setFormData({ ...formData, base_url_openai: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                        placeholder="https://api.openai.com/v1"
                        autoComplete="off"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Anthropic <span className="ml-1 text-xs font-normal text-gray-400">(optional)</span>
                      </label>
                      <input
                        type="url"
                        value={formData.base_url_anthropic}
                        onChange={(e) => setFormData({ ...formData, base_url_anthropic: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                        placeholder="https://api.anthropic.com"
                        autoComplete="off"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Gemini <span className="ml-1 text-xs font-normal text-gray-400">(optional)</span>
                      </label>
                      <input
                        type="url"
                        value={formData.base_url_gemini}
                        onChange={(e) => setFormData({ ...formData, base_url_gemini: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                        placeholder="https://generativelanguage.googleapis.com/v1beta/models"
                        autoComplete="off"
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        Include the full prefix before <code className="text-gray-600">{'{model}'}</code>
												<br />
												Developer:{' '}
                        <code className="text-gray-600">/v1beta/models</code>;
												Vertex{'\u00A0'}Express:{' '}
                        <code className="text-gray-600">/v1/publishers/google/models</code>.
                      </p>
                    </div>
                  </div>
                </section>

                {/* Authentication (Edit only) */}
                {editingProvider && (
                <section className="rounded-lg border border-gray-200 bg-slate-50/70 p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-gray-900">Authentication</h3>
                      <p className="text-xs text-gray-500 mt-0.5">
                        Manage multiple upstream API keys; Proxy schedules active keys with weighted random failover.
                      </p>
                    </div>
                    {!showKeyForm && (
                      <button
                        type="button"
                        onClick={() => {
                          setKeyError('');
                          setShowKeyForm(true);
                        }}
                        className="shrink-0 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        Add
                      </button>
                    )}
                  </div>
                    <>
                      {keyError && (
                        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{keyError}</div>
                      )}
                      {keysLoading ? (
                        <p className="text-sm text-gray-500">Loading keys…</p>
                      ) : providerKeys.length === 0 ? (
                        <p className="text-sm text-gray-500">No keys configured.</p>
                      ) : (
                        <div className="overflow-x-auto rounded-md border border-gray-200 bg-white">
                          <table className="min-w-full text-sm">
                            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                              <tr>
                                <th className="px-3 py-2">Label</th>
                                <th className="min-w-[12rem] px-3 py-2">API Key</th>
                                <th className="px-3 py-2">Status</th>
                                <th className="px-3 py-2">Weight</th>
                                <th className="px-3 py-2">Priority</th>
                                <th className="px-3 py-2">Limits</th>
                                <th className="px-3 py-2 text-right">Actions</th>
                              </tr>
                            </thead>
                            <tbody>
                              {providerKeys.map((key) => (
                                <Fragment key={key.id}>
                                <tr className="border-t border-gray-100">
                                  <td className="px-3 py-2 font-mono text-xs">{key.label}</td>
                                  <td className="min-w-[12rem] px-3 py-2">
                                    <div className="flex items-center gap-2">
                                      <span
                                        className="truncate font-mono text-xs text-gray-600"
                                        title={key.masked_api_key}
                                      >
                                        {key.masked_api_key}
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() => void handleCopyProviderKey(key)}
                                        className="shrink-0 text-gray-400 hover:text-gray-600"
                                        title={copiedId === `provider-key:${key.id}` ? 'Copied' : 'Copy API key'}
                                      >
                                        {copiedId === `provider-key:${key.id}` ? (
                                          <CheckIcon className="h-4 w-4 text-green-600" aria-hidden />
                                        ) : (
                                          <ClipboardDocumentIcon className="h-4 w-4" aria-hidden />
                                        )}
                                      </button>
                                    </div>
                                  </td>
                                  <td className="px-3 py-2">
                                    <input
                                      type="checkbox"
                                      checked={key.status === 'active'}
                                      disabled={providerKeyTogglingId === key.id}
                                      onChange={() => void handleToggleProviderKeyStatus(key)}
                                      className="h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50"
                                      aria-label={
                                        key.status === 'active'
                                          ? `Key ${key.label} enabled (uncheck to disable)`
                                          : `Key ${key.label} disabled (check to enable)`
                                      }
                                    />
                                  </td>
                                  <td className="px-3 py-2">{key.weight}</td>
                                  <td className="px-3 py-2">{key.priority}</td>
                                  <td className="px-3 py-2">
                                    <div className="flex items-center gap-1.5">
                                      <span className="whitespace-nowrap text-xs text-gray-600">
                                        {formatLimitConfig(key.limit_config)}
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() => handleStartEditLimits(key)}
                                        aria-label={`Edit limits for key ${key.label}`}
                                        className="shrink-0 text-gray-400 hover:text-gray-600"
                                        title="Edit rate limits (RPM / TPM / concurrency)"
                                      >
                                        <PencilSquareIcon className="h-4 w-4" aria-hidden />
                                      </button>
                                    </div>
                                  </td>
                                  <td className="px-3 py-2 text-right">
                                    <button
                                      type="button"
                                      onClick={() => void handleDeleteProviderKey(key)}
                                      aria-label={`Delete key ${key.label}`}
                                      className="inline-flex rounded-md p-1.5 text-red-600 hover:bg-red-50"
                                    >
                                      <TrashIcon className="h-4 w-4" aria-hidden />
                                    </button>
                                  </td>
                                </tr>
                                {editingLimitsKeyId === key.id && (
                                  <tr className="border-t border-gray-100 bg-slate-50">
                                    <td colSpan={7} className="px-3 py-3">
                                      <div className="flex flex-wrap items-end gap-3">
                                        <div>
                                          <label className="mb-1 block text-xs font-medium text-gray-700">RPM</label>
                                          <input
                                            type="number"
                                            min={1}
                                            value={limitsForm.rpm}
                                            onChange={(e) => setLimitsForm({ ...limitsForm, rpm: e.target.value })}
                                            className="w-28 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                                            placeholder="unlimited"
                                          />
                                        </div>
                                        <div>
                                          <label className="mb-1 block text-xs font-medium text-gray-700">TPM</label>
                                          <input
                                            type="number"
                                            min={1}
                                            value={limitsForm.tpm}
                                            onChange={(e) => setLimitsForm({ ...limitsForm, tpm: e.target.value })}
                                            className="w-32 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                                            placeholder="unlimited"
                                          />
                                        </div>
                                        <div>
                                          <label className="mb-1 block text-xs font-medium text-gray-700">Concurrency</label>
                                          <input
                                            type="number"
                                            min={1}
                                            value={limitsForm.max_concurrency}
                                            onChange={(e) =>
                                              setLimitsForm({ ...limitsForm, max_concurrency: e.target.value })
                                            }
                                            className="w-28 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                                            placeholder="unlimited"
                                          />
                                        </div>
                                        <div className="flex items-center gap-2">
                                          <button
                                            type="button"
                                            onClick={() => void handleSaveKeyLimits(key)}
                                            disabled={limitsSaving}
                                            className="rounded-md bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-700 disabled:opacity-50"
                                          >
                                            {limitsSaving ? 'Saving…' : 'Save limits'}
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => setEditingLimitsKeyId(null)}
                                            disabled={limitsSaving}
                                            className="rounded-md border border-gray-300 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                                          >
                                            Cancel
                                          </button>
                                        </div>
                                        <p className="basis-full text-xs text-gray-500">
                                          Leave blank for unlimited. Counted in-memory per gateway instance (sliding 60s window); set ~90% of the upstream quota.
                                        </p>
                                      </div>
                                    </td>
                                  </tr>
                                )}
                                </Fragment>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                      {showKeyForm && (
                        <div className="rounded-md border border-dashed border-gray-300 bg-white p-3 space-y-3">
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                            <div>
                              <label className="mb-1 block text-sm font-medium text-gray-700">Label</label>
                              <input
                                type="text"
                                value={keyForm.label}
                                onChange={(e) => setKeyForm({ ...keyForm, label: e.target.value })}
                                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                placeholder="e.g. backup-cn-1"
                                autoComplete="off"
                              />
                            </div>
                            <div>
                              <label className="mb-1 block text-sm font-medium text-gray-700">Priority</label>
                              <input
                                type="number"
                                value={keyForm.priority}
                                onChange={(e) => setKeyForm({ ...keyForm, priority: e.target.value })}
                                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                placeholder="0"
                              />
                            </div>
                            <div>
                              <label className="mb-1 block text-sm font-medium text-gray-700">Weight</label>
                              <input
                                type="number"
                                min={1}
                                value={keyForm.weight}
                                onChange={(e) => setKeyForm({ ...keyForm, weight: e.target.value })}
                                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                placeholder="1"
                              />
                            </div>
                          </div>
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                            <div>
                              <label className="mb-1 block text-sm font-medium text-gray-700">RPM limit</label>
                              <input
                                type="number"
                                min={1}
                                value={keyForm.rpm}
                                onChange={(e) => setKeyForm({ ...keyForm, rpm: e.target.value })}
                                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                placeholder="unlimited"
                              />
                            </div>
                            <div>
                              <label className="mb-1 block text-sm font-medium text-gray-700">TPM limit</label>
                              <input
                                type="number"
                                min={1}
                                value={keyForm.tpm}
                                onChange={(e) => setKeyForm({ ...keyForm, tpm: e.target.value })}
                                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                placeholder="unlimited"
                              />
                            </div>
                            <div>
                              <label className="mb-1 block text-sm font-medium text-gray-700">Max concurrency</label>
                              <input
                                type="number"
                                min={1}
                                value={keyForm.max_concurrency}
                                onChange={(e) => setKeyForm({ ...keyForm, max_concurrency: e.target.value })}
                                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                placeholder="unlimited"
                              />
                            </div>
                          </div>
                          <div>
                            <label className="mb-1 block text-sm font-medium text-gray-700">Upstream API Key</label>
                            <input
                              type="password"
                              value={keyForm.api_key}
                              onChange={(e) => setKeyForm({ ...keyForm, api_key: e.target.value })}
                              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                              placeholder="sk-…"
                              autoComplete="new-password"
                            />
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => void handleAddProviderKey()}
                              disabled={keySaving}
                              className="rounded-md bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-700 disabled:opacity-50"
                            >
                              {keySaving ? 'Adding…' : 'Add key'}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setKeyForm(emptyKeyForm);
                                setKeyError('');
                                setShowKeyForm(false);
                              }}
                              disabled={keySaving}
                              className="rounded-md border border-gray-300 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                      {editingProvider.has_pending_key && (
                        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                          Template placeholder detected. Click <strong>Add</strong> and add a real key with label <code>default</code> or any label,
                          then disable/delete placeholders if needed.
                        </div>
                      )}
                    </>
                </section>
                )}

                {/* Description (providers.description) */}
                <section className="rounded-lg border border-gray-200 bg-slate-50/70 p-4 space-y-3">
                  <div>
                    <h3 id="provider-description-heading" className="text-sm font-semibold text-gray-900">Description</h3>
                    <p className="text-xs text-gray-500 mt-0.5">Internal reference only; not sent to upstream.</p>
                  </div>
                  <div>
                    <textarea
                      rows={3}
                      value={formData.description}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                      placeholder="Optional internal description"
                      autoComplete="off"
                      aria-labelledby="provider-description-heading"
                    />
                  </div>
                </section>
              </div>
            </div>

            <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t bg-gray-50 px-6 py-4">
              <div className="flex flex-wrap items-center gap-2">
                {editingProvider && (
                  <button
                    type="button"
                    onClick={() => void handleDelete(editingProvider.id)}
                    disabled={isSaving || isDeleting}
                    className="inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <TrashIcon className="h-4 w-4" aria-hidden />
                    {isDeleting ? 'Deleting…' : 'Delete provider'}
                  </button>
                )}
              </div>
              <div className="ml-auto flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="rounded-md border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-50"
                  disabled={isSaving || isDeleting}
                >
                  Cancel
                </button>
                {editingProvider && (
                  <button
                    type="button"
                    onClick={() => handleDuplicate(editingProvider)}
                    disabled={isSaving || isDeleting}
                    className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <DocumentDuplicateIcon className="h-4 w-4" aria-hidden />
                    Duplicate
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={isSaving || isDeleting}
                  className="rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {isSaving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
