import type { EtlTableSpec } from './migration-tables';

/** Postgres 单条语句最多 65535 个绑定参数，留出余量。 */
export const MAX_PG_PARAMS = 60000;

export function quoteIdentifier(value: string): string {
	return `"${value.replace(/"/g, '""')}"`;
}

export function quoteLiteral(value: string): string {
	return `'${value.replace(/'/g, "''")}'`;
}

/**
 * 把 `--since` 规范成 D1 里 `created_at` 的文本格式（UTC，`YYYY-MM-DD HH:MM:SS`）。
 * 接受 `2026-10-25`、`2026-10-25 06:00:00`、`2026-10-25T06:00:00Z`、带时区偏移的 ISO。
 * 没有时区的时间一律按 UTC 解释，与 D1 `datetime('now')` 一致。
 */
export function normalizeSince(raw: string): string {
	const text = raw.trim();
	const match = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?))?(Z|[+-]\d{2}:?\d{2})?$/i.exec(text);
	if (!match) {
		throw new Error(`Invalid --since "${raw}", expected e.g. 2026-10-25 or 2026-10-25T06:00:00Z`);
	}
	const [, datePart, timePart, zone] = match;
	const iso = `${datePart}T${timePart ?? '00:00:00'}${zone ?? 'Z'}`;
	const ms = Date.parse(iso);
	if (Number.isNaN(ms)) {
		throw new Error(`Invalid --since "${raw}"`);
	}
	return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

function buildWhere(spec: EtlTableSpec, since: string | null, lastKey: string | null): string {
	const clauses: string[] = [];
	if (since && spec.sinceColumn) {
		const column = quoteIdentifier(spec.sinceColumn);
		// created_at 在 D1 里可空；NULL 行无法判断新旧，宁可多拷也不漏。
		clauses.push(`(${column} >= ${quoteLiteral(since)} OR ${column} IS NULL)`);
	}
	if (spec.keysetColumn && lastKey !== null) {
		clauses.push(`${quoteIdentifier(spec.keysetColumn)} > ${quoteLiteral(lastKey)}`);
	}
	return clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '';
}

export function buildCountSql(spec: EtlTableSpec, since: string | null): string {
	return `SELECT COUNT(*) AS count FROM ${quoteIdentifier(spec.name)}${buildWhere(spec, since, null)}`;
}

export interface SelectBatchOptions {
	batchSize: number;
	/** 仅无 keysetColumn 的表使用。 */
	offset: number;
	/** 仅有 keysetColumn 的表使用；首批传 null。 */
	lastKey: string | null;
	since: string | null;
}

export function buildSelectBatchSql(spec: EtlTableSpec, options: SelectBatchOptions): string {
	const table = quoteIdentifier(spec.name);
	if (spec.keysetColumn) {
		const key = quoteIdentifier(spec.keysetColumn);
		return `SELECT * FROM ${table}${buildWhere(spec, options.since, options.lastKey)} ORDER BY ${key} LIMIT ${options.batchSize}`;
	}
	return `SELECT * FROM ${table}${buildWhere(spec, options.since, null)} ORDER BY rowid LIMIT ${options.batchSize} OFFSET ${options.offset}`;
}

export function buildUpsertSql(spec: EtlTableSpec, columns: readonly string[], rowCount: number): string {
	const quotedColumns = columns.map(quoteIdentifier).join(', ');
	const values = Array.from({ length: rowCount }, (_, rowIndex) => {
		const placeholders = columns.map((_, columnIndex) => `$${rowIndex * columns.length + columnIndex + 1}`).join(', ');
		return `(${placeholders})`;
	}).join(', ');

	const conflict = spec.conflictKeys.map(quoteIdentifier).join(', ');
	const updatable = columns.filter((column) => !spec.conflictKeys.includes(column));
	const action =
		updatable.length === 0
			? 'DO NOTHING'
			: `DO UPDATE SET ${updatable.map((column) => `${quoteIdentifier(column)} = EXCLUDED.${quoteIdentifier(column)}`).join(', ')}`;

	return `INSERT INTO ${quoteIdentifier(spec.name)} (${quotedColumns}) VALUES ${values} ON CONFLICT (${conflict}) ${action}`;
}

