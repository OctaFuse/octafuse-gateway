'use client';

/**
 * 总览页：拉取 `/api/admin/stats`（`range`=1h|1d|7d|…），展示 KPI、近期日志与错误摘要。
 */
import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  GatewayTimeRangePicker,
  type GatewayDashboardStatsRange,
} from '@/components/GatewayTimeRangePicker';
import { createRangeValue } from '@/lib/analytics-range';
import { readApiJson } from '@/lib/api-json';
import { OCTAFUSE_GATEWAY_PRODUCT } from '@/lib/brand';
import { formatGatewayTime } from '@/lib/datetime';
import { formatGatewayMoneyCode } from '@/lib/format-gateway-currency';
import type { DashboardStats } from '@/lib/types';
import { useBillingCurrency } from '@/lib/use-billing-currency';

const RANGE_LABEL: Record<GatewayDashboardStatsRange, string> = {
  '1h': 'Last 1h',
  '1d': 'Last 1d',
  '7d': 'Last 7 days',
  '14d': 'Last 14 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
};

export default function DashboardPage() {
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
        <div className="text-gray-600">Loading...</div>
      </div>
    );
  }

  const kpi = stats?.kpi;
  const rangeLabel = RANGE_LABEL[range];

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500 mt-1">{OCTAFUSE_GATEWAY_PRODUCT} — operations overview</p>
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
          <div className="text-sm text-gray-500 mb-1">Active API Keys</div>
          <div className="text-3xl font-bold text-gray-900">{stats?.gateway.activeKeysCount ?? 0}</div>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm">
            <Link href="/gateway/users" className="text-blue-600 hover:underline">Users</Link>
            <Link href="/gateway/keys" className="text-blue-600 hover:underline">Keys</Link>
          </div>
        </div>
        {kpi ? (
          <>
            <Link href="/gateway/analytics/models" className="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow">
              <div className="text-sm text-gray-500 mb-1">Requests ({rangeLabel})</div>
              <div className="text-3xl font-bold text-gray-900">{kpi.totalRequests.toLocaleString()}</div>
              <div className="text-sm text-blue-600 mt-2">Model Usage →</div>
            </Link>
            <Link href="/gateway/analytics/models" className="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow">
              <div className="text-sm text-gray-500 mb-1">Success Rate ({rangeLabel})</div>
              <div className={`text-3xl font-bold ${kpi.successRate >= 95 ? 'text-green-600' : kpi.successRate >= 80 ? 'text-yellow-600' : 'text-red-600'}`}>
                {kpi.successRate.toFixed(1)}%
              </div>
              <div className="text-sm text-blue-600 mt-2">Model Usage →</div>
            </Link>
            <Link href="/gateway/analytics/users" className="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow">
              <div className="text-sm text-gray-500 mb-1">Charged / Active Users ({rangeLabel})</div>
              <div className="text-2xl font-bold text-gray-900">
                {formatGatewayMoneyCode(kpi.totalCost, billingCurrency, 4)}
              </div>
              <div className="text-xs text-gray-500">
                Std {formatGatewayMoneyCode(kpi.standardCost ?? 0, billingCurrency, 4)} · Metered{' '}
                {formatGatewayMoneyCode(kpi.meteredCost ?? 0, billingCurrency, 4)}
              </div>
              <div className="text-sm text-gray-500">{kpi.activeUsers} users</div>
              <div className="text-sm text-blue-600 mt-2">User Usage →</div>
            </Link>
          </>
        ) : (
          <>
            <div className="bg-white rounded-lg shadow-md p-6">
              <div className="text-sm text-gray-500 mb-1">Today&apos;s Requests</div>
              <div className="text-3xl font-bold text-gray-900">{stats?.gateway.todayRequestsCount ?? 0}</div>
              <div className="text-sm text-gray-500 mt-1">
                Cost: {formatGatewayMoneyCode(stats?.gateway.todayCost ?? 0, billingCurrency, 4)}
              </div>
            </div>
            <div className="bg-white rounded-lg shadow-md p-6">
              <div className="text-sm text-gray-500 mb-1">Today&apos;s Error Rate</div>
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
          <div className="text-sm text-gray-500 mb-1">Today&apos;s Requests</div>
          <div className="text-2xl font-bold text-gray-900">{stats?.gateway.todayRequestsCount ?? 0}</div>
          <div className="text-sm text-gray-500 mt-1">
            Cost: {formatGatewayMoneyCode(stats?.gateway.todayCost ?? 0, billingCurrency, 4)}
          </div>
        </div>
        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-gray-500 mb-1">Error Rate ({rangeLabel})</div>
              <div className={`text-2xl font-bold ${(kpi?.errorRate ?? stats?.gateway.errorRate ?? 0) > 5 ? 'text-red-600' : 'text-green-600'}`}>
                {(kpi?.errorRate ?? stats?.gateway.errorRate ?? 0).toFixed(2)}%
              </div>
            </div>
            <Link href="/gateway/request-logs?status=error" className="text-sm text-blue-600 hover:underline">View Error Logs</Link>
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
            <Link href="/gateway/analytics/providers" className="text-sm text-blue-600 hover:underline">Provider Usage →</Link>
            <Link href="/gateway/analytics/reliability" className="text-sm text-blue-600 hover:underline">Reliability →</Link>
          </div>
        </div>
      </div>

      {/* Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Logs */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Recent Requests</h2>
          {stats?.recentLogs && stats.recentLogs.length > 0 ? (
            <div className="space-y-3">
              {stats.recentLogs.map((log) => (
                <div key={log.id} className="flex items-center justify-between text-sm border-b pb-2">
                  <div>
                    <div>
                      <span className="font-medium text-gray-900">{log.model_id || 'Unknown'}</span>
                      <span className={`ml-2 px-2 py-0.5 rounded text-xs ${log.status === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                        {log.status}
                      </span>
                    </div>
                    {log.provider_id && <div className="text-xs text-gray-500 mt-0.5">Provider: {log.provider_id}</div>}
                  </div>
                  <div className="text-gray-500">
                    {formatGatewayTime(log.created_at)}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-gray-500 text-sm">No recent requests</div>
          )}
          <Link href="/gateway/request-logs" className="text-sm text-blue-600 hover:underline mt-4 inline-block">View All Logs</Link>
        </div>

        {/* Recent Errors */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Recent Errors</h2>
          {stats?.recentErrors && stats.recentErrors.length > 0 ? (
            <div className="space-y-3">
              {stats.recentErrors.map((log) => (
                <div key={log.id} className="flex items-center justify-between text-sm border-b pb-2">
                  <div className="truncate flex-1">
                    <div>
                      <span className="font-medium text-gray-900">{log.model_id || 'Unknown'}</span>
                      <span className="ml-2 text-red-600 text-xs truncate">{log.error_message || 'Unknown error'}</span>
                    </div>
                    {log.provider_id && <div className="text-xs text-gray-500 mt-0.5">Provider: {log.provider_id}</div>}
                  </div>
                  <div className="text-gray-500 ml-2">
                    {formatGatewayTime(log.created_at)}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-gray-500 text-sm">No recent errors</div>
          )}
        </div>
      </div>
    </div>
  );
}
