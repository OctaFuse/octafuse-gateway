import { getBusinessDayWindow, toSqlUtcDateTime, utcApiStringToInstant } from '@octafuse/core/lib/business-timezone';
import type { DashboardOverviewWindow } from '@octafuse/core';

/** Inclusive API seconds become half-open database bounds. Future end times are clipped.
 * Today compares yesterday from its business-day start for exactly the same elapsed duration.
 * Other windows compare the immediately preceding window of identical duration.
 */
export function dashboardOverviewWindow(start: string, end: string, timeZone: string, preset?: string, now = Date.now()): DashboardOverviewWindow {
 const startMs = utcApiStringToInstant(start).getTime();
 const endMs = Math.max(startMs, Math.min(utcApiStringToInstant(end).getTime() + 1000, Math.floor(now / 1000) * 1000 + 1000));
 const duration = endMs - startMs;
 const day = getBusinessDayWindow(new Date(startMs), timeZone);
 const today = preset === 'today' && day.startUtcSql === start;
 const previousStartMs = today ? utcApiStringToInstant(getBusinessDayWindow(new Date(startMs - 1), timeZone).startUtcSql).getTime() : startMs - duration;
 return { startDate: toSqlUtcDateTime(new Date(startMs)), endDate: toSqlUtcDateTime(new Date(endMs)),
 previousStart: toSqlUtcDateTime(new Date(previousStartMs)), previousEnd: toSqlUtcDateTime(new Date(previousStartMs + duration)) };
}
