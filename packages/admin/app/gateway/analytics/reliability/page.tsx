'use client';

/**
 * 可靠性：按供应商 / 模型×供应商 矩阵与近期错误片段；聚合自 `api_key_request_logs`。
 */
import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { AnalyticsInsights, AnalyticsLoadError } from '@/components/AnalyticsInsights';
import { useAnalyticsRange } from '@/lib/use-analytics-range';
import { GatewayTimeRangePicker } from '@/components/GatewayTimeRangePicker';
import { useAnalyticsProviderKind } from '@/components/AnalyticsProviderKind';
import { ProviderAccountLines } from '@/components/ProviderAccountLines';
import { readApiJson } from '@/lib/api-json';
import { GATEWAY_TOOLS_PROVIDER_ID } from '@/lib/gateway-tools';
import { providerAccountIdentity } from '@/lib/provider-kind';
import type { GatewayProvider } from '@/lib/types';
import { formatLatencyMs } from '@/lib/format-latency';
import { successRateClassName } from '@/lib/analytics-rate-style';
import type { ProviderReliabilityRow, ModelProviderRow, GatewayRequestLog } from '@/lib/types';
import { useBillingCurrency } from '@/lib/use-billing-currency';
import { useGatewayDateTime } from '@/lib/use-gateway-datetime';

type ReliabilityPayload = {
  providers: ProviderReliabilityRow[];
  modelProviders: ModelProviderRow[];
  recentErrors: GatewayRequestLog[];
};

