/**
 * IANA 时区选项（供 Gateway Config 下拉）；值须与 gateway `BUSINESS_TIMEZONE` 校验一致。
 * 若库中存了不在列表中的合法 IANA 名，UI 会追加一条对应 option。
 */
export const BUSINESS_TIMEZONE_VALUES = [
	'UTC',
	'Asia/Shanghai',
	'Asia/Hong_Kong',
	'Asia/Taipei',
	'Asia/Tokyo',
	'Asia/Seoul',
	'Asia/Singapore',
	'Asia/Dubai',
	'Europe/London',
	'Europe/Paris',
	'Europe/Berlin',
	'America/New_York',
	'America/Chicago',
	'America/Denver',
	'America/Los_Angeles',
	'America/Sao_Paulo',
	'Australia/Sydney',
	'Pacific/Auckland',
] as const;

export type TimezoneOptionTranslator = (
	key: 'timezones.UTC' | `timezones.${string}` | 'timezones.otherManual',
) => string;

export function getBusinessTimezoneOptions(
	t: TimezoneOptionTranslator,
): ReadonlyArray<{ value: string; label: string }> {
	return BUSINESS_TIMEZONE_VALUES.map((value) => ({
		value,
		label: t(`timezones.${value}` as `timezones.${string}`),
	}));
}

/** @deprecated Use getBusinessTimezoneOptions(t) in client components */
export const BUSINESS_TIMEZONE_OPTIONS: ReadonlyArray<{ value: string; label: string }> =
	getBusinessTimezoneOptions((key) => {
		const map: Record<string, string> = {
			'timezones.UTC': 'UTC',
			'timezones.Asia/Shanghai': 'Asia/Shanghai (China)',
			'timezones.Asia/Hong_Kong': 'Asia/Hong_Kong',
			'timezones.Asia/Taipei': 'Asia/Taipei',
			'timezones.Asia/Tokyo': 'Asia/Tokyo',
			'timezones.Asia/Seoul': 'Asia/Seoul',
			'timezones.Asia/Singapore': 'Asia/Singapore',
			'timezones.Asia/Dubai': 'Asia/Dubai',
			'timezones.Europe/London': 'Europe/London',
			'timezones.Europe/Paris': 'Europe/Paris',
			'timezones.Europe/Berlin': 'Europe/Berlin',
			'timezones.America/New_York': 'America/New_York (Eastern)',
			'timezones.America/Chicago': 'America/Chicago (Central)',
			'timezones.America/Denver': 'America/Denver (Mountain)',
			'timezones.America/Los_Angeles': 'America/Los_Angeles (Pacific)',
			'timezones.America/Sao_Paulo': 'America/Sao_Paulo',
			'timezones.Australia/Sydney': 'Australia/Sydney',
			'timezones.Pacific/Auckland': 'Pacific/Auckland',
		};
		return map[key] ?? key;
	});

export const BUSINESS_TIMEZONE_KEY = 'BUSINESS_TIMEZONE';
