'use client';

/**
 * API 密钥管理：列表分页（预算只读，来自 users JOIN）、创建（关联 user 或外部身份对）、
 * 编辑 name/metadata、吊销/激活、物理删除。
 */
import { useTranslations } from 'next-intl';
import { useState, useEffect, useCallback, type ReactNode } from 'react';
import Link from 'next/link';
import {
  ClipboardDocumentIcon,
  ClipboardDocumentListIcon,
  DocumentTextIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { readApiJson } from '@/lib/api-json';
import { formatGatewayDateTime } from '@/lib/datetime';
import { formatGatewayMoneyCode } from '@/lib/format-gateway-currency';
import { NewApiKeySecretBanner } from '@/lib/new-api-key-secret-banner';
import { useFeedback } from '@/components/feedback';
import { normalizeMetadataClient } from '@/lib/normalize-metadata-client';
import { summarizeMetadata } from '@/lib/summarize-metadata';
import { useBillingCurrency } from '@/lib/use-billing-currency';
import { useGatewayDateTime } from '@/lib/use-gateway-datetime';
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

function formatKeyTimestamp(iso: string | null | undefined, timeZone: string): string {
  if (iso == null || iso === '') {
    return '—';
  }
  return formatGatewayDateTime(iso, timeZone);
}

function formatBudgetPeriodResetLabel(
  period: string | null | undefined,
  resetAt: string | null | undefined,
  timeZone: string
): string {
  const periodLabel = period && period !== 'none' ? period : 'none';
  const resetLabel =
    resetAt == null || resetAt === '' ? '—' : formatGatewayDateTime(resetAt, timeZone);
  return `${periodLabel} / ${resetLabel}`;
}

/** 首列状态色块（实心）；悬停色块见完整 status 文案 */
function keyStatusSwatchClass(status: string) {
  if (status === 'active') return 'bg-emerald-500';
  if (status === 'revoked') return 'bg-gray-400';
  return 'bg-gray-300';
}

function budgetUsageRatio(spent: number, max: number | null | undefined): number | null {
  if (max == null || max <= 0) return null;
  return Math.min(1, Math.max(0, spent / max));
}

function budgetBarClass(ratio: number): string {
  if (ratio >= 1) return 'bg-red-500';
  if (ratio >= 0.8) return 'bg-amber-500';
  return 'bg-blue-500';
}

function displayMetadataSummary(summary: string): string {
  const plan = /^plan_id:\s*(.+)$/.exec(summary);
  return plan ? plan[1] : summary;
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
  const t = useTranslations('keysPage');
  const tCommon = useTranslations('common');
  const tOptions = useTranslations('options');
  const { notify, confirm } = useFeedback();
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
  const { businessTimezone, formatDate, formatTime } = useGatewayDateTime();

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

  const hasFilters = Boolean(filterEmail.trim() || filterUserId.trim());

  const clearFilters = () => {
    setFilterEmail('');
    setFilterUserId('');
    setPage(1);
  };

  const SortableTh = ({ label, columnKey }: { label: string; columnKey: ApiKeyListSortKey }) => (
    <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500 whitespace-nowrap">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          toggleSort(columnKey);
        }}
        className={`inline-flex items-center gap-0.5 rounded px-0.5 hover:text-gray-800 ${
          sortKey === columnKey ? 'text-gray-800' : 'text-gray-500'
        }`}
        aria-label={`Sort by ${label}`}
      >
        {label}
        <span className={`text-[10px] leading-none ${sortKey === columnKey ? 'text-blue-600' : 'text-gray-300'}`}>
          {sortKey === columnKey ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
        </span>
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
        notify('error', data.message || tCommon('updateFailed'));
      }
    } catch (error) {
      console.error('Status toggle error:', error);
      notify('error', tCommon('updateFailed'));
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
        setSaveError(data.message || tCommon('updateFailed'));
      }
    } catch (error) {
      console.error('Edit error:', error);
      setSaveError(tCommon('updateFailed'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleEditDelete = async () => {
    if (!selectedKey) return;
    const ok = await confirm({
      title: t('deleteKey'),
      message: t('confirmDelete'),
      confirmLabel: tCommon('delete'),
      danger: true,
    });
    if (!ok) {
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
  const showSkeleton = isLoading && keys.length === 0;
  const inputClass =
    'w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500';

  return (
    <div className="p-8">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900">{t('title')}</h1>
          <p className="mt-1 max-w-2xl text-sm text-gray-500">{t('subtitle')}</p>
        </div>
        <button
          type="button"
          onClick={handleCreate}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          <PlusIcon className="h-4 w-4" />
          {t('newKey')}
        </button>
      </div>

      {freshCreatedKey && (
        <div className="mb-6 max-w-3xl">
          <NewApiKeySecretBanner secret={freshCreatedKey} onDismiss={() => setFreshCreatedKey(null)} />
        </div>
      )}

      <div className="mb-4 rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
          <div className="grid min-w-0 flex-1 grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="min-w-0">
              <label className="mb-1 block text-xs font-medium text-gray-500">{tCommon('email')}</label>
              <div className="relative">
                <MagnifyingGlassIcon
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
                  aria-hidden
                />
                <input
                  type="search"
                  value={filterEmail}
                  onChange={(e) => { setFilterEmail(e.target.value); setPage(1); }}
                  placeholder={t('filters.emailPlaceholder')}
                  className={`${inputClass} pl-9`}
                  autoComplete="off"
                />
              </div>
            </div>
            <div className="min-w-0">
              <label className="mb-1 block text-xs font-medium text-gray-500">{t('fields.userId')}</label>
              <input
                type="text"
                value={filterUserId}
                onChange={(e) => { setFilterUserId(e.target.value); setPage(1); }}
                placeholder={t('filters.userIdPlaceholder')}
                className={`${inputClass} font-mono text-xs`}
                autoComplete="off"
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3 pb-0.5 text-xs text-gray-500">
            {hasFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-800"
              >
                <XMarkIcon className="h-3.5 w-3.5" aria-hidden />
                {tCommon('clearFilters')}
              </button>
            )}
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" aria-hidden />
              {tOptions('keyStatus.active')}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full bg-gray-400" aria-hidden />
              {tOptions('keyStatus.revoked')}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full bg-gray-300" aria-hidden />
              {t('statusOther')}
            </span>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className={`overflow-x-auto ${isLoading ? 'opacity-70' : ''}`}>
        <table className="w-full min-w-[68rem] table-fixed">
          <colgroup>
            <col className="w-[22%]" />
            <col className="w-[16%]" />
            <col className="w-[10%]" />
            <col className="w-[16%]" />
            <col className="w-[12%]" />
            <col className="w-[12%]" />
            <col className="w-[12%]" />
          </colgroup>
          <thead className="border-b border-gray-200 bg-gray-50/80">
            <tr>
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500 whitespace-nowrap">{t('table.user')}</th>
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500 whitespace-nowrap">{t('table.key')}</th>
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500 whitespace-nowrap">{t('table.name')}</th>
              <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider text-gray-500 whitespace-nowrap">{t('table.userBudget')}</th>
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500 whitespace-nowrap">{t('table.apiKeyMetadata')}</th>
              <SortableTh label={t('table.created')} columnKey="created_at" />
              <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider text-gray-500 whitespace-nowrap">{t('table.links')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {showSkeleton &&
              Array.from({ length: 8 }).map((_, index) => (
                <tr key={`skeleton-${index}`} className="animate-pulse">
                  <td className="px-4 py-4"><div className="h-4 w-40 rounded bg-gray-100" /></td>
                  <td className="px-4 py-4"><div className="h-4 w-28 rounded bg-gray-100" /></td>
                  <td className="px-4 py-4"><div className="h-4 w-16 rounded bg-gray-100" /></td>
                  <td className="px-4 py-4"><div className="ml-auto h-4 w-24 rounded bg-gray-100" /></td>
                  <td className="px-4 py-4"><div className="h-4 w-20 rounded bg-gray-100" /></td>
                  <td className="px-4 py-4"><div className="h-4 w-20 rounded bg-gray-100" /></td>
                  <td className="px-4 py-4"><div className="ml-auto h-4 w-16 rounded bg-gray-100" /></td>
                </tr>
              ))}
            {keys.map((key) => {
              const meta = summarizeMetadata(key.metadata);
              const revoked = key.status === 'revoked';
              const ratio = budgetUsageRatio(key.budget_spent, key.budget_max);
              const spentLabel = formatGatewayMoneyCode(key.budget_spent, billingCurrency, 2);
              const maxLabel =
                key.budget_max != null
                  ? formatGatewayMoneyCode(key.budget_max, billingCurrency, 2)
                  : tCommon('noLimit');
              const periodActive = Boolean(key.budget_period && key.budget_period !== 'none');
              const userHref = `/gateway/users/${encodeURIComponent(key.user_id)}`;
              const logsHref = `/gateway/request-logs?api_key_id=${encodeURIComponent(key.id)}`;
              const auditHref = `/gateway/audit-logs?api_key_id=${encodeURIComponent(key.id)}`;
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
                className={`cursor-pointer transition-colors hover:bg-blue-50/40 focus:bg-blue-50/60 focus:outline-none ${
                  revoked ? 'bg-gray-50/60' : ''
                }`}
              >
                <td className="px-4 py-3.5 overflow-hidden">
                  <div className="flex min-w-0 items-start gap-2.5">
                    <span
                      className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${keyStatusSwatchClass(key.status)}`}
                      title={key.status}
                      role="img"
                      aria-label={`Status: ${key.status}`}
                    />
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-2">
                        <Link
                          href={userHref}
                          onClick={(event) => event.stopPropagation()}
                          className={`truncate text-sm font-medium hover:underline ${
                            revoked ? 'text-gray-500' : 'text-blue-700'
                          }`}
                          title={t('links.openUserTitle')}
                        >
                          {key.user_email || tCommon('noData')}
                        </Link>
                        {revoked && (
                          <span className="inline-flex shrink-0 items-center rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-600 ring-1 ring-inset ring-gray-200">
                            {tOptions('keyStatus.revoked')}
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 truncate font-mono text-[11px] text-gray-400" title={key.user_id}>
                        {key.user_id}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3.5 overflow-hidden">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="min-w-0 truncate font-mono text-sm text-gray-900" title={key.key}>
                      {maskKey(key.key)}
                    </span>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        copyToClipboard(key.key);
                      }}
                      className={`shrink-0 ${copiedKey === key.key ? 'text-emerald-600' : 'text-gray-400 hover:text-gray-600'}`}
                      title={t('copyKey')}
                    >
                      <ClipboardDocumentIcon className="h-4 w-4" />
                    </button>
                  </div>
                </td>
                <td className="px-4 py-3.5 overflow-hidden">
                  {key.name?.trim() ? (
                    <span className="block truncate text-sm text-gray-900" title={key.name}>{key.name}</span>
                  ) : (
                    <span className="text-gray-300">{tCommon('noData')}</span>
                  )}
                </td>
                <td className="px-4 py-3.5 overflow-hidden">
                  <Link
                    href={userHref}
                    onClick={(event) => event.stopPropagation()}
                    className="block w-full text-right"
                    title={t('links.openUserBudgetTitle')}
                  >
                    <div className="truncate text-sm tabular-nums text-gray-900">
                      {spentLabel}
                      <span className="text-gray-400"> / </span>
                      <span className={key.budget_max == null ? 'text-gray-400' : 'text-gray-700'}>{maxLabel}</span>
                    </div>
                    <div className="mt-0.5 truncate text-[11px] tabular-nums text-gray-400">
                      {t('table.wallet')}{' '}
                      {formatGatewayMoneyCode(Number(key.wallet_granted ?? 0) - Number(key.wallet_spent ?? 0), billingCurrency, 2)}
                    </div>
                    {ratio != null ? (
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-gray-100">
                        <div
                          className={`h-full rounded-full ${budgetBarClass(ratio)}`}
                          style={{ width: `${Math.max(ratio * 100, ratio > 0 ? 4 : 0)}%` }}
                        />
                      </div>
                    ) : (
                      <div className="mt-1.5 h-1.5 rounded-full bg-gray-50" />
                    )}
                    {periodActive ? (
                      <div className="mt-1 truncate text-[11px] capitalize text-gray-400">
                        {key.budget_period}
                        {key.budget_reset_at ? ` · ${formatDate(key.budget_reset_at)}` : ''}
                      </div>
                    ) : null}
                  </Link>
                </td>
                <td className="px-4 py-3.5 overflow-hidden">
                  {meta.empty ? (
                    <span className="text-gray-300">{tCommon('noData')}</span>
                  ) : (
                    <span
                      className={`block truncate rounded-md bg-slate-50 px-2 py-1 text-xs font-medium ring-1 ring-inset ${
                        meta.ok ? 'text-slate-700 ring-slate-200' : 'text-red-700 ring-red-200 bg-red-50'
                      }`}
                      title={meta.summary}
                    >
                      {displayMetadataSummary(meta.summary)}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3.5 overflow-hidden whitespace-nowrap">
                  <div className="truncate text-sm text-gray-700">{formatDate(key.created_at)}</div>
                  <div className="truncate text-[11px] tabular-nums text-gray-400">{formatTime(key.created_at)}</div>
                </td>
                <td
                  className="px-4 py-3.5 overflow-hidden text-right"
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => event.stopPropagation()}
                >
                  <div className="inline-flex items-center justify-end gap-1">
                    <Link
                      href={logsHref}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-blue-700"
                      title={t('links.requestLogsTitle')}
                    >
                      <DocumentTextIcon className="h-4 w-4" />
                    </Link>
                    <Link
                      href={auditHref}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-blue-700"
                      title={t('links.auditLogsTitle')}
                    >
                      <ClipboardDocumentListIcon className="h-4 w-4" />
                    </Link>
                  </div>
                </td>
              </tr>
            );
            })}
          </tbody>
        </table>
        </div>
        {!showSkeleton && keys.length === 0 && (
          <div className="px-4 py-16 text-center text-sm text-gray-500">{t('empty')}</div>
        )}
        {!showSkeleton && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 px-4 py-3">
            <div className="text-sm text-gray-500">{t('totalKeys', { count: total })}</div>
            {totalPages > 1 && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPage(Math.max(1, page - 1))}
                  disabled={page === 1}
                  className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 disabled:opacity-40 hover:bg-gray-50"
                >
                  {tCommon('previous')}
                </button>
                <span className="min-w-[7rem] text-center text-sm text-gray-600">
                  {tCommon('pageOf', { page, totalPages })}
                </span>
                <button
                  type="button"
                  onClick={() => setPage(Math.min(totalPages, page + 1))}
                  disabled={page === totalPages}
                  className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 disabled:opacity-40 hover:bg-gray-50"
                >
                  {tCommon('next')}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Create Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b flex justify-between items-center">
              <h2 className="text-xl font-bold text-gray-900">{t('createTitle')}</h2>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600">x</button>
            </div>

            <div className="p-6">
              {saveError && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-red-600 text-sm">{saveError}</div>
              )}

              <fieldset className="mb-5 space-y-2">
                <legend className="text-sm font-medium text-gray-800">{t('create.attachLegend')}</legend>
                <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-6">
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700">
                    <input
                      type="radio"
                      name="keyCreationMode"
                      className="text-blue-600 focus:ring-blue-500"
                      checked={creationMode === 'existingUser'}
                      onChange={() => handleCreationModeChange('existingUser')}
                    />
                    {t('create.existingUser')}
                  </label>
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700">
                    <input
                      type="radio"
                      name="keyCreationMode"
                      className="text-blue-600 focus:ring-blue-500"
                      checked={creationMode === 'externalIdentity'}
                      onChange={() => handleCreationModeChange('externalIdentity')}
                    />
                    {t('create.externalIdentity')}
                  </label>
                </div>
              </fieldset>

              <div className="mb-5 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                <p className="font-medium text-slate-800">{t('create.afterCreation')}</p>
                {creationMode === 'existingUser' ? (
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-600">
                    <li>
                      {t('create.existingHelp1')}{' '}
                      <Link href="/gateway/users" className="text-blue-700 underline">
                        Users
                      </Link>{' '}
                    </li>
                    <li>
                      {t('create.existingHelp2')}{' '}
                      <Link href="/gateway/users" className="text-blue-700 underline">
                        Users
                      </Link>
                    </li>
                    <li>
                      {t('create.secretOnce')}
                    </li>
                    <li>
                      {t('create.metadataHelp')}
                    </li>
                  </ul>
                ) : (
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-600">
                    <li>
                      {t('create.externalHelp1')}
                    </li>
                    <li>
                      {t('create.externalHelp2')}{' '}
                      <Link href="/gateway/users" className="text-blue-700 underline">
                        Users
                      </Link>
                    </li>
                    <li>
                      {t('create.secretOnce')}
                    </li>
                    <li>
                      {t('create.metadataHelp')}
                    </li>
                  </ul>
                )}
              </div>

              <div className="space-y-4">
                {creationMode === 'existingUser' ? (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t('fields.userId')} <span className="ml-1 text-xs font-normal text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={formData.user_id}
                      onChange={(e) => setFormData({ ...formData, user_id: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder={t('placeholders.userId')}
                    />
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          {t('fields.externalSystem')} <span className="ml-1 text-xs font-normal text-red-500">*</span>
                        </label>
                        <input
                          type="text"
                          value={formData.external_system}
                          onChange={(e) => setFormData({ ...formData, external_system: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder={t('placeholders.externalSystem')}
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          {t('fields.externalUserId')} <span className="ml-1 text-xs font-normal text-red-500">*</span>
                        </label>
                        <input
                          type="text"
                          value={formData.external_user_id}
                          onChange={(e) => setFormData({ ...formData, external_user_id: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder={t('placeholders.externalUserId')}
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        {t('fields.userEmail')} <span className="ml-1 text-xs font-normal text-red-500">*</span>
                      </label>
                      <input
                        type="email"
                        value={formData.email}
                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder={t('placeholders.userEmail')}
                      />
                      <p className="mt-1 text-xs text-gray-500">
                        {t('help.userEmail')}
                      </p>
                    </div>
                  </>
                )}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('fields.keyName')} <span className="ml-1 text-xs font-normal text-gray-400">{tCommon('optional')}</span>
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder={t('placeholders.keyName')}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('fields.metadataJson')}</label>
                  <textarea
                    value={formData.metadata}
                    onChange={(e) => setFormData({ ...formData, metadata: e.target.value })}
                    rows={6}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder={t('placeholders.metadataJson')}
                  />
                  <p className="mt-1 text-xs text-gray-500">{t('help.metadata')}</p>
                </div>
              </div>
            </div>

            <div className="px-6 py-4 border-t flex justify-end gap-3">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50" disabled={isSaving}>{tCommon('cancel')}</button>
              <button onClick={handleSave} disabled={isSaving} className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50">{isSaving ? tCommon('creating') : tCommon('create')}</button>
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
                <h2 className="text-xl font-bold text-gray-900">{t('editTitle')}</h2>
                <div className="mt-1 flex items-center gap-2">
                  <span className="font-mono text-xs text-gray-500 break-all">{selectedKey.id}</span>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(selectedKey.id)}
                    className="shrink-0 text-gray-400 hover:text-gray-600"
                    title={t('copyId')}
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
                  <ReadonlyRow label={t('fields.secretKey')}>
                    <div className="flex items-start gap-2">
                      <span className="font-mono text-xs break-all">{selectedKey.key}</span>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(selectedKey.key)}
                        className="shrink-0 text-gray-400 hover:text-gray-600"
                        title={t('copySecret')}
                      >
                        <ClipboardDocumentIcon className="h-4 w-4" />
                      </button>
                    </div>
                  </ReadonlyRow>
                  <ReadonlyRow label={t('fields.status')}>
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
                  <ReadonlyRow label={t('fields.userIdAuth')}>
                    <Link href={`/gateway/users/${encodeURIComponent(selectedKey.user_id)}`} className="font-mono text-xs text-blue-600 hover:underline break-all">
                      {selectedKey.user_id}
                    </Link>
                  </ReadonlyRow>
                  <ReadonlyRow label={t('fields.userEmail')}>
                    <Link href={`/gateway/users/${encodeURIComponent(selectedKey.user_id)}`} className="text-sm text-blue-600 hover:underline break-all">
                      {selectedKey.user_email || selectedKey.user_id}
                    </Link>
                  </ReadonlyRow>
                  <div className="sm:col-span-2 grid gap-4 sm:grid-cols-2">
                    <ReadonlyRow label={t('fields.budgetReadonly')}>
                      <div className="text-sm">
                        {formatGatewayMoneyCode(selectedKey.budget_spent, billingCurrency, 2)} /{' '}
                        {selectedKey.budget_max != null ? formatGatewayMoneyCode(selectedKey.budget_max, billingCurrency, 2) : tCommon('noLimit')}
                        {selectedKey.budget_base != null && (
                          <span className="ml-1 text-xs text-gray-500">
                            (base {formatGatewayMoneyCode(selectedKey.budget_base, billingCurrency, 2)})
                          </span>
                        )}
                      </div>
                    </ReadonlyRow>
                    <ReadonlyRow label={t('fields.walletReadonly')}>
                      <div className="text-sm">
                        {formatGatewayMoneyCode(
                          Number(selectedKey.wallet_granted ?? 0) - Number(selectedKey.wallet_spent ?? 0),
                          billingCurrency,
                          2
                        )}
                      </div>
                    </ReadonlyRow>
                    <ReadonlyRow label={t('fields.budgetPeriodReset')}>
                      {formatBudgetPeriodResetLabel(
                        selectedKey.budget_period,
                        selectedKey.budget_reset_at,
                        businessTimezone
                      )}
                    </ReadonlyRow>
                  </div>
                  <ReadonlyRow label={t('fields.created')}>
                    {formatKeyTimestamp(selectedKey.created_at, businessTimezone)}
                  </ReadonlyRow>
                  <ReadonlyRow label={t('fields.updated')}>
                    {formatKeyTimestamp(selectedKey.updated_at, businessTimezone)}
                  </ReadonlyRow>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                  <a
                    href={`/gateway/request-logs?api_key_id=${selectedKey.id}`}
                    className="font-medium text-blue-600 hover:text-blue-800"
                  >
                    {t('links.requestLogsForKey')}
                  </a>
                  <a
                    href={`/gateway/audit-logs?api_key_id=${selectedKey.id}`}
                    className="font-medium text-blue-600 hover:text-blue-800"
                  >
                    {t('links.auditLogsForKey')}
                  </a>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('fields.name')}</label>
                  <input
                    type="text"
                    value={editFormData.name}
                    onChange={(e) => setEditFormData({ ...editFormData, name: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder={t('placeholders.optionalLabel')}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('fields.metadataJson')}</label>
                  <textarea
                    value={editFormData.metadata}
                    onChange={(e) => setEditFormData({ ...editFormData, metadata: e.target.value })}
                    rows={8}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="{}"
                  />
                  <p className="mt-1 text-xs text-gray-500">{t('help.editMetadata')}</p>
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
                {isDeleting ? tCommon('deleting') : t('deleteKey')}
              </button>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowEditModal(false)}
                  className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
                  disabled={isSaving || isDeleting}
                >
                  {tCommon('cancel')}
                </button>
                <button
                  onClick={handleEditSave}
                  disabled={isSaving || isDeleting}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                >
                  {isSaving ? tCommon('savingDots') : tCommon('save')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
