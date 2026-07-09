/**
 * Admin 前端：UTC ↔ 业务时区墙钟换算（复用 @octafuse/core 算法）。
 */
export {
	DEFAULT_BUSINESS_TIMEZONE,
	utcApiToZonedInput,
	zonedInputToUtcApi,
	utcApiStringToInstant,
	instantToZonedDatetimeLocalInput,
	zonedDatetimeLocalInputToInstant,
	toSqlUtcDateTime,
} from '@octafuse/core/lib/business-timezone';

/** 供 UI 标注的简短时区标签（如 `Asia/Shanghai (UTC+8)`）。 */
export function formatBusinessTimezoneLabel(timeZone: string, locale = 'en-US'): string {
	if (!timeZone || timeZone === 'UTC') return 'UTC';
	try {
		const parts = new Intl.DateTimeFormat(locale, {
			timeZone,
			timeZoneName: 'shortOffset',
		}).formatToParts(new Date());
		const offset = parts.find((part) => part.type === 'timeZoneName')?.value;
		return offset && offset !== timeZone ? `${timeZone} (${offset})` : timeZone;
	} catch {
		return timeZone;
	}
}
