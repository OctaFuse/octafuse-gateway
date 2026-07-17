/**
 * Shared parsers for `GET /v1/models` and `GET /catalog/models`.
 */

/** D1 / service layer JSON string column → tag id list; parse failure returns []. */
export function parseTags(tagsJson: string | null): string[] {
	if (tagsJson == null || tagsJson === '') return [];
	try {
		const arr = JSON.parse(tagsJson);
		return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [];
	} catch {
		return [];
	}
}

/** Aggregated `model_routes.route_group` JSON array → deduplicated string list. */
export function parseRouteGroupsJson(json: string | null | undefined): string[] {
	if (json == null || json === '') return [];
	try {
		const arr = JSON.parse(json);
		if (!Array.isArray(arr)) return [];
		const seen = new Set<string>();
		const out: string[] = [];
		for (const x of arr) {
			if (typeof x === 'string' && x !== '' && !seen.has(x)) {
				seen.add(x);
				out.push(x);
			}
		}
		return out;
	} catch {
		return [];
	}
}

/** `models.metadata` JSON object; non-object or parse failure returns `undefined`. */
export function parseMetadata(metadataJson: string | null): Record<string, unknown> | undefined {
	if (metadataJson == null || metadataJson === '') return undefined;
	try {
		const obj = JSON.parse(metadataJson);
		return obj && typeof obj === 'object' && !Array.isArray(obj) ? (obj as Record<string, unknown>) : undefined;
	} catch {
		return undefined;
	}
}

/** Keep `route_group` values present in the allowlist (case-insensitive compare). */
export function filterRouteGroupsByAllowlist(groups: string[], allowed: readonly string[]): string[] {
	const allowedSet = new Set(allowed.map((g) => g.toLowerCase()));
	return groups.filter((g) => allowedSet.has(g.toLowerCase()));
}

/**
 * Default route groups for agent-facing `GET /v1/models` when query param is omitted.
 */
export const DEFAULT_MODELS_ROUTE_GROUPS = ['default', 'free'] as const;

/**
 * Parse `route_groups` CSV for `GET /v1/models`.
 * Empty / missing → {@link DEFAULT_MODELS_ROUTE_GROUPS}.
 */
export function parseModelsRouteGroupsQuery(raw: string | undefined): string[] {
	if (raw == null || raw.trim() === '') {
		return [...DEFAULT_MODELS_ROUTE_GROUPS];
	}
	const seen = new Set<string>();
	const out: string[] = [];
	for (const part of raw.split(',')) {
		const g = part.trim().toLowerCase();
		if (g === '' || seen.has(g)) {
			continue;
		}
		seen.add(g);
		out.push(g);
	}
	return out.length > 0 ? out : [...DEFAULT_MODELS_ROUTE_GROUPS];
}

/** Model kind filter for agent-facing `GET /v1/models`. */
export type ModelsKindFilter = 'llm' | 'image' | 'all';

/**
 * Parse `kind` for `GET /v1/models`.
 * Empty / missing / unknown → `llm`（默认排除文生图，兼容 chat/agent 拉列表）。
 * `image` → 仅文生图；`all` → 不按 kind 过滤。
 */
export function parseModelsKindQuery(raw: string | undefined): ModelsKindFilter {
	if (raw == null || raw.trim() === '') {
		return 'llm';
	}
	const v = raw.trim().toLowerCase();
	if (v === 'image' || v === 'all' || v === 'llm') {
		return v;
	}
	return 'llm';
}

/**
 * Parse `route_groups` CSV for `GET /catalog/models`.
 * Empty / missing → `null` (include all active route groups).
 */
export function parseCatalogRouteGroupsQuery(raw: string | undefined): string[] | null {
	if (raw == null || raw.trim() === '') {
		return null;
	}
	const seen = new Set<string>();
	const out: string[] = [];
	for (const part of raw.split(',')) {
		const g = part.trim().toLowerCase();
		if (g === '' || seen.has(g)) {
			continue;
		}
		seen.add(g);
		out.push(g);
	}
	return out.length > 0 ? out : null;
}
