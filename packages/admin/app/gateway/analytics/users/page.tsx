'use client';

/**
 * 用户（邮箱）用量分析：预算占用、成功率等；支持 CSV 导出。
 */
import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { AnalyticsRangeCostTotals } from '@/components/AnalyticsRangeCostTotals';
import { AnalyticsTokenCount } from '@/components/AnalyticsTokenCount';
import { AnalyticsTokenDisplayPicker } from '@/components/AnalyticsTokenDisplayPicker';
import { GatewayTimeRangePicker } from '@/components/GatewayTimeRangePicker';
import { readApiJson } from '@/lib/api-json';
import {
  compareAnalyticsTableRows,
  createRangeValue,
  sumAnalyticsCosts,
  type GatewayTimeRangeValue,
} from '@/lib/analytics-range';
import { formatGatewayDateTime } from '@/lib/datetime';
import { formatGatewayMoneyCode } from '@/lib/format-gateway-currency';
import type { TokenDisplayMode } from '@/lib/format-token-count';
import type { UserUsageRow } from '@/lib/types';
import { csvRowsToString, downloadCsvFile, filenameTimestamp } from '@/lib/csv';
import { useBillingCurrency } from '@/lib/use-billing-currency';

type SortKey = keyof UserUsageRow | '';
type SortDir = 'asc' | 'desc';

