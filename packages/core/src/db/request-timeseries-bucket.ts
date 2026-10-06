/**
 * 仪表盘趋势分桶：按业务时区墙钟截断小时/日，返回 `YYYY-MM-DD` 或 `YYYY-MM-DD HH:MM:SS`。
 * Postgres 用 `AT TIME ZONE`（含夏令时）。D1 / MySQL 没有可用的 IANA 转换，按区间结束时刻的偏移平移 UTC。
 */
import { getTimezoneOffsetMinutesAtUtcInstant, utcApiStringToInstant } from '../lib/business-timezone';

export type RequestTimeseriesGranularity = 'hour' | 'day';

/** 偏移锚点：用查询窗结束时刻，使当前小时与业务时区一致。 */
export function timeseriesOffsetAnchor(endDate: string): Date {
	const instant = utcApiStringToInstant(endDate);
	return Number.isNaN(instant.getTime()) ? new Date() : instant;
}

/** SQLite `datetime()` modifier，把 UTC 朴素时间平移到业务时区墙钟。 */
export function sqliteBusinessTimezoneModifier(timeZone: string, at: Date): string {
	const offsetMinutes = getTimezoneOffsetMinutesAtUtcInstant(at, timeZone);
	const sign = offsetMinutes >= 0 ? '+' : '-';
	return `${sign}${Math.abs(offsetMinutes)} minutes`;
}

/** 加到 UTC unix 秒上，得到业务时区墙钟对应的朴素秒。 */
export function businessTimezoneOffsetSeconds(timeZone: string, at: Date): number {
	return getTimezoneOffsetMinutesAtUtcInstant(at, timeZone) * 60;
}

/** `$param` 绑定 IANA 时区名，例如 `$3`。 */
export function postgresTimeseriesBucketExpr(granularity: RequestTimeseriesGranularity, timeZoneParam: string): string {
	if (granularity === 'hour') {
		return `to_char(date_trunc('hour', created_at AT TIME ZONE ${timeZoneParam}), 'YYYY-MM-DD HH24:MI:SS')`;
	}
	return `to_char(date_trunc('day', created_at AT TIME ZONE ${timeZoneParam}), 'YYYY-MM-DD')`;
}

/** `?` 绑定 {@link sqliteBusinessTimezoneModifier}。 */
export function sqliteTimeseriesBucketExpr(granularity: RequestTimeseriesGranularity): string {
	const fmt = granularity === 'hour' ? '%Y-%m-%d %H:00:00' : '%Y-%m-%d';
	return `strftime('${fmt}', datetime(created_at, ?))`;
}

/** `?` 绑定 {@link businessTimezoneOffsetSeconds}。 */
export function mysqlTimeseriesBucketExpr(granularity: RequestTimeseriesGranularity): string {
	const fmt = granularity === 'hour' ? '%Y-%m-%d %H:00:00' : '%Y-%m-%d';
	return `DATE_FORMAT(DATE_ADD('1970-01-01 00:00:00', INTERVAL (UNIX_TIMESTAMP(created_at) + ?) SECOND), '${fmt}')`;
}
