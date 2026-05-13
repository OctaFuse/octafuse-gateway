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
import { NewApiKeySecretBanner } from '@/lib/new-api-key-secret-banner';
import { normalizeMetadataClient } from '@/lib/normalize-metadata-client';
import { useBillingCurrency } from '@/lib/use-billing-currency';

type UserDetail = {
  id: string;
  email: string;
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

function summarizeMetadata(raw: string | null | undefined): {
  ok: boolean;
  empty: boolean;
  summary: string;
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
    external_system: '',
    external_user_id: '',
  });
  const [showNewKey, setShowNewKey] = useState(false);
  const [freshApiKey, setFreshApiKey] = useState<string | null>(null);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyMeta, setNewKeyMeta] = useState('');
  const [keyError, setKeyError] = useState('');
  const [keysInlineError, setKeysInlineError] = useState('');
  const [keyStatusTogglingId, setKeyStatusTogglingId] = useState<string | null>(null);
  const [metaViewKey, setMetaViewKey] = useState<KeyRow | null>(null);
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
        external_system: u.external_system ?? '',
        external_user_id: u.external_user_id ?? '',
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
      const email = planForm.email.trim();
      if (!email) {
        setPlanError('Email is required');
        setIsSavingPlan(false);
        return;
      }
      const extS = planForm.external_system.trim();
      const extU = planForm.external_user_id.trim();
      if ((extS && !extU) || (!extS && extU)) {
        setPlanError('External system and external user ID must both be set or both empty');
        setIsSavingPlan(false);
        return;
      }
      const payload: Record<string, unknown> = {
        email,
        status: planForm.status,
        budget_max: planForm.budget_max.trim() === '' ? null : parseFloat(planForm.budget_max),
        budget_base: planForm.budget_base.trim() === '' ? null : parseFloat(planForm.budget_base),
        budget_spent: parseFloat(planForm.budget_spent) || 0,
        budget_period: planForm.budget_period,
        budget_reset_at: planForm.budget_reset_at ? new Date(planForm.budget_reset_at).toISOString() : null,
        external_system: extS || null,
        external_user_id: extU || null,
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
        setKeysInlineError('');
        await loadKeys();
        if (data.data?.key) {
          setFreshApiKey(data.data.key);
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

  const toggleKeyStatus = async (k: KeyRow) => {
    const nextStatus = k.status === 'active' ? 'revoked' : 'active';
    setKeysInlineError('');
    setKeyStatusTogglingId(k.id);
    try {
      const res = await fetch(
        `/api/admin/users/${encodeURIComponent(userId)}/keys/${encodeURIComponent(k.id)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: nextStatus,
            reason: `gwui:st:${nextStatus}`,
          }),
        }
      );
      const data = await readApiJson(res);
      if (data.success) {
        await loadKeys();
      } else {
        setKeysInlineError(data.message || 'Update failed');
      }
    } catch (e) {
      console.error(e);
      setKeysInlineError('Update failed');
    } finally {
      setKeyStatusTogglingId(null);
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
    <div className="p-8">
      <div className="mb-6">
        <Link href="/gateway/users" className="text-sm text-blue-600 hover:underline">← Users</Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-2">User</h1>
        <p className="text-sm text-gray-500 font-mono mt-1 break-all">{user.id}</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="bg-white rounded-lg shadow-md p-6 space-y-4">
          <h2 className="text-lg font-semibold text-gray-900">User Detail</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <ReadonlyRow label="Created">{formatGatewayDateTime(user.created_at)}</ReadonlyRow>
            <ReadonlyRow label="Updated">{formatGatewayDateTime(user.updated_at)}</ReadonlyRow>
          </div>
          {planError && <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">{planError}</div>}
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Email <span aria-hidden="true" className="ml-0.5 text-red-500">*</span>
                </label>
                <input
                  type="email"
                  required
                  aria-required="true"
                  autoComplete="email"
                  value={planForm.email}
                  onChange={(e) => setPlanForm({ ...planForm, email: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                  placeholder="user@example.com"
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
                <p className="mt-1 text-xs text-gray-500">
                  Disabled users cannot use any API key for new requests.
                </p>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Budget max <span className="ml-1 text-xs font-normal text-gray-400">(optional)</span>
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={planForm.budget_max}
                  onChange={(e) => setPlanForm({ ...planForm, budget_max: e.target.value })}
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
                  value={planForm.budget_base}
                  onChange={(e) => setPlanForm({ ...planForm, budget_base: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                  placeholder="Optional"
                />
                <p className="mt-1 text-xs text-gray-500">
                  Reference amount used to reset Budget max when the budget cycle resets.
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Budget spent</label>
                <input
                  type="number"
                  step="0.01"
                  value={planForm.budget_spent}
                  onChange={(e) => setPlanForm({ ...planForm, budget_spent: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                />
                <p className="mt-1 text-xs text-gray-500">
                  Amount already spent in the current cycle. Edit only to manually adjust.
                </p>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Budget period <span className="ml-1 text-xs font-normal text-gray-400">(optional)</span>
                </label>
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
                <p className="mt-1 text-xs text-gray-500">
                  Reset cycle for spent / Budget max. <span className="font-mono">none</span> disables auto-reset.
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Budget reset at (local) <span className="ml-1 text-xs font-normal text-gray-400">(optional)</span>
                </label>
                <input
                  type="datetime-local"
                  step={1}
                  value={planForm.budget_reset_at}
                  onChange={(e) => setPlanForm({ ...planForm, budget_reset_at: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                />
                <p className="mt-1 text-xs text-gray-500">
                  Next time spent (and Budget max from base) will auto-reset. Ignored when Budget period is <span className="font-mono">none</span>.
                </p>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Metadata (JSON object) <span className="ml-1 text-xs font-normal text-gray-400">(optional)</span>
              </label>
              <textarea
                value={planForm.metadata}
                onChange={(e) => setPlanForm({ ...planForm, metadata: e.target.value })}
                rows={6}
                className="w-full px-3 py-2 border border-gray-300 rounded-md font-mono text-xs"
                placeholder="{}"
              />
              <p className="mt-1 text-xs text-gray-500">
                Saving replaces the entire metadata object. Leave empty to keep current value unchanged.
              </p>
            </div>
            <div className="pt-4 border-t border-gray-200">
              <h3 className="text-sm font-semibold text-gray-900">
                External identity <span className="ml-1 text-xs font-normal text-gray-400">(optional)</span>
              </h3>
              <p className="mt-1 text-xs text-gray-500">
                Use these fields to link this user to an account in another system (e.g. your own SaaS, an OAuth provider). Leave both empty for an internal Gateway-only user. Both fields must be set together or both left blank.
              </p>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    External system <span className="ml-1 text-xs font-normal text-gray-400">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={planForm.external_system}
                    onChange={(e) => setPlanForm({ ...planForm, external_system: e.target.value })}
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
                    value={planForm.external_user_id}
                    onChange={(e) => setPlanForm({ ...planForm, external_user_id: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                    placeholder="ID in the external system"
                  />
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between gap-3 pt-2">
              <button
                type="button"
                onClick={deleteUser}
                className="px-4 py-2 border border-red-300 text-red-700 rounded-md text-sm hover:bg-red-50"
              >
                Delete user
              </button>
              <button
                type="button"
                onClick={savePlan}
                disabled={isSavingPlan}
                className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700 disabled:opacity-50"
              >
                {isSavingPlan ? 'Saving…' : 'Save user'}
              </button>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold text-gray-900">API keys</h2>
            <button
              type="button"
              onClick={() => {
                setShowNewKey(true);
                setKeyError('');
                setKeysInlineError('');
                setFreshApiKey(null);
              }}
              className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700"
            >
              <PlusIcon className="h-4 w-4" />
              New key
            </button>
          </div>
          {keysInlineError && (
            <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{keysInlineError}</div>
          )}
          {freshApiKey && (
            <NewApiKeySecretBanner secret={freshApiKey} onDismiss={() => setFreshApiKey(null)} />
          )}
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm table-auto">
              <thead>
                <tr className="border-b text-xs text-gray-500 uppercase">
                  <th className="py-2 pr-4 text-left">Key</th>
                  <th className="py-2 pr-4 text-left">Name</th>
                  <th className="py-2 pr-4 text-left">Metadata</th>
                  <th className="py-2 pr-4 text-left">Status</th>
                  <th className="py-2 pl-4 text-right whitespace-nowrap w-px">Actions</th>
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <tr key={k.id} className="border-b border-gray-100">
                    <td className="py-2 pr-4 font-mono text-xs align-top">
                      <span title={k.key}>{maskKey(k.key)}</span>
                      <button type="button" onClick={() => copy(k.key)} className="ml-1 text-gray-400 hover:text-gray-600 align-middle">
                        <ClipboardDocumentIcon className="h-3.5 w-3.5 inline" />
                      </button>
                      <div className="text-gray-400">{shortId(k.id)}</div>
                    </td>
                    <td className="py-2 pr-4 align-top">{k.name || '—'}</td>
                    <td className="py-2 pr-4 align-top max-w-xs">
                      {(() => {
                        const m = summarizeMetadata(k.metadata);
                        if (m.empty) {
                          return <span className="text-gray-400">—</span>;
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
                              onClick={() => setMetaViewKey(k)}
                              className="shrink-0 text-xs font-medium text-blue-600 hover:text-blue-800"
                            >
                              Details
                            </button>
                          </div>
                        );
                      })()}
                    </td>
                    <td className="py-2 pr-4 align-top">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={k.status === 'active'}
                        aria-label={k.status === 'active' ? 'Active: click to revoke' : 'Inactive: click to activate'}
                        title={k.status}
                        disabled={keyStatusTogglingId === k.id}
                        onClick={() => toggleKeyStatus(k)}
                        className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed ${
                          k.status === 'active' ? 'bg-blue-600' : 'bg-gray-200'
                        }`}
                      >
                        <span
                          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ${
                            k.status === 'active' ? 'translate-x-5' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </td>
                    <td className="py-2 pl-4 text-right whitespace-nowrap align-top">
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
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Recent request logs</h2>
          <Link
            href={`/gateway/request-logs?user_email=${encodeURIComponent(user.email)}`}
            className="text-sm text-blue-600 hover:underline"
          >
            More →
          </Link>
        </div>
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
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">User audit logs</h2>
          <Link
            href={`/gateway/audit-logs?user_id=${encodeURIComponent(user.id)}`}
            className="text-sm text-blue-600 hover:underline"
          >
            More →
          </Link>
        </div>
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

      {metaViewKey && (() => {
        const m = summarizeMetadata(metaViewKey.metadata);
        return (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] flex flex-col">
              <div className="px-6 py-4 border-b flex justify-between items-center">
                <div className="min-w-0">
                  <h3 className="text-lg font-bold text-gray-900">Key metadata</h3>
                  <p className="mt-0.5 text-xs text-gray-500 font-mono truncate" title={metaViewKey.id}>
                    {[metaViewKey.name, maskKey(metaViewKey.key)].filter(Boolean).join(' · ')} · {metaViewKey.id}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setMetaViewKey(null)}
                  className="text-gray-400 hover:text-gray-600"
                  aria-label="Close"
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
              <div className="px-6 py-3 border-t flex justify-end gap-2">
                {!m.empty && (
                  <button
                    type="button"
                    onClick={() => copy(m.full)}
                    className="px-3 py-1.5 border border-gray-300 rounded-md text-sm text-gray-700 hover:bg-gray-50"
                  >
                    Copy
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setMetaViewKey(null)}
                  className="px-3 py-1.5 border border-gray-300 rounded-md text-sm text-gray-700 hover:bg-gray-50"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        );
      })()}

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
