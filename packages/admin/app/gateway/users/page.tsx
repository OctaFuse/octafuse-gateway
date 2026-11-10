'use client';

import { AdminPageTitle } from '@/components/admin-page-title';

/**
 * 网关用户列表：预算在 `users`；筛选与分页；跳转详情。
 */
import { AdminInspector } from '@/components/admin-inspector';
import { useAdminDialog } from '@/components/use-admin-dialog';
import { buildUserCreatePayload } from './user-detail-form';
import { FilterTextInput } from '../components/filter-controls';
import { useTranslations } from 'next-intl';
import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import {
  PlusIcon,
  XMarkIcon,
  MagnifyingGlassIcon,
  ArrowsUpDownIcon,
  KeyIcon,
  CodeBracketIcon,
  AdjustmentsHorizontalIcon,
} from '@heroicons/react/24/outline';
import { InfoHintPopover } from '@/components/InfoHintPopover';
import { readApiJson } from '@/lib/api-json';
import { formatGatewayMoneyCode } from '@/lib/format-gateway-currency';
import { summarizeChargedCostFactors } from '@/lib/summarize-charged-cost-factors';
import { summarizeMetadata } from '@/lib/summarize-metadata';
import type { GatewayUserListItem } from '@/lib/types';
import { useBillingCurrency } from '@/lib/use-billing-currency';
import { useGatewayDateTime } from '@/lib/use-gateway-datetime';

type UserListSortKey =
  | 'budget_spent'
  | 'budget_max'
  | 'budget_base'
  | 'budget_reset_at'
  | 'wallet_granted'
  | 'wallet_spent'
  | 'created_at';
type SortDir = 'asc' | 'desc';

function budgetUsageRatio(spent: number, max: number | null | undefined): number | null {
  if (max == null || max <= 0) return null;
  return Math.min(1, Math.max(0, spent / max));
}

function budgetBarClass(ratio: number): string {
  if (ratio >= 1) return 'bg-red-500';
  if (ratio >= 0.8) return 'bg-amber-500';
  return 'bg-gray-700';
}

function spentToneClass(ratio: number | null, idle: boolean): string {
  if (idle) return 'text-gray-400';
  if (ratio == null) return 'text-gray-900';
  if (ratio >= 1) return 'text-red-600';
  if (ratio >= 0.8) return 'text-amber-700';
  return 'text-gray-900';
}

function userRpm(user: { rate_limit?: { rpm?: number } | null }): number | null {
  return user.rate_limit?.rpm ?? null;
}

