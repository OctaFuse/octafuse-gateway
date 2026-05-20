/**
 * Admin `GET /admin/users` list sort whitelist and query parsing.
 */
export const USER_LIST_SORT_FIELDS = [
	'budget_spent',
	'budget_max',
	'budget_base',
	'budget_reset_at',
	'created_at',
] as const;
export type UserListSortField = (typeof USER_LIST_SORT_FIELDS)[number];

export const USER_LIST_SORT_ORDERS = ['asc', 'desc'] as const;
export type UserListSortOrder = (typeof USER_LIST_SORT_ORDERS)[number];

export const DEFAULT_USER_LIST_SORT: UserListSortField = 'created_at';
export const DEFAULT_USER_LIST_ORDER: UserListSortOrder = 'desc';

export type UserListSort = {
	sort: UserListSortField;
	order: UserListSortOrder;
};

export type UserListSortParseResult =
	| { ok: true; value: UserListSort }
	| { ok: false; message: string };

function isUserListSortField(v: string): v is UserListSortField {
	return (USER_LIST_SORT_FIELDS as readonly string[]).includes(v);
}

function isUserListSortOrder(v: string): v is UserListSortOrder {
	return (USER_LIST_SORT_ORDERS as readonly string[]).includes(v);
}

/** Parse `sort` / `order` query strings; invalid explicit values return an error message. */
export function parseUserListSortQuery(sort?: string, order?: string): UserListSortParseResult {
	const sortTrim = sort?.trim();
	const orderTrim = order?.trim();

	if (sortTrim !== undefined && sortTrim !== '' && !isUserListSortField(sortTrim)) {
		return {
			ok: false,
			message: `Invalid sort; allowed: ${USER_LIST_SORT_FIELDS.join(', ')}`,
		};
	}
	if (orderTrim !== undefined && orderTrim !== '' && !isUserListSortOrder(orderTrim)) {
		return {
			ok: false,
			message: `Invalid order; allowed: ${USER_LIST_SORT_ORDERS.join(', ')}`,
		};
	}

	return {
		ok: true,
		value: {
			sort: sortTrim && isUserListSortField(sortTrim) ? sortTrim : DEFAULT_USER_LIST_SORT,
			order: orderTrim && isUserListSortOrder(orderTrim) ? orderTrim : DEFAULT_USER_LIST_ORDER,
		},
	};
}

/** D1 raw SQL `ORDER BY` clause (whitelist columns only). */
export function buildD1UserListOrderByClause(sort: UserListSortField, order: UserListSortOrder): string {
	const dir = order === 'asc' ? 'ASC' : 'DESC';
	const tieDir = dir;
	if (sort === 'budget_reset_at' || sort === 'budget_max') {
		const nulls = order === 'asc' ? 'NULLS LAST' : 'NULLS FIRST';
		return `ORDER BY ${sort} ${dir} ${nulls}, created_at ${tieDir}`;
	}
	if (sort === 'budget_spent' || sort === 'budget_base') {
		return `ORDER BY ${sort} ${dir}, created_at ${tieDir}`;
	}
	return `ORDER BY created_at ${dir}`;
}
