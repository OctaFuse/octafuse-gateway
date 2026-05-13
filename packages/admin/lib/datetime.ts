const SQL_UTC_SECONDS_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

export function parseGatewayDateTime(raw: string | null | undefined): Date | null {
	if (raw == null || raw === '') return null;
	const normalized = SQL_UTC_SECONDS_RE.test(raw)
		? `${raw.replace(' ', 'T')}Z`
		: raw;
	const date = new Date(normalized);
	return Number.isNaN(date.getTime()) ? null : date;
}

export function formatGatewayDateTime(raw: string | null | undefined, timeZone?: string): string {
	const date = parseGatewayDateTime(raw);
	if (!date) return '—';
	return new Intl.DateTimeFormat(undefined, {
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		hour12: false,
		timeZone,
	}).format(date);
}

export function formatGatewayDate(raw: string | null | undefined, timeZone?: string): string {
	const date = parseGatewayDateTime(raw);
	if (!date) return '—';
	return new Intl.DateTimeFormat(undefined, {
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		timeZone,
	}).format(date);
}

export function formatGatewayTime(raw: string | null | undefined, timeZone?: string): string {
	const date = parseGatewayDateTime(raw);
	if (!date) return '—';
	return new Intl.DateTimeFormat(undefined, {
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		hour12: false,
		timeZone,
	}).format(date);
}
