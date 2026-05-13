'use client';

/**
 * API 密钥管理：列表分页、创建/编辑预算与 metadata、吊销/激活、物理删除。
 */
import { useState, useEffect, useCallback, type ReactNode } from 'react';
import { PlusIcon, ClipboardDocumentIcon } from '@heroicons/react/24/outline';
import { readApiJson } from '@/lib/api-json';
import { formatGatewayDateTime, parseGatewayDateTime } from '@/lib/datetime';
import { formatGatewayMoneyCode, getGatewayCurrencySymbol } from '@/lib/format-gateway-currency';
import { useBillingCurrency } from '@/lib/use-billing-currency';
import type { GatewayApiKey } from '@/lib/types';

function formatApiKeyMetadataForEditor(raw: string | null | undefined): string {
  if (raw == null || raw === '') {
    return '';
  }
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function normalizeMetadataClient(raw: string): { ok: true; value: string | null } | { ok: false; message: string } {
  const t = raw.trim();
  if (t === '') {
    return { ok: true, value: null };
  }
  try {
    return { ok: true, value: JSON.stringify(JSON.parse(t)) };
  } catch {
    return { ok: false, message: 'Metadata must be valid JSON' };
  }
}

function formatKeyTimestamp(iso: string | null | undefined): string {
  if (iso == null || iso === '') {
    return '—';
  }
  return formatGatewayDateTime(iso);
}

function formatLocalDateTimeInput(raw: string | null | undefined): string {
  const date = parseGatewayDateTime(raw);
  if (!date) {
    return '';
  }
  const pad = (value: number) => value.toString().padStart(2, '0');
  return [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`,
  ].join('T');
}

function summarizeMetadata(raw: string | null | undefined): {
  ok: boolean;
  empty: boolean;
  /** 行内简短摘要（如 `plan_id: pro · +2`） */
  summary: string;
  /** 弹窗内完整 pretty JSON（解析失败时为原始字符串） */
  full: string;
} {
  if (raw == null || raw === '') {
    return { ok: true, empty: true, summary: '', full: '' };
  }
  try {
    const parsed = JSON.parse(raw);
    const full = JSON.stringify(parsed, null, 2);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const entries = Object.entries(parsed as Record<string, unknown>);
      if (entries.length === 0) {
        return { ok: true, empty: false, summary: '{}', full };
      }
      const [firstKey, firstVal] = entries[0];
      const valueText = typeof firstVal === 'string' ? firstVal : JSON.stringify(firstVal);
      const head = `${firstKey}: ${valueText}`;
      const rest = entries.length - 1;
      return {
        ok: true,
        empty: false,
        summary: rest > 0 ? `${head} · +${rest}` : head,
        full,
      };
    }
    const compact = JSON.stringify(parsed);
    return { ok: true, empty: false, summary: compact, full };
  } catch {
    return { ok: false, empty: false, summary: raw, full: raw };
  }
}

function ReadonlyRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <div className="text-xs font-medium text-gray-500">{label}</div>
      <div className="mt-0.5 text-sm text-gray-900 min-w-0">{children}</div>
    </div>
  );
}

export default function GatewayKeysPage() {
  const [keys, setKeys] = useState<GatewayApiKey[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const [filterEmail, setFilterEmail] = useState('');
  const [filterMaxBudget, setFilterMaxBudget] = useState<'positive' | 'zero_or_negative' | 'null'>('positive');
  const [isLoading, setIsLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedKey, setSelectedKey] = useState<GatewayApiKey | null>(null);
  const [formData, setFormData] = useState({
    user_id: '',
    user_email: '',
    budget_max: '',
    budget_base: '',
    budget_period: 'none',
    metadata: '',
  });
  const [editFormData, setEditFormData] = useState({
    id: '',
    budget_max: '',
    budget_base: '',
    budget_period: 'none',
    budget_spent: '',
    budget_reset_at: '',
    metadata: '',
  });
  const [saveError, setSaveError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [statusTogglingId, setStatusTogglingId] = useState<string | null>(null);
  const [metadataViewKey, setMetadataViewKey] = useState<GatewayApiKey | null>(null);
  const { currency: billingCurrency } = useBillingCurrency();
  const billingCurrencySym = getGatewayCurrencySymbol(billingCurrency);

  const fetchKeys = useCallback(async () => {
    try {
      setIsLoading(true);
      const params = new URLSearchParams();
      params.append('page', page.toString());
      params.append('page_size', pageSize.toString());
      if (filterEmail) params.append('email', filterEmail);
      if (filterMaxBudget) params.append('max_budget', filterMaxBudget);

      const response = await fetch(`/api/admin/keys?${params.toString()}`);
      const data = await readApiJson<GatewayApiKey[]>(response);
      if (data.success && data.data) {
        setKeys(data.data);
        setTotal(data.total || 0);
      }
    } catch (error) {
      console.error('Fetch keys error:', error);
    } finally {
      setIsLoading(false);
    }
  }, [page, filterEmail, filterMaxBudget]);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  const handleCreate = () => {
    setFormData({
      user_id: '',
      user_email: '',
      budget_max: '',
      budget_base: '',
      budget_period: 'none',
      metadata: '',
    });
    setShowModal(true);
    setSaveError('');
  };

  const handleStatusToggle = async (key: GatewayApiKey) => {
    const nextStatus = key.status === 'active' ? 'revoked' : 'active';
    setStatusTogglingId(key.id);
    try {
      const response = await fetch(`/api/admin/keys/${encodeURIComponent(key.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: nextStatus,
          reason: `gwui:st:${nextStatus}`,
        }),
      });
      const data = await readApiJson(response);
      if (data.success) {
        fetchKeys();
      } else {
        alert(data.message || 'Update failed');
      }
    } catch (error) {
      console.error('Status toggle error:', error);
      alert('Update failed');
    } finally {
      setStatusTogglingId(null);
    }
  };

  const handleEdit = (key: GatewayApiKey) => {
    setSelectedKey(key);
    setEditFormData({
      id: key.id,
      budget_max: key.budget_max?.toString() || '',
      budget_base: key.budget_base != null ? key.budget_base.toString() : '',
      budget_period: key.budget_period || 'none',
      budget_spent: key.budget_spent?.toString() || '0',
      budget_reset_at: formatLocalDateTimeInput(key.budget_reset_at),
      metadata: formatApiKeyMetadataForEditor(key.metadata),
    });
    setShowEditModal(true);
    setSaveError('');
  };

  const handleEditSave = async () => {
    if (!selectedKey) return;
    setSaveError('');
    setIsSaving(true);

    try {
      const meta = normalizeMetadataClient(editFormData.metadata);
      if (!meta.ok) {
        setSaveError(meta.message);
        setIsSaving(false);
        return;
      }

      const trimmedBudgetBase = editFormData.budget_base.trim();
      const payload: Record<string, unknown> = {
        budget_max: editFormData.budget_max ? parseFloat(editFormData.budget_max) : null,
        budget_spent: parseFloat(editFormData.budget_spent) || 0,
        budget_period: editFormData.budget_period,
        budget_reset_at: editFormData.budget_reset_at ? new Date(editFormData.budget_reset_at).toISOString() : null,
        metadata: meta.value,
        reason: 'gwui:edit',
      };
      const originalBudgetBase = selectedKey.budget_base != null ? selectedKey.budget_base.toString() : '';
      if (trimmedBudgetBase !== originalBudgetBase) {
        payload.budget_base = trimmedBudgetBase === '' ? null : parseFloat(trimmedBudgetBase);
      }

      const response = await fetch(`/api/admin/keys/${encodeURIComponent(selectedKey.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await readApiJson(response);
      if (data.success) {
        setShowEditModal(false);
        fetchKeys();
      } else {
        setSaveError(data.message || 'Update failed');
      }
    } catch (error) {
      console.error('Edit error:', error);
      setSaveError('Update failed, please try again');
    } finally {
      setIsSaving(false);
    }
  };

  const handleEditDelete = async () => {
    if (!selectedKey) return;
    if (
      !window.confirm(
        'Permanently delete this API key from the database? This cannot be undone. Request history rows may still reference the old key id.'
      )
    ) {
      return;
    }
    setSaveError('');
    setIsDeleting(true);
    try {
      const response = await fetch(`/api/admin/keys/${encodeURIComponent(selectedKey.id)}`, {
        method: 'DELETE',
      });
      const data = await readApiJson(response);
      if (data.success) {
        setShowEditModal(false);
        setSelectedKey(null);
        fetchKeys();
      } else {
        setSaveError(data.message || 'Delete failed');
      }
    } catch (error) {
      console.error('Delete key error:', error);
      setSaveError('Delete failed, please try again');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleSave = async () => {
    setSaveError('');
    setIsSaving(true);

    try {
      const meta = normalizeMetadataClient(formData.metadata);
      if (!meta.ok) {
        setSaveError(meta.message);
        setIsSaving(false);
        return;
      }

      const trimmedBudgetBase = formData.budget_base.trim();
      const payload: Record<string, unknown> = {
        user_id: formData.user_id,
        user_email: formData.user_email,
        budget_max: formData.budget_max ? parseFloat(formData.budget_max) : null,
        budget_period: formData.budget_period,
        metadata: meta.value,
        reason: 'gwui:new',
      };
      if (trimmedBudgetBase !== '') {
        payload.budget_base = parseFloat(trimmedBudgetBase);
      }

      const response = await fetch('/api/admin/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await readApiJson<GatewayApiKey>(response);

      if (data.success) {
        setShowModal(false);
        fetchKeys();
        // Show the new key
        if (data.data?.key) {
          alert(`Key created: ${data.data.key}\nPlease save this key as it won't be shown again.`);
        }
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

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(text);
      setTimeout(() => setCopiedKey(null), 2000);
    } catch (error) {
      console.error('Copy failed:', error);
    }
  };

  const maskKey = (key: string) => {
    if (!key || key.length < 10) return key;
    return key.substring(0, 7) + '...' + key.substring(key.length - 4);
  };

  const getBudgetPercentage = (key: GatewayApiKey) => {
    if (!key.budget_max) return 0;
    return Math.min(100, (key.budget_spent / key.budget_max) * 100);
  };

  const totalPages = Math.ceil(total / pageSize);

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
          <h1 className="text-3xl font-bold text-gray-900">API Keys</h1>
          <p className="text-sm text-gray-500 mt-1">Manage user API keys for gateway access</p>
        </div>
        <div className="flex items-center gap-4">
          <button
            onClick={handleCreate}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <PlusIcon className="h-5 w-5" />
            New Key
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="mb-4 flex justify-between items-center">
        <div className="flex gap-4">
          <div>
            <label className="block text-sm text-gray-500 mb-1">Email</label>
            <input
              type="text"
              value={filterEmail}
              onChange={(e) => { setFilterEmail(e.target.value); setPage(1); }}
              placeholder="Filter by email..."
              className="px-3 py-2 border border-gray-300 rounded-md text-sm"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-500 mb-1">Max-Budget</label>
            <div className="inline-flex rounded-md border border-gray-300 bg-white">
              <button
                type="button"
                onClick={() => { setFilterMaxBudget('positive'); setPage(1); }}
                className={`px-3 py-1.5 text-sm font-medium rounded-l-md border-r border-gray-300 ${
                  filterMaxBudget === 'positive' ? 'bg-blue-600 text-white border-blue-600' : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                &gt; 0
              </button>
              <button
                type="button"
                onClick={() => { setFilterMaxBudget('zero_or_negative'); setPage(1); }}
                className={`px-3 py-1.5 text-sm font-medium border-r border-gray-300 ${
                  filterMaxBudget === 'zero_or_negative' ? 'bg-blue-600 text-white border-blue-600' : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                &lt;= 0
              </button>
              <button
                type="button"
                onClick={() => { setFilterMaxBudget('null'); setPage(1); }}
                className={`px-3 py-1.5 text-sm font-medium rounded-r-md ${
                  filterMaxBudget === 'null' ? 'bg-blue-600 text-white' : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                no limit
              </button>
            </div>
          </div>
        </div>
        <div className="text-sm text-gray-500">
          Total: {total} keys
        </div>
      </div>

      {/* Keys Table */}
      <div className="bg-white rounded-lg shadow-md overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Key</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">User</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Budget</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Period</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Metadata</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {keys.map((key) => (
              <tr
                key={key.id}
                onClick={() => handleEdit(key)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    handleEdit(key);
                  }
                }}
                tabIndex={0}
                className="cursor-pointer hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500"
              >
                <td className="px-4 py-4">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-mono text-gray-900">{maskKey(key.key)}</span>
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        copyToClipboard(key.key);
                      }}
                      className="text-gray-400 hover:text-gray-600"
                      title="Copy key"
                    >
                      <ClipboardDocumentIcon className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="text-xs text-gray-500 font-mono mt-1">ID: {key.id}</div>
                </td>
                <td className="px-4 py-4">
                  <div className="text-sm text-gray-900">{key.user_email || '-'}</div>
                  <div className="text-xs text-gray-500">{key.user_id}</div>
                </td>
                <td className="px-4 py-4">
                  <div>
                    {/* Budget: always spend / max */}
                    {key.budget_max != null && key.budget_max > 0 && (
                      <div className="w-28 bg-gray-200 rounded-full h-2 mb-1.5">
                        <div
                          className={`h-2 rounded-full ${getBudgetPercentage(key) > 90 ? 'bg-red-500' : getBudgetPercentage(key) > 70 ? 'bg-yellow-500' : 'bg-green-500'}`}
                          style={{ width: `${getBudgetPercentage(key)}%` }}
                        />
                      </div>
                    )}
                    <div className="text-sm font-medium text-gray-900">
                      {formatGatewayMoneyCode(key.budget_spent, billingCurrency, 2)} /{' '}
                      {key.budget_max != null ? formatGatewayMoneyCode(key.budget_max, billingCurrency, 2) : 'no limit'}
                      {key.budget_base != null && (
                        <span className="ml-1 text-xs font-normal text-gray-500">
                          ({formatGatewayMoneyCode(key.budget_base, billingCurrency, 2)})
                        </span>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-4 py-4">
                  <div className="text-sm text-gray-900">
                    {key.budget_period && key.budget_period !== 'none' ? key.budget_period : '-'}
                  </div>
                  <div className="text-xs text-gray-500">
                    {key.budget_reset_at ? `resets ${formatGatewayDateTime(key.budget_reset_at)}` : '-'}
                  </div>
                </td>
                <td className="px-4 py-4 max-w-xs">
                  {(() => {
                    const m = summarizeMetadata(key.metadata);
                    if (m.empty) {
                      return <div className="text-sm text-gray-400">-</div>;
                    }
                    return (
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className={`block truncate text-xs font-mono ${m.ok ? 'text-gray-700' : 'text-red-600'}`}
                          title={m.summary}
                        >
                          {m.summary}
                        </span>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setMetadataViewKey(key);
                          }}
                          className="shrink-0 text-xs font-medium text-blue-600 hover:text-blue-800"
                        >
                          Details
                        </button>
                      </div>
                    );
                  })()}
                </td>
                <td className="px-4 py-4 whitespace-nowrap">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={key.status === 'active'}
                      disabled={statusTogglingId === key.id}
                      onClick={(event) => {
                        event.stopPropagation();
                        handleStatusToggle(key);
                      }}
                      className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed ${
                        key.status === 'active' ? 'bg-blue-600' : 'bg-gray-200'
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ${
                          key.status === 'active' ? 'translate-x-5' : 'translate-x-1'
                        }`}
                      />
                    </button>
                    {key.status !== 'active' && (
                      <span className="text-sm text-gray-600">Revoked</span>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {keys.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            No API keys found
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-4 flex justify-center gap-2">
          <button
            onClick={() => setPage(Math.max(1, page - 1))}
            disabled={page === 1}
            className="px-4 py-2 border border-gray-300 rounded-md text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
          >
            Previous
          </button>
          <span className="px-4 py-2 text-sm text-gray-600">
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => setPage(Math.min(totalPages, page + 1))}
            disabled={page === totalPages}
            className="px-4 py-2 border border-gray-300 rounded-md text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
          >
            Next
          </button>
        </div>
      )}

      {/* Create Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b flex justify-between items-center">
              <h2 className="text-xl font-bold text-gray-900">Create API Key</h2>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600">x</button>
            </div>

            <div className="p-6">
              {saveError && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-red-600 text-sm">{saveError}</div>
              )}

              <div className="mb-5 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                <p className="font-medium text-slate-800">After creation</p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-600">
                  <li>New keys are <strong>Active</strong> and tied to the <strong>user_id</strong> you enter (one active key per user).</li>
                  <li>The full <code className="rounded bg-slate-200 px-1 text-xs">sk-…</code> secret is shown <strong>once</strong> in a dialog; save it immediately.</li>
                  <li><code className="rounded bg-slate-200 px-1 text-xs">metadata</code> is optional JSON stored on the row and returned by <code className="rounded bg-slate-200 px-1 text-xs">GET /v1/me</code>.</li>
                </ul>
              </div>

              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">User ID *</label>
                    <input
                      type="text"
                      value={formData.user_id}
                      onChange={(e) => setFormData({ ...formData, user_id: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">User Email</label>
                    <input
                      type="email"
                      value={formData.user_email}
                      onChange={(e) => setFormData({ ...formData, user_email: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Budget Max ({billingCurrencySym})</label>
                    <input
                      type="number"
                      step="0.01"
                      value={formData.budget_max}
                      onChange={(e) => setFormData({ ...formData, budget_max: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="Leave empty for unlimited"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Budget Base ({billingCurrencySym})</label>
                    <input
                      type="number"
                      step="0.01"
                      value={formData.budget_base}
                      onChange={(e) => setFormData({ ...formData, budget_base: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="Defaults to Budget Max"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Budget Period</label>
                    <select
                      value={formData.budget_period}
                      onChange={(e) => setFormData({ ...formData, budget_period: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="none">None</option>
                      <option value="daily">Daily</option>
                      <option value="weekly">Weekly</option>
                      <option value="monthly">Monthly</option>
                    </select>
                  </div>
                </div>
                <p className="-mt-2 text-xs text-gray-500">
                  <span className="font-medium text-gray-700">Budget Base:</span> subscription baseline restored to <code className="rounded bg-gray-100 px-1">budget_max</code> on each period reset. Leave empty to default to the value of <code className="rounded bg-gray-100 px-1">budget_max</code>.
                </p>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Metadata (JSON)</label>
                  <textarea
                    value={formData.metadata}
                    onChange={(e) => setFormData({ ...formData, metadata: e.target.value })}
                    rows={6}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder='Optional, e.g. {"plan_id":"pro"}'
                  />
                  <p className="mt-1 text-xs text-gray-500">Stored on the key and returned by GET /v1/me. Leave empty for none.</p>
                </div>
              </div>
            </div>

            <div className="px-6 py-4 border-t flex justify-end gap-3">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50" disabled={isSaving}>Cancel</button>
              <button onClick={handleSave} disabled={isSaving} className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50">{isSaving ? 'Creating...' : 'Create'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {showEditModal && selectedKey && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b flex justify-between items-start gap-4">
              <div className="min-w-0">
                <h2 className="text-xl font-bold text-gray-900">Edit API Key</h2>
                <div className="mt-1 flex items-center gap-2">
                  <span className="font-mono text-xs text-gray-500 break-all">{selectedKey.id}</span>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(selectedKey.id)}
                    className="shrink-0 text-gray-400 hover:text-gray-600"
                    title="Copy ID"
                  >
                    <ClipboardDocumentIcon className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <button onClick={() => setShowEditModal(false)} className="text-gray-400 hover:text-gray-600">x</button>
            </div>

            <div className="p-6">
              {saveError && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-red-600 text-sm">{saveError}</div>
              )}

              <div className="mb-6 space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <ReadonlyRow label="Secret key">
                    <div className="flex items-start gap-2">
                      <span className="font-mono text-xs break-all">{selectedKey.key}</span>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(selectedKey.key)}
                        className="shrink-0 text-gray-400 hover:text-gray-600"
                        title="Copy secret"
                      >
                        <ClipboardDocumentIcon className="h-4 w-4" />
                      </button>
                    </div>
                  </ReadonlyRow>
                  <ReadonlyRow label="Status">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        selectedKey.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-gray-200 text-gray-700'
                      }`}
                    >
                      {selectedKey.status}
                    </span>
                    <span className="mt-1 block text-xs text-gray-500">Use the table row toggle to activate or revoke.</span>
                  </ReadonlyRow>
                  <ReadonlyRow label="User email">
                    {selectedKey.user_email || '—'}
                  </ReadonlyRow>
                  <ReadonlyRow label="User ID (auth)">
                    <span className="font-mono text-xs break-all">{selectedKey.user_id}</span>
                  </ReadonlyRow>
                  <ReadonlyRow label="Created">
                    {formatKeyTimestamp(selectedKey.created_at)}
                  </ReadonlyRow>
                  <ReadonlyRow label="Updated">
                    {formatKeyTimestamp(selectedKey.updated_at)}
                  </ReadonlyRow>
                </div>
                <div>
                  <a
                    href={`/gateway/request-logs?api_key_id=${selectedKey.id}`}
                    className="text-sm font-medium text-blue-600 hover:text-blue-800"
                  >
                    Open request logs for this key →
                  </a>
                </div>
              </div>

              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Budget Max ({billingCurrencySym})</label>
                    <input
                      type="number"
                      step="0.01"
                      value={editFormData.budget_max}
                      onChange={(e) => setEditFormData({ ...editFormData, budget_max: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="Leave empty for unlimited"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Budget Base ({billingCurrencySym})</label>
                    <input
                      type="number"
                      step="0.01"
                      value={editFormData.budget_base}
                      onChange={(e) => setEditFormData({ ...editFormData, budget_base: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="Plan baseline; restored on period reset"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Budget Spent ({billingCurrencySym})</label>
                    <input
                      type="number"
                      step="0.01"
                      value={editFormData.budget_spent}
                      onChange={(e) => setEditFormData({ ...editFormData, budget_spent: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
                <p className="-mt-2 text-xs text-gray-500">
                  <span className="font-medium text-gray-700">Budget Base:</span> subscription baseline restored to <code className="rounded bg-gray-100 px-1">budget_max</code> on period reset. Leave unchanged for top-ups (only bump <code className="rounded bg-gray-100 px-1">budget_max</code>).
                </p>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Budget Period</label>
                    <select
                      value={editFormData.budget_period}
                      onChange={(e) => setEditFormData({ ...editFormData, budget_period: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="none">None</option>
                      <option value="daily">Daily</option>
                      <option value="weekly">Weekly</option>
                      <option value="monthly">Monthly</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Budget Reset At</label>
                    <input
                      type="datetime-local"
                      step={1}
                      value={editFormData.budget_reset_at}
                      onChange={(e) => setEditFormData({ ...editFormData, budget_reset_at: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <p className="mt-1 text-xs text-gray-500">Leave empty for no reset</p>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Metadata (JSON)</label>
                  <textarea
                    value={editFormData.metadata}
                    onChange={(e) => setEditFormData({ ...editFormData, metadata: e.target.value })}
                    rows={8}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="{}"
                  />
                  <p className="mt-1 text-xs text-gray-500">Full JSON stored on this key; cleared if empty. Shown on GET /v1/me.</p>
                </div>
              </div>

            </div>

            <div className="px-6 py-4 border-t flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                onClick={handleEditDelete}
                disabled={isSaving || isDeleting}
                className="px-4 py-2 rounded-md border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-50 disabled:hover:bg-transparent"
              >
                {isDeleting ? 'Deleting...' : 'Delete key'}
              </button>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowEditModal(false)}
                  className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
                  disabled={isSaving || isDeleting}
                >
                  Cancel
                </button>
                <button
                  onClick={handleEditSave}
                  disabled={isSaving || isDeleting}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                >
                  {isSaving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Metadata Detail Modal */}
      {metadataViewKey && (() => {
        const m = summarizeMetadata(metadataViewKey.metadata);
        return (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] flex flex-col">
              <div className="px-6 py-4 border-b flex justify-between items-center">
                <div className="min-w-0">
                  <h2 className="text-lg font-bold text-gray-900">Metadata</h2>
                  <p className="mt-0.5 text-xs text-gray-500 font-mono truncate" title={metadataViewKey.id}>
                    {metadataViewKey.user_email || metadataViewKey.user_id} · {metadataViewKey.id}
                  </p>
                </div>
                <button
                  onClick={() => setMetadataViewKey(null)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  x
                </button>
              </div>
              <div className="p-6 overflow-y-auto">
                {m.empty ? (
                  <div className="text-sm text-gray-500">No metadata.</div>
                ) : (
                  <>
                    {!m.ok && (
                      <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                        Stored value is not valid JSON; showing raw string.
                      </div>
                    )}
                    <pre className="whitespace-pre-wrap break-all rounded-md bg-gray-50 border border-gray-200 p-4 text-xs font-mono text-gray-800">
                      {m.full}
                    </pre>
                  </>
                )}
              </div>
              <div className="px-6 py-3 border-t flex justify-end gap-3">
                {!m.empty && (
                  <button
                    type="button"
                    onClick={() => copyToClipboard(m.full)}
                    className="px-3 py-1.5 border border-gray-300 rounded-md text-sm text-gray-700 hover:bg-gray-50"
                  >
                    {copiedKey === m.full ? 'Copied' : 'Copy'}
                  </button>
                )}
                <button
                  onClick={() => setMetadataViewKey(null)}
                  className="px-3 py-1.5 bg-gray-800 text-white rounded-md text-sm hover:bg-gray-900"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