function QuotaUsageBar({ ratio }: { ratio: number | null }) {
  if (ratio == null) return null;
  return (
    <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-gray-100">
      <div
        className={`h-full rounded-full ${budgetBarClass(ratio)}`}
        style={{ width: `${Math.max(ratio * 100, ratio > 0 ? 4 : 0)}%` }}
      />
    </div>
  );
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
  icon,
  title,
  invalid,
  onClick,
}: {
  children: ReactNode;
  icon?: ReactNode;
  title: string;
  invalid?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={`flex w-full min-w-0 max-w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs ring-1 ring-inset transition-colors hover:bg-white ${
        invalid
          ? 'bg-red-50 text-red-700 ring-red-200 hover:bg-red-50'
          : 'bg-slate-50 text-slate-700 ring-slate-200 hover:ring-slate-300'
      }`}
    >
      <span className="shrink-0 text-gray-400">{icon}</span>
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
  const createRef = useAdminDialog(showCreate, isSaving, () => setShowCreate(false));
  const metadataRef = useAdminDialog(Boolean(metadataViewUser), false, () =>
    setMetadataViewUser(null)
  );
  const factorsRef = useAdminDialog(Boolean(factorsViewUser), false, () =>
    setFactorsViewUser(null)
  );
  const requestSequence = useRef(0);
  const { currency: billingCurrency } = useBillingCurrency();
  const { formatDateTime, formatDate, formatTime } = useGatewayDateTime();

  const fetchUsers = useCallback(async () => {
    const sequence = ++requestSequence.current;
    setIsLoading(true);
    setListError('');
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        page_size: pageSize.toString(),
      });
      if (filterEmail.trim()) params.append('email', filterEmail.trim());
      if (filterExternalSystem.trim())
        params.append('external_system', filterExternalSystem.trim());
      if (filterExternalUserId.trim())
        params.append('external_user_id', filterExternalUserId.trim());
      if (filterStatus) params.append('status', filterStatus);
      params.append('sort', sortKey);
      params.append('order', sortDir);

      const response = await fetch(`/api/admin/users?${params.toString()}`);
      const data = await readApiJson<GatewayUserListItem[]>(response);
      if (sequence !== requestSequence.current) return;
      if (data.success && data.data) {
        setUsers(data.data);
        setTotal(data.total ?? 0);
      } else {
        setListError(data.message || tCommon('failedToLoadUsers'));
      }
    } catch (e) {
      if (sequence !== requestSequence.current) return;
      console.error('Fetch users error:', e);
      setListError(tCommon('failedToLoadUsers'));
    } finally {
      if (sequence === requestSequence.current) setIsLoading(false);
    }
  }, [
    page,
    filterEmail,
    filterExternalSystem,
    filterExternalUserId,
    filterStatus,
    sortKey,
    sortDir,
    tCommon,
  ]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const totalPages = Math.ceil(total / pageSize);

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
    const invalid = Array.from(createRef.current?.querySelectorAll('input') ?? []).find(
      (input) => input.validity.badInput
    );
    if (invalid) {
      invalid.reportValidity();
      setSaveError(t('createErrors.amountInvalid'));
      return;
    }
    setIsSaving(true);
    try {
      let body: Record<string, unknown>;
      try {
        body = buildUserCreatePayload(createForm);
      } catch (error) {
        setSaveError(t(`createErrors.${error instanceof Error ? error.message : 'invalid'}`));
        return;
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
        setSaveError(data.message || tCommon('createFailed'));
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

  return (
    <div className="min-w-0 p-4 sm:p-6 lg:p-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <AdminPageTitle>{t('title')}</AdminPageTitle>
          <p className="mt-1 max-w-2xl text-sm text-gray-500">{t('subtitle')}</p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center gap-2 h-9 rounded-lg admin-primary px-3 py-2 text-xs font-medium text-white hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2"
        >
          <PlusIcon className="h-4 w-4" />
          {t('newUser')}
        </button>
      </div>

      <section aria-label={t('ui.filters')} className="mb-5 flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-1 basis-64 sm:max-w-sm">
          <MagnifyingGlassIcon
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
            aria-hidden
          />
          <input
            type="search"
            aria-label={t('filters.email')}
            value={filterEmail}
            onChange={(event) => {
              setFilterEmail(event.target.value);
              setPage(1);
            }}
            placeholder={t('filters.emailPlaceholder')}
            className="h-10 w-full rounded-lg border border-gray-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-gray-400 focus:ring-2 focus:ring-gray-100"
          />
        </div>
        <select
          aria-label={t('filters.status')}
          value={filterStatus}
          onChange={(event) => {
            setFilterStatus(event.target.value);
            setPage(1);
          }}
          className="h-10 rounded-lg border border-gray-200 bg-white px-3 text-xs text-gray-600"
        >
          <option value="">{t('ui.allStatuses')}</option>
          {statusFilterOptions
            .filter((option) => option.value)
            .map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
        </select>
        <AdminInspector
          label={`${t('ui.moreFilters')}${
            [filterExternalSystem, filterExternalUserId].filter(Boolean).length
              ? ' · ' + [filterExternalSystem, filterExternalUserId].filter(Boolean).length
              : ''
          }`}
          size="md"
          icon={AdjustmentsHorizontalIcon}
        >
          <FilterTextInput
            label={t('filters.externalSystem')}
            value={filterExternalSystem}
            onChange={(value) => {
              setFilterExternalSystem(value);
              setPage(1);
            }}
            placeholder={t('filters.externalSystemPlaceholder')}
          />
          <FilterTextInput
            label={t('filters.externalUserId')}
            value={filterExternalUserId}
            onChange={(value) => {
              setFilterExternalUserId(value);
              setPage(1);
            }}
            placeholder={t('filters.externalUserIdPlaceholder')}
          />
        </AdminInspector>
        <div className="ml-auto flex items-center gap-2">
          <select
            aria-label={t('ui.sort')}
            value={sortKey}
            onChange={(event) => {
              setSortKey(event.target.value as UserListSortKey);
              setPage(1);
            }}
            className="h-10 max-w-48 rounded-lg border border-gray-200 bg-white px-3 text-xs text-gray-600"
          >
            {(
              [
                'created_at',
                'budget_spent',
                'budget_max',
                'budget_base',
                'budget_reset_at',
                'wallet_granted',
                'wallet_spent',
              ] as const
            ).map((key) => (
              <option key={key} value={key}>
                {t(`ui.sortOptions.${key}`)}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => {
              setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
              setPage(1);
            }}
            aria-label={t(sortDir === 'asc' ? 'ui.ascending' : 'ui.descending')}
            title={t(sortDir === 'asc' ? 'ui.ascending' : 'ui.descending')}
            className="flex h-10 w-10 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500"
          >
            <ArrowsUpDownIcon className="h-4 w-4" aria-hidden />
          </button>
        </div>
        {hasFilters && (
          <button
            type="button"
            onClick={clearFilters}
            className="text-xs text-gray-500 hover:text-gray-900"
          >
            {tCommon('clearFilters')}
          </button>
        )}
      </section>

      {listError && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
          {listError}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <div className={`overflow-x-auto ${isLoading ? 'opacity-70' : ''}`}>
          <table className="admin-data-table w-full min-w-[56rem] table-fixed">
            <colgroup>
              {['26%', '21%', '16%', '12%', '15%', '10%'].map((width) => (
                <col key={width} style={{ width }} />
              ))}
            </colgroup>
            <thead className="border-b border-gray-200 bg-gray-50/80">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">
                  {t('table.user')}
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">
                  <span className="inline-flex items-center gap-1">
                    {t('table.budget')}
                    <InfoHintPopover label={t('hints.budgetTitle')}>
                      <p>{t('hints.budgetVsWallet')}</p>
                    </InfoHintPopover>
                  </span>
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">
                  <span className="inline-flex items-center gap-1">
                    {t('table.wallet')}
                    <InfoHintPopover label={t('hints.walletTitle')}>
                      <p>{t('hints.budgetVsWallet')}</p>
                    </InfoHintPopover>
                  </span>
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">
                  {t('ui.access')}
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">
                  {t('ui.configuration')}
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">
                  {t('table.created')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {showSkeleton &&
                Array.from({ length: 6 }).map((_, index) => (
                  <tr key={`skeleton-${index}`} className="animate-pulse">
                    {['w-48', 'w-28', 'w-20', 'w-12', 'w-16', 'w-20'].map((width, cell) => (
                      <td key={cell} className="px-4 py-4">
                        <div
                          className={`h-4 max-w-full rounded bg-gray-100 ${width} ${
                            cell > 0 && cell < 4 ? 'ml-auto' : ''
                          }`}
                        />
                      </td>
                    ))}
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
                const cycleText = [
                  periodText,
                  u.budget_reset_at ? formatDate(u.budget_reset_at) : null,
                ]
                  .filter(Boolean)
                  .join(' · ');
                const resetToText = hasBase
                  ? t('table.resetTo', {
                      amount: formatGatewayMoneyCode(u.budget_base, billingCurrency, 2),
                    })
                  : null;
                const resetHint = [cycleText, resetToText].filter(Boolean).join(' ');
                const budgetIdle = ratio == null && Number(u.budget_spent) === 0 && !resetHint;
                const walletRemaining = Number(u.wallet_granted ?? 0) - Number(u.wallet_spent ?? 0);
                const walletSpent = Number(u.wallet_spent ?? 0);
                const walletIdle = walletRemaining === 0 && walletSpent === 0;
                const walletDepleted = walletRemaining <= 0 && Number(u.wallet_granted ?? 0) > 0;
                const externalLabel = u.external_system;
                return (
                  <tr
                    key={u.id}
                    role="link"
                    tabIndex={0}
                    aria-label={`${t('title')}: ${u.email || u.id}`}
                    className={`cursor-pointer transition-colors hover:bg-gray-50/40 focus:bg-gray-50/60 focus:outline-none ${
                      disabled ? 'bg-gray-50/60' : ''
                    }`}
                    onClick={() => router.push(detailHref)}
                    onKeyDown={(e) => {
                      if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
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
                          aria-label={tOptions(
                            disabled ? 'userStatus.disabled' : 'userStatus.active'
                          )}
                        />
                        <div className="min-w-0">
                          <div className="flex min-w-0 items-center gap-2">
                            <span
                              className={`truncate text-sm font-medium ${
                                disabled ? 'text-gray-500' : 'text-gray-900'
                              }`}
                              title={u.email || undefined}
                            >
                              {u.email || tCommon('noData')}
                            </span>
                            {disabled && (
                              <span className="inline-flex shrink-0 items-center rounded-full bg-gray-100 px-1.5 py-0.5 text-xs font-medium normal-case tracking-normal text-gray-600 ring-1 ring-inset ring-gray-200">
                                {tOptions('userStatus.disabled')}
                              </span>
                            )}
                          </div>
                          {externalLabel ? (
                            <div
                              className="mt-0.5 truncate font-mono text-xs text-gray-400"
                              title={externalLabel}
                            >
                              {externalLabel}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3.5 overflow-hidden">
                      <div className="w-full text-right">
                        <div
                          className={`text-sm tabular-nums ${spentToneClass(ratio, budgetIdle)}`}
                        >
                          {spentLabel}
                          <span className="text-gray-400"> / </span>
                          <span className={u.budget_max == null ? 'text-gray-400' : undefined}>
                            {maxLabel}
                          </span>
                        </div>
                        {resetHint ? (
                          <div
                            className="mt-0.5 truncate text-xs text-gray-400"
                            title={
                              u.budget_reset_at ? formatDateTime(u.budget_reset_at) : resetHint
                            }
                          >
                            {resetHint}
                          </div>
                        ) : null}
                        <QuotaUsageBar ratio={ratio} />
                      </div>
                    </td>
                    <td className="px-4 py-3.5 overflow-hidden text-right">
                      <div
                        className={`text-sm tabular-nums ${
                          walletIdle
                            ? 'text-gray-400'
                            : walletDepleted
                            ? 'text-red-600'
                            : 'font-medium text-gray-900'
                        }`}
                      >
                        {formatGatewayMoneyCode(walletRemaining, billingCurrency, 2)}
                      </div>
                      <div className="mt-0.5 text-xs tabular-nums text-gray-400">
                        {t('table.walletSpent')}{' '}
                        {formatGatewayMoneyCode(walletSpent, billingCurrency, 2)}
                      </div>
                    </td>
                    <td
                      className="px-4 py-3.5 overflow-hidden text-right"
                      title={t('help.rateLimitRpm')}
                    >
                      {(() => {
                        const rpm = userRpm(u);
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
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          router.push(`${detailHref}?section=keys`);
                        }}
                        aria-label={t('ui.manageUserKeys', {
                          user: u.email || u.id,
                        })}
                        title={t('table.keysActiveOfTotal')}
                        className="mt-1 flex w-full items-center justify-end gap-1.5 text-xs tabular-nums text-gray-500 hover:text-gray-950"
                      >
                        <KeyIcon className="h-3.5 w-3.5" aria-hidden />
                        {u.active_keys_count} / {u.keys_count ?? u.active_keys_count}
                      </button>
                    </td>
                    <td
                      className="px-4 py-3.5 overflow-hidden"
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => e.stopPropagation()}
                    >
                      {meta.empty ? (
                        factors.empty ? (
                          <span className="text-gray-300">{tCommon('noData')}</span>
                        ) : null
                      ) : (
                        <SummaryChip
                          icon={<CodeBracketIcon className="h-3.5 w-3.5" aria-hidden />}
                          title={`${tCommon('metadata')}: ${meta.summary}`}
                          invalid={!meta.ok}
                          onClick={() => setMetadataViewUser(u)}
                        >
                          {displayMetadataSummary(meta.summary)}
                        </SummaryChip>
                      )}
                      <div className="mt-1.5" />
                      {factors.empty ? null : (
                        <SummaryChip
                          icon={<AdjustmentsHorizontalIcon className="h-3.5 w-3.5" aria-hidden />}
                          title={`${t('fields.chargedCostFactors')}: ${factors.summary}`}
                          onClick={() => setFactorsViewUser(u)}
                        >
                          {factors.summary}
                        </SummaryChip>
                      )}
                    </td>
                    <td className="px-4 py-3.5 overflow-hidden whitespace-nowrap">
                      <div className="truncate text-sm text-gray-700">
                        {formatDate(u.created_at)}
                      </div>
                      <div className="truncate text-xs tabular-nums text-gray-400">
                        {formatTime(u.created_at)}
                      </div>
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
        <div className="fixed inset-0 bg-gray-950/40 flex items-center justify-center z-50 p-3 sm:p-6">
          <div
            ref={createRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-user-title"
            className="flex max-h-[calc(100dvh-1.5rem)] sm:max-h-[calc(100dvh-3rem)] w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-white shadow-panel outline-none"
          >
            <div className="px-6 py-4 border-b flex justify-between items-center">
              <h2 id="create-user-title" className="text-base font-medium text-gray-900">
                {t('createTitle')}
              </h2>
              <button
                type="button"
                disabled={isSaving}
                aria-label={tCommon('close')}
                onClick={() => setShowCreate(false)}
                className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100"
              >
                <XMarkIcon className="h-5 w-5" aria-hidden />
              </button>
            </div>
            <fieldset disabled={isSaving} className="min-h-0 space-y-5 overflow-y-auto p-5">
              {saveError && (
                <div
                  role="alert"
                  className="p-3 bg-red-50 border border-red-200 rounded-md text-red-600 text-sm"
                >
                  {saveError}
                </div>
              )}
              <p className="text-sm text-gray-600">{t('help.createUser')}</p>
              <div>
                <label
                  htmlFor="create-user-email"
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  {t('fields.email')}{' '}
                  <span aria-hidden="true" className="ml-0.5 text-red-500">
                    *
                  </span>
                </label>
                <input
                  id="create-user-email"
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
              <details className="rounded-xl border border-gray-200 bg-gray-50/60 p-4">
                <summary className="cursor-pointer text-sm font-medium text-gray-900">
                  {t('table.budget')}
                </summary>
                <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor="create-user-budget_max"
                      className="block text-sm font-medium text-gray-700 mb-1"
                    >
                      {t('fields.budgetMax')}{' '}
                      <span className="ml-1 text-xs font-normal text-gray-400">
                        {tCommon('optional')}
                      </span>
                    </label>
                    <input
                      id="create-user-budget_max"
                      type="number"
                      step="0.01"
                      value={createForm.budget_max}
                      onChange={(e) =>
                        setCreateForm({
                          ...createForm,
                          budget_max: e.target.value,
                        })
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-md bg-white text-sm"
                      placeholder={tCommon('noLimit')}
                    />
                    <p className="mt-1 text-xs text-gray-500">{t('help.budgetMax')}</p>
                  </div>
                  <div>
                    <label
                      htmlFor="create-user-budget_base"
                      className="block text-sm font-medium text-gray-700 mb-1"
                    >
                      {t('fields.budgetBase')}{' '}
                      <span className="ml-1 text-xs font-normal text-gray-400">
                        {tCommon('optional')}
                      </span>
                    </label>
                    <input
                      id="create-user-budget_base"
                      type="number"
                      step="0.01"
                      value={createForm.budget_base}
                      onChange={(e) =>
                        setCreateForm({
                          ...createForm,
                          budget_base: e.target.value,
                        })
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-md bg-white text-sm"
                      placeholder={tCommon('optional')}
                    />
                    <p className="mt-1 text-xs text-gray-500">{t('help.budgetBase')}</p>
                  </div>
                  <div>
                    <label
                      htmlFor="create-user-budget_period"
                      className="block text-sm font-medium text-gray-700 mb-1"
                    >
                      {t('fields.budgetPeriod')}{' '}
                      <span className="ml-1 text-xs font-normal text-gray-400">
                        {tCommon('optional')}
                      </span>
                    </label>
                    <select
                      id="create-user-budget_period"
                      value={createForm.budget_period}
                      onChange={(e) =>
                        setCreateForm({
                          ...createForm,
                          budget_period: e.target.value,
                        })
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-md bg-white text-sm"
                    >
                      <option value="none">{tOptions('budgetPeriod.none')}</option>
                      <option value="daily">{tOptions('budgetPeriod.daily')}</option>
                      <option value="weekly">{tOptions('budgetPeriod.weekly')}</option>
                      <option value="monthly">{tOptions('budgetPeriod.monthly')}</option>
                    </select>
                    <p className="mt-1 text-xs text-gray-500">{t('help.budgetPeriod')}</p>
                  </div>
                </div>
              </details>
              <details className="border-t border-gray-100 pt-4">
                <summary className="cursor-pointer text-sm font-medium text-gray-900">
                  {tCommon('metadata')}
                </summary>
                <label
                  htmlFor="create-user-metadata"
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  {t('fields.metadataJsonObject')}{' '}
                  <span className="ml-1 text-xs font-normal text-gray-400">
                    {tCommon('optional')}
                  </span>
                </label>
                <textarea
                  id="create-user-metadata"
                  value={createForm.metadata}
                  onChange={(e) => setCreateForm({ ...createForm, metadata: e.target.value })}
                  rows={4}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md font-mono text-xs"
                  placeholder="{}"
                />
              </details>

              <details className="pt-4 border-t border-gray-100">
                <summary className="text-sm font-medium text-gray-900">
                  {t('externalIdentity.title')}{' '}
                  <span className="ml-1 text-xs font-normal text-gray-400">
                    {tCommon('optional')}
                  </span>
                </summary>
                <p className="mt-1 text-xs text-gray-500">{t('externalIdentity.createHint')}</p>
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor="create-user-external_system"
                      className="block text-sm font-medium text-gray-700 mb-1"
                    >
                      {t('fields.externalSystem')}{' '}
                      <span className="ml-1 text-xs font-normal text-gray-400">
                        {tCommon('optional')}
                      </span>
                    </label>
                    <input
                      id="create-user-external_system"
                      type="text"
                      value={createForm.external_system}
                      onChange={(e) =>
                        setCreateForm({
                          ...createForm,
                          external_system: e.target.value,
                        })
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                      placeholder="my-app"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="create-user-external_user_id"
                      className="block text-sm font-medium text-gray-700 mb-1"
                    >
                      {t('fields.externalUserId')}{' '}
                      <span className="ml-1 text-xs font-normal text-gray-400">
                        {tCommon('optional')}
                      </span>
                    </label>
                    <input
                      id="create-user-external_user_id"
                      type="text"
                      value={createForm.external_user_id}
                      onChange={(e) =>
                        setCreateForm({
                          ...createForm,
                          external_user_id: e.target.value,
                        })
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                      placeholder={t('fields.externalUserId')}
                    />
                  </div>
                </div>
              </details>
            </fieldset>
            <div className="shrink-0 border-t border-gray-100 bg-gray-50 px-5 py-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="px-4 py-2 border rounded-md text-sm"
                disabled={isSaving}
              >
                {tCommon('cancel')}
              </button>
              <button
                type="button"
                onClick={submitCreate}
                disabled={isSaving}
                className="px-4 py-2 admin-primary rounded-md text-sm disabled:opacity-50"
              >
                {isSaving ? tCommon('saving') : tCommon('create')}
              </button>
            </div>
          </div>
        </div>
      )}

      {metadataViewUser &&
        (() => {
          const m = summarizeMetadata(metadataViewUser.metadata);
          return (
            <div className="fixed inset-0 bg-gray-950/40 flex items-center justify-center z-50 p-3 sm:p-6">
              <div
                ref={metadataRef}
                tabIndex={-1}
                role="dialog"
                aria-modal="true"
                aria-labelledby="user-metadata-title"
                className="flex max-h-[calc(100dvh-1.5rem)] sm:max-h-[calc(100dvh-3rem)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-panel outline-none"
              >
                <div className="px-6 py-4 border-b flex justify-between items-center">
                  <div className="min-w-0">
                    <h2 id="user-metadata-title" className="text-base font-medium text-gray-900">
                      {tCommon('metadata')}
                    </h2>
                    <p
                      className="mt-0.5 text-xs text-gray-500 font-mono truncate"
                      title={metadataViewUser.id}
                    >
                      {[metadataViewUser.email, metadataViewUser.id].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setMetadataViewUser(null)}
                    aria-label={tCommon('close')}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <XMarkIcon className="h-4 w-4" aria-hidden />
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
                    aria-label={tCommon('close')}
                    className="px-3 py-1.5 bg-gray-800 text-white rounded-md text-sm hover:bg-gray-900"
                  >
                    {tCommon('close')}
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

      {factorsViewUser &&
        (() => {
          const f = summarizeChargedCostFactors(factorsViewUser.charged_cost_factors);
          return (
            <div className="fixed inset-0 bg-gray-950/40 flex items-center justify-center z-50 p-3 sm:p-6">
              <div
                ref={factorsRef}
                tabIndex={-1}
                role="dialog"
                aria-modal="true"
                aria-labelledby="user-factors-title"
                className="flex max-h-[calc(100dvh-1.5rem)] sm:max-h-[calc(100dvh-3rem)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-panel outline-none"
              >
                <div className="px-6 py-4 border-b flex justify-between items-center">
                  <div className="min-w-0">
                    <h2 id="user-factors-title" className="text-base font-medium text-gray-900">
                      {t('fields.chargedCostFactors')}
                    </h2>
                    <p
                      className="mt-0.5 text-xs text-gray-500 font-mono truncate"
                      title={factorsViewUser.id}
                    >
                      {[factorsViewUser.email, factorsViewUser.id].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setFactorsViewUser(null)}
                    aria-label={tCommon('close')}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <XMarkIcon className="h-4 w-4" aria-hidden />
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
                    aria-label={tCommon('close')}
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
