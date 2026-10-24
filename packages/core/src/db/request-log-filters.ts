/**
 * Shared predicates for admin request-log list filters.
 * LIKE uses a backslash escape so `%` and `_` in a prefix stay literal.
 */

export function escapeSqlLike(value: string): string {
	return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * 把 ISO 8601 时刻转成 D1 / MySQL 比较用的 UTC `YYYY-MM-DD HH:mm:ss.SSS`。
 * D1 的 `created_at` 是秒级文本，较短的前缀在字典序上不大于带毫秒的同秒值，半开区间边界与按毫秒比较一致。
 */
export function isoToSqlUtcMillis(iso: string): string {
	return new Date(iso).toISOString().slice(0, 23).replace('T', ' ');
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
	dialect?: 'mysql',
): void {
	const trimmed = prefix?.trim() ?? '';
	if (trimmed === '') return;
	// MySQL 默认把反斜杠当字符串转义符，转义字符本身要写成 '\\'，写成 '\' 会变成未闭合字符串。
	const escapeLiteral = dialect === 'mysql' ? "'\\\\'" : "'\\'";
	conditions.push(`${column} LIKE ? ESCAPE ${escapeLiteral}`);
	bindValues.push(`${escapeSqlLike(trimmed)}%`);
}