export default function UserUsagePage() {
  const t = useTranslations('analytics.userUsage');
  const tA = useTranslations('analytics');
  const tCommon = useTranslations('common');
  const [rows, setRows] = useState<UserUsageRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [rangeValue, setRangeValue] = useState<GatewayTimeRangeValue>(() => createRangeValue('1d'));
  const [committedQuery, setCommittedQuery] = useState(() => createRangeValue('1d'));
  const [sortKey, setSortKey] = useState<SortKey>('request_count');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [tokenDisplayMode, setTokenDisplayMode] = useState<TokenDisplayMode>('compact');
  const { currency: billingCurrency } = useBillingCurrency();

  useEffect(() => {
    const run = async () => {
      setIsLoading(true);
      try {
        const { start_date, end_date } = rangeValue;
        const params = new URLSearchParams({ start_date, end_date });
        const response = await fetch(`/api/admin/analytics/users?${params.toString()}`);
        const data = await readApiJson<UserUsageRow[]>(response);
        if (data.success) {
          setRows(data.data ?? []);
          setCommittedQuery(rangeValue);
        }
      } catch (e) {
        console.error('Fetch user usage error:', e);
      } finally {
        setIsLoading(false);
      }
    };
    run();
  }, [rangeValue]);

  const rangeTotals = useMemo(() => sumAnalyticsCosts(rows), [rows]);

  const sorted = useMemo(() => {
    if (!sortKey) return rows;
    return [...rows].sort((a, b) => compareAnalyticsTableRows(a, b, sortKey, sortDir));
  }, [rows, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const Th = ({ label, columnKey }: { label: string; columnKey: SortKey }) => (
    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
      <button type="button" onClick={() => toggleSort(columnKey)} className="hover:text-gray-700">
        {label} {sortKey === columnKey && (sortDir === 'asc' ? '↑' : '↓')}
      </button>
    </th>
  );

  const formatDate = (s: string | null) => formatGatewayDateTime(s);

  const exportCsv = () => {
    const { start_date, end_date } = committedQuery;
    const headers = [
      'user_email',
      'request_count',
      'input_tokens',
      'output_tokens',
      'standard_cost',
      'charged_cost',
      'metered_cost',
      'distinct_models',
      'last_active_at',
      'budget_max',
      'budget_spent',
      'budget_usage_rate_pct',
      'success_rate_pct',
      'error_count',
      'range_start_utc',
      'range_end_utc',
    ];
    const dataRows: string[][] = sorted.map((r) => [
      r.user_email,
      String(r.request_count),
      String(r.input_tokens),
      String(r.output_tokens),
      String(r.standard_cost ?? 0),
      String(r.charged_cost),
      String(r.metered_cost),
      String(r.distinct_models),
      r.last_active_at ?? '',
      r.budget_max != null ? String(r.budget_max) : '',
      String(r.budget_spent),
      r.budget_usage_rate != null ? String(r.budget_usage_rate) : '',
      String(r.success_rate),
      String(r.error_count),
      start_date,
      end_date,
    ]);
    const csv = csvRowsToString([headers, ...dataRows]);
    downloadCsvFile(`user-usage-${filenameTimestamp()}.csv`, csv);
  };

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">{t('title')}</h1>
        <p className="text-sm text-gray-500 mt-1">{t('subtitle')}</p>
      </div>
      <div className="mb-4 flex w-full min-w-0 flex-wrap items-end gap-x-4 gap-y-2">
        <GatewayTimeRangePicker value={rangeValue} onChange={setRangeValue} className="flex-1 min-w-0" />
        <AnalyticsTokenDisplayPicker value={tokenDisplayMode} onChange={setTokenDisplayMode} />
      </div>

      <div className="bg-white rounded-lg shadow-md overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 flex flex-wrap justify-between items-center gap-x-4 gap-y-2 text-sm">
          <button
            type="button"
            onClick={exportCsv}
            disabled={isLoading}
            className="px-3 py-1.5 border border-gray-300 rounded-md text-sm text-gray-800 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {tCommon('exportCsv')}
          </button>
          <AnalyticsRangeCostTotals isLoading={isLoading} totals={rangeTotals} billingCurrency={billingCurrency} />
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <Th label={tA('columns.userEmail')} columnKey="user_email" />
                <Th label={tA('columns.requests')} columnKey="request_count" />
                <Th label={tA('columns.inputTokens')} columnKey="input_tokens" />
                <Th label={tA('columns.outputTokens')} columnKey="output_tokens" />
                <Th label={tA('columns.std')} columnKey="standard_cost" />
                <Th label={tA('columns.charged')} columnKey="charged_cost" />
                <Th label={tA('columns.metered')} columnKey="metered_cost" />
                <Th label={tA('columns.models')} columnKey="distinct_models" />
                <Th label={tA('columns.lastActive')} columnKey="last_active_at" />
                <Th label={tA('columns.budgetUsage')} columnKey="budget_usage_rate" />
                <Th label={tA('columns.successRate')} columnKey="success_rate" />
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {sorted.map((r) => {
                const budgetHigh = r.budget_usage_rate != null && r.budget_usage_rate >= 80;
                const budgetCritical = r.budget_usage_rate != null && r.budget_usage_rate >= 100;
                const { start_date, end_date } = committedQuery;
                const logQuery = new URLSearchParams();
                logQuery.set('user_email', r.user_email);
                logQuery.set('start_date', start_date);
                logQuery.set('end_date', end_date);
                return (
                  <tr
                    key={r.user_email}
                    className={`hover:bg-gray-50 ${budgetCritical ? 'bg-red-50' : budgetHigh ? 'bg-yellow-50' : ''}`}
                  >
                    <td className="px-4 py-3 text-sm">
                      <Link
                        href={`/gateway/request-logs?${logQuery.toString()}`}
                        className="text-blue-600 hover:underline"
                      >
                        {r.user_email}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900">{r.request_count.toLocaleString()}</td>
                    <td className="px-4 py-3 text-sm"><AnalyticsTokenCount value={r.input_tokens} mode={tokenDisplayMode} /></td>
                    <td className="px-4 py-3 text-sm"><AnalyticsTokenCount value={r.output_tokens} mode={tokenDisplayMode} /></td>
                    <td className="px-4 py-3 text-sm text-gray-600 tabular-nums">
                      {formatGatewayMoneyCode(r.standard_cost ?? 0, billingCurrency, 4)}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 tabular-nums">
                      {formatGatewayMoneyCode(r.charged_cost, billingCurrency, 4)}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 tabular-nums">
                      {formatGatewayMoneyCode(r.metered_cost, billingCurrency, 4)}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">{r.distinct_models}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{formatDate(r.last_active_at)}</td>
                    <td className="px-4 py-3 text-sm">
                      {r.budget_usage_rate != null ? (
                        <span className={budgetCritical ? 'text-red-600 font-medium' : budgetHigh ? 'text-yellow-600' : 'text-gray-600'}>
                          {r.budget_usage_rate.toFixed(1)}%
                        </span>
                      ) : (
                        tCommon('noData')
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <span className={r.success_rate >= 95 ? 'text-green-600' : r.success_rate >= 80 ? 'text-yellow-600' : 'text-red-600'}>
                        {r.success_rate.toFixed(1)}%
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {sorted.length === 0 && !isLoading && <div className="text-center py-12 text-gray-500">{tA('noData')}</div>}
        {isLoading && <div className="text-center py-12 text-gray-500">{tCommon('loading')}</div>}
      </div>
    </div>
  );
}
