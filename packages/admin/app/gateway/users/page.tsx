'use client';

/**
 * 网关用户列表：预算在 `users`；筛选与分页；跳转详情。
 */
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { PlusIcon } from '@heroicons/react/24/outline';
import { readApiJson } from '@/lib/api-json';
import { formatGatewayDateTime } from '@/lib/datetime';
import { formatGatewayMoneyCode } from '@/lib/format-gateway-currency';
import { summarizeMetadata } from '@/lib/summarize-metadata';
import { nextListSortStateWithAscToggle } from '@/lib/toggle-list-sort';
import type { GatewayUserListItem } from '@/lib/types';
import { useBillingCurrency } from '@/lib/use-billing-currency';

type UserListSortKey = 'budget_spent' | 'budget_max' | 'budget_base' | 'budget_reset_at' | 'created_at';
type SortDir = 'asc' | 'desc';

/** 首列状态色块（实心）；悬停色块见完整 status 文案 */
function statusSwatchClass(status: string): string {
  if (status === 'active') return 'bg-emerald-500';
  return 'bg-gray-400';
}

function formatBudgetBase(value: number | null | undefined, currency: string): string {
  if (value == null || value === 0) return '—';
  return formatGatewayMoneyCode(value, currency, 2);
}

export default function GatewayUsersPage() {
  const router = useRouter();
  const [users, setUsers] = useState<GatewayUserListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const [filterEmail, setFilterEmail] = useState('');
  const [filterExternalSystem, setFilterExternalSystem] = useState('');
  const [filterExternalUserId, setFilterExternalUserId] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [sortKey, setSortKey] = useState<UserListSortKey>('created_at');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [isLoading, setIsLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({
    email: '',
    external_system: '',
    external_user_id: '',
    budget_max: '',
    budget_base: '',
    budget_period: 'none',
    metadata: '',
  });
  const [saveError, setSaveError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [metadataViewUser, setMetadataViewUser] = useState<GatewayUserListItem | null>(null);
  const [listError, setListError] = useState('');
  const { currency: billingCurrency } = useBillingCurrency();

  const fetchUsers = useCallback(async () => {
    setIsLoading(true);
    setListError('');
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        page_size: pageSize.toString(),
      });
      if (filterEmail.trim()) params.append('email', filterEmail.trim());
      if (filterExternalSystem.trim()) params.append('external_system', filterExternalSystem.trim());
      if (filterExternalUserId.trim()) params.append('external_user_id', filterExternalUserId.trim());
      if (filterStatus) params.append('status', filterStatus);
      params.append('sort', sortKey);
      params.append('order', sortDir);

      const response = await fetch(`/api/admin/users?${params.toString()}`);
      const data = await readApiJson<GatewayUserListItem[]>(response);
      if (data.success && data.data) {
        setUsers(data.data);
        setTotal(data.total ?? 0);
      } else {
        setListError(data.message || `Failed to load users (${response.status})`);
      }
    } catch (e) {
      console.error('Fetch users error:', e);
      setListError('Failed to load users');
    } finally {
      setIsLoading(false);
    }
  }, [page, filterEmail, filterExternalSystem, filterExternalUserId, filterStatus, sortKey, sortDir]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const totalPages = Math.ceil(total / pageSize);

  const toggleSort = (key: UserListSortKey) => {
    const next = nextListSortStateWithAscToggle(sortKey, sortDir, key);
    setSortKey(next.sortKey as UserListSortKey);
    setSortDir(next.sortDir);
    setPage(1);
  };

  const SortableTh = ({
    label,
    columnKey,
    align = 'left',
  }: {
    label: string;
    columnKey: UserListSortKey;
    align?: 'left' | 'right';
  }) => (
    <th
      className={`px-4 py-3 text-xs font-medium text-gray-500 uppercase whitespace-nowrap ${
        align === 'right' ? 'text-right' : 'text-left'
      }`}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          toggleSort(columnKey);
        }}
        className={`hover:text-gray-700 ${align === 'right' ? 'inline-block' : ''}`}
        aria-label={`Sort by ${label}`}
      >
        {label}
        {sortKey === columnKey && (sortDir === 'asc' ? ' ↑' : ' ↓')}
      </button>
    </th>
  );

  const openCreate = () => {
    setCreateForm({
      email: '',
      external_system: '',
      external_user_id: '',
      budget_max: '',
      budget_base: '',
      budget_period: 'none',
      metadata: '',
    });
    setSaveError('');
    setShowCreate(true);
  };

  const submitCreate = async () => {
    setSaveError('');
    setIsSaving(true);
    try {
      const extS = createForm.external_system.trim();
      const extU = createForm.external_user_id.trim();
      if ((extS && !extU) || (!extS && extU)) {
        setSaveError('External system and external user ID must both be set or both empty');
        setIsSaving(false);
        return;
      }
      const email = createForm.email.trim();
      if (!email) {
        setSaveError('Email is required');
        setIsSaving(false);
        return;
      }
      const body: Record<string, unknown> = {
        email,
        external_system: extS || null,
        external_user_id: extU || null,
        budget_period: createForm.budget_period,
      };
      if (createForm.budget_max.trim() !== '') {
        body.budget_max = parseFloat(createForm.budget_max);
      } else {
        body.budget_max = null;
      }
      if (createForm.budget_base.trim() !== '') {
        body.budget_base = parseFloat(createForm.budget_base);
      }
      if (createForm.metadata.trim() !== '') {
        try {
          body.metadata = JSON.parse(createForm.metadata);
        } catch {
          setSaveError('Metadata must be valid JSON');
          setIsSaving(false);
          return;
        }
      }

      const response = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await readApiJson<{ id: string }>(response);
      if (data.success && data.data?.id) {
        setShowCreate(false);
        fetchUsers();
      } else {
        setSaveError(data.message || 'Create failed');
      }
    } catch (e) {
      console.error(e);
      setSaveError('Create failed');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading && users.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-600">Loading...</div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Users</h1>
          <p className="text-sm text-gray-500 mt-1">
            Gateway users (<code className="text-xs bg-gray-100 px-1 rounded">users</code>) — budgets and external identity
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <PlusIcon className="h-5 w-5" />
          New user
        </button>
      </div>

      <div className="mb-4 flex flex-wrap gap-4 justify-between">
        <div className="flex flex-wrap gap-4">
          <div>
            <label className="block text-sm text-gray-500 mb-1">Email</label>
            <input
              type="text"
              value={filterEmail}
              onChange={(e) => { setFilterEmail(e.target.value); setPage(1); }}
              className="px-3 py-2 border border-gray-300 rounded-md text-sm w-48"
              placeholder="Contains…"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-500 mb-1">External system</label>
            <input
              type="text"
              value={filterExternalSystem}
              onChange={(e) => { setFilterExternalSystem(e.target.value); setPage(1); }}
              className="px-3 py-2 border border-gray-300 rounded-md text-sm w-40"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-500 mb-1">External user ID</label>
            <input
              type="text"
              value={filterExternalUserId}
              onChange={(e) => { setFilterExternalUserId(e.target.value); setPage(1); }}
              className="px-3 py-2 border border-gray-300 rounded-md text-sm w-40"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-500 mb-1">Status</label>
            <select
              value={filterStatus}
              onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }}
              className="px-3 py-2 border border-gray-300 rounded-md text-sm"
            >
              <option value="">All</option>
              <option value="active">active</option>
              <option value="disabled">disabled</option>
            </select>
          </div>
        </div>
        <div className="text-sm text-gray-500 self-end">Total: {total} users</div>
      </div>

      {listError && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-red-600 text-sm">{listError}</div>
      )}

      <div className="bg-white rounded-lg shadow-md overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">
                Status · Email
              </th>
              <SortableTh label="Spent" columnKey="budget_spent" align="right" />
              <SortableTh label="Max" columnKey="budget_max" align="right" />
              <SortableTh label="Base" columnKey="budget_base" align="right" />
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">
                Period
              </th>
              <SortableTh label="Reset at" columnKey="budget_reset_at" />
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase whitespace-nowrap">
                Keys
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap max-w-xs">
                Metadata
              </th>
              <SortableTh label="Created" columnKey="created_at" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {users.map((u) => {
              const detailHref = `/gateway/users/${encodeURIComponent(u.id)}`;
              const meta = summarizeMetadata(u.metadata);
              return (
              <tr
                key={u.id}
                role="link"
                tabIndex={0}
                aria-label={`User detail: ${u.email || u.id}`}
                className="hover:bg-gray-50 cursor-pointer"
                onClick={() => router.push(detailHref)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    router.push(detailHref);
                  }
                }}
              >
                <td className="px-4 py-3 text-sm min-w-[12rem]">
                  <div className="flex items-start gap-2 min-w-0">
                    <span
                      className={`inline-block w-2.5 h-2.5 rounded-sm shrink-0 mt-1 ${statusSwatchClass(u.status)}`}
                      title={u.status}
                      role="img"
                      aria-label={`Status: ${u.status}`}
                    />
                    <div className="min-w-0 truncate font-medium text-gray-900" title={u.email || undefined}>
                      {u.email || '—'}
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-sm text-gray-900 text-right tabular-nums whitespace-nowrap">
                  {formatGatewayMoneyCode(u.budget_spent, billingCurrency, 2)}
                </td>
                <td className="px-4 py-3 text-sm text-gray-900 text-right tabular-nums whitespace-nowrap">
                  {u.budget_max != null
                    ? formatGatewayMoneyCode(u.budget_max, billingCurrency, 2)
                    : 'no limit'}
                </td>
                <td className="px-4 py-3 text-sm text-gray-900 text-right tabular-nums whitespace-nowrap">
                  {formatBudgetBase(u.budget_base, billingCurrency)}
                </td>
                <td className="px-4 py-3 text-sm text-gray-900 whitespace-nowrap">
                  {u.budget_period && u.budget_period !== 'none' ? u.budget_period : '—'}
                </td>
                <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">
                  {u.budget_reset_at ? formatGatewayDateTime(u.budget_reset_at) : '—'}
                </td>
                <td className="px-4 py-3 text-sm text-gray-900 text-right tabular-nums whitespace-nowrap">
                  {u.active_keys_count}
                </td>
                <td
                  className="px-4 py-3 max-w-xs"
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                >
                  {meta.empty ? (
                    <div className="text-sm text-gray-400">—</div>
                  ) : (
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className={`block truncate text-xs font-mono ${meta.ok ? 'text-gray-700' : 'text-red-600'}`}
                        title={meta.summary}
                      >
                        {meta.summary}
                      </span>
                      <button
                        type="button"
                        onClick={() => setMetadataViewUser(u)}
                        className="shrink-0 text-xs font-medium text-blue-600 hover:text-blue-800"
                      >
                        Details
                      </button>
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">
                  {formatGatewayDateTime(u.created_at)}
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
        {users.length === 0 && (
          <div className="text-center py-12 text-gray-500">No users match filters</div>
        )}
      </div>

      {totalPages > 1 && (
        <div className="mt-4 flex justify-center gap-2">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-4 py-2 border border-gray-300 rounded-md text-sm disabled:opacity-50 hover:bg-gray-50"
          >
            Previous
          </button>
          <span className="px-4 py-2 text-sm text-gray-600">
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="px-4 py-2 border border-gray-300 rounded-md text-sm disabled:opacity-50 hover:bg-gray-50"
          >
            Next
          </button>
        </div>
      )}

      {showCreate && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b flex justify-between items-center">
              <h2 className="text-xl font-bold text-gray-900">Create user</h2>
              <button type="button" onClick={() => setShowCreate(false)} className="text-gray-400 hover:text-gray-600">×</button>
            </div>
            <div className="p-6 space-y-5">
              {saveError && <div className="p-3 bg-red-50 border border-red-200 rounded-md text-red-600 text-sm">{saveError}</div>}
              <p className="text-sm text-gray-600">
                Creates a new gateway user. <strong>Email</strong> is required; all other fields are optional. To link this user to an account in another system, use the <strong>External identity</strong> section at the bottom.
              </p>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Email <span aria-hidden="true" className="ml-0.5 text-red-500">*</span>
                </label>
                <input
                  type="email"
                  required
                  aria-required="true"
                  autoComplete="email"
                  value={createForm.email}
                  onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                  placeholder="user@example.com"
                />
              </div>
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Budget max <span className="ml-1 text-xs font-normal text-gray-400">(optional)</span>
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={createForm.budget_max}
                    onChange={(e) => setCreateForm({ ...createForm, budget_max: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                    placeholder="Empty = unlimited"
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    Maximum spendable amount in the current cycle. Leave empty for unlimited.
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Budget base <span className="ml-1 text-xs font-normal text-gray-400">(optional)</span>
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={createForm.budget_base}
                    onChange={(e) => setCreateForm({ ...createForm, budget_base: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                    placeholder="Optional"
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    Reference amount used to reset Budget max when the budget cycle resets.
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Budget period <span className="ml-1 text-xs font-normal text-gray-400">(optional)</span>
                  </label>
                  <select
                    value={createForm.budget_period}
                    onChange={(e) => setCreateForm({ ...createForm, budget_period: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                  >
                    <option value="none">none</option>
                    <option value="daily">daily</option>
                    <option value="weekly">weekly</option>
                    <option value="monthly">monthly</option>
                  </select>
                  <p className="mt-1 text-xs text-gray-500">
                    Reset cycle for spent / Budget max. <span className="font-mono">none</span> disables auto-reset.
                  </p>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Metadata (JSON object) <span className="ml-1 text-xs font-normal text-gray-400">(optional)</span>
                </label>
                <textarea
                  value={createForm.metadata}
                  onChange={(e) => setCreateForm({ ...createForm, metadata: e.target.value })}
                  rows={4}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md font-mono text-xs"
                  placeholder="{}"
                />
              </div>

              <div className="pt-4 border-t border-gray-200">
                <h3 className="text-sm font-semibold text-gray-900">
                  External identity <span className="ml-1 text-xs font-normal text-gray-400">(optional)</span>
                </h3>
                <p className="mt-1 text-xs text-gray-500">
                  Use these fields to link this user to an account in another system (e.g. your own SaaS, an OAuth provider). Leave both empty for an internal Gateway-only user. When both are set, creation is idempotent on the (external system, external user ID) pair.
                </p>
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      External system <span className="ml-1 text-xs font-normal text-gray-400">(optional)</span>
                    </label>
                    <input
                      type="text"
                      value={createForm.external_system}
                      onChange={(e) => setCreateForm({ ...createForm, external_system: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                      placeholder="e.g. my-app"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      External user ID <span className="ml-1 text-xs font-normal text-gray-400">(optional)</span>
                    </label>
                    <input
                      type="text"
                      value={createForm.external_user_id}
                      onChange={(e) => setCreateForm({ ...createForm, external_user_id: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                      placeholder="ID in the external system"
                    />
                  </div>
                </div>
              </div>
            </div>
            <div className="px-6 py-4 border-t flex justify-end gap-2">
              <button type="button" onClick={() => setShowCreate(false)} className="px-4 py-2 border rounded-md text-sm" disabled={isSaving}>Cancel</button>
              <button type="button" onClick={submitCreate} disabled={isSaving} className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm disabled:opacity-50">
                {isSaving ? 'Saving…' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {metadataViewUser && (() => {
        const m = summarizeMetadata(metadataViewUser.metadata);
        return (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] flex flex-col">
              <div className="px-6 py-4 border-b flex justify-between items-center">
                <div className="min-w-0">
                  <h2 className="text-lg font-bold text-gray-900">Metadata</h2>
                  <p className="mt-0.5 text-xs text-gray-500 font-mono truncate" title={metadataViewUser.id}>
                    {[metadataViewUser.email, metadataViewUser.id].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setMetadataViewUser(null)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  ×
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
              <div className="px-6 py-3 border-t flex justify-end">
                <button
                  type="button"
                  onClick={() => setMetadataViewUser(null)}
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
