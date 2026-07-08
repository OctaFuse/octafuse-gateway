'use client';

/**
 * 总览页：拉取 `/api/admin/stats`（`range`=1h|1d|7d|…），展示 KPI、近期日志与错误摘要。
 */
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import {
  GatewayTimeRangePicker,
  type GatewayDashboardStatsRange,
} from '@/components/GatewayTimeRangePicker';
import { createRangeValue } from '@/lib/analytics-range';
import { readApiJson } from '@/lib/api-json';
import { formatGatewayTime } from '@/lib/datetime';
import { formatGatewayMoneyCode } from '@/lib/format-gateway-currency';
import type { DashboardStats } from '@/lib/types';
import { useBillingCurrency } from '@/lib/use-billing-currency';

export default function DashboardPage() {
  const t = useTranslations('dashboard');
  const tBrand = useTranslations('brand');
  const tCommon = useTranslations('common');
  const tPricing = useTranslations('pricing');
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [range, setRange] = useState<GatewayDashboardStatsRange>('1d');
  const { currency: billingCurrency } = useBillingCurrency();

  useEffect(() => {
    fetchStats();
  }, [range]);

  const fetchStats = async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({ range });
      const response = await fetch(`/api/admin/stats?${params.toString()}`);
      const data = await readApiJson<DashboardStats>(response);
      if (data.success && data.data != null) {
        setStats(data.data);
      }
    } catch (error) {
      console.error('Fetch stats error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading && !stats) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-600">{tCommon('loading')}</div>
      </div>
    );
  }

  const kpi = stats?.kpi;
  const rangeLabel = t(`rangeLabels.${range}`);

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">{t('title')}</h1>
        <p className="text-sm text-gray-500 mt-1">{t('subtitle', { product: tBrand('product') })}</p>
      </div>
      <div className="mb-8 w-full min-w-0">
        <GatewayTimeRangePicker
          showCustom={false}
          value={createRangeValue(range)}
          onChange={(v) => setRange(v.preset as GatewayDashboardStatsRange)}
        />
      </div>

      {/* KPI (range-based) + Gateway Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="text-sm text-gray-500 mb-1">{t('activeApiKeys')}</div>
          <div className="text-3xl font-bold text-gray-900">{stats?.gateway.activeKeysCount ?? 0}</div>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm">
            <Link href="/gateway/users" className="text-blue-600 hover:underline">{t('usersLink')}</Link>
            <Link href="/gateway/keys" className="text-blue-600 hover:underline">{t('keysLink')}</Link>
          </div>
        </div>
        {kpi ? (
          <>
            <Link href="/gateway/analytics/models" className="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow">
              <div className="text-sm text-gray-500 mb-1">{t('requestsRange', { range: rangeLabel })}</div>
              <div className="text-3xl font-bold text-gray-900">{kpi.totalRequests.toLocaleString()}</div>
              <div className="text-sm text-blue-600 mt-2">{t('modelUsageLink')}</div>
            </Link>
            <Link href="/gateway/analytics/models" className="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow">
              <div className="text-sm text-gray-500 mb-1">{t('successRateRange', { range: rangeLabel })}</div>
              <div className={`text-3xl font-bold ${kpi.successRate >= 95 ? 'text-green-600' : kpi.successRate >= 80 ? 'text-yellow-600' : 'text-red-600'}`}>
                {kpi.successRate.toFixed(1)}%
              </div>
              <div className="text-sm text-blue-600 mt-2">{t('modelUsageLink')}</div>
            </Link>
            <Link href="/gateway/analytics/users" className="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow">
              <div className="text-sm text-gray-500 mb-1">{t('chargedActiveUsersRange', { range: rangeLabel })}</div>
              <div className="text-2xl font-bold text-gray-900">
                {formatGatewayMoneyCode(kpi.totalCost, billingCurrency, 4)}
              </div>
              <div className="text-xs text-gray-500">
                {tPricing('stdMetered', {
                  std: formatGatewayMoneyCode(kpi.standardCost ?? 0, billingCurrency, 4),
                  metered: formatGatewayMoneyCode(kpi.meteredCost ?? 0, billingCurrency, 4),
                })}
              </div>
              <div className="text-sm text-gray-500">{kpi.activeUsers} users</div>
              <div className="text-sm text-blue-600 mt-2">{t('userUsageLink')}</div>
            </Link>
          </>
        ) : (
          <>
            <div className="bg-white rounded-lg shadow-md p-6">
              <div className="text-sm text-gray-500 mb-1">{t('todayRequests')}</div>
              <div className="text-3xl font-bold text-gray-900">{stats?.gateway.todayRequestsCount ?? 0}</div>
              <div className="text-sm text-gray-500 mt-1">
                {tPricing('cost', { amount: formatGatewayMoneyCode(stats?.gateway.todayCost ?? 0, billingCurrency, 4) })}
              </div>
            </div>
            <div className="bg-white rounded-lg shadow-md p-6">
              <div className="text-sm text-gray-500 mb-1">{t('todayErrorRate')}</div>
              <div className={`text-3xl font-bold ${(stats?.gateway.errorRate ?? 0) > 5 ? 'text-red-600' : 'text-green-600'}`}>
                {(stats?.gateway.errorRate ?? 0).toFixed(2)}%
              </div>
            </div>
          </>
        )}
      </div>

      {/* Today + Error Rate (keep for quick glance) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="text-sm text-gray-500 mb-1">{t('todayRequests')}</div>
          <div className="text-2xl font-bold text-gray-900">{stats?.gateway.todayRequestsCount ?? 0}</div>
          <div className="text-sm text-gray-500 mt-1">
            {tPricing('cost', { amount: formatGatewayMoneyCode(stats?.gateway.todayCost ?? 0, billingCurrency, 4) })}
          </div>
        </div>
        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-gray-500 mb-1">{t('errorRateRange', { range: rangeLabel })}</div>
              <div className={`text-2xl font-bold ${(kpi?.errorRate ?? stats?.gateway.errorRate ?? 0) > 5 ? 'text-red-600' : 'text-green-600'}`}>
                {(kpi?.errorRate ?? stats?.gateway.errorRate ?? 0).toFixed(2)}%
              </div>
            </div>
            <Link href="/gateway/request-logs?status=error" className="text-sm text-blue-600 hover:underline">{t('viewErrorLogs')}</Link>
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
            <Link href="/gateway/analytics/providers" className="text-sm text-blue-600 hover:underline">{t('providerUsageLink')}</Link>
            <Link href="/gateway/analytics/reliability" className="text-sm text-blue-600 hover:underline">{t('reliabilityLink')}</Link>
          </div>
        </div>
      </div>

      {/* Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Logs */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">{t('recentRequests')}</h2>
          {stats?.recentLogs && stats.recentLogs.length > 0 ? (
            <div className="space-y-3">
              {stats.recentLogs.map((log) => (
                <div key={log.id} className="flex items-center justify-between text-sm border-b pb-2">
                  <div>
                    <div>
                      <span className="font-medium text-gray-900">{log.model_id || tCommon('unknown')}</span>
                      <span className={`ml-2 px-2 py-0.5 rounded text-xs ${log.status === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                        {log.status}
                      </span>
                    </div>
                    {log.provider_id && <div className="text-xs text-gray-500 mt-0.5">{tPricing('providerLabel', { id: log.provider_id })}</div>}
                  </div>
                  <div className="text-gray-500">
                    {formatGatewayTime(log.created_at)}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-gray-500 text-sm">{tCommon('noRecentRequests')}</div>
          )}
          <Link href="/gateway/request-logs" className="text-sm text-blue-600 hover:underline mt-4 inline-block">{tCommon('viewAll')}</Link>
        </div>

        {/* Recent Errors */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">{t('recentErrors')}</h2>
          {stats?.recentErrors && stats.recentErrors.length > 0 ? (
            <div className="space-y-3">
              {stats.recentErrors.map((log) => (
                <div key={log.id} className="flex items-center justify-between text-sm border-b pb-2">
                  <div className="truncate flex-1">
                    <div>
                      <span className="font-medium text-gray-900">{log.model_id || tCommon('unknown')}</span>
                      <span className="ml-2 text-red-600 text-xs truncate">{log.error_message || tCommon('unknownError')}</span>
                    </div>
                    {log.provider_id && <div className="text-xs text-gray-500 mt-0.5">{tPricing('providerLabel', { id: log.provider_id })}</div>}
                  </div>
                  <div className="text-gray-500 ml-2">
                    {formatGatewayTime(log.created_at)}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-gray-500 text-sm">{tCommon('noRecentErrors')}</div>
          )}
        </div>
      </div>
    </div>
  );
}
