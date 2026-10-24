/**
 * Shared predicates for admin request-log list filters.
 * LIKE uses a backslash escape so `%` and `_` in a prefix stay literal.
 */

export function escapeSqlLike(value: string): string {
	return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * 把 ISO 8601 时刻转成 D1 / MySQL 比较用的 UTC 文本：毫秒非零时 `YYYY-MM-DD HH:mm:ss.SSS`，整秒时省略 `.000`。
 * D1 的 `created_at` 是秒级文本，按字典序比较：`'…:23' < '…:23.123'`，所以带毫秒的边界与秒级值比较正确；
 * 但整秒边界若写成 `'…:23.000'`，同一秒的秒级值（`'…:23'`）会被判为更小，起点那一秒被漏掉、终点那一秒被多算。
 * 整秒时去掉 `.000`，秒级值与边界相等，半开区间 `[start, end)` 的语义才与按毫秒比较一致。MySQL 的 DATETIME 按时间值比较，两种写法等价。
 */
export function isoToSqlUtcMillis(iso: string): string {
	const text = new Date(iso).toISOString().slice(0, 23).replace('T', ' ');
	return text.endsWith('.000') ? text.slice(0, -4) : text;
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
