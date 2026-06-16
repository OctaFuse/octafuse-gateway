'use client';

/**
 * 上游供应商：CRUD、各协议 base URL 与 API Key；对应 Worker `/admin/providers`。
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  TrashIcon,
  PlusIcon,
  ClipboardDocumentIcon,
  CheckIcon,
  ArrowDownTrayIcon,
  DocumentDuplicateIcon,
} from '@heroicons/react/24/outline';
import {
  OpenAiEndpointIcon,
  AnthropicEndpointIcon,
  GeminiEndpointIcon,
} from '@/components/upstream-brand-logo';
import { readApiJson } from '@/lib/api-json';
import { OCTAFUSE_GATEWAY_PRODUCT } from '@/lib/brand';
import { isPendingProviderImportApiKey } from '@/lib/provider-import-preset';
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
  fingerprint: string;
  created_at: string;
  updated_at: string;
};

const emptyKeyForm = {
  label: '',
  api_key: '',
  weight: '1',
  priority: '0',
};

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
  const [keyForm, setKeyForm] = useState(emptyKeyForm);
  const [keySaving, setKeySaving] = useState(false);
  const [keyError, setKeyError] = useState('');

  const existingProviderIds = useMemo(() => new Set(providers.map((p) => p.id)), [providers]);
  const pendingKeyCount = useMemo(
    () => providers.filter((p) => isPendingProviderImportApiKey(p.api_key)).length,
    [providers]
  );
  const importSelectedCount = useMemo(
    () => Object.values(importSelected).filter(Boolean).length,
    [importSelected]
  );

  const fetchProviderKeys = useCallback(async (providerId: string) => {
    setKeysLoading(true);
    setKeyError('');
    try {
      const response = await fetch(`/api/admin/providers/${encodeURIComponent(providerId)}/keys`);
      const data = await readApiJson<ProviderKeyRow[]>(response);
      if (data.success && data.data) {
        setProviderKeys(data.data);
      } else {
        setProviderKeys([]);
        setKeyError(data.message || 'Failed to load keys');
      }
    } catch (error) {
      console.error('Fetch provider keys error:', error);
      setProviderKeys([]);
      setKeyError('Failed to load keys');
    } finally {
      setKeysLoading(false);
    }
  }, []);

  useEffect(() => {
    if (editingProvider) {
      void fetchProviderKeys(editingProvider.id);
    } else {
      setProviderKeys([]);
      setKeyForm(emptyKeyForm);
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
        }),
      });
      const data = await readApiJson(response);
      if (data.success) {
        setKeyForm(emptyKeyForm);
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

  const handleToggleProviderKeyStatus = async (key: ProviderKeyRow) => {
    if (!editingProvider) return;
    const nextStatus = key.status === 'active' ? 'disabled' : 'active';
    if (nextStatus === 'disabled' && !confirm(`Disable key "${key.label}"?`)) return;
    try {
      const response = await fetch(
        `/api/admin/providers/${encodeURIComponent(editingProvider.id)}/keys/${encodeURIComponent(key.id)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: nextStatus }),
        }
      );
      const data = await readApiJson(response);
      if (data.success) {
        void fetchProviderKeys(editingProvider.id);
      } else {
        alert(data.message || 'Update failed');
      }
    } catch (error) {
      console.error('Toggle provider key error:', error);
      alert('Update failed');
    }
  };

  const handleDeleteProviderKey = async (key: ProviderKeyRow) => {
    if (!editingProvider) return;
    if (!confirm(`Delete key "${key.label}" (${key.fingerprint})? This cannot be undone.`)) return;
    try {
      const response = await fetch(
        `/api/admin/providers/${encodeURIComponent(editingProvider.id)}/keys/${encodeURIComponent(key.id)}`,
        { method: 'DELETE' }
      );
      const data = await readApiJson(response);
      if (data.success) {
        void fetchProviderKeys(editingProvider.id);
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
        setProviders([...data.data].sort((a, b) => a.id.localeCompare(b.id)));
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
    setShowModal(true);
    setSaveError('');
  };

  const handleEdit = (provider: GatewayProvider) => {
    setEditingProvider(provider);
    setDuplicateSourceId(null);
    const pending = isPendingProviderImportApiKey(provider.api_key);
    setFormData({
      id: provider.id,
      name: provider.name,
      base_url_openai: provider.base_url_openai ?? '',
      base_url_anthropic: provider.base_url_anthropic ?? '',
      base_url_gemini: provider.base_url_gemini ?? '',
      api_key: pending ? '' : provider.api_key,
      description: provider.description ?? '',
    });
    setShowModal(true);
    setSaveError('');
  };

  const handleDuplicate = (provider: GatewayProvider) => {
    setEditingProvider(null);
    setDuplicateSourceId(provider.id);
    const pending = isPendingProviderImportApiKey(provider.api_key);
    setFormData({
      id: suggestDuplicateProviderId(provider.id, existingProviderIds),
      name: `${provider.name} (copy)`,
      base_url_openai: provider.base_url_openai ?? '',
      base_url_anthropic: provider.base_url_anthropic ?? '',
      base_url_gemini: provider.base_url_gemini ?? '',
      api_key: pending ? '' : provider.api_key,
      description: provider.description ?? '',
    });
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
    if (existingProviderIds.has(id)) return;
    setImportSelected((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const selectAllImportPresets = () => {
    const next: Record<string, boolean> = {};
    for (const row of importCatalogRows) {
      if (!existingProviderIds.has(row.id)) next[row.id] = true;
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
        skipped_existing: string[];
        failed: Array<{ id: string; message: string }>;
      }>(response);
      if (data.success && data.data) {
        const { created, skipped_existing, failed } = data.data;
        const skipLines =
          skipped_existing.length > 0 ? `\nSkipped (already exists): ${skipped_existing.join(', ')}` : '';
        const failLines =
          failed.length > 0
            ? `\nFailed:\n${failed.map((f) => `  ${f.id}: ${f.message}`).join('\n')}`
            : '';
        alert(`Import finished.\nCreated: ${created}${skipLines}${failLines}`);
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
      !editingProvider &&
      !formData.api_key.trim()
    ) {
      setSaveError('API key is required for new providers.');
      return;
    }
    if (
      editingProvider &&
      isPendingProviderImportApiKey(editingProvider.api_key) &&
      providerKeys.every((k) => k.status !== 'active' || isPendingProviderImportApiKey(k.fingerprint))
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
      if (editingProvider) {
        delete payload.api_key;
      }
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

  const maskKey = (key: string) => {
    if (isPendingProviderImportApiKey(key)) return 'placeholder (edit to set key)';
    if (!key || key.length < 8) return '***';
    return key.substring(0, 4) + '...' + key.substring(key.length - 4);
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

      {/* Providers Table */}
      <div className="bg-white rounded-lg shadow-md overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                ID
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Name
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Endpoints
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">API Key</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Description</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {providers.map((provider) => {
              const openaiUrl = provider.base_url_openai?.trim() ?? '';
              const anthropicUrl = provider.base_url_anthropic?.trim() ?? '';
              const geminiUrl = provider.base_url_gemini?.trim() ?? '';
              const hasAnyEndpoint = Boolean(openaiUrl || anthropicUrl || geminiUrl);
              const pendingKey = isPendingProviderImportApiKey(provider.api_key);
              return (
              <tr
                key={provider.id}
                role="button"
                tabIndex={0}
                onClick={() => handleEdit(provider)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleEdit(provider);
                  }
                }}
                className={
                  (pendingKey ? 'bg-amber-50/80 hover:bg-amber-50 ' : 'hover:bg-gray-50 ') +
                  'cursor-pointer focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500'
                }
              >
                <td className="px-4 py-4 align-middle">
                  <div className="text-xs font-mono text-gray-600 break-all leading-snug" title={provider.id}>
                    {provider.id}
                  </div>
                </td>
                <td className="px-4 py-4 align-middle">
                  <div className="text-sm font-medium text-gray-900 leading-snug">{provider.name}</div>
                </td>
                <td className="px-4 py-4 align-middle">
                  {hasAnyEndpoint ? (
                    <div className="flex flex-row flex-wrap items-center gap-1">
                      {openaiUrl && (
                        <button
                          type="button"
                          aria-label="Copy OpenAI base URL"
                          onClick={(e) => {
                            e.stopPropagation();
                            void copyToClipboard(openaiUrl, `endpoint:${provider.id}:openai`);
                          }}
                          className="inline-flex items-center justify-center rounded-md p-1.5 text-gray-600 hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                          title={`OpenAI — ${openaiUrl} (click to copy)`}
                        >
                          {copiedId === `endpoint:${provider.id}:openai` ? (
                            <CheckIcon className="h-4 w-4 text-green-600" aria-hidden />
                          ) : (
                            <OpenAiEndpointIcon label="OpenAI" className="inline-flex" />
                          )}
                        </button>
                      )}
                      {anthropicUrl && (
                        <button
                          type="button"
                          aria-label="Copy Anthropic base URL"
                          onClick={(e) => {
                            e.stopPropagation();
                            void copyToClipboard(anthropicUrl, `endpoint:${provider.id}:anthropic`);
                          }}
                          className="inline-flex items-center justify-center rounded-md p-1.5 text-gray-600 hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                          title={`Anthropic — ${anthropicUrl} (click to copy)`}
                        >
                          {copiedId === `endpoint:${provider.id}:anthropic` ? (
                            <CheckIcon className="h-4 w-4 text-green-600" aria-hidden />
                          ) : (
                            <AnthropicEndpointIcon label="Anthropic" className="h-4 w-4" />
                          )}
                        </button>
                      )}
                      {geminiUrl && (
                        <button
                          type="button"
                          aria-label="Copy Gemini base URL"
                          onClick={(e) => {
                            e.stopPropagation();
                            void copyToClipboard(geminiUrl, `endpoint:${provider.id}:gemini`);
                          }}
                          className="inline-flex items-center justify-center rounded-md p-1.5 text-gray-600 hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                          title={`Gemini — ${geminiUrl} (click to copy)`}
                        >
                          {copiedId === `endpoint:${provider.id}:gemini` ? (
                            <CheckIcon className="h-4 w-4 text-green-600" aria-hidden />
                          ) : (
                            <GeminiEndpointIcon label="Gemini" className="h-4 w-4" />
                          )}
                        </button>
                      )}
                    </div>
                  ) : (
                    <span className="text-sm text-gray-400">—</span>
                  )}
                </td>
                <td className="px-4 py-4 whitespace-nowrap">
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-mono text-gray-600">{maskKey(provider.api_key)}</span>
                      {!pendingKey ? (
                        copiedId === `apikey:${provider.id}` ? (
                          <span className="text-xs text-green-600">Copied!</span>
                        ) : (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void copyToClipboard(provider.api_key, `apikey:${provider.id}`);
                            }}
                            className="text-gray-400 hover:text-gray-600"
                            title="Copy API key"
                          >
                            <ClipboardDocumentIcon className="h-4 w-4" />
                          </button>
                        )
                      ) : (
                        <span className="text-[11px] font-medium uppercase tracking-wide text-amber-800 bg-amber-100 px-2 py-0.5 rounded">
                          Pending key
                        </span>
                      )}
                    </div>
                    {pendingKey && (
                      <span className="self-start text-xs text-blue-700">Open row to set API key</span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-4 max-w-[200px]" title={provider.description ?? undefined}>
                  <span className="block truncate text-sm text-gray-600">{provider.description || '—'}</span>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>

        {providers.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            No providers found
          </div>
        )}
      </div>

      {showImportModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="provider-import-title"
        >
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-lg bg-white shadow-xl">
            <div className="flex items-center justify-between border-b px-6 py-4">
              <div>
                <h2 id="provider-import-title" className="text-xl font-bold text-gray-900">
                  Import from templates
                </h2>
                <p className="mt-1 text-xs text-gray-500">
                  Prefills OpenAI-compatible base URLs (CN-first catalog). Rows already in your database are skipped.
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
            <div className="border-b px-6 py-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={selectAllImportPresets}
                className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm hover:bg-gray-50"
              >
                Select all new
              </button>
              <button
                type="button"
                onClick={clearImportPresetSelection}
                className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm hover:bg-gray-50"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={() => void loadImportCatalog()}
                className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm hover:bg-gray-50"
              >
                Refresh catalog
              </button>
            </div>
            <div className="px-6 py-4">
              {importCatalogError && (
                <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {importCatalogError}
                </div>
              )}
              {importCatalogLoading ? (
                <div className="py-12 text-center text-gray-600">Loading catalog…</div>
              ) : (
                <ul className="divide-y divide-gray-200 rounded-lg border border-gray-200">
                  {importCatalogRows.map((row) => {
                    const exists = existingProviderIds.has(row.id);
                    const checked = Boolean(importSelected[row.id]);
                    return (
                      <li key={row.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                        <input
                          type="checkbox"
                          className="mt-1 h-4 w-4 rounded border-gray-300"
                          checked={checked}
                          disabled={exists}
                          onChange={() => toggleImportPreset(row.id)}
                          aria-label={exists ? `${row.name} already imported` : `Select ${row.name}`}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                            <span className="font-mono text-xs text-gray-500">{row.id}</span>
                            {exists && (
                              <span className="rounded bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">
                                Exists
                              </span>
                            )}
                          </div>
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
            <div className="flex justify-end gap-3 border-t px-6 py-4">
              <button
                type="button"
                onClick={() => setShowImportModal(false)}
                className="rounded-md border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-50"
                disabled={importSubmitting}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void runImportSelectedPresets()}
                disabled={importSubmitting || importSelectedCount === 0}
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg bg-white shadow-xl">
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
                        placeholder="https://generativelanguage.googleapis.com"
                        autoComplete="off"
                      />
                    </div>
                  </div>
                </section>

                {/* Authentication */}
                <section className="rounded-lg border border-gray-200 bg-slate-50/70 p-4 space-y-3">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900">Authentication</h3>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {editingProvider
                        ? 'Manage multiple upstream API keys; Proxy schedules active keys with weighted random failover.'
                        : 'Initial default key; you can add more keys after creation.'}
                    </p>
                  </div>
                  {editingProvider ? (
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
                                <th className="px-3 py-2">Fingerprint</th>
                                <th className="px-3 py-2">Status</th>
                                <th className="px-3 py-2">Weight</th>
                                <th className="px-3 py-2">Priority</th>
                                <th className="px-3 py-2 text-right">Actions</th>
                              </tr>
                            </thead>
                            <tbody>
                              {providerKeys.map((key) => (
                                <tr key={key.id} className="border-t border-gray-100">
                                  <td className="px-3 py-2 font-mono text-xs">{key.label}</td>
                                  <td className="px-3 py-2 font-mono text-xs text-gray-600">{key.fingerprint}</td>
                                  <td className="px-3 py-2">
                                    <span
                                      className={`inline-flex rounded-full px-2 py-0.5 text-xs ${
                                        key.status === 'active'
                                          ? 'bg-green-100 text-green-800'
                                          : 'bg-gray-100 text-gray-600'
                                      }`}
                                    >
                                      {key.status}
                                    </span>
                                  </td>
                                  <td className="px-3 py-2">{key.weight}</td>
                                  <td className="px-3 py-2">{key.priority}</td>
                                  <td className="px-3 py-2 text-right space-x-2">
                                    <button
                                      type="button"
                                      onClick={() => void handleToggleProviderKeyStatus(key)}
                                      className="text-xs text-blue-600 hover:underline"
                                    >
                                      {key.status === 'active' ? 'Disable' : 'Enable'}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => void handleDeleteProviderKey(key)}
                                      className="text-xs text-red-600 hover:underline"
                                    >
                                      Delete
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                      <div className="rounded-md border border-dashed border-gray-300 bg-white p-3 space-y-2">
                        <p className="text-xs font-medium text-gray-700">Add key</p>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          <input
                            type="text"
                            value={keyForm.label}
                            onChange={(e) => setKeyForm({ ...keyForm, label: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                            placeholder="Label (e.g. backup-cn-1)"
                            autoComplete="off"
                          />
                          <input
                            type="password"
                            value={keyForm.api_key}
                            onChange={(e) => setKeyForm({ ...keyForm, api_key: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                            placeholder="Upstream API key"
                            autoComplete="new-password"
                          />
                          <input
                            type="number"
                            min={1}
                            value={keyForm.weight}
                            onChange={(e) => setKeyForm({ ...keyForm, weight: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                            placeholder="Weight"
                          />
                          <input
                            type="number"
                            value={keyForm.priority}
                            onChange={(e) => setKeyForm({ ...keyForm, priority: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                            placeholder="Priority"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => void handleAddProviderKey()}
                          disabled={keySaving}
                          className="rounded-md bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-700 disabled:opacity-50"
                        >
                          {keySaving ? 'Adding…' : 'Add key'}
                        </button>
                      </div>
                      {editingProvider && isPendingProviderImportApiKey(editingProvider.api_key) && (
                        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                          Template placeholder detected. Add a real key above with label <code>default</code> or any label,
                          then disable/delete placeholders if needed.
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">API Key *</label>
                        <input
                          type="password"
                          value={formData.api_key}
                          onChange={(e) => setFormData({ ...formData, api_key: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                          autoComplete="new-password"
                          required
                        />
                      </div>
                    </>
                  )}
                </section>

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
