'use client';

import { AdminPageTitle } from '@/components/admin-page-title';

/**
 * API 密钥管理：列表分页（预算只读，来自 users JOIN）、创建（关联 user 或外部身份对）、
 * 编辑 name/metadata、吊销/激活、物理删除。
 */
import { useTranslations } from 'next-intl';
import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import Link from 'next/link';
import {
  AdjustmentsHorizontalIcon,
  ArrowsUpDownIcon,
  ArrowUpRightIcon,
  CodeBracketIcon,
  EyeIcon,
  EyeSlashIcon,
  KeyIcon,
  SignalIcon,
  UserCircleIcon,
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
import { AdminInspector } from '@/components/admin-inspector';
import { useAdminDialog } from '@/components/use-admin-dialog';
import { buildKeyCreatePayload, buildKeyEditPayload, type KeyCreationMode } from './key-form';
import { KeyUserPicker } from './key-user-picker';
import { summarizeMetadata } from '@/lib/summarize-metadata';
import { useBillingCurrency } from '@/lib/use-billing-currency';
import { useGatewayDateTime } from '@/lib/use-gateway-datetime';
import type { GatewayApiKey } from '@/lib/types';

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
  return 'bg-gray-700';
}

function displayMetadataSummary(summary: string): string {
  const plan = /^plan_id:\s*(.+)$/.exec(summary);
  return plan ? plan[1] : summary;
}

function keyRpm(key: { rate_limit?: { rpm?: number } | null }): number | null {
  return key.rate_limit?.rpm ?? null;
}

