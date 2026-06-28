'use client';

/**
 * 供应商用量分析：时间范围、表格展示、支持 CSV 导出。
 */
import { Fragment, useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { AnalyticsRangeCostTotals } from '@/components/AnalyticsRangeCostTotals';
import { AnalyticsTokenCount } from '@/components/AnalyticsTokenCount';
import { AnalyticsTokenDisplayPicker } from '@/components/AnalyticsTokenDisplayPicker';
import { GatewayTimeRangePicker } from '@/components/GatewayTimeRangePicker';
import { readJson } from '@/lib/api-json';
import {
  compareAnalyticsTableRows,
  createRangeValue,
  sumAnalyticsCosts,
  type GatewayTimeRangeValue,
} from '@/lib/analytics-range';
import { formatGatewayMoneyCode } from '@/lib/format-gateway-currency';
import type { TokenDisplayMode } from '@/lib/format-token-count';
import type { ApiResponse, ModelUsageRow, ProviderUsageRow } from '@/lib/types';
import { csvRowsToString, downloadCsvFile, filenameTimestamp } from '@/lib/csv';
import { useBillingCurrency } from '@/lib/use-billing-currency';

type SortKey = keyof ProviderUsageRow | '';
type SortDir = 'asc' | 'desc';

export default function ProviderUsagePage() {
  const [rows, setRows] = useState<ProviderUsageRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [rangeValue, setRangeValue] = useState<GatewayTimeRangeValue>(() => createRangeValue('1d'));
  const [committedQuery, setCommittedQuery] = useState(() => createRangeValue('1d'));
  const [sortKey, setSortKey] = useState<SortKey>('provider_name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [tokenDisplayMode, setTokenDisplayMode] = useState<TokenDisplayMode>('compact');
  const [expandedProviderId, setExpandedProviderId] = useState<string | null>(null);
  const [modelRowsByProvider, setModelRowsByProvider] = useState<Record<string, ModelUsageRow[]>>({});
  const [modelRowsLoading, setModelRowsLoading] = useState<Record<string, boolean>>({});
  const { currency: billingCurrency } = useBillingCurrency();

  useEffect(() => {
    const run = async () => {
      setIsLoading(true);
      try {
        const { start_date, end_date } = rangeValue;
        const params = new URLSearchParams({ start_date, end_date });
        const response = await fetch(`/api/admin/analytics/providers?${params.toString()}`);
        const data = await readJson<ApiResponse<ProviderUsageRow[]>>(response);
        if (data.success) {
          setRows(data.data ?? []);
          setCommittedQuery(rangeValue);
          setExpandedProviderId(null);
          setModelRowsByProvider({});
          setModelRowsLoading({});
        }
      } catch (e) {
        console.error('Fetch provider usage error:', e);
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

  const toggleProviderModels = async (providerId: string) => {
    if (expandedProviderId === providerId) {
      setExpandedProviderId(null);
      return;
    }

    setExpandedProviderId(providerId);
    if (modelRowsByProvider[providerId] || modelRowsLoading[providerId]) return;

    setModelRowsLoading((prev) => ({ ...prev, [providerId]: true }));
    try {
      const { start_date, end_date } = committedQuery;
      const params = new URLSearchParams({ start_date, end_date, provider_id: providerId });
      const response = await fetch(`/api/admin/analytics/models?${params.toString()}`);
      const data = await readJson<ApiResponse<ModelUsageRow[]>>(response);
      if (data.success) {
        setModelRowsByProvider((prev) => ({ ...prev, [providerId]: data.data ?? [] }));
      }
    } catch (e) {
      console.error('Fetch provider model usage error:', e);
      setModelRowsByProvider((prev) => ({ ...prev, [providerId]: [] }));
    } finally {
      setModelRowsLoading((prev) => ({ ...prev, [providerId]: false }));
    }
  };

  const Th = ({ label, columnKey }: { label: string; columnKey: SortKey }) => (
    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
      <button
        type="button"
        onClick={() => toggleSort(columnKey)}
        className="hover:text-gray-700"
      >
        {label} {sortKey === columnKey && (sortDir === 'asc' ? '↑' : '↓')}
      </button>
    </th>
  );

  const exportCsv = () => {
    const { start_date, end_date } = committedQuery;
    const headers = [
      'provider_id',
      'provider_name',
      'request_count',
      'input_tokens',
      'output_tokens',
      'standard_cost',
      'charged_cost',
      'metered_cost',
      'success_count',
      'error_count',
      'success_rate',
      'avg_latency_ms',
      'avg_charged_per_request',
      'range_start_utc',
      'range_end_utc',
    ];
    const dataRows: string[][] = sorted.map((r) => [
      r.provider_id,
      r.provider_name ?? '',
      String(r.request_count),
      String(r.input_tokens),
      String(r.output_tokens),
      String(r.standard_cost ?? 0),
      String(r.charged_cost),
      String(r.metered_cost),
      String(r.success_count),
      String(r.error_count),
      String(r.success_rate),
      r.avg_latency_ms != null ? String(r.avg_latency_ms) : '',
      String(r.avg_charged_per_request),
      start_date,
      end_date,
    ]);
    const csv = csvRowsToString([headers, ...dataRows]);
    downloadCsvFile(`provider-usage-${filenameTimestamp()}.csv`, csv);
  };

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Provider Usage</h1>
        <p className="text-sm text-gray-500 mt-1">Usage and cost by upstream provider</p>
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
            Export CSV
          </button>
          <AnalyticsRangeCostTotals isLoading={isLoading} totals={rangeTotals} billingCurrency={billingCurrency} />
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <Th label="Provider Name" columnKey="provider_name" />
                <Th label="Requests" columnKey="request_count" />
                <Th label="Input tokens" columnKey="input_tokens" />
                <Th label="Output tokens" columnKey="output_tokens" />
                <Th label="Std" columnKey="standard_cost" />
                <Th label="Charged" columnKey="charged_cost" />
                <Th label="Metered" columnKey="metered_cost" />
                <Th label="Avg charged/req" columnKey="avg_charged_per_request" />
                <Th label="Success rate" columnKey="success_rate" />
                <Th label="Avg latency (ms)" columnKey="avg_latency_ms" />
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {sorted.map((r) => {
                const { start_date, end_date } = committedQuery;
                const logQuery = new URLSearchParams();
                logQuery.set('provider_id', r.provider_id);
                logQuery.set('start_date', start_date);
                logQuery.set('end_date', end_date);
                const isExpanded = expandedProviderId === r.provider_id;
                const modelRows = modelRowsByProvider[r.provider_id] ?? [];
                const isModelRowsLoading = modelRowsLoading[r.provider_id] === true;
                return (
                  <Fragment key={r.provider_id}>
                    <tr
                      className={`cursor-pointer hover:bg-gray-50 ${isExpanded ? 'bg-blue-50/40' : ''}`}
                      onClick={() => void toggleProviderModels(r.provider_id)}
                    >
                      <td className="px-4 py-3 text-sm">
                        <button
                          type="button"
                          className="inline-flex items-center gap-2 text-left font-medium text-blue-600 hover:text-blue-800"
                          aria-expanded={isExpanded}
                        >
                          <span className="w-4 text-gray-400">{isExpanded ? '▾' : '▸'}</span>
                          <span>{r.provider_name ?? r.provider_id}</span>
                        </button>
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
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {formatGatewayMoneyCode(r.avg_charged_per_request, billingCurrency, 6)}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <span className={r.success_rate >= 95 ? 'text-green-600' : r.success_rate >= 80 ? 'text-yellow-600' : 'text-red-600'}>
                          {r.success_rate.toFixed(1)}%
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">{r.avg_latency_ms != null ? Math.round(r.avg_latency_ms) : '—'}</td>
                    </tr>
                    {isExpanded ? (
                      <tr key={`${r.provider_id}:models`} className="bg-blue-50/60">
                        <td colSpan={10} className="border-l-4 border-blue-300 px-5 py-4">
                          {isModelRowsLoading ? (
                            <div className="py-4 text-sm text-gray-500">Loading model usage...</div>
                          ) : modelRows.length === 0 ? (
                            <div className="py-4 text-sm text-gray-500">No model usage for this provider in the selected range.</div>
                          ) : (
                            <div className="overflow-hidden rounded-lg border border-blue-200 bg-white shadow-sm ring-1 ring-blue-100">
                              <table className="min-w-full divide-y divide-gray-200">
                                <thead className="bg-gray-50">
                                  <tr>
                                    <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Model</th>
                                    <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Route group</th>
                                    <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Requests</th>
                                    <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Input tokens</th>
                                    <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Output tokens</th>
                                    <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Std</th>
                                    <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Charged</th>
                                    <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Metered</th>
                                    <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Avg charged/req</th>
                                    <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Success rate</th>
                                    <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Avg latency (ms)</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                  {modelRows.map((modelRow) => {
                                    const modelLogQuery = new URLSearchParams(logQuery);
                                    modelLogQuery.set('model_id', modelRow.model_id);
                                    modelLogQuery.set('route_group', modelRow.route_group);
                                    return (
                                      <tr key={`${r.provider_id}\t${modelRow.model_id}\t${modelRow.route_group}`} className="hover:bg-gray-50">
                                        <td className="px-3 py-2 text-sm">
                                          <Link
                                            href={`/gateway/request-logs?${modelLogQuery.toString()}`}
                                            className="text-blue-600 hover:underline"
                                            onClick={(event) => event.stopPropagation()}
                                          >
                                            {modelRow.model_id}
                                          </Link>
                                        </td>
                                        <td className="px-3 py-2 text-sm font-mono text-gray-700">{modelRow.route_group}</td>
                                        <td className="px-3 py-2 text-sm text-gray-900">{modelRow.request_count.toLocaleString()}</td>
                                        <td className="px-3 py-2 text-sm"><AnalyticsTokenCount value={modelRow.input_tokens} mode={tokenDisplayMode} /></td>
                                        <td className="px-3 py-2 text-sm"><AnalyticsTokenCount value={modelRow.output_tokens} mode={tokenDisplayMode} /></td>
                                        <td className="px-3 py-2 text-sm text-gray-600 tabular-nums">
                                          {formatGatewayMoneyCode(modelRow.standard_cost ?? 0, billingCurrency, 4)}
                                        </td>
                                        <td className="px-3 py-2 text-sm text-gray-600 tabular-nums">
                                          {formatGatewayMoneyCode(modelRow.charged_cost, billingCurrency, 4)}
                                        </td>
                                        <td className="px-3 py-2 text-sm text-gray-600 tabular-nums">
                                          {formatGatewayMoneyCode(modelRow.metered_cost, billingCurrency, 4)}
                                        </td>
                                        <td className="px-3 py-2 text-sm text-gray-600">
                                          {formatGatewayMoneyCode(modelRow.avg_charged_per_request, billingCurrency, 6)}
                                        </td>
                                        <td className="px-3 py-2 text-sm">
                                          <span className={modelRow.success_rate >= 95 ? 'text-green-600' : modelRow.success_rate >= 80 ? 'text-yellow-600' : 'text-red-600'}>
                                            {modelRow.success_rate.toFixed(1)}%
                                          </span>
                                        </td>
                                        <td className="px-3 py-2 text-sm text-gray-600">
                                          {modelRow.avg_latency_ms != null ? Math.round(modelRow.avg_latency_ms) : '—'}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
              );
              })}
            </tbody>
          </table>
        </div>
        {sorted.length === 0 && !isLoading && <div className="text-center py-12 text-gray-500">No data</div>}
        {isLoading && <div className="text-center py-12 text-gray-500">Loading...</div>}
      </div>
    </div>
  );
}
