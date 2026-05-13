'use client';

/**
 * 网关用户列表：预算在 `users`；筛选与分页；跳转详情。
 */
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { PlusIcon } from '@heroicons/react/24/outline';
import { readApiJson } from '@/lib/api-json';
import { formatGatewayDateTime } from '@/lib/datetime';
import { formatGatewayMoneyCode } from '@/lib/format-gateway-currency';
import type { GatewayUserListItem } from '@/lib/types';
import { useBillingCurrency } from '@/lib/use-billing-currency';

export default function GatewayUsersPage() {
  const [users, setUsers] = useState<GatewayUserListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const [filterEmail, setFilterEmail] = useState('');
  const [filterExternalSystem, setFilterExternalSystem] = useState('');
  const [filterExternalUserId, setFilterExternalUserId] = useState('');
  const [filterMaxBudget, setFilterMaxBudget] = useState<'positive' | 'zero_or_negative' | 'null'>('positive');
  const [filterStatus, setFilterStatus] = useState('');
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
  const { currency: billingCurrency } = useBillingCurrency();

  const fetchUsers = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        page_size: pageSize.toString(),
        max_budget: filterMaxBudget,
      });
      if (filterEmail.trim()) params.append('email', filterEmail.trim());
      if (filterExternalSystem.trim()) params.append('external_system', filterExternalSystem.trim());
      if (filterExternalUserId.trim()) params.append('external_user_id', filterExternalUserId.trim());
      if (filterStatus) params.append('status', filterStatus);

      const response = await fetch(`/api/admin/users?${params.toString()}`);
      const data = await readApiJson<GatewayUserListItem[]>(response);
      if (data.success && data.data) {
        setUsers(data.data);
        setTotal(data.total ?? 0);
      }
    } catch (e) {
      console.error('Fetch users error:', e);
    } finally {
      setIsLoading(false);
    }
  }, [page, filterEmail, filterExternalSystem, filterExternalUserId, filterMaxBudget, filterStatus]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const totalPages = Math.ceil(total / pageSize);

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
      const body: Record<string, unknown> = {
        email: createForm.email.trim() || null,
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
          <div>
            <label className="block text-sm text-gray-500 mb-1">Max budget</label>
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
        <div className="text-sm text-gray-500 self-end">Total: {total} users</div>
      </div>

      <div className="bg-white rounded-lg shadow-md overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Email</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">External</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Budget</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Period</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Active keys</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {users.map((u) => (
              <tr key={u.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <Link href={`/gateway/users/${encodeURIComponent(u.id)}`} className="text-sm font-medium text-blue-600 hover:underline">
                    {u.email || '—'}
                  </Link>
                  <div className="text-xs text-gray-500 font-mono mt-0.5">{u.id}</div>
                </td>
                <td className="px-4 py-3 text-sm text-gray-900">
                  <div>{u.external_system || '—'}</div>
                  <div className="text-xs text-gray-500 font-mono truncate max-w-[14rem]" title={u.external_user_id ?? ''}>
                    {u.external_user_id || '—'}
                  </div>
                </td>
                <td className="px-4 py-3 text-sm">
                  <div className="text-gray-900">
                    {formatGatewayMoneyCode(u.budget_spent, billingCurrency, 2)} /{' '}
                    {u.budget_max != null ? formatGatewayMoneyCode(u.budget_max, billingCurrency, 2) : 'no limit'}
                  </div>
                  {u.budget_base != null && u.budget_base > 0 && (
                    <div className="text-xs text-gray-500">base {formatGatewayMoneyCode(u.budget_base, billingCurrency, 2)}</div>
                  )}
                </td>
                <td className="px-4 py-3 text-sm text-gray-900">
                  {u.budget_period && u.budget_period !== 'none' ? u.budget_period : '—'}
                  <div className="text-xs text-gray-500">
                    {u.budget_reset_at ? formatGatewayDateTime(u.budget_reset_at) : '—'}
                  </div>
                </td>
                <td className="px-4 py-3 text-sm text-gray-900">{u.active_keys_count}</td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                      u.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-gray-200 text-gray-700'
                    }`}
                  >
                    {u.status}
                  </span>
                </td>
              </tr>
            ))}
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
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b flex justify-between items-center">
              <h2 className="text-xl font-bold text-gray-900">Create user</h2>
              <button type="button" onClick={() => setShowCreate(false)} className="text-gray-400 hover:text-gray-600">×</button>
            </div>
            <div className="p-6 space-y-4">
              {saveError && <div className="p-3 bg-red-50 border border-red-200 rounded-md text-red-600 text-sm">{saveError}</div>}
              <p className="text-sm text-gray-600">
                Idempotent when <strong>external system</strong> + <strong>external user ID</strong> are both set; otherwise creates a new gateway user.
              </p>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <input
                  type="text"
                  value={createForm.email}
                  onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">External system</label>
                  <input
                    type="text"
                    value={createForm.external_system}
                    onChange={(e) => setCreateForm({ ...createForm, external_system: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">External user ID</label>
                  <input
                    type="text"
                    value={createForm.external_user_id}
                    onChange={(e) => setCreateForm({ ...createForm, external_user_id: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Budget max</label>
                  <input
                    type="number"
                    step="0.01"
                    value={createForm.budget_max}
                    onChange={(e) => setCreateForm({ ...createForm, budget_max: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                    placeholder="Empty = unlimited"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Budget base</label>
                  <input
                    type="number"
                    step="0.01"
                    value={createForm.budget_base}
                    onChange={(e) => setCreateForm({ ...createForm, budget_base: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                    placeholder="Optional"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Budget period</label>
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
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Metadata (JSON object)</label>
                <textarea
                  value={createForm.metadata}
                  onChange={(e) => setCreateForm({ ...createForm, metadata: e.target.value })}
                  rows={4}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md font-mono text-xs"
                  placeholder="{}"
                />
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
    </div>
  );
}
