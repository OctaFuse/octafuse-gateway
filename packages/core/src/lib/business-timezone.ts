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

export function getTimezoneOffsetMinutesAtUtcInstant(utcInstant: Date, timeZone: string): number {
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

export function toSqlUtcDateTime(date: Date): string {
	return date.toISOString().slice(0, 19).replace('T', ' ');
}

/** API/SQL UTC 字符串 → `Date` instant；`YYYY-MM-DD HH:mm:ss` 按 UTC 解析。 */
export function utcApiStringToInstant(sqlUtc: string): Date {
	const trimmed = sqlUtc.trim();
	return new Date(trimmed.includes('T') ? trimmed : `${trimmed.replace(' ', 'T')}Z`);
}

/** UTC instant → 指定 IANA 时区的 `datetime-local` 值（`YYYY-MM-DDTHH:mm`）。 */
export function instantToZonedDatetimeLocalInput(instant: Date, timeZone: string): string {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		hour12: false,
	}).formatToParts(instant);
	const year = parts.find((part) => part.type === 'year')?.value ?? '1970';
	const month = parts.find((part) => part.type === 'month')?.value ?? '01';
	const day = parts.find((part) => part.type === 'day')?.value ?? '01';
	let hour = parts.find((part) => part.type === 'hour')?.value ?? '00';
	const minute = parts.find((part) => part.type === 'minute')?.value ?? '00';
	if (hour === '24') hour = '00';
	return `${year}-${month}-${day}T${hour}:${minute}`;
}

/** 指定 IANA 时区墙钟 `datetime-local` → UTC instant。 */
export function zonedDatetimeLocalInputToInstant(localStr: string, timeZone: string): Date | null {
	const match = localStr.trim().match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
	if (!match) return null;
	const [, yearRaw, monthRaw, dayRaw, hourRaw, minuteRaw] = match;
	const wallUtcMillis = Date.UTC(
		Number(yearRaw),
		Number(monthRaw) - 1,
		Number(dayRaw),
		Number(hourRaw),
		Number(minuteRaw),
		0
	);
	const probe = new Date(wallUtcMillis);
	const offsetMinutes = getTimezoneOffsetMinutesAtUtcInstant(probe, timeZone);
	const instant = new Date(wallUtcMillis - offsetMinutes * 60 * 1000);
	return Number.isNaN(instant.getTime()) ? null : instant;
}

/** UTC API 字符串 → 业务时区 `datetime-local`。 */
export function utcApiToZonedInput(api: string, timeZone: string): string {
	const instant = utcApiStringToInstant(api);
	if (Number.isNaN(instant.getTime())) return '';
	return instantToZonedDatetimeLocalInput(instant, timeZone);
}

/** 业务时区 `datetime-local` → UTC API 字符串。 */
export function zonedInputToUtcApi(localStr: string, timeZone: string): string {
	const instant = zonedDatetimeLocalInputToInstant(localStr, timeZone);
	if (!instant) return '';
	return toSqlUtcDateTime(instant);
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
