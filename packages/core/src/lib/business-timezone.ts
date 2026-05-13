import type { GatewayRepositories } from '../storage/repositories';

export const DEFAULT_BUSINESS_TIMEZONE = 'UTC';

const DAY_MS = 24 * 60 * 60 * 1000;

function isValidIanaTimeZone(value: string): boolean {
	try {
		new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date());
		return true;
	} catch {
		return false;
	}
}

function formatDateKeyInTimeZone(date: Date, timeZone: string): string {
	const parts = new Intl.DateTimeFormat('en-CA', {
		timeZone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
	}).formatToParts(date);
	const year = parts.find((part) => part.type === 'year')?.value ?? '1970';
	const month = parts.find((part) => part.type === 'month')?.value ?? '01';
	const day = parts.find((part) => part.type === 'day')?.value ?? '01';
	return `${year}-${month}-${day}`;
}

function parseDateKey(dateKey: string): { year: number; month: number; day: number } {
	const [yearRaw, monthRaw, dayRaw] = dateKey.split('-');
	return {
		year: Number(yearRaw),
		month: Number(monthRaw),
		day: Number(dayRaw),
	};
}

function addDateKeyDays(dateKey: string, days: number): string {
	const { year, month, day } = parseDateKey(dateKey);
	const next = new Date(Date.UTC(year, month - 1, day) + days * DAY_MS);
	return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
}

function getTimezoneOffsetMinutesAtUtcInstant(utcInstant: Date, timeZone: string): number {
	const part = new Intl.DateTimeFormat('en-US', {
		timeZone,
		timeZoneName: 'shortOffset',
		hour: '2-digit',
		minute: '2-digit',
		hour12: false,
	})
		.formatToParts(utcInstant)
		.find((token) => token.type === 'timeZoneName')?.value ?? 'GMT';
	if (part === 'GMT' || part === 'UTC') return 0;
	const match = part.match(/^(?:GMT|UTC)([+-])(\d{1,2})(?::?(\d{2}))?$/);
	if (!match) return 0;
	const sign = match[1] === '-' ? -1 : 1;
	const hours = Number(match[2]);
	const minutes = Number(match[3] ?? '0');
	return sign * (hours * 60 + minutes);
}

function getUtcDateTimeFromDateKeyMidnight(dateKey: string, timeZone: string): Date {
	const { year, month, day } = parseDateKey(dateKey);
	const utcMidnightMillis = Date.UTC(year, month - 1, day, 0, 0, 0);
	const probe = new Date(utcMidnightMillis);
	const offsetMinutes = getTimezoneOffsetMinutesAtUtcInstant(probe, timeZone);
	return new Date(utcMidnightMillis - offsetMinutes * 60 * 1000);
}

function toSqlUtcDateTime(date: Date): string {
	return date.toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * 读取业务时区配置：
 * - 来源：system_config.BUSINESS_TIMEZONE
 * - 非法或未配置时回落 UTC
 */
export async function getBusinessTimezone(repos: GatewayRepositories): Promise<string> {
	const raw = await repos.systemConfig.getConfig('BUSINESS_TIMEZONE');
	const candidate = raw?.trim();
	if (!candidate) return DEFAULT_BUSINESS_TIMEZONE;
	return isValidIanaTimeZone(candidate) ? candidate : DEFAULT_BUSINESS_TIMEZONE;
}

/**
 * 业务日窗口（按业务时区计算“今天”，并返回与 DB `created_at` 比较的 UTC 字符串边界）。
 */
export function getBusinessDayWindow(
	now: Date,
	businessTimeZone: string
): {
	dateKey: string;
	startUtcSql: string;
	endExclusiveUtcSql: string;
} {
	const dateKey = formatDateKeyInTimeZone(now, businessTimeZone);
	const nextDateKey = addDateKeyDays(dateKey, 1);
	const startUtc = getUtcDateTimeFromDateKeyMidnight(dateKey, businessTimeZone);
	const endUtc = getUtcDateTimeFromDateKeyMidnight(nextDateKey, businessTimeZone);
	return {
		dateKey,
		startUtcSql: toSqlUtcDateTime(startUtc),
		endExclusiveUtcSql: toSqlUtcDateTime(endUtc),
	};
}
