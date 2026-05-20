'use client';

/**
 * API 密钥管理：列表分页（预算只读，来自 users JOIN）、创建（关联 user 或外部身份对）、
 * 编辑 name/metadata、吊销/激活、物理删除。
 */
import { useState, useEffect, useCallback, type ReactNode } from 'react';
import Link from 'next/link';
import { PlusIcon, ClipboardDocumentIcon } from '@heroicons/react/24/outline';
import { readApiJson } from '@/lib/api-json';
import { formatGatewayDateTime } from '@/lib/datetime';
import { formatGatewayMoneyCode } from '@/lib/format-gateway-currency';
import { NewApiKeySecretBanner } from '@/lib/new-api-key-secret-banner';
import { normalizeMetadataClient } from '@/lib/normalize-metadata-client';
import { summarizeMetadata } from '@/lib/summarize-metadata';
import { useBillingCurrency } from '@/lib/use-billing-currency';
import type { GatewayApiKey } from '@/lib/types';

type KeyCreationMode = 'existingUser' | 'externalIdentity';
type ApiKeyListSortKey = 'created_at';
type SortDir = 'asc' | 'desc';

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

function formatKeyTimestamp(iso: string | null | undefined): string {
  if (iso == null || iso === '') {
    return '—';
  }
  return formatGatewayDateTime(iso);
}

/** 首列状态色块（实心）；悬停色块见完整 status 文案 */
function keyStatusSwatchClass(status: string) {
  if (status === 'active') return 'bg-emerald-500';
  if (status === 'revoked') return 'bg-gray-400';
  return 'bg-gray-300';
}

