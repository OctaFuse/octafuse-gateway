'use client';

/**
 * 网关用户列表：预算在 `users`；筛选与分页；跳转详情。
 */
import { useTranslations } from 'next-intl';
import { useState, useEffect, useCallback, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { MagnifyingGlassIcon, PlusIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { readApiJson } from '@/lib/api-json';
import { formatGatewayMoneyCode } from '@/lib/format-gateway-currency';
import { summarizeChargedCostFactors } from '@/lib/summarize-charged-cost-factors';
import { summarizeMetadata } from '@/lib/summarize-metadata';
import { nextListSortStateWithAscToggle } from '@/lib/toggle-list-sort';
import type { GatewayUserListItem } from '@/lib/types';
import { useBillingCurrency } from '@/lib/use-billing-currency';
import { useGatewayDateTime } from '@/lib/use-gateway-datetime';

type UserListSortKey = 'budget_spent' | 'budget_max' | 'budget_base' | 'budget_reset_at' | 'created_at';
type SortDir = 'asc' | 'desc';

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

function periodLabel(
  period: string | null | undefined,
  labels: { daily: string; weekly: string; monthly: string }
): string | null {
  if (!period || period === 'none') return null;
  if (period === 'daily' || period === 'weekly' || period === 'monthly') {
    return labels[period];
  }
  return period;
}

function SummaryChip({
  children,
  title,
  invalid,
  onClick,
}: {
  children: ReactNode;
  title: string;
  invalid?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`flex w-full min-w-0 max-w-full items-center rounded-md px-2 py-1 text-left text-xs ring-1 ring-inset transition-colors hover:bg-white ${
        invalid
          ? 'bg-red-50 text-red-700 ring-red-200 hover:bg-red-50'
          : 'bg-slate-50 text-slate-700 ring-slate-200 hover:ring-slate-300'
      }`}
    >
      <span className="min-w-0 truncate font-medium">{children}</span>
    </button>
  );
}

export default function GatewayUsersPage() {
  const t = useTranslations('users');
  const tCommon = useTranslations('common');
  const tOptions = useTranslations('options');
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
  const [factorsViewUser, setFactorsViewUser] = useState<GatewayUserListItem | null>(null);
  const [listError, setListError] = useState('');
  const { currency: billingCurrency } = useBillingCurrency();
  const { formatDateTime, formatDate, formatTime } = useGatewayDateTime();

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
      setListError(tCommon('failedToLoadUsers'));
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

  const hasFilters = Boolean(
    filterEmail.trim() || filterExternalSystem.trim() || filterExternalUserId.trim() || filterStatus
  );

  const clearFilters = () => {
    setFilterEmail('');
    setFilterExternalSystem('');
    setFilterExternalUserId('');
    setFilterStatus('');
    setPage(1);
  };

  const SortButton = ({
    label,
    columnKey,
  }: {
    label: string;
    columnKey: UserListSortKey;
  }) => {
    const active = sortKey === columnKey;
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          toggleSort(columnKey);
        }}
        className={`inline-flex items-center gap-0.5 rounded px-0.5 hover:text-gray-800 ${
          active ? 'text-gray-800' : 'text-gray-500'
        }`}
        aria-label={`Sort by ${label}`}
      >
        {label}
        <span className={`text-[10px] leading-none ${active ? 'text-blue-600' : 'text-gray-300'}`}>
          {active ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
        </span>
      </button>
    );
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
      className={`px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider whitespace-nowrap ${
        align === 'right' ? 'text-right' : 'text-left'
      }`}
    >
      <SortButton label={label} columnKey={columnKey} />
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
      setSaveError(tCommon('createFailed'));
    } finally {
      setIsSaving(false);
    }
  };

  const statusFilterOptions: Array<{ value: string; label: string }> = [
    { value: '', label: tCommon('all') },
    { value: 'active', label: tOptions('userStatus.active') },
    { value: 'disabled', label: tOptions('userStatus.disabled') },
  ];
  const showSkeleton = isLoading && users.length === 0;
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
          onClick={openCreate}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          <PlusIcon className="h-4 w-4" />
          {t('newUser')}
        </button>
      </div>

      <div className="mb-4 rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
          <div className="grid min-w-0 flex-1 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="min-w-0">
              <label className="mb-1 block text-xs font-medium text-gray-500">{t('filters.email')}</label>
              <div className="relative">
                <MagnifyingGlassIcon
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
                  aria-hidden
                />
                <input
                  type="search"
                  value={filterEmail}
                  onChange={(e) => { setFilterEmail(e.target.value); setPage(1); }}
                  className={`${inputClass} pl-9`}
                  placeholder={t('filters.emailPlaceholder')}
                  autoComplete="off"
                />
              </div>
            </div>
            <div className="min-w-0">
              <label className="mb-1 block text-xs font-medium text-gray-500">{t('filters.externalSystem')}</label>
              <input
                type="text"
                value={filterExternalSystem}
                onChange={(e) => { setFilterExternalSystem(e.target.value); setPage(1); }}
                className={inputClass}
                placeholder={t('filters.externalSystemPlaceholder')}
                autoComplete="off"
              />
            </div>
            <div className="min-w-0">
              <label className="mb-1 block text-xs font-medium text-gray-500">{t('filters.externalUserId')}</label>
              <input
                type="text"
                value={filterExternalUserId}
                onChange={(e) => { setFilterExternalUserId(e.target.value); setPage(1); }}
                className={inputClass}
                placeholder={t('filters.externalUserIdPlaceholder')}
                autoComplete="off"
              />
            </div>
            <div className="min-w-0">
              <label className="mb-1 block text-xs font-medium text-gray-500">{t('filters.status')}</label>
              <div className="inline-flex w-full rounded-lg bg-gray-100 p-0.5">
                {statusFilterOptions.map((option) => {
                  const selected = filterStatus === option.value;
                  return (
                    <button
                      key={option.value || 'all'}
                      type="button"
                      onClick={() => { setFilterStatus(option.value); setPage(1); }}
                      className={`flex-1 rounded-md px-2.5 py-1.5 text-xs font-medium capitalize transition-colors ${
                        selected
                          ? 'bg-white text-gray-900 shadow-sm'
                          : 'text-gray-500 hover:text-gray-800'
                      }`}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          {hasFilters && (
            <div className="flex shrink-0 items-end pb-0.5">
              <button
                type="button"
                onClick={clearFilters}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-800"
              >
                <XMarkIcon className="h-3.5 w-3.5" aria-hidden />
                {tCommon('clearFilters')}
              </button>
            </div>
          )}
        </div>
      </div>

      {listError && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{listError}</div>
      )}

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className={`overflow-x-auto ${isLoading ? 'opacity-70' : ''}`}>
        <table className="w-full min-w-[68rem] table-fixed">
          <colgroup>
            <col className="w-[22%]" />
            <col className="w-[26%]" />
            <col className="w-[8%]" />
            <col className="w-[14%]" />
            <col className="w-[14%]" />
            <col className="w-[16%]" />
          </colgroup>
          <thead className="border-b border-gray-200 bg-gray-50/80">
            <tr>
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500 whitespace-nowrap">
                {t('table.user')}
              </th>
              <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider whitespace-nowrap">
                <div className="inline-flex items-center justify-end gap-1.5">
                  <span className="text-gray-400">{t('table.budget')}</span>
                  <SortButton label={t('table.spent')} columnKey="budget_spent" />
                  <span className="text-gray-300">/</span>
                  <SortButton label={t('table.max')} columnKey="budget_max" />
                  <span className="text-gray-300">·</span>
                  <SortButton label={t('table.base')} columnKey="budget_base" />
                  <span className="text-gray-300">·</span>
                  <SortButton label={t('table.cycle')} columnKey="budget_reset_at" />
                </div>
              </th>
              <th
                className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider text-gray-500 whitespace-nowrap"
                title={t('table.keysActiveOfTotal')}
              >
                {t('table.keys')}
              </th>
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500 whitespace-nowrap">
                {t('table.metadata')}
              </th>
              <th
                className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500 whitespace-nowrap"
                title={t('help.chargedCostFactors')}
              >
                {t('table.chargedCostFactors')}
              </th>
              <SortableTh label={t('table.created')} columnKey="created_at" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {showSkeleton &&
              Array.from({ length: 8 }).map((_, index) => (
                <tr key={`skeleton-${index}`} className="animate-pulse">
                  <td className="px-4 py-4"><div className="h-4 w-48 rounded bg-gray-100" /></td>
                  <td className="px-4 py-4"><div className="ml-auto h-4 w-40 rounded bg-gray-100" /></td>
                  <td className="px-4 py-4"><div className="ml-auto h-4 w-8 rounded bg-gray-100" /></td>
                  <td className="px-4 py-4"><div className="h-4 w-24 rounded bg-gray-100" /></td>
                  <td className="px-4 py-4"><div className="h-4 w-24 rounded bg-gray-100" /></td>
                  <td className="px-4 py-4"><div className="h-4 w-20 rounded bg-gray-100" /></td>
                </tr>
              ))}
            {users.map((u) => {
              const detailHref = `/gateway/users/${encodeURIComponent(u.id)}`;
              const meta = summarizeMetadata(u.metadata);
              const factors = summarizeChargedCostFactors(u.charged_cost_factors);
              const disabled = u.status !== 'active';
              const periodActive = Boolean(u.budget_period && u.budget_period !== 'none');
              const hasBase = u.budget_base != null && u.budget_base !== 0;
              const ratio = budgetUsageRatio(u.budget_spent, u.budget_max);
              const spentLabel = formatGatewayMoneyCode(u.budget_spent, billingCurrency, 2);
              const maxLabel =
                u.budget_max != null
                  ? formatGatewayMoneyCode(u.budget_max, billingCurrency, 2)
                  : tCommon('noLimit');
              const periodText = periodActive
                ? periodLabel(u.budget_period, {
                    daily: tOptions('budgetPeriod.daily'),
                    weekly: tOptions('budgetPeriod.weekly'),
                    monthly: tOptions('budgetPeriod.monthly'),
                  }) ?? u.budget_period
                : null;
              const cycleText = [periodText, u.budget_reset_at ? formatDate(u.budget_reset_at) : null]
                .filter(Boolean)
                .join(' · ');
              const resetToText = hasBase
                ? t('table.resetTo', { amount: formatGatewayMoneyCode(u.budget_base, billingCurrency, 2) })
                : null;
              const resetHint = [cycleText, resetToText].filter(Boolean).join(' ');
              const externalLabel = [u.external_system, u.external_user_id].filter(Boolean).join(' · ');
              return (
              <tr
                key={u.id}
                role="link"
                tabIndex={0}
                aria-label={`User detail: ${u.email || u.id}`}
                className={`cursor-pointer transition-colors hover:bg-blue-50/40 focus:bg-blue-50/60 focus:outline-none ${
                  disabled ? 'bg-gray-50/60' : ''
                }`}
                onClick={() => router.push(detailHref)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    router.push(detailHref);
                  }
                }}
              >
                <td className="px-4 py-3.5 overflow-hidden">
                  <div className="flex min-w-0 items-start gap-2.5">
                    <span
                      className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                        disabled ? 'bg-gray-400' : 'bg-emerald-500'
                      }`}
                      title={u.status}
                      role="img"
                      aria-label={`Status: ${u.status}`}
                    />
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-2">
                        <span
                          className={`truncate text-sm font-medium ${disabled ? 'text-gray-500' : 'text-gray-900'}`}
                          title={u.email || undefined}
                        >
                          {u.email || tCommon('noData')}
                        </span>
                        {disabled && (
                          <span className="inline-flex shrink-0 items-center rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-600 ring-1 ring-inset ring-gray-200">
                            {tOptions('userStatus.disabled')}
                          </span>
                        )}
                      </div>
                      {externalLabel ? (
                        <div className="mt-0.5 truncate font-mono text-[11px] text-gray-400" title={externalLabel}>
                          {externalLabel}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3.5 overflow-hidden">
                  <div className="w-full">
                    <div className="flex items-baseline justify-end gap-2">
                      {resetHint ? (
                        <div
                          className="min-w-0 flex-1 truncate text-left text-[11px] text-gray-500"
                          title={u.budget_reset_at ? formatDateTime(u.budget_reset_at) : resetHint}
                        >
                          {resetHint}
                        </div>
                      ) : null}
                      <div className="shrink-0 text-right text-sm tabular-nums text-gray-900">
                        {spentLabel}
                        <span className="text-gray-400"> / </span>
                        <span className={u.budget_max == null ? 'text-gray-400' : 'text-gray-700'}>{maxLabel}</span>
                      </div>
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
                  </div>
                </td>
                <td className="px-4 py-3.5 overflow-hidden text-right">
                  <span
                    className="inline-flex items-center justify-end tabular-nums text-sm"
                    title={t('table.keysActiveOfTotal')}
                  >
                    <span className={u.active_keys_count === 0 && (u.keys_count ?? 0) > 0 ? 'text-gray-400' : 'text-gray-900'}>
                      {u.active_keys_count}
                    </span>
                    <span className="text-gray-400"> / </span>
                    <span className="text-gray-700">{u.keys_count ?? u.active_keys_count}</span>
                  </span>
                </td>
                <td
                  className="px-4 py-3.5 overflow-hidden"
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                >
                  {meta.empty ? (
                    <span className="text-gray-300">{tCommon('noData')}</span>
                  ) : (
                    <SummaryChip
                      title={meta.summary}
                      invalid={!meta.ok}
                      onClick={() => setMetadataViewUser(u)}
                    >
                      {displayMetadataSummary(meta.summary)}
                    </SummaryChip>
                  )}
                </td>
                <td
                  className="px-4 py-3.5 overflow-hidden"
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                >
                  {factors.empty ? (
                    <span className="text-gray-300">{tCommon('noData')}</span>
                  ) : (
                    <SummaryChip
                      title={factors.summary}
                      onClick={() => setFactorsViewUser(u)}
                    >
                      {factors.summary}
                    </SummaryChip>
                  )}
                </td>
                <td className="px-4 py-3.5 overflow-hidden whitespace-nowrap">
                  <div className="truncate text-sm text-gray-700">{formatDate(u.created_at)}</div>
                  <div className="truncate text-[11px] tabular-nums text-gray-400">{formatTime(u.created_at)}</div>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
        </div>
        {!showSkeleton && users.length === 0 && (
          <div className="px-4 py-16 text-center text-sm text-gray-500">{t('emptyFiltered')}</div>
        )}
        {!showSkeleton && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 px-4 py-3">
            <div className="text-sm text-gray-500">{t('totalUsers', { count: total })}</div>
            {totalPages > 1 && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
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
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
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

      {showCreate && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b flex justify-between items-center">
              <h2 className="text-xl font-bold text-gray-900">{t('createTitle')}</h2>
              <button type="button" onClick={() => setShowCreate(false)} className="text-gray-400 hover:text-gray-600">×</button>
            </div>
            <div className="p-6 space-y-5">
              {saveError && <div className="p-3 bg-red-50 border border-red-200 rounded-md text-red-600 text-sm">{saveError}</div>}
              <p className="text-sm text-gray-600">
                {t('help.createUser')}
              </p>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('fields.email')} <span aria-hidden="true" className="ml-0.5 text-red-500">*</span>
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
              <div className="rounded-lg border border-sky-200 bg-sky-50/70 p-4 space-y-3">
                <h3 className="text-sm font-semibold text-sky-950">{t('table.budget')}</h3>
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t('fields.budgetMax')} <span className="ml-1 text-xs font-normal text-gray-400">{tCommon('optional')}</span>
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={createForm.budget_max}
                      onChange={(e) => setCreateForm({ ...createForm, budget_max: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md bg-white text-sm"
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
                      value={createForm.budget_base}
                      onChange={(e) => setCreateForm({ ...createForm, budget_base: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md bg-white text-sm"
                      placeholder={tCommon('optional')}
                    />
                    <p className="mt-1 text-xs text-gray-500">
                      {t('help.budgetBase')}
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t('fields.budgetPeriod')} <span className="ml-1 text-xs font-normal text-gray-400">{tCommon('optional')}</span>
                    </label>
                    <select
                      value={createForm.budget_period}
                      onChange={(e) => setCreateForm({ ...createForm, budget_period: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md bg-white text-sm"
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
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('fields.metadataJsonObject')} <span className="ml-1 text-xs font-normal text-gray-400">{tCommon('optional')}</span>
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
                  {t('externalIdentity.title')} <span className="ml-1 text-xs font-normal text-gray-400">{tCommon('optional')}</span>
                </h3>
                <p className="mt-1 text-xs text-gray-500">
                  {t('externalIdentity.createHint')}
                </p>
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t('fields.externalSystem')} <span className="ml-1 text-xs font-normal text-gray-400">{tCommon('optional')}</span>
                    </label>
                    <input
                      type="text"
                      value={createForm.external_system}
                      onChange={(e) => setCreateForm({ ...createForm, external_system: e.target.value })}
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
                      value={createForm.external_user_id}
                      onChange={(e) => setCreateForm({ ...createForm, external_user_id: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                      placeholder={t('fields.externalUserId')}
                    />
                  </div>
                </div>
              </div>
            </div>
            <div className="px-6 py-4 border-t flex justify-end gap-2">
              <button type="button" onClick={() => setShowCreate(false)} className="px-4 py-2 border rounded-md text-sm" disabled={isSaving}>{tCommon('cancel')}</button>
              <button type="button" onClick={submitCreate} disabled={isSaving} className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm disabled:opacity-50">
                {isSaving ? tCommon('saving') : tCommon('create')}
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
                  <h2 className="text-lg font-bold text-gray-900">{tCommon('metadata')}</h2>
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
              <div className="px-6 py-3 border-t flex justify-end">
                <button
                  type="button"
                  onClick={() => setMetadataViewUser(null)}
                  className="px-3 py-1.5 bg-gray-800 text-white rounded-md text-sm hover:bg-gray-900"
                >
                  {tCommon('close')}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {factorsViewUser && (() => {
        const f = summarizeChargedCostFactors(factorsViewUser.charged_cost_factors);
        return (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] flex flex-col">
              <div className="px-6 py-4 border-b flex justify-between items-center">
                <div className="min-w-0">
                  <h2 className="text-lg font-bold text-gray-900">{t('fields.chargedCostFactors')}</h2>
                  <p className="mt-0.5 text-xs text-gray-500 font-mono truncate" title={factorsViewUser.id}>
                    {[factorsViewUser.email, factorsViewUser.id].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setFactorsViewUser(null)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  ×
                </button>
              </div>
              <div className="p-6 overflow-y-auto">
                {f.empty ? (
                  <div className="text-sm text-gray-500">{t('chargedCostFactors.none')}</div>
                ) : (
                  <pre className="whitespace-pre-wrap break-all rounded-md bg-gray-50 border border-gray-200 p-4 text-xs font-mono text-gray-800">
                    {f.full}
                  </pre>
                )}
              </div>
              <div className="px-6 py-3 border-t flex justify-end">
                <button
                  type="button"
                  onClick={() => setFactorsViewUser(null)}
                  className="px-3 py-1.5 bg-gray-800 text-white rounded-md text-sm hover:bg-gray-900"
                >
                  {tCommon('close')}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
