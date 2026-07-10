'use client';

/**
 * 单个网关用户：预算计划、关联密钥、请求日志与用户审计。
 */
import { useState, useEffect, useCallback, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ClipboardDocumentIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import { readApiJson } from '@/lib/api-json';
import { parseGatewayDateTime } from '@/lib/datetime';
import { formatGatewayMoneyCode, formatGatewayMoneyCodeSigned, getGatewayCurrencySymbol } from '@/lib/format-gateway-currency';
import type { GatewayApiKeyBudgetAuditLog, GatewayRequestLog } from '@/lib/types';
import { GATEWAY_MONEY_DECIMAL_PLACES } from '@/lib/gateway-money';
import { NewApiKeySecretBanner } from '@/lib/new-api-key-secret-banner';
import { normalizeMetadataClient } from '@/lib/normalize-metadata-client';
import { useBillingCurrency } from '@/lib/use-billing-currency';
import { useGatewayDateTime } from '@/lib/use-gateway-datetime';
import { summarizeUserSnapshotDiffLines } from '@/lib/audit-user-snapshot-diff';
import { summarizeMetadata } from '@/lib/summarize-metadata';
import { normalizeRouteGroup, routeGroupBadgeClass } from '@/lib/route-group-ui';

/** 与「Δ spend」「budget_max」列重复，不在「User snapshot Δ」再展示 */
const OMIT_USER_AUDIT_SNAPSHOT_NEIGHBOR_FIELDS = ['budget_spent', 'budget_max'] as const;

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

function shortAuditId(id: string | null | undefined): string {
  if (id == null || id === '') return '—';
  if (id.length < 14) return id;
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
}

const USER_DETAIL_RECENT_LIMIT = 5;

function formatLogProvider(log: GatewayRequestLog): string {
  const pname = log.provider_name?.trim();
  const pid = log.provider_id?.trim();
  return pname || pid || '—';
}

export default function GatewayUserDetailPage() {
  const t = useTranslations('users');
  const tCommon = useTranslations('common');
  const tOptions = useTranslations('options');
  const params = useParams();
  const userIdRaw = typeof params.id === 'string' ? params.id : '';
  const userId = decodeURIComponent(userIdRaw);

  const [user, setUser] = useState<UserDetail | null>(null);
  const [loadError, setLoadError] = useState('');
  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [logs, setLogs] = useState<GatewayRequestLog[]>([]);
  const [audits, setAudits] = useState<GatewayApiKeyBudgetAuditLog[]>([]);
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
  const { formatDateTime } = useGatewayDateTime();
  const billingCurrencySym = getGatewayCurrencySymbol(billingCurrency);

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
      const q = new URLSearchParams({ page: '1', page_size: String(USER_DETAIL_RECENT_LIMIT) });
      const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/logs?${q}`);
      const data = await readApiJson<GatewayRequestLog[]>(res);
      if (data.success) {
        setLogs(data.data ?? []);
      }
    } catch (e) {
      console.error(e);
    }
  }, [userId]);

  const loadAudits = useCallback(async () => {
    if (!userId) return;
    try {
      const q = new URLSearchParams({ page: '1', page_size: String(USER_DETAIL_RECENT_LIMIT) });
      const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/audit-logs?${q}`);
      const data = await readApiJson<GatewayApiKeyBudgetAuditLog[]>(res);
      if (data.success) {
        setAudits(data.data ?? []);
      }
    } catch (e) {
      console.error(e);
    }
  }, [userId]);

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
        setPlanError(data.message || t('errors.updateFailed'));
      }
    } catch (e) {
      console.error(e);
      setPlanError(t('errors.updateFailed'));
    } finally {
      setIsSavingPlan(false);
    }
  };

  const deleteUser = async () => {
    if (!window.confirm(t('confirm.deleteUser'))) return;
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}`, { method: 'DELETE' });
      const data = await readApiJson(res);
      if (data.success) {
        window.location.href = '/gateway/users';
      } else {
        alert(data.message || t('errors.deleteFailed'));
      }
    } catch (e) {
      console.error(e);
      alert(t('errors.deleteFailed'));
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
        setKeyError(data.message || t('errors.createFailed'));
      }
    } catch (e) {
      console.error(e);
      setKeyError(t('errors.createFailed'));
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
        setKeysInlineError(data.message || t('errors.updateFailed'));
      }
    } catch (e) {
      console.error(e);
      setKeysInlineError(t('errors.updateFailed'));
    } finally {
      setKeyStatusTogglingId(null);
    }
  };

  const deleteKeyHard = async (keyId: string) => {
    if (!window.confirm(t('confirm.deleteKey'))) return;
    try {
      const res = await fetch(
        `/api/admin/users/${encodeURIComponent(userId)}/keys/${encodeURIComponent(keyId)}`,
        { method: 'DELETE' }
      );
      const data = await readApiJson(res);
      if (data.success) loadKeys();
      else alert(data.message || tCommon('failed'));
    } catch (e) {
      console.error(e);
      alert(tCommon('failed'));
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
    return <div className="p-8 text-gray-600">{t('invalidUserId')}</div>;
  }

  if (loadError) {
    return (
      <div className="p-8">
        <Link href="/gateway/users" className="text-sm text-blue-600 hover:underline">{t('backUsers')}</Link>
        <p className="mt-4 text-red-600">{loadError}</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="p-8">
        <Link href="/gateway/users" className="text-sm text-blue-600 hover:underline">{t('backUsers')}</Link>
        <div className="mt-8 text-gray-600">{tCommon('loadingEllipsis')}</div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="mb-6">
        <Link href="/gateway/users" className="text-sm text-blue-600 hover:underline">{t('backUsers')}</Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-2">{t('detailTitle')}</h1>
        <p className="text-sm text-gray-500 font-mono mt-1 break-all">{user.id}</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="bg-white rounded-lg shadow-md p-6 space-y-4">
          <h2 className="text-lg font-semibold text-gray-900">{t('userDetail')}</h2>
          {planError && <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">{planError}</div>}
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('fields.email')} <span aria-hidden="true" className="ml-0.5 text-red-500">*</span>
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
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('fields.status')}</label>
                <select
                  value={planForm.status}
                  onChange={(e) => setPlanForm({ ...planForm, status: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                >
                  <option value="active">{tOptions('userStatus.active')}</option>
                  <option value="disabled">{tOptions('userStatus.disabled')}</option>
                </select>
                <p className="mt-1 text-xs text-gray-500">
                  {t('help.disabledUser')}
                </p>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('fields.budgetMax')} <span className="ml-1 text-xs font-normal text-gray-400">{tCommon('optional')}</span>
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={planForm.budget_max}
                  onChange={(e) => setPlanForm({ ...planForm, budget_max: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                  placeholder={tCommon('noLimit')}
                />
                <p className="mt-1 text-xs text-gray-500">
                  {t('help.budgetMax')}
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('fields.budgetBase')} <span className="ml-1 text-xs font-normal text-gray-400">{tCommon('optional')}</span>
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={planForm.budget_base}
                  onChange={(e) => setPlanForm({ ...planForm, budget_base: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                  placeholder={tCommon('optional')}
                />
                <p className="mt-1 text-xs text-gray-500">
                  {t('help.budgetBase')}
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('fields.budgetSpent')}</label>
                <input
                  type="number"
                  step="0.01"
                  value={planForm.budget_spent}
                  onChange={(e) => setPlanForm({ ...planForm, budget_spent: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                />
                <p className="mt-1 text-xs text-gray-500">
                  {t('help.budgetSpent')}
                </p>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('fields.budgetPeriod')} <span className="ml-1 text-xs font-normal text-gray-400">{tCommon('optional')}</span>
                </label>
                <select
                  value={planForm.budget_period}
                  onChange={(e) => setPlanForm({ ...planForm, budget_period: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                >
                  <option value="none">{tOptions('budgetPeriod.none')}</option>
                  <option value="daily">{tOptions('budgetPeriod.daily')}</option>
                  <option value="weekly">{tOptions('budgetPeriod.weekly')}</option>
                  <option value="monthly">{tOptions('budgetPeriod.monthly')}</option>
                </select>
                <p className="mt-1 text-xs text-gray-500">
                  {t('help.budgetPeriod')}
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('fields.budgetResetAt')} <span className="ml-1 text-xs font-normal text-gray-400">{tCommon('optional')}</span>
                </label>
                <input
                  type="datetime-local"
                  step={1}
                  value={planForm.budget_reset_at}
                  onChange={(e) => setPlanForm({ ...planForm, budget_reset_at: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                />
                <p className="mt-1 text-xs text-gray-500">
                  {t('help.budgetResetAt')}
                </p>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('fields.metadataJsonObject')} <span className="ml-1 text-xs font-normal text-gray-400">{tCommon('optional')}</span>
              </label>
              <textarea
                value={planForm.metadata}
                onChange={(e) => setPlanForm({ ...planForm, metadata: e.target.value })}
                rows={6}
                className="w-full px-3 py-2 border border-gray-300 rounded-md font-mono text-xs"
                placeholder="{}"
              />
              <p className="mt-1 text-xs text-gray-500">
                {t('help.metadataReplace')}
              </p>
            </div>
            <div className="pt-4 border-t border-gray-200">
              <h3 className="text-sm font-semibold text-gray-900">
                {t('externalIdentity.title')} <span className="ml-1 text-xs font-normal text-gray-400">{tCommon('optional')}</span>
              </h3>
              <p className="mt-1 text-xs text-gray-500">
                {t('externalIdentity.hint')}
              </p>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('fields.externalSystem')} <span className="ml-1 text-xs font-normal text-gray-400">{tCommon('optional')}</span>
                  </label>
                  <input
                    type="text"
                    value={planForm.external_system}
                    onChange={(e) => setPlanForm({ ...planForm, external_system: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                    placeholder="my-app"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('fields.externalUserId')} <span className="ml-1 text-xs font-normal text-gray-400">{tCommon('optional')}</span>
                  </label>
                  <input
                    type="text"
                    value={planForm.external_user_id}
                    onChange={(e) => setPlanForm({ ...planForm, external_user_id: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                    placeholder={t('fields.externalUserId')}
                  />
                </div>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <ReadonlyRow label={t('table.created')}>{formatDateTime(user.created_at)}</ReadonlyRow>
              <ReadonlyRow label={t('table.updated')}>{formatDateTime(user.updated_at)}</ReadonlyRow>
            </div>
            <div className="flex items-center justify-between gap-3 pt-2">
              <button
                type="button"
                onClick={deleteUser}
                className="px-4 py-2 border border-red-300 text-red-700 rounded-md text-sm hover:bg-red-50"
              >
                {t('deleteUser')}
              </button>
              <button
                type="button"
                onClick={savePlan}
                disabled={isSavingPlan}
                className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700 disabled:opacity-50"
              >
                {isSavingPlan ? tCommon('saving') : t('saveUser')}
              </button>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold text-gray-900">{t('apiKeys')}</h2>
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
              {t('newKey')}
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
                  <th className="py-2 pr-4 text-left">{tCommon('key')}</th>
                  <th className="py-2 pr-4 text-left">{tCommon('name')}</th>
                  <th className="py-2 pr-4 text-left">{tCommon('metadata')}</th>
                  <th className="py-2 pr-4 text-left">{tCommon('status')}</th>
                  <th className="py-2 pl-4 text-right whitespace-nowrap w-px">{tCommon('actions')}</th>
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
                              {t('keysTable.details')}
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
                        aria-label={k.status === 'active' ? t('keysTable.activeClickToRevoke') : t('keysTable.inactiveClickToActivate')}
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
                        {tCommon('delete')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {keys.length === 0 && <p className="text-sm text-gray-500 py-4">{t('keysTable.noKeys')}</p>}
          </div>
        </div>
      </div>

      <div className="mt-6 bg-white rounded-lg shadow-md p-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">{t('detailSections.recentRequestLogs')}</h2>
          <Link
            href={`/gateway/request-logs?user_email=${encodeURIComponent(user.email)}`}
            className="text-sm text-blue-600 hover:underline"
          >
            {tCommon('more')}
          </Link>
        </div>
        <div className="overflow-x-auto text-sm">
          <table className="min-w-full">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b">
                <th className="py-2 pr-2">{tCommon('time')}</th>
                <th className="py-2 pr-2">{tCommon('model')}</th>
                <th className="py-2 pr-2">{t('table.group')}</th>
                <th className="py-2 pr-2">{tCommon('provider')}</th>
                <th className="py-2 pr-2">{tCommon('status')}</th>
                <th className="py-2 pr-2 whitespace-nowrap">Standard ({billingCurrencySym})</th>
                <th className="py-2 pr-2 whitespace-nowrap">Charged ({billingCurrencySym})</th>
                <th className="py-2 pr-2 whitespace-nowrap">Metered ({billingCurrencySym})</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => {
                const routeGroup = normalizeRouteGroup(log.route_group);
                return (
                <tr key={log.id} className="border-b border-gray-50">
                  <td className="py-2 pr-2 whitespace-nowrap">{formatDateTime(log.created_at)}</td>
                  <td className="py-2 pr-2 font-mono text-xs max-w-[10rem] truncate" title={log.model_name || log.model_id || undefined}>
                    {log.model_name || log.model_id || '—'}
                  </td>
                  <td className="py-2 pr-2">
                    <span
                      className={`inline-flex items-center rounded-md px-2 py-0.5 font-mono text-[11px] font-semibold leading-4 ${routeGroupBadgeClass(routeGroup)}`}
                      title={`route_group: ${routeGroup}`}
                    >
                      @{routeGroup}
                    </span>
                  </td>
                  <td className="py-2 pr-2 text-xs max-w-[10rem] truncate" title={formatLogProvider(log)}>
                    {formatLogProvider(log)}
                  </td>
                  <td className="py-2 pr-2">{log.status}</td>
                  <td className="py-2 pr-2 tabular-nums whitespace-nowrap">
                    {formatGatewayMoneyCode(Number(log.standard_cost ?? 0), billingCurrency, 4)}
                  </td>
                  <td className="py-2 pr-2 tabular-nums whitespace-nowrap">
                    {formatGatewayMoneyCode(Number(log.charged_cost ?? 0), billingCurrency, 4)}
                  </td>
                  <td className="py-2 pr-2 tabular-nums whitespace-nowrap">
                    {formatGatewayMoneyCode(Number(log.metered_cost ?? 0), billingCurrency, 4)}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
          {logs.length === 0 && <p className="text-sm text-gray-500 py-4">{t('empty.requestLogs')}</p>}
        </div>
      </div>

      <div className="mt-6 bg-white rounded-lg shadow-md p-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">{t('detailSections.userAuditLogs')}</h2>
          <Link
            href={`/gateway/audit-logs?user_id=${encodeURIComponent(user.id)}`}
            className="text-sm text-blue-600 hover:underline"
          >
            {tCommon('more')}
          </Link>
        </div>
        <div className="overflow-x-auto text-xs">
          <table className="min-w-full">
            <thead>
              <tr className="text-left text-gray-500 border-b">
                <th className="py-2 pr-2">{tCommon('time')}</th>
                <th className="py-2 pr-2">{t('table.event')}</th>
                <th className="py-2 pr-2">{t('table.sourceTrace')}</th>
                <th className="py-2 pr-2">{t('table.deltaSpend')}</th>
                <th className="py-2 pr-2">{t('table.budgetMaxChange')}</th>
                <th className="py-2 pr-2 min-w-[12rem]">{t('table.userSnapshotDelta')}</th>
              </tr>
            </thead>
            <tbody>
              {audits.map((a) => {
                const snapLines = summarizeUserSnapshotDiffLines({
                  before_user_snapshot: a.before_user_snapshot ?? null,
                  after_user_snapshot: a.after_user_snapshot ?? null,
                  changed_fields: a.changed_fields ?? null,
                  omitSnapshotFields: OMIT_USER_AUDIT_SNAPSHOT_NEIGHBOR_FIELDS,
                });
                return (
                <tr key={a.id} className="border-b border-gray-50 align-top">
                  <td className="py-2 pr-2 whitespace-nowrap">{formatDateTime(a.created_at)}</td>
                  <td className="py-2 pr-2">
                    <div className="font-medium">{a.event_type}</div>
                    <div className="text-gray-500 mt-0.5">{a.actor_type}</div>
                    {(a.reason_code || a.reason_text) ? (
                      <div className="text-gray-600 mt-0.5 max-w-[14rem] line-clamp-2" title={a.reason_text ?? a.reason_code ?? ''}>
                        {a.reason_text || a.reason_code}
                      </div>
                    ) : null}
                  </td>
                  <td className="py-2 pr-2 font-mono text-[11px] text-gray-700">
                    {a.source ? <div className="text-violet-800">{a.source}</div> : <span className="text-gray-400">—</span>}
                    {a.correlation_id ? (
                      <div className="mt-0.5 text-gray-500" title={a.correlation_id}>corr {shortAuditId(a.correlation_id)}</div>
                    ) : a.request_log_id ? (
                      <div className="mt-0.5 text-gray-500" title={a.request_log_id}>req {shortAuditId(a.request_log_id)}</div>
                    ) : null}
                  </td>
                  <td className="py-2 pr-2">{formatGatewayMoneyCodeSigned(a.delta_spent, billingCurrency, GATEWAY_MONEY_DECIMAL_PLACES)}</td>
                  <td className="py-2 pr-2 font-mono">
                    {a.before_budget_max != null ? formatGatewayMoneyCode(a.before_budget_max, billingCurrency, 2) : '—'}
                    {' → '}
                    {a.after_budget_max != null ? formatGatewayMoneyCode(a.after_budget_max, billingCurrency, 2) : '—'}
                  </td>
                  <td className="py-2 pr-2 text-gray-600">
                    <div className="space-y-0.5">
                      {snapLines.length === 0 ? (
                        <span className="text-gray-400">—</span>
                      ) : (
                        <>
                          {snapLines.slice(0, 5).map((line, i) => (
                            <div key={`${a.id}-s-${i}`} className="line-clamp-2 font-mono text-[11px]" title={line}>
                              {line}
                            </div>
                          ))}
                          {snapLines.length > 5 ? (
                            <div className="text-gray-400 text-[11px]">{t('detailSections.moreCount', { count: snapLines.length - 5 })}</div>
                          ) : null}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
          {audits.length === 0 && <p className="text-sm text-gray-500 py-4">{t('empty.auditLogs')}</p>}
        </div>
      </div>

      {metaViewKey && (() => {
        const m = summarizeMetadata(metaViewKey.metadata);
        return (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] flex flex-col">
              <div className="px-6 py-4 border-b flex justify-between items-center">
                <div className="min-w-0">
                  <h3 className="text-lg font-bold text-gray-900">{t('detailSections.keyMetadata')}</h3>
                  <p className="mt-0.5 text-xs text-gray-500 font-mono truncate" title={metaViewKey.id}>
                    {[metaViewKey.name, maskKey(metaViewKey.key)].filter(Boolean).join(' · ')} · {metaViewKey.id}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setMetaViewKey(null)}
                  className="text-gray-400 hover:text-gray-600"
                  aria-label={tCommon('close')}
                >
                  ×
                </button>
              </div>
              <div className="p-6 overflow-y-auto">
                {m.empty ? (
                  <div className="text-sm text-gray-500">{t('metadata.none')}</div>
                ) : (
                  <>
                    {!m.ok && (
                      <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                        {t('metadata.invalidRaw')}
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
                    {tCommon('copy')}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setMetaViewKey(null)}
                  className="px-3 py-1.5 border border-gray-300 rounded-md text-sm text-gray-700 hover:bg-gray-50"
                >
                  {tCommon('close')}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {showNewKey && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-bold text-gray-900 mb-3">{t('detailSections.newApiKey')}</h3>
            {keyError && <div className="mb-3 p-2 bg-red-50 text-red-700 text-sm rounded">{keyError}</div>}
            <div className="space-y-3">
              <div>
                <label className="block text-sm text-gray-700 mb-1">{t('fields.name')}</label>
                <input value={newKeyName} onChange={(e) => setNewKeyName(e.target.value)} className="w-full border rounded px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm text-gray-700 mb-1">{t('fields.metadataJson')}</label>
                <textarea value={newKeyMeta} onChange={(e) => setNewKeyMeta(e.target.value)} rows={4} className="w-full border rounded px-3 py-2 font-mono text-xs" />
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setShowNewKey(false)} className="px-3 py-2 border rounded text-sm" disabled={isKeySaving}>{tCommon('cancel')}</button>
              <button type="button" onClick={createKey} disabled={isKeySaving} className="px-3 py-2 bg-blue-600 text-white rounded text-sm disabled:opacity-50">{isKeySaving ? '…' : tCommon('create')}</button>
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
