/** Values that may appear in `api_key_request_logs.status` — used to whitelist `include_statuses` query parsing. */
const REQUEST_LOG_STATUS_WHITELIST = new Set(['success', 'error', 'incomplete', 'cancelled']);

/**
 * Returns deduplicated statuses present in the whitelist. Unknown strings are dropped.
 */
export function filterAllowedRequestLogStatuses(statuses: string[] | undefined): string[] {
	if (!statuses?.length) {
		return [];
	}
	const out: string[] = [];
	for (const s of statuses) {
		if (REQUEST_LOG_STATUS_WHITELIST.has(s)) {
			out.push(s);
		}
	}
	return [...new Set(out)];
}
