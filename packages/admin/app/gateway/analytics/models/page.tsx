'use client';

/**
 * 模型用量分析：时间范围、表格展示、支持 CSV 导出。
 */
import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { AnalyticsRangeCostTotals } from '@/components/AnalyticsRangeCostTotals';
import { GatewayTimeRangePicker } from '@/components/GatewayTimeRangePicker';
import { readJson } from '@/lib/api-json';
import {
  compareAnalyticsTableRows,
  createRangeValue,
  sumAnalyticsCosts,
  type GatewayTimeRangeValue,
} from '@/lib/analytics-range';
import { formatGatewayMoneyCode } from '@/lib/format-gateway-currency';
import type { ApiResponse, ModelUsageRow } from '@/lib/types';
import { csvRowsToString, downloadCsvFile, filenameTimestamp } from '@/lib/csv';
import { useBillingCurrency } from '@/lib/use-billing-currency';

type SortKey = keyof ModelUsageRow | '';
type SortDir = 'asc' | 'desc';

export default function ModelUsagePage() {
  const [rows, setRows] = useState<ModelUsageRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [rangeValue, setRangeValue] = useState<GatewayTimeRangeValue>(() => createRangeValue('1d'));
  const [committedQuery, setCommittedQuery] = useState(() => createRangeValue('1d'));
  const [sortKey, setSortKey] = useState<SortKey>('request_count');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const { currency: billingCurrency } = useBillingCurrency();

  useEffect(() => {
    const run = async () => {
      setIsLoading(true);
      try {
        const { start_date, end_date } = rangeValue;
        const params = new URLSearchParams({ start_date, end_date });
        const response = await fetch(`/api/admin/analytics/models?${params.toString()}`);
        const data = await readJson<ApiResponse<ModelUsageRow[]>>(response);
        if (data.success) {
          setRows(data.data ?? []);
          setCommittedQuery(rangeValue);
        }
      } catch (e) {
        console.error('Fetch model usage error:', e);
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
      'model_id',
      'route_group',
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
      r.model_id,
      r.route_group,
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
    downloadCsvFile(`model-usage-${filenameTimestamp()}.csv`, csv);
  };

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Model Usage</h1>
        <p className="text-sm text-gray-500 mt-1">Usage and cost by model and route group</p>
      </div>
      <div className="mb-4 w-full min-w-0">
        <GatewayTimeRangePicker value={rangeValue} onChange={setRangeValue} />
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
                <Th label="Model" columnKey="model_id" />
                <Th label="Route group" columnKey="route_group" />
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
                logQuery.set('model_id', r.model_id);
                logQuery.set('route_group', r.route_group);
                logQuery.set('start_date', start_date);
                logQuery.set('end_date', end_date);
                return (
                <tr
                  key={`${r.model_id}\t${r.route_group}`}
                  className="hover:bg-gray-50"
                >
                  <td className="px-4 py-3 text-sm">
                    <Link
                      href={`/gateway/request-logs?${logQuery.toString()}`}
                      className="text-blue-600 hover:underline"
                    >
                      {r.model_id}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-sm font-mono text-gray-700">{r.route_group}</td>
                  <td className="px-4 py-3 text-sm text-gray-900">{r.request_count.toLocaleString()}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{r.input_tokens.toLocaleString()}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{r.output_tokens.toLocaleString()}</td>
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
