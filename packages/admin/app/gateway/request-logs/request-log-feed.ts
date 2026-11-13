import { createRangeValue, type GatewayTimeRangeValue } from '@/lib/analytics-range';

/** Refresh relative ranges at request time; custom bounds remain exactly as selected. */
export function requestLogRefreshQuery(query: string, preset: GatewayTimeRangeValue['preset'], timeZone: string) {
	const next = new URLSearchParams(query);
	if (preset !== 'custom') {
		const range = createRangeValue(preset, timeZone);
		next.set('start_date', range.start_date);
		next.set('end_date', range.end_date);
	}
	return next;
}

/** Only the unseen leading prefix is incoming traffic; older backfilled rows are not new arrivals. */
export function incomingRequestLogIds(previous: readonly { id: string }[], next: readonly { id: string }[]): string[] {
	const known = new Set(previous.map(row => row.id));
	const incoming = new Set<string>();
	for (const row of next) {
		if (known.has(row.id)) break;
		incoming.add(row.id);
	}
	return [...incoming];
}

export function uniqueRequestLogs<T extends { id: string }>(rows: readonly T[]): T[] {
	const seen = new Set<string>();
	return rows.filter(row => {
		if (seen.has(row.id)) return false;
		seen.add(row.id);
		return true;
	});
}

export function shouldQueueRequestLogs(source: string, incomingCount: number, reading: boolean) {
	return source === 'automatic' && incomingCount > 0 && reading;
}