function ReadonlyRow({ label, children }: { label: string; children: ReactNode }) {
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
  const statusLabel = (status: string) =>
    status === 'active'
      ? tOptions('keyStatus.active')
      : status === 'revoked'
      ? tOptions('keyStatus.revoked')
      : t('statusOther');
  const { notify, confirm } = useFeedback();
  const [keys, setKeys] = useState<GatewayApiKey[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const [filterEmail, setFilterEmail] = useState('');
  const [filterUserId, setFilterUserId] = useState('');
  const sortKey: ApiKeyListSortKey = 'created_at';
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
    rateLimitRpm: '',
  });
  const [saveError, setSaveError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [statusTogglingId, setStatusTogglingId] = useState<string | null>(null);
  const [listError, setListError] = useState('');
  const [revealSecret, setRevealSecret] = useState(false);
  const [metadataExpanded, setMetadataExpanded] = useState(false);
  const requestSequence = useRef(0);
  const editRpmRef = useRef<HTMLInputElement>(null);
  const createRef = useAdminDialog(showModal, isSaving, () => setShowModal(false));
  const editRef = useAdminDialog(
    showEditModal,
    isSaving || isDeleting || statusTogglingId != null,
    () => setShowEditModal(false)
  );
  const { currency: billingCurrency } = useBillingCurrency();
  const { businessTimezone, formatDate, formatTime } = useGatewayDateTime();

  useEffect(() => {
    if (saveError) {
      (showModal ? createRef : editRef).current
        ?.querySelector('[role="alert"]')
        ?.scrollIntoView({ block: 'nearest' });
    }
  }, [saveError, showModal, createRef, editRef]);

  const fetchKeys = useCallback(async () => {
    const sequence = ++requestSequence.current;
    try {
      setListError('');
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
      if (sequence !== requestSequence.current) return;
      if (data.success && data.data) {
        setKeys(data.data);
        setTotal(data.total || 0);
      } else {
        setListError(data.message || t('ui.loadFailed'));
      }
    } catch (error) {
      if (sequence !== requestSequence.current) return;
      setListError(error instanceof Error ? error.message : t('ui.loadFailed'));
    } finally {
      if (sequence === requestSequence.current) setIsLoading(false);
    }
  }, [page, filterEmail, filterUserId, sortKey, sortDir, t]);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  const hasFilters = Boolean(filterEmail.trim() || filterUserId.trim());

  const clearFilters = () => {
    setFilterEmail('');
    setFilterUserId('');
    setPage(1);
  };

  const handleCreationModeChange = (mode: KeyCreationMode) => {
    setCreationMode(mode);
    setSaveError('');
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
        setSelectedKey((prev) => (prev?.id === key.id ? { ...prev, status: nextStatus } : prev));
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

  const handleEdit = (key: GatewayApiKey, expandMetadata = false) => {
    setMetadataExpanded(expandMetadata);
    setSelectedKey(key);
    setRevealSecret(false);
    setEditFormData({
      id: key.id,
      name: key.name ?? '',
      metadata: formatApiKeyMetadataForEditor(key.metadata),
      rateLimitRpm: keyRpm(key) == null ? '' : String(keyRpm(key)),
    });
    setShowEditModal(true);
    setSaveError('');
  };

  const handleEditSave = async () => {
    if (!selectedKey) return;
    setSaveError('');
    setIsSaving(true);

    try {
      let payload;
      try {
        if (editRpmRef.current?.validity.badInput) throw new Error('rpm');
        payload = buildKeyEditPayload(editFormData);
      } catch (error) {
        const code = error instanceof Error ? error.message : 'metadata';
        setSaveError(t(`errors.${code}`));
        return;
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
        setSaveError(data.message || t('ui.deleteFailed'));
      }
    } catch (error) {
      console.error('Delete key error:', error);
      setSaveError(t('ui.deleteFailed'));
    } finally {
      setIsDeleting(false);
    }
  };

  const handleSave = async () => {
    setSaveError('');
    setIsSaving(true);

    try {
      let payload;
      try {
        payload = buildKeyCreatePayload(creationMode, formData);
      } catch (error) {
        const code = error instanceof Error ? error.message : 'metadata';
        setSaveError(t(`errors.${code}`));
        return;
      }

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
        setSaveError(data.message || tCommon('saveFailed'));
      }
    } catch (error) {
      console.error('Save error:', error);
      setSaveError(tCommon('saveFailed'));
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
    'w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-500';

  return (
    <div className="min-w-0 p-4 sm:p-6 lg:p-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <AdminPageTitle>{t('title')}</AdminPageTitle>
          <p className="mt-1 max-w-2xl text-sm text-gray-500">{t('subtitle')}</p>
        </div>
        <button
          type="button"
          onClick={handleCreate}
          className="inline-flex items-center gap-2 h-9 rounded-lg admin-primary px-3 py-2 text-xs font-medium text-white hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2"
        >
          <PlusIcon className="h-4 w-4" />
          {t('newKey')}
        </button>
      </div>

      {freshCreatedKey && (
        <div className="mb-6 max-w-3xl">
          <NewApiKeySecretBanner
            secret={freshCreatedKey}
            onDismiss={() => setFreshCreatedKey(null)}
          />
        </div>
      )}

      <section aria-label={t('ui.filters')} className="mb-5 flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-1 basis-64 sm:max-w-sm">
          <MagnifyingGlassIcon
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
            aria-hidden
          />
          <input
            type="search"
            aria-label={tCommon('email')}
            value={filterEmail}
            onChange={(e) => {
              setFilterEmail(e.target.value);
              setPage(1);
            }}
            placeholder={t('filters.emailPlaceholder')}
            className="h-10 w-full rounded-lg border border-gray-200 bg-white pl-9 pr-3 text-sm"
            autoComplete="off"
          />
        </div>
        <AdminInspector
          label={`${t('ui.moreFilters')}${filterUserId.trim() ? ' · 1' : ''}`}
          size="md"
          icon={AdjustmentsHorizontalIcon}
        >
          <label htmlFor="filter-key-user" className="block text-xs font-medium text-gray-500">
            {t('fields.userId')}
          </label>
          <input
            id="filter-key-user"
            value={filterUserId}
            onChange={(e) => {
              setFilterUserId(e.target.value);
              setPage(1);
            }}
            placeholder={t('filters.userIdPlaceholder')}
            className={`${inputClass} font-mono text-xs`}
          />
        </AdminInspector>
        {hasFilters && (
          <button
            type="button"
            onClick={clearFilters}
            className="text-xs text-gray-500 hover:text-gray-900"
          >
            {tCommon('clearFilters')}
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
            setPage(1);
          }}
          className="ml-auto inline-flex h-9 items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 text-xs text-gray-600"
          aria-label={t(sortDir === 'desc' ? 'ui.newestFirst' : 'ui.oldestFirst')}
        >
          <ArrowsUpDownIcon className="h-4 w-4" aria-hidden />
          {t(sortDir === 'desc' ? 'ui.newestFirst' : 'ui.oldestFirst')}
        </button>
      </section>
      {listError && (
        <p
          role="alert"
          className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
        >
          {listError}
        </p>
      )}

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <div className={`overflow-x-auto ${isLoading ? 'opacity-70' : ''}`}>
          <table className="admin-data-table w-full min-w-[64rem] table-fixed">
            <colgroup>
              {['23%', '20%', '10%', '18%', '12%', '10%', '7%'].map((width, index) => (
                <col key={index} style={{ width }} />
              ))}
            </colgroup>
            <thead className="border-b border-gray-200 bg-gray-50/80">
              <tr>
                <th className="px-4 py-2.5 text-left text-xs font-medium tracking-normal text-gray-500 whitespace-nowrap">
                  {t('table.key')}
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-medium tracking-normal text-gray-500 whitespace-nowrap">
                  {t('table.user')}
                </th>
                <th
                  className="px-4 py-2.5 text-left text-xs font-medium tracking-normal text-gray-500 whitespace-nowrap"
                  title={t('help.rateLimitRpm')}
                >
                  {t('table.rateLimit')}
                </th>
                <th className="px-4 py-2.5 text-right text-xs font-medium tracking-normal text-gray-500 whitespace-nowrap">
                  {t('table.userBudget')}
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-medium tracking-normal text-gray-500 whitespace-nowrap">
                  {t('table.apiKeyMetadata')}
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">
                  {t('table.created')}
                </th>
                <th className="px-4 py-2.5 text-right text-xs font-medium tracking-normal text-gray-500 whitespace-nowrap">
                  {t('table.links')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {showSkeleton &&
                Array.from({ length: 8 }).map((_, index) => (
                  <tr key={`skeleton-${index}`} className="animate-pulse">
                    <td className="px-4 py-4">
                      <div className="h-4 w-40 rounded bg-gray-100" />
                    </td>
                    <td className="px-4 py-4">
                      <div className="h-8 w-36 rounded bg-gray-100" />
                    </td>
                    <td className="px-4 py-4">
                      <div className="h-4 w-16 rounded bg-gray-100" />
                    </td>
                    <td className="px-4 py-4">
                      <div className="ml-auto h-4 w-24 rounded bg-gray-100" />
                    </td>
                    <td className="px-4 py-4">
                      <div className="h-4 w-20 rounded bg-gray-100" />
                    </td>
                    <td className="px-4 py-4">
                      <div className="h-4 w-20 rounded bg-gray-100" />
                    </td>
                    <td className="px-4 py-4">
                      <div className="ml-auto h-4 w-16 rounded bg-gray-100" />
                    </td>
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
                      if (
                        event.target === event.currentTarget &&
                        (event.key === 'Enter' || event.key === ' ')
                      ) {
                        event.preventDefault();
                        handleEdit(key);
                      }
                    }}
                    tabIndex={0}
                    className={`cursor-pointer transition-colors hover:bg-gray-50/40 focus:bg-gray-50/60 focus:outline-none ${
                      revoked ? 'bg-gray-50/60' : ''
                    }`}
                  >
                    <td className="px-4 py-3.5 overflow-hidden">
                      <div className="flex min-w-0 items-start gap-2.5">
                        <span
                          className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${keyStatusSwatchClass(
                            key.status
                          )}`}
                          title={key.status}
                          role="img"
                          aria-label={statusLabel(key.status)}
                        />
                        <div className="min-w-0 flex-1">
                          {key.name?.trim() ? (
                            <span
                              className={`block truncate text-sm font-medium ${
                                revoked ? 'text-gray-500' : 'text-gray-900'
                              }`}
                              title={key.name}
                            >
                              {key.name}
                            </span>
                          ) : (
                            <span className="text-sm text-gray-500">{t('ui.unnamedKey')}</span>
                          )}
                          {revoked && (
                            <span className="inline-flex shrink-0 items-center rounded-full bg-gray-100 px-1.5 py-0.5 text-xs font-medium normal-case tracking-normal text-gray-600 ring-1 ring-inset ring-gray-200">
                              {tOptions('keyStatus.revoked')}
                            </span>
                          )}
                          <div className="mt-0.5 flex min-w-0 items-center gap-1">
                            <span className="min-w-0 truncate font-mono text-xs text-gray-400">
                              {maskKey(key.key)}
                            </span>
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                copyToClipboard(key.key);
                              }}
                              className={`shrink-0 rounded p-0.5 ${
                                copiedKey === key.key
                                  ? 'text-emerald-600'
                                  : 'text-gray-300 hover:bg-gray-100 hover:text-gray-600'
                              }`}
                              title={t('copyKey')}
                              aria-label={t('copyKey')}
                            >
                              <ClipboardDocumentIcon className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3.5 overflow-hidden">
                      <div className="flex min-w-0 items-start gap-2.5">
                        <div className="min-w-0">
                          <div className="flex min-w-0 items-center gap-2">
                            <Link
                              href={userHref}
                              onClick={(event) => event.stopPropagation()}
                              className={`truncate text-sm font-medium hover:underline ${
                                revoked ? 'text-gray-500' : 'text-gray-800'
                              }`}
                              title={t('links.openUserTitle')}
                            >
                              {key.user_email || tCommon('noData')}
                            </Link>
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3.5 overflow-hidden" title={t('help.rateLimitRpm')}>
                      {(() => {
                        const rpm = keyRpm(key);
                        return rpm == null ? (
                          <span className="text-sm text-gray-400">{tCommon('noLimit')}</span>
                        ) : (
                          <span
                            className={`text-sm tabular-nums ${
                              rpm === 0 ? 'text-amber-700' : 'text-gray-900'
                            }`}
                          >
                            {t('table.rateLimitRpmValue', { rpm })}
                          </span>
                        );
                      })()}
                    </td>
                    <td className="px-4 py-3.5 overflow-hidden">
                      <Link
                        href={`${userHref}?section=billing`}
                        onClick={(event) => event.stopPropagation()}
                        className="block w-full text-right"
                        title={t('links.openUserBudgetTitle')}
                      >
                        <div className="truncate text-sm tabular-nums text-gray-900">
                          {spentLabel}
                          <span className="text-gray-400"> / </span>
                          <span
                            className={key.budget_max == null ? 'text-gray-400' : 'text-gray-700'}
                          >
                            {maxLabel}
                          </span>
                        </div>
                        <div className="mt-0.5 truncate text-xs tabular-nums text-gray-400">
                          {t('table.wallet')}{' '}
                          {formatGatewayMoneyCode(
                            Number(key.wallet_granted ?? 0) - Number(key.wallet_spent ?? 0),
                            billingCurrency,
                            2
                          )}
                        </div>
                        {ratio != null ? (
                          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-gray-100">
                            <div
                              className={`h-full rounded-full ${budgetBarClass(ratio)}`}
                              style={{ width: `${Math.max(ratio * 100, ratio > 0 ? 4 : 0)}%` }}
                            />
                          </div>
                        ) : null}
                        {periodActive ? (
                          <div className="mt-1 truncate text-xs capitalize text-gray-400">
                            {tOptions(`budgetPeriod.${key.budget_period}`)}
                            {key.budget_reset_at ? ` · ${formatDate(key.budget_reset_at)}` : ''}
                          </div>
                        ) : null}
                      </Link>
                    </td>
                    <td className="px-4 py-3.5 overflow-hidden">
                      {meta.empty ? (
                        <span className="text-gray-300">{tCommon('noData')}</span>
                      ) : (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            handleEdit(key, true);
                          }}
                          aria-label={t('ui.editMetadata')}
                          className={`flex w-full items-center gap-1.5 rounded-md bg-gray-50 px-2 py-1 text-xs font-medium ring-1 ring-inset ${
                            meta.ok
                              ? 'text-gray-600 ring-gray-200'
                              : 'text-red-700 ring-red-200 bg-red-50'
                          }`}
                          title={meta.summary}
                        >
                          <CodeBracketIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                          <span className="truncate">{displayMetadataSummary(meta.summary)}</span>
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-3.5 overflow-hidden whitespace-nowrap">
                      <div className="truncate text-sm text-gray-700">
                        {formatDate(key.created_at)}
                      </div>
                      <div className="truncate text-xs tabular-nums text-gray-400">
                        {formatTime(key.created_at)}
                      </div>
                    </td>
                    <td
                      className="px-4 py-3.5 overflow-hidden text-right"
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => event.stopPropagation()}
                    >
                      <div className="inline-flex items-center justify-end gap-1">
                        <Link
                          href={logsHref}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-800"
                          title={t('links.requestLogsTitle')}
                          aria-label={t('links.requestLogsTitle')}
                        >
                          <DocumentTextIcon className="h-4 w-4" />
                        </Link>
                        <Link
                          href={auditHref}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-800"
                          title={t('links.auditLogsTitle')}
                          aria-label={t('links.auditLogsTitle')}
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

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/40 p-3 sm:p-6">
          <div
            ref={createRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-key-title"
            className="flex max-h-[calc(100dvh-1.5rem)] sm:max-h-[calc(100dvh-3rem)] w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-white outline-none"
          >
            <header className="flex shrink-0 items-center justify-between gap-4 border-b border-gray-100 px-5 py-4">
              <h2
                id="create-key-title"
                className="flex items-center gap-2 text-base font-medium text-gray-950"
              >
                <KeyIcon className="h-5 w-5 text-gray-400" aria-hidden />
                {t('createTitle')}
              </h2>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                disabled={isSaving}
                aria-label={tCommon('close')}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 disabled:opacity-50"
              >
                <XMarkIcon className="h-5 w-5" aria-hidden />
              </button>
            </header>
            <fieldset disabled={isSaving} className="min-h-0 space-y-5 overflow-y-auto p-5">
              {saveError && (
                <p
                  role="alert"
                  className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
                >
                  {saveError}
                </p>
              )}
              <fieldset>
                <legend className="sr-only">{t('create.attachLegend')}</legend>
                <div className="flex flex-wrap gap-1 rounded-lg bg-gray-100 p-1">
                  {(['existingUser', 'externalIdentity'] as const).map((mode) => (
                    <label
                      key={mode}
                      className={`flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-md px-3 py-2 text-center text-xs ${
                        creationMode === mode
                          ? 'bg-white font-medium text-gray-950'
                          : 'text-gray-500'
                      }`}
                    >
                      <input
                        className="sr-only"
                        type="radio"
                        name="keyCreationMode"
                        checked={creationMode === mode}
                        onChange={() => handleCreationModeChange(mode)}
                      />
                      <span>{t(`create.${mode}`)}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              {creationMode === 'existingUser' ? (
                <KeyUserPicker
                  value={formData.user_id}
                  onChange={(user_id) => setFormData((prev) => ({ ...prev, user_id }))}
                />
              ) : (
                <div className="space-y-4">
                  <p className="text-xs leading-5 text-gray-500">{t('ui.externalHint')}</p>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label
                        htmlFor="key-external-system"
                        className="mb-1 block text-sm font-medium text-gray-700"
                      >
                        {t('fields.externalSystem')} <span className="text-red-500">*</span>
                      </label>
                      <input
                        id="key-external-system"
                        value={formData.external_system}
                        onChange={(e) =>
                          setFormData({ ...formData, external_system: e.target.value })
                        }
                        className={inputClass}
                        placeholder={t('placeholders.externalSystem')}
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="key-external-user"
                        className="mb-1 block text-sm font-medium text-gray-700"
                      >
                        {t('fields.externalUserId')} <span className="text-red-500">*</span>
                      </label>
                      <input
                        id="key-external-user"
                        value={formData.external_user_id}
                        onChange={(e) =>
                          setFormData({ ...formData, external_user_id: e.target.value })
                        }
                        className={inputClass}
                        placeholder={t('placeholders.externalUserId')}
                      />
                    </div>
                  </div>
                  <div>
                    <label
                      htmlFor="key-user-email"
                      className="mb-1 block text-sm font-medium text-gray-700"
                    >
                      {t('fields.userEmail')} <span className="text-red-500">*</span>
                    </label>
                    <input
                      id="key-user-email"
                      type="email"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      className={inputClass}
                      placeholder="user@example.com"
                    />
                    <p className="mt-1 text-xs leading-5 text-gray-500">{t('help.userEmail')}</p>
                  </div>
                  <p className="text-xs leading-5 text-amber-700">
                    {t('create.externalHelp2')}{' '}
                    <Link href="/gateway/users" className="underline">
                      {t('table.user')}
                      <ArrowUpRightIcon className="ml-1 inline h-3 w-3" aria-hidden />
                    </Link>
                  </p>
                </div>
              )}
              <div>
                <label
                  htmlFor="create-key-name"
                  className="mb-1 block text-sm font-medium text-gray-700"
                >
                  {t('fields.keyName')}{' '}
                  <span className="text-xs font-normal text-gray-400">{tCommon('optional')}</span>
                </label>
                <input
                  id="create-key-name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className={inputClass}
                  placeholder={t('placeholders.keyName')}
                />
              </div>
              <details className="rounded-lg border border-gray-200 p-3">
                <summary className="cursor-pointer text-sm text-gray-700">
                  <CodeBracketIcon className="mr-1.5 inline h-4 w-4 text-gray-400" aria-hidden />
                  {t('fields.metadataJson')}{' '}
                  <span className="text-xs text-gray-400">{tCommon('optional')}</span>
                </summary>
                <label htmlFor="create-key-metadata" className="sr-only">
                  {t('fields.metadataJson')}
                </label>
                <textarea
                  id="create-key-metadata"
                  value={formData.metadata}
                  onChange={(e) => setFormData({ ...formData, metadata: e.target.value })}
                  rows={4}
                  className={`${inputClass} mt-3 font-mono text-xs`}
                  placeholder={t('placeholders.metadataJson')}
                />
                <p className="mt-1 text-xs text-gray-500">{t('help.metadata')}</p>
              </details>
              <p className="text-xs leading-5 text-gray-500">
                {t('ui.quotaHint')}{' '}
                <Link href="/gateway/users" className="underline">
                  {t('table.user')}
                  <ArrowUpRightIcon className="ml-1 inline h-3 w-3" aria-hidden />
                </Link>
              </p>
              <p className="text-xs leading-5 text-amber-700">{t('create.secretOnce')}</p>
            </fieldset>
            <footer className="flex shrink-0 justify-end gap-2 border-t border-gray-100 bg-gray-50 px-5 py-3">
              <button
                type="button"
                onClick={() => setShowModal(false)}
                disabled={isSaving}
                className="h-9 rounded-lg border border-gray-200 bg-white px-4 text-xs text-gray-700 disabled:opacity-50"
              >
                {tCommon('cancel')}
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={isSaving}
                className="h-9 rounded-lg admin-primary px-4 text-xs disabled:opacity-50"
              >
                {isSaving ? tCommon('creating') : tCommon('create')}
              </button>
            </footer>
          </div>
        </div>
      )}
      {showEditModal && selectedKey && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/40 p-3 sm:p-6">
          <div
            ref={editRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-key-title"
            className="flex max-h-[calc(100dvh-1.5rem)] sm:max-h-[calc(100dvh-3rem)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white outline-none"
          >
            <header className="flex shrink-0 items-center justify-between gap-4 border-b border-gray-100 px-5 py-4">
              <h2
                id="edit-key-title"
                className="flex items-center gap-2 text-base font-medium text-gray-950"
              >
                <KeyIcon className="h-5 w-5 text-gray-400" aria-hidden />
                {t('editTitle')}
              </h2>
              <button
                type="button"
                onClick={() => setShowEditModal(false)}
                disabled={isSaving || isDeleting || statusTogglingId != null}
                aria-label={tCommon('close')}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 disabled:opacity-50"
              >
                <XMarkIcon className="h-5 w-5" aria-hidden />
              </button>
            </header>
            <fieldset
              disabled={isSaving || isDeleting || statusTogglingId != null}
              className="min-h-0 space-y-5 overflow-y-auto p-5"
            >
              {saveError && (
                <p
                  role="alert"
                  className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
                >
                  {saveError}
                </p>
              )}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-3">
                <Link
                  href={`/gateway/users/${encodeURIComponent(selectedKey.user_id)}`}
                  className="flex min-w-0 items-center gap-2 text-sm text-gray-800 hover:underline"
                >
                  <UserCircleIcon className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
                  <span className="truncate">{selectedKey.user_email || tCommon('noData')}</span>
                  <ArrowUpRightIcon className="h-3 w-3 shrink-0 text-gray-400" aria-hidden />
                </Link>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">{statusLabel(selectedKey.status)}</span>
                  <button
                    type="button"
                    role="switch"
                    aria-label={t('fields.status')}
                    aria-checked={selectedKey.status === 'active'}
                    disabled={statusTogglingId === selectedKey.id}
                    onClick={() => handleStatusToggle(selectedKey)}
                    className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 ${
                      selectedKey.status === 'active' ? 'bg-gray-950' : 'bg-gray-300'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
                        selectedKey.status === 'active' ? 'translate-x-[18px]' : 'translate-x-0.5'
                      }`}
                    />
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2.5">
                <KeyIcon className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
                <code className="min-w-0 flex-1 break-all text-xs text-gray-600">
                  {revealSecret ? selectedKey.key : maskKey(selectedKey.key)}
                </code>
                <button
                  type="button"
                  onClick={() => setRevealSecret(!revealSecret)}
                  aria-label={t(revealSecret ? 'ui.hideSecret' : 'ui.showSecret')}
                  aria-pressed={revealSecret}
                  className="rounded p-1 text-gray-400 hover:bg-gray-100"
                >
                  {revealSecret ? (
                    <EyeSlashIcon className="h-4 w-4" aria-hidden />
                  ) : (
                    <EyeIcon className="h-4 w-4" aria-hidden />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => copyToClipboard(selectedKey.key)}
                  aria-label={t('copySecret')}
                  title={t('copySecret')}
                  className={`rounded p-1 hover:bg-gray-100 ${
                    copiedKey === selectedKey.key ? 'text-emerald-600' : 'text-gray-400'
                  }`}
                >
                  <ClipboardDocumentIcon className="h-4 w-4" aria-hidden />
                </button>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="edit-key-name"
                    className="mb-1 block text-sm font-medium text-gray-700"
                  >
                    {t('fields.name')}
                  </label>
                  <input
                    id="edit-key-name"
                    value={editFormData.name}
                    onChange={(e) => setEditFormData({ ...editFormData, name: e.target.value })}
                    className={inputClass}
                    placeholder={t('placeholders.optionalLabel')}
                  />
                </div>
                <div>
                  <label
                    htmlFor="edit-key-rpm"
                    className="mb-1 flex items-center gap-1.5 text-sm font-medium text-gray-700"
                  >
                    <SignalIcon className="h-4 w-4 text-gray-400" aria-hidden />
                    {t('fields.rateLimitRpm')}
                  </label>
                  <input
                    ref={editRpmRef}
                    id="edit-key-rpm"
                    type="number"
                    min={0}
                    step={1}
                    value={editFormData.rateLimitRpm}
                    onChange={(e) =>
                      setEditFormData({ ...editFormData, rateLimitRpm: e.target.value })
                    }
                    className={inputClass}
                    placeholder={t('placeholders.rateLimitRpm')}
                  />
                </div>
                <p className="text-xs leading-5 text-gray-500 sm:col-span-2">
                  {t('help.rateLimitRpm')}
                </p>
              </div>
              <details
                open={metadataExpanded}
                onToggle={(event) => setMetadataExpanded(event.currentTarget.open)}
                className="rounded-lg border border-gray-200 p-3"
              >
                <summary className="cursor-pointer text-sm text-gray-700">
                  <CodeBracketIcon className="mr-1.5 inline h-4 w-4 text-gray-400" aria-hidden />
                  {t('fields.metadataJson')}
                </summary>
                <label htmlFor="edit-key-metadata" className="sr-only">
                  {t('fields.metadataJson')}
                </label>
                <textarea
                  id="edit-key-metadata"
                  value={editFormData.metadata}
                  onChange={(e) => setEditFormData({ ...editFormData, metadata: e.target.value })}
                  rows={4}
                  className={`${inputClass} mt-3 font-mono text-xs`}
                  placeholder="{}"
                />
                <p className="mt-1 text-xs text-gray-500">{t('help.editMetadata')}</p>
              </details>
              <details className="rounded-lg border border-gray-200 p-3">
                <summary className="cursor-pointer text-sm text-gray-700">
                  {t('ui.userQuota')}
                </summary>
                <p className="my-3 text-xs leading-5 text-gray-500">{t('ui.quotaHint')}</p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <ReadonlyRow label={t('fields.budgetReadonly')}>
                    {formatGatewayMoneyCode(selectedKey.budget_spent, billingCurrency, 2)} /{' '}
                    {selectedKey.budget_max != null
                      ? formatGatewayMoneyCode(selectedKey.budget_max, billingCurrency, 2)
                      : tCommon('noLimit')}
                  </ReadonlyRow>
                  <ReadonlyRow label={t('fields.walletReadonly')}>
                    {formatGatewayMoneyCode(
                      Number(selectedKey.wallet_granted ?? 0) -
                        Number(selectedKey.wallet_spent ?? 0),
                      billingCurrency,
                      2
                    )}
                  </ReadonlyRow>
                  <ReadonlyRow label={t('ui.resetBase')}>
                    {selectedKey.budget_base != null
                      ? formatGatewayMoneyCode(selectedKey.budget_base, billingCurrency, 2)
                      : '—'}
                  </ReadonlyRow>
                  <ReadonlyRow label={t('fields.budgetPeriodReset')}>
                    {tOptions(`budgetPeriod.${selectedKey.budget_period || 'none'}`)} /{' '}
                    {selectedKey.budget_reset_at
                      ? formatKeyTimestamp(selectedKey.budget_reset_at, businessTimezone)
                      : '—'}
                  </ReadonlyRow>
                </div>
                <Link
                  href={`/gateway/users/${encodeURIComponent(selectedKey.user_id)}?section=billing`}
                  className="mt-4 inline-flex items-center gap-1 text-xs text-gray-600 hover:underline"
                >
                  {t('ui.manageQuota')}
                  <ArrowUpRightIcon className="h-3 w-3" aria-hidden />
                </Link>
              </details>
              <details className="rounded-lg border border-gray-200 p-3">
                <summary className="cursor-pointer text-sm text-gray-700">
                  {t('ui.technicalDetails')}
                </summary>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <ReadonlyRow label={t('ui.keyId')}>
                    <div className="flex items-start gap-2">
                      <span className="break-all font-mono text-xs">{selectedKey.id}</span>
                      <button
                        type="button"
                        aria-label={t('copyId')}
                        onClick={() => copyToClipboard(selectedKey.id)}
                        className="shrink-0 text-gray-400 hover:text-gray-700"
                      >
                        <ClipboardDocumentIcon className="h-4 w-4" aria-hidden />
                      </button>
                    </div>
                  </ReadonlyRow>
                  <ReadonlyRow label={t('fields.userIdAuth')}>
                    <Link
                      href={`/gateway/users/${encodeURIComponent(selectedKey.user_id)}`}
                      className="break-all font-mono text-xs hover:underline"
                    >
                      {selectedKey.user_id}
                    </Link>
                  </ReadonlyRow>
                  <ReadonlyRow label={t('fields.created')}>
                    {formatKeyTimestamp(selectedKey.created_at, businessTimezone)}
                  </ReadonlyRow>
                  <ReadonlyRow label={t('fields.updated')}>
                    {formatKeyTimestamp(selectedKey.updated_at, businessTimezone)}
                  </ReadonlyRow>
                  <ReadonlyRow label={t('fields.lastUsedAt')}>
                    {selectedKey.last_used_at
                      ? formatKeyTimestamp(selectedKey.last_used_at, businessTimezone)
                      : t('fields.lastUsedNever')}
                  </ReadonlyRow>
                </div>
              </details>
              <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-gray-600">
                <Link
                  href={`/gateway/request-logs?api_key_id=${encodeURIComponent(selectedKey.id)}`}
                  className="inline-flex items-center gap-1.5 hover:text-gray-950"
                >
                  <DocumentTextIcon className="h-4 w-4" aria-hidden />
                  {t('links.requestLogsForKey')}
                </Link>
                <Link
                  href={`/gateway/audit-logs?api_key_id=${encodeURIComponent(selectedKey.id)}`}
                  className="inline-flex items-center gap-1.5 hover:text-gray-950"
                >
                  <ClipboardDocumentListIcon className="h-4 w-4" aria-hidden />
                  {t('links.auditLogsForKey')}
                </Link>
              </div>
            </fieldset>
            <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-gray-100 bg-gray-50 px-5 py-3">
              <button
                type="button"
                onClick={handleEditDelete}
                disabled={isSaving || isDeleting || statusTogglingId != null}
                className="text-xs text-red-600 hover:text-red-800 disabled:opacity-50"
              >
                {isDeleting ? tCommon('deleting') : t('deleteKey')}
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  disabled={isSaving || isDeleting || statusTogglingId != null}
                  className="h-9 rounded-lg border border-gray-200 bg-white px-4 text-xs text-gray-700 disabled:opacity-50"
                >
                  {tCommon('cancel')}
                </button>
                <button
                  type="button"
                  onClick={handleEditSave}
                  disabled={isSaving || isDeleting || statusTogglingId != null}
                  className="h-9 rounded-lg admin-primary px-4 text-xs disabled:opacity-50"
                >
                  {isSaving ? tCommon('savingDots') : tCommon('save')}
                </button>
              </div>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
