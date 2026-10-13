/**
 * Shared predicates for admin request-log list filters.
 * LIKE uses a backslash escape so `%` and `_` in a prefix stay literal.
 */

export function escapeSqlLike(value: string): string {
	return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export function appendProviderIdsCondition(
	conditions: string[],
	bindValues: unknown[],
	column: string,
	providerIds: string[] | undefined,
): void {
	const ids = (providerIds ?? []).map((id) => id.trim()).filter((id) => id !== '');
	if (ids.length === 0) return;
	conditions.push(`${column} IN (${ids.map(() => '?').join(', ')})`);
	bindValues.push(...ids);
}

export function appendModelIdPrefixCondition(
	conditions: string[],
	bindValues: unknown[],
	column: string,
	prefix: string | undefined,
): void {
	const trimmed = prefix?.trim() ?? '';
	if (trimmed === '') return;
	conditions.push(`${column} LIKE ? ESCAPE '\\'`);
	bindValues.push(`${escapeSqlLike(trimmed)}%`);
}