export default function ReliabilityPage() {
  const t = useTranslations('analytics.reliability');
  const tA = useTranslations('analytics');
  const tCommon = useTranslations('common');
  const tKind = useTranslations('providers.kind');
  const locale = useLocale();
  const [liveProviders, setLiveProviders] = useState<Map<string, GatewayProvider>>(new Map());
  const [providers, setProviders] = useState<ProviderReliabilityRow[]>([]);
  const [modelProviders, setModelProviders] = useState<ModelProviderRow[]>([]);
  const [recentErrors, setRecentErrors] = useState<GatewayRequestLog[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [rangeValue, setRangeValue] = useAnalyticsRange();
  const { currency: billingCurrency } = useBillingCurrency();
  const { formatDateTime } = useGatewayDateTime();



  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch('/api/admin/providers');
        const data = await readApiJson<GatewayProvider[]>(response);
        if (cancelled || !data.success || !Array.isArray(data.data)) return;
        setLiveProviders(new Map(data.data.map((provider) => [provider.id, provider])));
      } catch (e) {
        console.error('Fetch providers error:', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const providerKind = useAnalyticsProviderKind(liveProviders);

  const providerIdentity = (providerId: string | null | undefined, snapshotName: string | null | undefined) => {
    const id = providerId?.trim() ?? '';
    const live = id ? liveProviders.get(id) : undefined;
    return providerAccountIdentity(live, locale, tKind('custom'), snapshotName?.trim() || id || '—');
  };

  const deletedProviderBadge = (providerId: string | null | undefined) => {
    const id = providerId?.trim() ?? '';
    if (!id || id === GATEWAY_TOOLS_PROVIDER_ID || liveProviders.has(id)) return null;
    return tA('deletedProvider');
  };

  useEffect(() => {
    const controller = new AbortController();
    const run = async () => {
      setIsLoading(true);
      setLoadError(false);
      setProviders([]);
      setModelProviders([]);
      setRecentErrors([]);
      try {
        const { start_date, end_date } = rangeValue;
        const params = new URLSearchParams({ start_date, end_date });
        const response = await fetch(`/api/admin/analytics/reliability?${params}`, { signal: controller.signal });
        const data = await readApiJson<ReliabilityPayload>(response);
        if (controller.signal.aborted) return;
        if (!response.ok || !data.success || !data.data) throw new Error(data.message);
        setProviders([...data.data.providers].sort((a, b) => b.error_count - a.error_count || b.request_count - a.request_count));
        setModelProviders([...data.data.modelProviders].sort((a, b) => a.model_id.localeCompare(b.model_id) || a.success_rate - b.success_rate || b.request_count - a.request_count));
        setRecentErrors(data.data.recentErrors);
      } catch {
        if (!controller.signal.aborted) setLoadError(true);
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    };
    void run();
    return () => controller.abort();
  }, [rangeValue, refresh]);

  const errorLogHref = (providerId?: string) => {
    const params = new URLSearchParams({ start_date: rangeValue.start_date, end_date: rangeValue.end_date, status: 'error' });
    if (providerId) params.set('provider_id', providerId);
    return `/gateway/request-logs?${params}`;
  };

  const byModel = useMemo(() => {
    const map: Record<string, ModelProviderRow[]> = {};
    for (const r of modelProviders) {
      if (!map[r.model_id]) map[r.model_id] = [];
      map[r.model_id].push(r);
    }
    return map;
  }, [modelProviders]);

  const formatDate = (s: string) => formatDateTime(s);

  return (
    <div className="min-w-0 p-4 sm:p-6 lg:p-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">{t('title')}</h1>
        <p className="text-sm text-gray-500 mt-1">{t('subtitle')}</p>
      </div>
      <div className="mb-4 w-full min-w-0 rounded-xl border border-gray-200 bg-white p-3 sm:p-4">
        <GatewayTimeRangePicker value={rangeValue} onChange={setRangeValue} />
      </div>

      {loadError && <AnalyticsLoadError onRetry={() => setRefresh(n => n + 1)} />}
      {!isLoading && !loadError && <AnalyticsInsights rows={providers} currency={billingCurrency} scope="reliability" />}
      {/* Provider table */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">{t('providerQuality')}</h2>
        <div className="bg-white rounded-lg shadow-md overflow-hidden">
          <div className="overflow-x-auto">
            <table className="admin-data-table min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{tA('columns.providerKind')}</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{tA('columns.providerAccount')}</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{tA('columns.requests')}</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{tA('columns.successRate')}</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{tA('columns.errors')}</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{tA('columns.avgLatencyMs')}</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{tA('columns.avgUpstreamMs')}</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{tA('insights.failoverShare')}</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{tA('columns.avgAttempts')}</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {providers.map((p) => (
                  <tr key={p.provider_id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm whitespace-nowrap text-gray-600">{providerKind(p.provider_id).label}</td>
                    <td className="px-4 py-3 text-sm">
                      <ProviderAccountLines
                        identity={{ ...providerIdentity(p.provider_id, p.provider_name), kind: null }}
                        badge={deletedProviderBadge(p.provider_id)}
                      />
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">{p.request_count.toLocaleString()}</td>
                    <td className="px-4 py-3 text-sm">
                      <span className={successRateClassName(p.success_rate)}>
                        {p.success_rate.toFixed(1)}%
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm"><Link className="text-red-600 hover:underline" href={errorLogHref(p.provider_id)}>{p.error_count.toLocaleString()}</Link></td>
                    <td className="px-4 py-3 text-sm text-gray-600 tabular-nums">{p.avg_latency_ms != null ? formatLatencyMs(p.avg_latency_ms) : tCommon('noData')}</td>
                    <td className="px-4 py-3 text-sm text-gray-600 tabular-nums">{p.avg_upstream_response_ms != null ? formatLatencyMs(p.avg_upstream_response_ms) : tCommon('noData')}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{p.failover_request_rate != null ? `${p.failover_request_rate.toFixed(1)}%` : '—'}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{p.avg_attempts != null ? p.avg_attempts.toFixed(2) : tCommon('noData')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {providers.length === 0 && !isLoading && !loadError && <div className="text-center py-8 text-gray-500">{tA('noData')}</div>}
        </div>
      </div>

      {/* Model–provider breakdown */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">{t('perModelComparison')}</h2>
        <div className="bg-white rounded-lg shadow-md overflow-hidden">
          <div className="overflow-x-auto">
            <table className="admin-data-table min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{tA('columns.model')}</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{tA('columns.providerKind')}</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{tA('columns.providerAccount')}</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{tA('columns.requests')}</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{tA('columns.successRate')}</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{tA('columns.avgLatencyMs')}</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{tA('columns.avgUpstreamMs')}</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{tA('insights.failoverShare')}</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{tA('columns.avgAttempts')}</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {Object.entries(byModel).map(([modelId, list]) =>
                  list.map((r) => (
                    <tr key={`${r.model_id}-${r.provider_id}`} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">{modelId}</td>
                      <td className="px-4 py-3 text-sm whitespace-nowrap text-gray-600">{providerKind(r.provider_id).label}</td>
                      <td className="px-4 py-3 text-sm">
                        <ProviderAccountLines
                          identity={{ ...providerIdentity(r.provider_id, r.provider_name), kind: null }}
                          nameClassName="font-normal text-gray-700"
                          badge={deletedProviderBadge(r.provider_id)}
                        />
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">{r.request_count.toLocaleString()}</td>
                      <td className="px-4 py-3 text-sm">
                        <span className={successRateClassName(r.success_rate)}>
                          {r.success_rate.toFixed(1)}%
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600 tabular-nums">{r.avg_latency_ms != null ? formatLatencyMs(r.avg_latency_ms) : tCommon('noData')}</td>
                      <td className="px-4 py-3 text-sm text-gray-600 tabular-nums">{r.avg_upstream_response_ms != null ? formatLatencyMs(r.avg_upstream_response_ms) : tCommon('noData')}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{r.failover_request_rate != null ? `${r.failover_request_rate.toFixed(1)}%` : '—'}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{r.avg_attempts != null ? r.avg_attempts.toFixed(2) : tCommon('noData')}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {modelProviders.length === 0 && !isLoading && !loadError && <div className="text-center py-8 text-gray-500">{tA('noData')}</div>}
        </div>
      </div>

      {/* {tA('insights.rangeErrors')} */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-4 flex flex-wrap items-center justify-between gap-2">
          {tA('insights.rangeErrors')}
          <Link href={errorLogHref()} className="text-sm text-blue-600 hover:underline">{t('viewAllErrors')}</Link>
        </h2>
        <div className="bg-white rounded-lg shadow-md overflow-hidden">
          <div className="overflow-x-auto">
            <table className="admin-data-table min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{tCommon('time')}</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{tA('columns.model')}</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{tA('columns.providerKind')}</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{tA('columns.providerAccount')}</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{tA('columns.errors')}</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {recentErrors.map((log) => (
                  <tr key={log.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">{formatDate(log.created_at)}</td>
                    <td className="px-4 py-3 text-sm">
                      <div className="truncate text-gray-900">{log.model_id ?? '—'}</div>
                    </td>
                    <td className="px-4 py-3 text-sm whitespace-nowrap text-gray-600">{providerKind(log.provider_id).label}</td>
                    <td className="px-4 py-3 text-sm">
                      <ProviderAccountLines
                        identity={{ ...providerIdentity(log.provider_id, log.provider_name), kind: null }}
                        nameClassName="text-xs font-normal text-gray-500"
                        badge={deletedProviderBadge(log.provider_id)}
                      />
                    </td>
                    <td className="px-4 py-3 text-sm text-red-600 truncate max-w-xs" title={log.error_message ?? ''}>
                      {log.error_message || tCommon('unknownError')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {recentErrors.length === 0 && !isLoading && !loadError && <div className="text-center py-8 text-gray-500">{tCommon('noRecentErrors')}</div>}
        </div>
      </div>

      {isLoading && <div className="text-center py-4 text-gray-500">{tCommon('loading')}</div>}
    </div>
  );
}
