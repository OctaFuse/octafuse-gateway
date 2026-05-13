'use client';

/**
 * 单个网关用户：预算计划、关联密钥、请求日志与用户审计。
 */
import { useState, useEffect, useCallback, type ReactNode } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ClipboardDocumentIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import { readApiJson } from '@/lib/api-json';
import { formatGatewayDateTime, parseGatewayDateTime } from '@/lib/datetime';
import { formatGatewayMoneyCode, formatGatewayMoneyCodeSigned } from '@/lib/format-gateway-currency';
import type { GatewayApiKeyBudgetAuditLog, GatewayRequestLog } from '@/lib/types';
import { GATEWAY_MONEY_DECIMAL_PLACES } from '@/lib/gateway-money';
import { useBillingCurrency } from '@/lib/use-billing-currency';

type UserDetail = {
  id: string;
  email: string | null;
  external_system: string | null;
  external_user_id: string | null;
  budget_max: number | null;
  budget_base: number;
  budget_spent: number;
  budget_period: string;
  budget_reset_at: string | null;
  status: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

type KeyRow = {
  id: string;
  key: string;
  user_id: string;
  name: string | null;
  status: string;
  metadata: string | null;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
};

function formatLocalDateTimeInput(raw: string | null | undefined): string {
  const date = parseGatewayDateTime(raw);
  if (!date) return '';
  const pad = (value: number) => value.toString().padStart(2, '0');
  return [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`,
  ].join('T');
}

function normalizeMetadataClient(raw: string): { ok: true; value: string | null } | { ok: false; message: string } {
  const t = raw.trim();
  if (t === '') return { ok: true, value: null };
  try {
    return { ok: true, value: JSON.stringify(JSON.parse(t)) };
  } catch {
    return { ok: false, message: 'Metadata must be valid JSON' };
  }
}

function ReadonlyRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-xs font-medium text-gray-500">{label}</div>
      <div className="mt-0.5 text-sm text-gray-900 min-w-0">{children}</div>
    </div>
  );
}

function maskKey(key: string) {
  if (!key || key.length < 10) return key;
  return `${key.substring(0, 7)}…${key.substring(key.length - 4)}`;
}

export default function GatewayUserDetailPage() {
  const params = useParams();
  const userIdRaw = typeof params.id === 'string' ? params.id : '';
  const userId = decodeURIComponent(userIdRaw);

  const [user, setUser] = useState<UserDetail | null>(null);
  const [loadError, setLoadError] = useState('');
  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [logs, setLogs] = useState<GatewayRequestLog[]>([]);
  const [logsTotal, setLogsTotal] = useState(0);
  const [logsPage, setLogsPage] = useState(1);
  const [audits, setAudits] = useState<GatewayApiKeyBudgetAuditLog[]>([]);
  const [auditsTotal, setAuditsTotal] = useState(0);
  const [auditsPage, setAuditsPage] = useState(1);
  const [planError, setPlanError] = useState('');
  const [isSavingPlan, setIsSavingPlan] = useState(false);
  const [planForm, setPlanForm] = useState({
    email: '',
    status: 'active',
    budget_max: '',
    budget_base: '',
    budget_spent: '',
    budget_period: 'none',
    budget_reset_at: '',
    metadata: '',
  });
  const [showNewKey, setShowNewKey] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyMeta, setNewKeyMeta] = useState('');
  const [keyError, setKeyError] = useState('');
  const [isKeySaving, setIsKeySaving] = useState(false);
  const { currency: billingCurrency } = useBillingCurrency();

  const loadUser = useCallback(async () => {
    if (!userId) return;
    setLoadError('');
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}`);
      const data = await readApiJson<UserDetail>(res);
      if (!data.success || !data.data) {
        setLoadError(data.message || 'Failed to load user');
        setUser(null);
        return;
      }
      const u = data.data;
      setUser(u);
      setPlanForm({
        email: u.email ?? '',
        status: u.status,
        budget_max: u.budget_max != null ? String(u.budget_max) : '',
        budget_base: String(u.budget_base ?? 0),
        budget_spent: String(u.budget_spent ?? 0),
        budget_period: u.budget_period || 'none',
        budget_reset_at: formatLocalDateTimeInput(u.budget_reset_at),
        metadata: u.metadata ? JSON.stringify(u.metadata, null, 2) : '',
      });
    } catch (e) {
      console.error(e);
      setLoadError('Failed to load user');
    }
  }, [userId]);

  const loadKeys = useCallback(async () => {
    if (!userId) return;
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/keys`);
      const data = await readApiJson<KeyRow[]>(res);
      if (data.success && data.data) setKeys(data.data);
    } catch (e) {
      console.error(e);
    }
  }, [userId]);

  const loadLogs = useCallback(async () => {
    if (!userId) return;
    try {
      const q = new URLSearchParams({ page: String(logsPage), page_size: '20' });
      const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/logs?${q}`);
      const data = await readApiJson<GatewayRequestLog[]>(res);
      if (data.success) {
        setLogs(data.data ?? []);
        setLogsTotal(data.total ?? 0);
      }
    } catch (e) {
      console.error(e);
    }
  }, [userId, logsPage]);

  const loadAudits = useCallback(async () => {
    if (!userId) return;
    try {
      const q = new URLSearchParams({ page: String(auditsPage), page_size: '20' });
      const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/audit-logs?${q}`);
      const data = await readApiJson<GatewayApiKeyBudgetAuditLog[]>(res);
      if (data.success) {
        setAudits(data.data ?? []);
        setAuditsTotal(data.total ?? 0);
      }
    } catch (e) {
      console.error(e);
    }
  }, [userId, auditsPage]);

  useEffect(() => {
    loadUser();
  }, [loadUser]);

  useEffect(() => {
    loadKeys();
  }, [loadKeys]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  useEffect(() => {
    loadAudits();
  }, [loadAudits]);

  const savePlan = async () => {
    setPlanError('');
    setIsSavingPlan(true);
    try {
      const meta = normalizeMetadataClient(planForm.metadata);
      if (!meta.ok) {
        setPlanError(meta.message);
        setIsSavingPlan(false);
        return;
      }
      const payload: Record<string, unknown> = {
        email: planForm.email.trim() === '' ? null : planForm.email.trim(),
        status: planForm.status,
        budget_max: planForm.budget_max.trim() === '' ? null : parseFloat(planForm.budget_max),
        budget_base: planForm.budget_base.trim() === '' ? null : parseFloat(planForm.budget_base),
        budget_spent: parseFloat(planForm.budget_spent) || 0,
        budget_period: planForm.budget_period,
        budget_reset_at: planForm.budget_reset_at ? new Date(planForm.budget_reset_at).toISOString() : null,
        reason: 'gwui:user-plan',
      };
      if (meta.value != null) {
        payload.metadata_replace = meta.value;
      }

      const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await readApiJson(res);
      if (data.success) {
        await loadUser();
      } else {
        setPlanError(data.message || 'Update failed');
      }
    } catch (e) {
      console.error(e);
      setPlanError('Update failed');
    } finally {
      setIsSavingPlan(false);
    }
  };

  const deleteUser = async () => {
    if (!window.confirm('Permanently delete this user and all keys / audit rows?')) return;
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}`, { method: 'DELETE' });
      const data = await readApiJson(res);
      if (data.success) {
        window.location.href = '/gateway/users';
      } else {
        alert(data.message || 'Delete failed');
      }
    } catch (e) {
      console.error(e);
      alert('Delete failed');
    }
  };

  const createKey = async () => {
    setKeyError('');
    setIsKeySaving(true);
    try {
      let metadata: string | null = null;
      if (newKeyMeta.trim() !== '') {
        const m = normalizeMetadataClient(newKeyMeta);
        if (!m.ok) {
          setKeyError(m.message);
          setIsKeySaving(false);
          return;
        }
        metadata = m.value;
      }
      const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newKeyName.trim() || null,
          metadata,
          reason: 'gwui:user-detail',
        }),
      });
      const data = await readApiJson<{ key?: string }>(res);
      if (data.success) {
        setShowNewKey(false);
        setNewKeyName('');
        setNewKeyMeta('');
        await loadKeys();
        if (data.data?.key) {
          alert(`Key created: ${data.data.key}\nSave it now; it will not be shown again.`);
        }
      } else {
        setKeyError(data.message || 'Create failed');
      }
    } catch (e) {
      console.error(e);
      setKeyError('Create failed');
    } finally {
      setIsKeySaving(false);
    }
  };

  const revokeKey = async (keyId: string) => {
    if (!window.confirm('Revoke this key?')) return;
    try {
      const res = await fetch(
        `/api/admin/users/${encodeURIComponent(userId)}/keys/${encodeURIComponent(keyId)}`,
        { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'revoked', reason: 'gwui:revoke' }) }
      );
      const data = await readApiJson(res);
      if (data.success) loadKeys();
      else alert(data.message || 'Failed');
    } catch (e) {
      console.error(e);
      alert('Failed');
    }
  };

  const deleteKeyHard = async (keyId: string) => {
    if (!window.confirm('Permanently delete this key from the database?')) return;
    try {
      const res = await fetch(
        `/api/admin/users/${encodeURIComponent(userId)}/keys/${encodeURIComponent(keyId)}`,
        { method: 'DELETE' }
      );
      const data = await readApiJson(res);
      if (data.success) loadKeys();
      else alert(data.message || 'Failed');
    } catch (e) {
      console.error(e);
      alert('Failed');
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* ignore */
    }
  };

  if (!userId) {
    return <div className="p-8 text-gray-600">Invalid user id</div>;
  }

  if (loadError) {
    return (
      <div className="p-8">
        <Link href="/gateway/users" className="text-sm text-blue-600 hover:underline">← Users</Link>
        <p className="mt-4 text-red-600">{loadError}</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="p-8">
        <Link href="/gateway/users" className="text-sm text-blue-600 hover:underline">← Users</Link>
        <div className="mt-8 text-gray-600">Loading…</div>
      </div>
    );
  }

  const logsTotalPages = Math.ceil(logsTotal / 20) || 1;
  const auditsTotalPages = Math.ceil(auditsTotal / 20) || 1;

  return (
    <div className="p-8 max-w-6xl">
      <div className="mb-6 flex flex-wrap justify-between gap-4">
        <div>
          <Link href="/gateway/users" className="text-sm text-blue-600 hover:underline">← Users</Link>
          <h1 className="text-2xl font-bold text-gray-900 mt-2">User</h1>
          <p className="text-sm text-gray-500 font-mono mt-1 break-all">{user.id}</p>
        </div>
        <div className="flex gap-2">
          <Link
            href={`/gateway/audit-logs?user_id=${encodeURIComponent(user.id)}`}
            className="px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-700 hover:bg-gray-50"
          >
            All audit logs
          </Link>
          <button type="button" onClick={deleteUser} className="px-3 py-2 border border-red-300 text-red-700 rounded-md text-sm hover:bg-red-50">
            Delete user
          </button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="bg-white rounded-lg shadow-md p-6 space-y-4">
          <h2 className="text-lg font-semibold text-gray-900">Profile & plan</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <ReadonlyRow label="External system">{user.external_system || '—'}</ReadonlyRow>
            <ReadonlyRow label="External user ID">
              <span className="font-mono text-xs break-all">{user.external_user_id || '—'}</span>
            </ReadonlyRow>
            <ReadonlyRow label="Created">{formatGatewayDateTime(user.created_at)}</ReadonlyRow>
            <ReadonlyRow label="Updated">{formatGatewayDateTime(user.updated_at)}</ReadonlyRow>
          </div>
          {planError && <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">{planError}</div>}
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input
                type="text"
                value={planForm.email}
                onChange={(e) => setPlanForm({ ...planForm, email: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
              <select
                value={planForm.status}
                onChange={(e) => setPlanForm({ ...planForm, status: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              >
                <option value="active">active</option>
                <option value="disabled">disabled</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Budget max</label>
                <input
                  type="number"
                  step="0.01"
                  value={planForm.budget_max}
                  onChange={(e) => setPlanForm({ ...planForm, budget_max: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Budget base</label>
                <input
                  type="number"
                  step="0.01"
                  value={planForm.budget_base}
                  onChange={(e) => setPlanForm({ ...planForm, budget_base: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Budget spent</label>
                <input
                  type="number"
                  step="0.01"
                  value={planForm.budget_spent}
                  onChange={(e) => setPlanForm({ ...planForm, budget_spent: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Period</label>
                <select
                  value={planForm.budget_period}
                  onChange={(e) => setPlanForm({ ...planForm, budget_period: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                >
                  <option value="none">none</option>
                  <option value="daily">daily</option>
                  <option value="weekly">weekly</option>
                  <option value="monthly">monthly</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Budget reset at (local)</label>
              <input
                type="datetime-local"
                step={1}
                value={planForm.budget_reset_at}
                onChange={(e) => setPlanForm({ ...planForm, budget_reset_at: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">User metadata (JSON, replace)</label>
              <textarea
                value={planForm.metadata}
                onChange={(e) => setPlanForm({ ...planForm, metadata: e.target.value })}
                rows={6}
                className="w-full px-3 py-2 border border-gray-300 rounded-md font-mono text-xs"
              />
            </div>
            <button
              type="button"
              onClick={savePlan}
              disabled={isSavingPlan}
              className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700 disabled:opacity-50"
            >
              {isSavingPlan ? 'Saving…' : 'Save plan'}
            </button>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold text-gray-900">API keys</h2>
            <button
              type="button"
              onClick={() => { setShowNewKey(true); setKeyError(''); }}
              className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700"
            >
              <PlusIcon className="h-4 w-4" />
              New key
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-gray-500 uppercase">
                  <th className="py-2 pr-2">Key</th>
                  <th className="py-2 pr-2">Name</th>
                  <th className="py-2 pr-2">Status</th>
                  <th className="py-2"> </th>
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <tr key={k.id} className="border-b border-gray-100">
                    <td className="py-2 pr-2 font-mono text-xs">
                      <span title={k.key}>{maskKey(k.key)}</span>
                      <button type="button" onClick={() => copy(k.key)} className="ml-1 text-gray-400 hover:text-gray-600 align-middle">
                        <ClipboardDocumentIcon className="h-3.5 w-3.5 inline" />
                      </button>
                      <div className="text-gray-400">{shortId(k.id)}</div>
                    </td>
                    <td className="py-2 pr-2">{k.name || '—'}</td>
                    <td className="py-2 pr-2">{k.status}</td>
                    <td className="py-2 whitespace-nowrap">
                      {k.status === 'active' && (
                        <button type="button" onClick={() => revokeKey(k.id)} className="text-xs text-amber-700 hover:underline mr-2">
                          Revoke
                        </button>
                      )}
                      <button type="button" onClick={() => deleteKeyHard(k.id)} className="text-xs text-red-600 hover:underline inline-flex items-center gap-0.5">
                        <TrashIcon className="h-3.5 w-3.5" />
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {keys.length === 0 && <p className="text-sm text-gray-500 py-4">No keys</p>}
          </div>
        </div>
      </div>

      <div className="mt-6 bg-white rounded-lg shadow-md p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-3">Recent request logs</h2>
        <div className="overflow-x-auto text-sm">
          <table className="min-w-full">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b">
                <th className="py-2 pr-2">Time</th>
                <th className="py-2 pr-2">Model</th>
                <th className="py-2 pr-2">Status</th>
                <th className="py-2 pr-2">Charged</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id} className="border-b border-gray-50">
                  <td className="py-2 pr-2 whitespace-nowrap">{formatGatewayDateTime(log.created_at)}</td>
                  <td className="py-2 pr-2 font-mono text-xs">{log.model_id || '—'}</td>
                  <td className="py-2 pr-2">{log.status}</td>
                  <td className="py-2 pr-2 tabular-nums">{formatGatewayMoneyCode(log.charged_cost, billingCurrency, 4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {logsTotalPages > 1 && (
          <div className="mt-3 flex gap-2 items-center text-sm">
            <button type="button" disabled={logsPage <= 1} onClick={() => setLogsPage((p) => p - 1)} className="px-2 py-1 border rounded disabled:opacity-50">Prev</button>
            <span className="text-gray-600">Page {logsPage} / {logsTotalPages}</span>
            <button type="button" disabled={logsPage >= logsTotalPages} onClick={() => setLogsPage((p) => p + 1)} className="px-2 py-1 border rounded disabled:opacity-50">Next</button>
          </div>
        )}
      </div>

      <div className="mt-6 bg-white rounded-lg shadow-md p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-3">User audit logs</h2>
        <div className="overflow-x-auto text-xs">
          <table className="min-w-full">
            <thead>
              <tr className="text-left text-gray-500 border-b">
                <th className="py-2 pr-2">Time</th>
                <th className="py-2 pr-2">Event</th>
                <th className="py-2 pr-2">Δ spend</th>
                <th className="py-2 pr-2">budget_max →</th>
              </tr>
            </thead>
            <tbody>
              {audits.map((a) => (
                <tr key={a.id} className="border-b border-gray-50">
                  <td className="py-2 pr-2 whitespace-nowrap">{formatGatewayDateTime(a.created_at)}</td>
                  <td className="py-2 pr-2">{a.event_type}</td>
                  <td className="py-2 pr-2">{formatGatewayMoneyCodeSigned(a.delta_spent, billingCurrency, GATEWAY_MONEY_DECIMAL_PLACES)}</td>
                  <td className="py-2 pr-2 font-mono">
                    {a.before_budget_max != null ? formatGatewayMoneyCode(a.before_budget_max, billingCurrency, 2) : '—'}
                    {' → '}
                    {a.after_budget_max != null ? formatGatewayMoneyCode(a.after_budget_max, billingCurrency, 2) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {auditsTotalPages > 1 && (
          <div className="mt-3 flex gap-2 items-center text-sm">
            <button type="button" disabled={auditsPage <= 1} onClick={() => setAuditsPage((p) => p - 1)} className="px-2 py-1 border rounded disabled:opacity-50">Prev</button>
            <span className="text-gray-600">Page {auditsPage} / {auditsTotalPages}</span>
            <button type="button" disabled={auditsPage >= auditsTotalPages} onClick={() => setAuditsPage((p) => p + 1)} className="px-2 py-1 border rounded disabled:opacity-50">Next</button>
          </div>
        )}
      </div>

      {showNewKey && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-bold text-gray-900 mb-3">New API key</h3>
            {keyError && <div className="mb-3 p-2 bg-red-50 text-red-700 text-sm rounded">{keyError}</div>}
            <div className="space-y-3">
              <div>
                <label className="block text-sm text-gray-700 mb-1">Name</label>
                <input value={newKeyName} onChange={(e) => setNewKeyName(e.target.value)} className="w-full border rounded px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm text-gray-700 mb-1">Metadata JSON</label>
                <textarea value={newKeyMeta} onChange={(e) => setNewKeyMeta(e.target.value)} rows={4} className="w-full border rounded px-3 py-2 font-mono text-xs" />
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setShowNewKey(false)} className="px-3 py-2 border rounded text-sm" disabled={isKeySaving}>Cancel</button>
              <button type="button" onClick={createKey} disabled={isKeySaving} className="px-3 py-2 bg-blue-600 text-white rounded text-sm disabled:opacity-50">{isKeySaving ? '…' : 'Create'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function shortId(id: string): string {
  if (!id || id.length < 14) return id;
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
}