function formatUserBudgetOneLine(key: GatewayApiKey, currency: string): string {
  const spent = formatGatewayMoneyCode(key.budget_spent, currency, 2);
  const maxPart =
    key.budget_max != null
      ? formatGatewayMoneyCode(key.budget_max, currency, 2)
      : 'no limit';
  let line = `${spent} / ${maxPart}`;
  const period = key.budget_period && key.budget_period !== 'none' ? key.budget_period : null;
  if (period) {
    line += ` · ${period}`;
    if (key.budget_reset_at) {
      line += ` · resets ${formatGatewayDateTime(key.budget_reset_at)}`;
    }
  }
  return line;
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
  const [filterUserId, setFilterUserId] = useState('');
  const [sortKey, setSortKey] = useState<ApiKeyListSortKey>('created_at');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [isLoading, setIsLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedKey, setSelectedKey] = useState<GatewayApiKey | null>(null);
  const [formData, setFormData] = useState({
    user_id: '',
    email: '',
    external_system: '',
    external_user_id: '',
    name: '',
    metadata: '',
  });
  const [creationMode, setCreationMode] = useState<KeyCreationMode>('existingUser');
  const [freshCreatedKey, setFreshCreatedKey] = useState<string | null>(null);
  const [editFormData, setEditFormData] = useState({
    id: '',
    name: '',
    metadata: '',
  });
  const [saveError, setSaveError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [statusTogglingId, setStatusTogglingId] = useState<string | null>(null);
  const { currency: billingCurrency } = useBillingCurrency();

  const fetchKeys = useCallback(async () => {
    try {
      setIsLoading(true);
      const params = new URLSearchParams();
      params.append('page', page.toString());
      params.append('page_size', pageSize.toString());
      if (filterEmail) params.append('email', filterEmail);
      if (filterUserId.trim()) params.append('user_id', filterUserId.trim());
      params.append('sort', sortKey);
      params.append('order', sortDir);

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
  }, [page, filterEmail, filterUserId, sortKey, sortDir]);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  const toggleSort = (key: ApiKeyListSortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
    setPage(1);
  };

  const SortableTh = ({ label, columnKey }: { label: string; columnKey: ApiKeyListSortKey }) => (
    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          toggleSort(columnKey);
        }}
        className="hover:text-gray-700"
        aria-label={`Sort by ${label}`}
      >
        {label}
        {sortKey === columnKey && (sortDir === 'asc' ? ' ↑' : ' ↓')}
      </button>
    </th>
  );

  const handleCreationModeChange = (mode: KeyCreationMode) => {
    setCreationMode(mode);
    setFormData((prev) =>
      mode === 'existingUser'
        ? { ...prev, external_system: '', external_user_id: '', email: '' }
        : { ...prev, user_id: '' }
    );
  };

  const handleCreate = () => {
    setFormData({
      user_id: '',
      email: '',
      external_system: '',
      external_user_id: '',
      name: '',
      metadata: '',
    });
    setCreationMode('existingUser');
    setFreshCreatedKey(null);
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
        setSelectedKey((prev) =>
          prev?.id === key.id ? { ...prev, status: nextStatus } : prev
        );
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
      name: key.name ?? '',
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

      const payload: Record<string, unknown> = {
        name: editFormData.name.trim() === '' ? null : editFormData.name.trim(),
        metadata: meta.value,
        reason: 'gwui:edit',
      };

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

      const payload: Record<string, unknown> = {
        metadata: meta.value,
        reason: 'gwui:new',
      };

      if (creationMode === 'existingUser') {
        const uid = formData.user_id.trim();
        if (!uid) {
          setSaveError('User ID is required (gateway users.id)');
          setIsSaving(false);
          return;
        }
        payload.user_id = uid;
      } else {
        const extS = formData.external_system.trim();
        const extU = formData.external_user_id.trim();
        if ((extS && !extU) || (!extS && extU)) {
          setSaveError('External system and external user ID must be set together');
          setIsSaving(false);
          return;
        }
        if (!extS || !extU) {
          setSaveError('External system and external user ID are required for this mode');
          setIsSaving(false);
          return;
        }
        const em = formData.email.trim();
        if (!em) {
          setSaveError('Email is required when matching or creating a user by external identity');
          setIsSaving(false);
          return;
        }
        payload.external_system = extS;
        payload.external_user_id = extU;
        payload.email = em;
      }

      if (formData.name.trim() !== '') payload.name = formData.name.trim();

      const response = await fetch('/api/admin/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await readApiJson<{ key?: string; key_id?: string; user_id?: string }>(response);

      if (data.success) {
        setShowModal(false);
        fetchKeys();
        if (data.data?.key) {
          setFreshCreatedKey(data.data.key);
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

      {freshCreatedKey && (
        <div className="mb-6 max-w-3xl">
          <NewApiKeySecretBanner secret={freshCreatedKey} onDismiss={() => setFreshCreatedKey(null)} />
        </div>
      )}

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
            <label className="block text-sm text-gray-500 mb-1">User ID</label>
            <input
              type="text"
              value={filterUserId}
              onChange={(e) => { setFilterUserId(e.target.value); setPage(1); }}
              placeholder="Filter by gateway user uuid..."
              className="px-3 py-2 border border-gray-300 rounded-md text-xs w-72 font-mono"
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-gray-500">
          <span className="text-sm">Total: {total} keys</span>
          <span className="hidden sm:inline h-3 w-px bg-gray-200" aria-hidden />
          <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block w-2.5 h-2.5 rounded-sm bg-emerald-500 shrink-0" aria-hidden />
              active
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block w-2.5 h-2.5 rounded-sm bg-gray-400 shrink-0" aria-hidden />
              revoked
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block w-2.5 h-2.5 rounded-sm bg-gray-300 shrink-0" aria-hidden />
              other
            </span>
          </span>
        </div>
      </div>

      {/* Keys Table */}
      <div className="bg-white rounded-lg shadow-md overflow-hidden">
        <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">Status</th>
              <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">User</th>
              <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">Key</th>
              <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">Name</th>
              <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">User Budget</th>
              <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider min-w-[10rem] max-w-xs">Api Key Metadata</th>
              <SortableTh label="Created" columnKey="created_at" />
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {keys.map((key) => {
              const budgetLine = formatUserBudgetOneLine(key, billingCurrency);
              const meta = summarizeMetadata(key.metadata);
              return (
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
                <td className="px-3 py-3 whitespace-nowrap">
                  <span
                    className={`inline-block w-2.5 h-2.5 rounded-sm shrink-0 ${keyStatusSwatchClass(key.status)}`}
                    title={key.status}
                    role="img"
                    aria-label={`Status: ${key.status}`}
                  />
                </td>
                <td className="px-3 py-3 whitespace-nowrap">
                  <div className="text-sm text-gray-900">{key.user_email || '—'}</div>
                </td>
                <td className="px-3 py-3 whitespace-nowrap">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-mono text-gray-900">{maskKey(key.key)}</span>
                    <button
                      type="button"
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
                </td>
                <td className="px-3 py-3 whitespace-nowrap">
                  <div className="text-sm text-gray-900">{key.name?.trim() ? key.name : '—'}</div>
                </td>
                <td className="px-3 py-3 max-w-[20rem]">
                  <div className="text-sm text-gray-900 truncate whitespace-nowrap" title={budgetLine}>
                    {budgetLine}
                  </div>
                </td>
                <td className="px-3 py-3 max-w-xs">
                  {meta.empty ? (
                    <div className="text-sm text-gray-400">—</div>
                  ) : (
                    <span
                      className={`block truncate text-xs font-mono ${meta.ok ? 'text-gray-700' : 'text-red-600'}`}
                      title={meta.summary}
                    >
                      {meta.summary}
                    </span>
                  )}
                </td>
                <td className="px-3 py-3 whitespace-nowrap text-sm text-gray-600">
                  {formatKeyTimestamp(key.created_at)}
                </td>
              </tr>
            );
            })}
          </tbody>
        </table>
        </div>

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

              <fieldset className="mb-5 space-y-2">
                <legend className="text-sm font-medium text-gray-800">How to attach the key</legend>
                <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-6">
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700">
                    <input
                      type="radio"
                      name="keyCreationMode"
                      className="text-blue-600 focus:ring-blue-500"
                      checked={creationMode === 'existingUser'}
                      onChange={() => handleCreationModeChange('existingUser')}
                    />
                    Existing gateway user
                  </label>
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700">
                    <input
                      type="radio"
                      name="keyCreationMode"
                      className="text-blue-600 focus:ring-blue-500"
                      checked={creationMode === 'externalIdentity'}
                      onChange={() => handleCreationModeChange('externalIdentity')}
                    />
                    External identity (match or create user)
                  </label>
                </div>
              </fieldset>

              <div className="mb-5 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                <p className="font-medium text-slate-800">After creation</p>
                {creationMode === 'existingUser' ? (
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-600">
                    <li>
                      Enter the gateway <strong>User ID</strong> (<code className="rounded bg-slate-200 px-1 text-xs">users.id</code> from the{' '}
                      <Link href="/gateway/users" className="text-blue-700 underline">
                        Users
                      </Link>{' '}
                      list). Prefer creating keys from a user&apos;s detail page when you are already there.
                    </li>
                    <li>
                      Multiple <strong>active</strong> keys per user are allowed. Budget lives on the user — edit under{' '}
                      <Link href="/gateway/users" className="text-blue-700 underline">
                        Users
                      </Link>
                      .
                    </li>
                    <li>
                      The full <code className="rounded bg-slate-200 px-1 text-xs">sk-…</code> secret is shown <strong>once</strong> in the banner above the list; copy it immediately.
                    </li>
                    <li>
                      <code className="rounded bg-slate-200 px-1 text-xs">metadata</code> is optional JSON on the key (returned by <code className="rounded bg-slate-200 px-1 text-xs">GET /v1/me</code>).
                    </li>
                  </ul>
                ) : (
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-600">
                    <li>
                      Provide <strong>External system</strong>, <strong>External user ID</strong>, and <strong>Email</strong>. The gateway will match an existing user by that pair or create one (email stored on <code className="rounded bg-slate-200 px-1 text-xs">users.email</code>; required on first create). If the user already exists, the request email is not used to overwrite the stored email.
                    </li>
                    <li>
                      New users from this path start with <strong>zero</strong> budget until you set a plan on{' '}
                      <Link href="/gateway/users" className="text-blue-700 underline">
                        Users
                      </Link>
                      .
                    </li>
                    <li>
                      The full <code className="rounded bg-slate-200 px-1 text-xs">sk-…</code> secret is shown <strong>once</strong> in the banner above the list.
                    </li>
                    <li>
                      <code className="rounded bg-slate-200 px-1 text-xs">metadata</code> is optional JSON on the key (returned by <code className="rounded bg-slate-200 px-1 text-xs">GET /v1/me</code>).
                    </li>
                  </ul>
                )}
              </div>

              <div className="space-y-4">
                {creationMode === 'existingUser' ? (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      User ID <span className="ml-1 text-xs font-normal text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={formData.user_id}
                      onChange={(e) => setFormData({ ...formData, user_id: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="e.g. uuid from Users page"
                    />
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          External system <span className="ml-1 text-xs font-normal text-red-500">*</span>
                        </label>
                        <input
                          type="text"
                          value={formData.external_system}
                          onChange={(e) => setFormData({ ...formData, external_system: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="Upstream product id"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          External user ID <span className="ml-1 text-xs font-normal text-red-500">*</span>
                        </label>
                        <input
                          type="text"
                          value={formData.external_user_id}
                          onChange={(e) => setFormData({ ...formData, external_user_id: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="Upstream user id"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        User email <span className="ml-1 text-xs font-normal text-red-500">*</span>
                      </label>
                      <input
                        type="email"
                        value={formData.email}
                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="Stored on users.email when creating via external identity"
                      />
                      <p className="mt-1 text-xs text-gray-500">
                        Required for match-or-create. Not used to overwrite email when the external pair already exists.
                      </p>
                    </div>
                  </>
                )}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Key name <span className="ml-1 text-xs font-normal text-gray-400">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Label shown in admin / clients"
                  />
                </div>
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
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={selectedKey.status === 'active'}
                        disabled={statusTogglingId === selectedKey.id}
                        onClick={() => handleStatusToggle(selectedKey)}
                        className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed ${
                          selectedKey.status === 'active' ? 'bg-blue-600' : 'bg-gray-200'
                        }`}
                      >
                        <span
                          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ${
                            selectedKey.status === 'active' ? 'translate-x-5' : 'translate-x-1'
                          }`}
                        />
                      </button>
                      <span className="text-sm text-gray-600 capitalize">{selectedKey.status}</span>
                    </div>
                  </ReadonlyRow>
                  <ReadonlyRow label="User email">
                    {selectedKey.user_email || '—'}
                  </ReadonlyRow>
                  <ReadonlyRow label="User ID (auth)">
                    <Link href={`/gateway/users/${encodeURIComponent(selectedKey.user_id)}`} className="font-mono text-xs text-blue-600 hover:underline break-all">
                      {selectedKey.user_id}
                    </Link>
                  </ReadonlyRow>
                  <ReadonlyRow label="Budget (read-only)">
                    <div className="text-sm">
                      <div>
                        {formatGatewayMoneyCode(selectedKey.budget_spent, billingCurrency, 2)} /{' '}
                        {selectedKey.budget_max != null ? formatGatewayMoneyCode(selectedKey.budget_max, billingCurrency, 2) : 'no limit'}
                        {selectedKey.budget_base != null && (
                          <span className="ml-1 text-xs text-gray-500">
                            (base {formatGatewayMoneyCode(selectedKey.budget_base, billingCurrency, 2)})
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        Period: {selectedKey.budget_period && selectedKey.budget_period !== 'none' ? selectedKey.budget_period : 'none'}
                        {selectedKey.budget_reset_at ? ` · next reset ${formatGatewayDateTime(selectedKey.budget_reset_at)}` : ''}
                      </div>
                      <Link href={`/gateway/users/${encodeURIComponent(selectedKey.user_id)}`} className="mt-1 inline-block text-xs font-medium text-blue-600 hover:text-blue-800">
                        Edit plan on user →
                      </Link>
                    </div>
                  </ReadonlyRow>
                  <ReadonlyRow label="Created">
                    {formatKeyTimestamp(selectedKey.created_at)}
                  </ReadonlyRow>
                  <ReadonlyRow label="Updated">
                    {formatKeyTimestamp(selectedKey.updated_at)}
                  </ReadonlyRow>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                  <a
                    href={`/gateway/request-logs?api_key_id=${selectedKey.id}`}
                    className="font-medium text-blue-600 hover:text-blue-800"
                  >
                    Request logs for this key →
                  </a>
                  <Link
                    href={`/gateway/audit-logs?user_id=${encodeURIComponent(selectedKey.user_id)}`}
                    className="font-medium text-blue-600 hover:text-blue-800"
                  >
                    Audit logs for this user →
                  </Link>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                  <input
                    type="text"
                    value={editFormData.name}
                    onChange={(e) => setEditFormData({ ...editFormData, name: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Optional label"
                  />
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

    </div>
  );
}