/** 读 D1 里全部主键，用于 prune。 */
export function buildKeyListSql(spec: EtlTableSpec): string {
	return `SELECT ${spec.conflictKeys.map(quoteIdentifier).join(', ')} FROM ${quoteIdentifier(spec.name)}`;
}

function buildNotInD1Where(spec: EtlTableSpec): string {
	const keys = spec.conflictKeys;
	const aliases = keys.map((_, index) => `k${index}`);
	const unnest = keys.map((_, index) => `$${index + 1}::text[]`).join(', ');
	const match = keys.map((key, index) => `t.${quoteIdentifier(key)}::text = d.${aliases[index]}`).join(' AND ');
	return `NOT EXISTS (SELECT 1 FROM unnest(${unnest}) AS d(${aliases.join(', ')}) WHERE ${match})`;
}

/**
 * 删除 Postgres 里 D1 已不存在的行。键列按 text 比较（所有 ETL 表的主键列都是 TEXT）。
 * 参数：每个键列一个 text[]，下标对齐。
 */
export function buildPruneSql(spec: EtlTableSpec): string {
	return `DELETE FROM ${quoteIdentifier(spec.name)} AS t WHERE ${buildNotInD1Where(spec)}`;
}

/** 与 prune 同一判据，只数不删：Postgres 里比 D1 多出来的行数。 */
export function buildStaleCountSql(spec: EtlTableSpec): string {
	return `SELECT COUNT(*)::int AS stale FROM ${quoteIdentifier(spec.name)} AS t WHERE ${buildNotInD1Where(spec)}`;
}

/**
 * 差异检查：和 upsert 同样的语句，但只在行不存在或内容不同时才“命中”，并统计命中数。
 * 必须放在会回滚的事务里执行，调用方负责 ROLLBACK，绝不能提交。
 *
 * 比较交给 Postgres：EXCLUDED 里的值已按目标列类型转换，所以 0.1 与 0.100000、
 * `2026-08-10 15:43:50` 与 timestamptz 这类写法差异不会被误报成不同。
 * 键列以外的列全部相同则不命中；全部列都是键（如 model_tags）时只有新插入的行命中。
 */
export function buildCheckSql(spec: EtlTableSpec, columns: readonly string[], rowCount: number): string {
	const quotedColumns = columns.map(quoteIdentifier).join(', ');
	const values = Array.from({ length: rowCount }, (_, rowIndex) => {
		const placeholders = columns.map((_, columnIndex) => `$${rowIndex * columns.length + columnIndex + 1}`).join(', ');
		return `(${placeholders})`;
	}).join(', ');

	const conflict = spec.conflictKeys.map(quoteIdentifier).join(', ');
	const updatable = columns.filter((column) => !spec.conflictKeys.includes(column));
	// 参与比较的列：去掉登记为“校验时忽略”的使用时间戳。全部被忽略时等同于只有键列。
	const ignored = new Set(spec.checkIgnoreColumns ?? []);
	const compared = updatable.filter((column) => !ignored.has(column));
	const action =
		compared.length === 0
			? 'DO NOTHING'
			: `DO UPDATE SET ${updatable.map((column) => `${quoteIdentifier(column)} = EXCLUDED.${quoteIdentifier(column)}`).join(', ')} ` +
				`WHERE (${compared.map((column) => `t.${quoteIdentifier(column)}`).join(', ')}) IS DISTINCT FROM ` +
				`(${compared.map((column) => `EXCLUDED.${quoteIdentifier(column)}`).join(', ')})`;

	return (
		`WITH changed AS (INSERT INTO ${quoteIdentifier(spec.name)} AS t (${quotedColumns}) VALUES ${values} ` +
		`ON CONFLICT (${conflict}) ${action} RETURNING 1) SELECT COUNT(*)::int AS changed FROM changed`
	);
}
