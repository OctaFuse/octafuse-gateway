/** SQLite `?` → Postgres `$1`…`$n`（占位符数量与 bind 数组一致）。 */
export function sqlitePlaceholdersToPg(sqliteSql: string): string {
	let n = 0;
	return sqliteSql.replace(/\?/g, () => `$${++n}`);
}
