import type postgres from 'postgres';

/**
 * ETL 写 Postgres 时的类型处理。
 *
 * postgres.js 默认把 timestamptz 参数当作 JS 日期：`new Date('2026-04-05 21:07:00').toISOString()`。
 * D1 的 `created_at` 等是不带时区的 UTC 文本，`new Date()` 会按**运行机器的本地时区**解释它，
 * 在 UTC+8 的机器上整体早 8 小时（实测 21:07:00 写成 13:07:00+00），在 UTC 机器上却是对的，
 * 所以结果取决于在哪台机器上跑。这里让字符串原样交给 Postgres，由会话时区（ETL 固定为 UTC）解释。
 */
export const ETL_PG_TYPES: Record<string, postgres.PostgresType> = {
	date: {
		to: 1184,
		from: [1082, 1114, 1184],
		serialize: (value: unknown): string => (value instanceof Date ? value.toISOString() : String(value)),
		parse: (value: string): Date => new Date(value),
	},
};
