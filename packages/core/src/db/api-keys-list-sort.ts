/**
 * Admin `GET /admin/keys` list sort whitelist and query parsing.
 * Budget columns come from JOIN `users u`; `created_at` from `api_keys k`.
 */
export const API_KEY_LIST_SORT_FIELDS = ['budget_spent', 'budget_reset_at', 'created_at'] as const;
export type ApiKeyListSortField = (typeof API_KEY_LIST_SORT_FIELDS)[number];

export const API_KEY_LIST_SORT_ORDERS = ['asc', 'desc'] as const;
export type ApiKeyListSortOrder = (typeof API_KEY_LIST_SORT_ORDERS)[number];

export const DEFAULT_API_KEY_LIST_SORT: ApiKeyListSortField = 'created_at';
export const DEFAULT_API_KEY_LIST_ORDER: ApiKeyListSortOrder = 'desc';

export type ApiKeyListSort = {
	sort: ApiKeyListSortField;
	order: ApiKeyListSortOrder;
};

export type ApiKeyListSortParseResult =
	| { ok: true; value: ApiKeyListSort }
	| { ok: false; message: string };

function isApiKeyListSortField(v: string): v is ApiKeyListSortField {
	return (API_KEY_LIST_SORT_FIELDS as readonly string[]).includes(v);
}

function isApiKeyListSortOrder(v: string): v is ApiKeyListSortOrder {
	return (API_KEY_LIST_SORT_ORDERS as readonly string[]).includes(v);
}

/** Parse `sort` / `order` query strings; invalid explicit values return an error message. */
export function parseApiKeyListSortQuery(sort?: string, order?: string): ApiKeyListSortParseResult {
	const sortTrim = sort?.trim();
	const orderTrim = order?.trim();

	if (sortTrim !== undefined && sortTrim !== '' && !isApiKeyListSortField(sortTrim)) {
		return {
			ok: false,
			message: `Invalid sort; allowed: ${API_KEY_LIST_SORT_FIELDS.join(', ')}`,
		};
	}
	if (orderTrim !== undefined && orderTrim !== '' && !isApiKeyListSortOrder(orderTrim)) {
		return {
			ok: false,
			message: `Invalid order; allowed: ${API_KEY_LIST_SORT_ORDERS.join(', ')}`,
		};
	}

	return {
		ok: true,
		value: {
			sort: sortTrim && isApiKeyListSortField(sortTrim) ? sortTrim : DEFAULT_API_KEY_LIST_SORT,
			order: orderTrim && isApiKeyListSortOrder(orderTrim) ? orderTrim : DEFAULT_API_KEY_LIST_ORDER,
		},
	};
}

/** D1 raw SQL `ORDER BY` clause (whitelist columns only; `k` / `u` aliases). */
export function buildD1ApiKeyListOrderByClause(sort: ApiKeyListSortField, order: ApiKeyListSortOrder): string {
	const dir = order === 'asc' ? 'ASC' : 'DESC';
	if (sort === 'budget_reset_at') {
		const nulls = order === 'asc' ? 'NULLS LAST' : 'NULLS FIRST';
		return `ORDER BY u.budget_reset_at ${dir} ${nulls}`;
	}
	if (sort === 'budget_spent') {
		return `ORDER BY u.budget_spent ${dir}`;
	}
	return `ORDER BY k.created_at ${dir}`;
}
