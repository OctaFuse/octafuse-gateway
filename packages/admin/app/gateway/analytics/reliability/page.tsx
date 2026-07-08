'use client';

/**
 * 可靠性：按供应商 / 模型×供应商 矩阵与近期错误片段；聚合自 `api_key_request_logs`。
 */
import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { GatewayTimeRangePicker } from '@/components/GatewayTimeRangePicker';
import { readApiJson } from '@/lib/api-json';
import { createRangeValue, type GatewayTimeRangeValue } from '@/lib/analytics-range';
import { formatGatewayDateTime } from '@/lib/datetime';
import { formatGatewayMoneyCode } from '@/lib/format-gateway-currency';
import type { ProviderReliabilityRow, ModelProviderRow, GatewayRequestLog } from '@/lib/types';
import { useBillingCurrency } from '@/lib/use-billing-currency';

type ReliabilityPayload = {
  providers: ProviderReliabilityRow[];
  modelProviders: ModelProviderRow[];
  recentErrors: GatewayRequestLog[];
};

export default function ReliabilityPage() {
  const t = useTranslations('analytics.reliability');
  const tA = useTranslations('analytics');
  const tCommon = useTranslations('common');
  const [providers, setProviders] = useState<ProviderReliabilityRow[]>([]);
  const [modelProviders, setModelProviders] = useState<ModelProviderRow[]>([]);
  const [recentErrors, setRecentErrors] = useState<GatewayRequestLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [rangeValue, setRangeValue] = useState<GatewayTimeRangeValue>(() => createRangeValue('1d'));
  const { currency: billingCurrency } = useBillingCurrency();

  useEffect(() => {
    fetchData();
  }, [rangeValue]);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const { start_date, end_date } = rangeValue;
      const params = new URLSearchParams({ start_date, end_date });
      const response = await fetch(`/api/admin/analytics/reliability?${params.toString()}`);
      const data = await readApiJson<ReliabilityPayload>(response);
      if (data.success && data.data) {
        setProviders(data.data.providers ?? []);
        setModelProviders(data.data.modelProviders ?? []);
        setRecentErrors(data.data.recentErrors ?? []);
      }
    } catch (e) {
      console.error('Fetch reliability error:', e);
    } finally {
      setIsLoading(false);
    }
  };

  const byModel = useMemo(() => {
    const map: Record<string, ModelProviderRow[]> = {};
    for (const r of modelProviders) {
      if (!map[r.model_id]) map[r.model_id] = [];
      map[r.model_id].push(r);
    }
    return map;
  }, [modelProviders]);

  const formatDate = (s: string) => formatGatewayDateTime(s);

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">{t('title')}</h1>
        <p className="text-sm text-gray-500 mt-1">{t('subtitle')}</p>
      </div>
      <div className="mb-4 w-full min-w-0">
        <GatewayTimeRangePicker value={rangeValue} onChange={setRangeValue} />
      </div>

      {/* Provider table */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">{t('providerQuality')}</h2>
        <div className="bg-white rounded-lg shadow-md overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{tA('columns.provider')}</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{tA('columns.requests')}</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{tA('columns.successRate')}</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{tA('columns.errors')}</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{tA('columns.avgLatencyMs')}</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{tA('columns.std')}</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{tA('columns.charged')}</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{tA('columns.metered')}</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {providers.map((p) => (
                  <tr key={p.provider_id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{p.provider_name ?? p.provider_id}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{p.request_count.toLocaleString()}</td>
                    <td className="px-4 py-3 text-sm">
                      <span className={p.success_rate >= 95 ? 'text-green-600' : p.success_rate >= 80 ? 'text-yellow-600' : 'text-red-600'}>
                        {p.success_rate.toFixed(1)}%
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">{p.error_count}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{p.avg_latency_ms != null ? Math.round(p.avg_latency_ms) : tCommon('noData')}</td>
                    <td className="px-4 py-3 text-sm text-gray-600 tabular-nums">
                      {formatGatewayMoneyCode(p.standard_cost ?? 0, billingCurrency, 4)}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 tabular-nums">
                      {formatGatewayMoneyCode(p.charged_cost, billingCurrency, 4)}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 tabular-nums">
                      {formatGatewayMoneyCode(p.metered_cost, billingCurrency, 4)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {providers.length === 0 && !isLoading && <div className="text-center py-8 text-gray-500">{tA('noData')}</div>}
        </div>
      </div>

      {/* Model–provider breakdown */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">{t('perModelComparison')}</h2>
        <div className="bg-white rounded-lg shadow-md overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{tA('columns.model')}</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{tA('columns.provider')}</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{tA('columns.requests')}</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{tA('columns.successRate')}</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{tA('columns.avgLatencyMs')}</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{tA('columns.std')}</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{tA('columns.charged')}</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{tA('columns.metered')}</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {Object.entries(byModel).map(([modelId, list]) =>
                  list.map((r) => (
                    <tr key={`${r.model_id}-${r.provider_id}`} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">{modelId}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{r.provider_name ?? r.provider_id}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{r.request_count.toLocaleString()}</td>
                      <td className="px-4 py-3 text-sm">
                        <span className={r.success_rate >= 95 ? 'text-green-600' : r.success_rate >= 80 ? 'text-yellow-600' : 'text-red-600'}>
                          {r.success_rate.toFixed(1)}%
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">{r.avg_latency_ms != null ? Math.round(r.avg_latency_ms) : tCommon('noData')}</td>
                      <td className="px-4 py-3 text-sm text-gray-600 tabular-nums">
                        {formatGatewayMoneyCode(r.standard_cost ?? 0, billingCurrency, 4)}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600 tabular-nums">
                        {formatGatewayMoneyCode(r.charged_cost, billingCurrency, 4)}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600 tabular-nums">
                        {formatGatewayMoneyCode(r.metered_cost, billingCurrency, 4)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {modelProviders.length === 0 && !isLoading && <div className="text-center py-8 text-gray-500">{tA('noData')}</div>}
        </div>
      </div>

      {/* {t('recentErrors')} */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center justify-between">
          {t('recentErrors')}
          <Link href="/gateway/request-logs?status=error" className="text-sm text-blue-600 hover:underline">{t('viewAllErrors')}</Link>
        </h2>
        <div className="bg-white rounded-lg shadow-md overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{tCommon('time')}</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{tA('columns.modelProvider')}</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{tA('columns.errors')}</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {recentErrors.map((log) => (
                  <tr key={log.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">{formatDate(log.created_at)}</td>
                    <td className="px-4 py-3 text-sm">
                      <div className="text-gray-900">{log.model_id ?? '—'}</div>
                      <div className="text-xs text-gray-500">{log.provider_name ?? log.provider_id ?? '—'}</div>
                    </td>
                    <td className="px-4 py-3 text-sm text-red-600 truncate max-w-xs" title={log.error_message ?? ''}>
                      {log.error_message || tCommon('unknownError')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {recentErrors.length === 0 && !isLoading && <div className="text-center py-8 text-gray-500">{tCommon('noRecentErrors')}</div>}
        </div>
      </div>

      {isLoading && <div className="text-center py-4 text-gray-500">{tCommon('loading')}</div>}
    </div>
  );
}
