import type { GatewayTimeRangeValue } from '@/lib/analytics-range';

/** The log page defaults to today: always carry the originating time window. */
export function dashboardLogsHref(range: Pick<GatewayTimeRangeValue, 'start_date' | 'end_date'>, filters: Record<string, string> = {}): string {
  const query = new URLSearchParams({ start_date: range.start_date, end_date: range.end_date, ...filters });
  return `/gateway/request-logs?${query}`;
}

/** A request ID is exact. Explicit empty bounds prevent the log page's default today filter from hiding older records. */
export function dashboardLogHref(log: { id: string; created_at?: string }): string {
  return `/gateway/request-logs?${new URLSearchParams({ id: log.id, start_date: '', end_date: '' })}`;
}

/** Recent activity is global; an explicit unbounded range must not become today's log filter. */
export function dashboardActivityLogsHref(view: 'recent' | 'errors'): string {
  return dashboardLogsHref({ start_date: '', end_date: '' }, view === 'errors' ? { status: 'error' } : {});
}
