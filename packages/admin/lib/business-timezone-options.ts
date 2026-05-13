/**
 * IANA 时区选项（供 Gateway Config 下拉）；值须与 gateway `BUSINESS_TIMEZONE` 校验一致。
 * 若库中存了不在列表中的合法 IANA 名，UI 会追加一条对应 option。
 */
export const BUSINESS_TIMEZONE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
	{ value: 'UTC', label: 'UTC' },
	{ value: 'Asia/Shanghai', label: 'Asia/Shanghai (China)' },
	{ value: 'Asia/Hong_Kong', label: 'Asia/Hong_Kong' },
	{ value: 'Asia/Taipei', label: 'Asia/Taipei' },
	{ value: 'Asia/Tokyo', label: 'Asia/Tokyo' },
	{ value: 'Asia/Seoul', label: 'Asia/Seoul' },
	{ value: 'Asia/Singapore', label: 'Asia/Singapore' },
	{ value: 'Asia/Dubai', label: 'Asia/Dubai' },
	{ value: 'Europe/London', label: 'Europe/London' },
	{ value: 'Europe/Paris', label: 'Europe/Paris' },
	{ value: 'Europe/Berlin', label: 'Europe/Berlin' },
	{ value: 'America/New_York', label: 'America/New_York (Eastern)' },
	{ value: 'America/Chicago', label: 'America/Chicago (Central)' },
	{ value: 'America/Denver', label: 'America/Denver (Mountain)' },
	{ value: 'America/Los_Angeles', label: 'America/Los_Angeles (Pacific)' },
	{ value: 'America/Sao_Paulo', label: 'America/Sao_Paulo' },
	{ value: 'Australia/Sydney', label: 'Australia/Sydney' },
	{ value: 'Pacific/Auckland', label: 'Pacific/Auckland' },
];

export const BUSINESS_TIMEZONE_KEY = 'BUSINESS_TIMEZONE';
