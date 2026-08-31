import type { KeyAnalyticsRow } from '../storage/repository-dtos';

const EMPTY_STATS = {
	request_count: 0,
	input_tokens: 0,
	output_tokens: 0,
	charged_cost: 0,
	metered_cost: 0,
	standard_cost: 0,
	distinct_models: 0,
	last_active_at: null as string | null,
	success_count: 0,
	error_count: 0,
};

function emptyKeyRow(apiKeyId: string, keyName: string | null): KeyAnalyticsRow {
	return { api_key_id: apiKeyId, key_name: keyName, ...EMPTY_STATS };
}

function logKeyId(row: KeyAnalyticsRow): string | null {
	const id = row.api_key_id;
	if (id == null || id === '') return null;
	return id;
}

/**
 * Merge current `api_keys` (so unused keys appear as zeros) with log aggregates
 * (`GROUP BY api_key_id`). A null `api_key_id` bucket is kept when it has traffic
 * (deleted keys: `ON DELETE SET NULL`).
 */
export function assembleKeyAnalytics(
	keys: Array<{ id: string; name: string | null }>,
	logRows: KeyAnalyticsRow[]
): KeyAnalyticsRow[] {
	const byId = new Map<string, KeyAnalyticsRow>();
	let orphan: KeyAnalyticsRow | null = null;

	for (const row of logRows) {
		const id = logKeyId(row);
		if (id == null) {
			orphan = row;
		} else {
			byId.set(id, row);
		}
	}

	const result: KeyAnalyticsRow[] = [];
	for (const key of keys) {
		const stats = byId.get(key.id);
		if (stats) {
			result.push({ ...stats, api_key_id: key.id, key_name: key.name });
			byId.delete(key.id);
		} else {
			result.push(emptyKeyRow(key.id, key.name));
		}
	}

	for (const leftover of byId.values()) {
		result.push(leftover);
	}

	if (orphan != null && Number(orphan.request_count) > 0) {
		result.push({ ...orphan, api_key_id: null, key_name: null });
	}

	return result;
}
