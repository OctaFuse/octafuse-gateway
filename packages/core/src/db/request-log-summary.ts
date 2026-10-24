/**
 * `api_key_request_logs` 汇总查询（`GET /admin/request-logs/summary`）的三库共用 SQL 构造与行映射。
 * 分组列只来自白名单，调用方输入从不拼进 SQL；筛选值全部走绑定参数。
 */
import { sqlMoneyRound } from '../lib/money-precision';
import type {
	RequestLogSummaryDimension,
	RequestLogSummaryRow,
} from '../storage/gateway-repository-interfaces';
import { appendModelIdPrefixCondition, appendProviderIdsCondition, isoToSqlUtcMillis } from './request-log-filters';

export type RequestLogSummaryDialect = 'postgres' | 'mysql' | 'd1';

export type RequestLogSummaryQueryOptions = {
	groupBy: RequestLogSummaryDimension[];
	startDate: string;
	endDate: string;
	providerIds?: string[];
	modelId?: string;
	modelIdPrefix?: string;
	routeGroup?: string;
	status?: string;
	limit: number;
};

const DIMENSION_COLUMN: Record<RequestLogSummaryDimension, 'provider_id' | 'model_id' | 'route_group' | 'status'> = {
	provider: 'provider_id',
	model: 'model_id',
	route_group: 'route_group',
	status: 'status',
};

const TOKEN_COLUMNS = [
	'input_tokens',
	'output_tokens',
	'cache_read_tokens',
	'cache_write_tokens',
	'reasoning_tokens',
	'total_tokens',
] as const;
const COST_COLUMNS = ['standard_cost', 'metered_cost', 'charged_cost', 'charged_wallet_cost'] as const;

/** 金额以十进制文本输出：Postgres `::text`、MySQL `CAST AS CHAR`，D1 为 REAL 由应用层 `toFixed(6)`。 */
function moneyText(dialect: RequestLogSummaryDialect, expr: string): string {
	const rounded = sqlMoneyRound(`COALESCE(${expr}, 0)`);
	if (dialect === 'postgres') return `${rounded}::text`;
	if (dialect === 'mysql') return `CAST(${rounded} AS CHAR)`;
	return rounded;
}

/** 返回使用 `?` 占位符的 SQL（Postgres 由调用方再转 `$n`）与绑定值。 */
export function buildRequestLogSummaryQuery(
	options: RequestLogSummaryQueryOptions,
	dialect: RequestLogSummaryDialect,
): { sql: string; binds: unknown[] } {
	const groupColumns = options.groupBy.map((dimension) => DIMENSION_COLUMN[dimension]);
	if (groupColumns.length === 0) throw new Error('group_by must not be empty');

	const conditions: string[] = [];
	const binds: unknown[] = [];
	appendProviderIdsCondition(conditions, binds, 'provider_id', options.providerIds);
	if (options.modelId) {
		conditions.push('model_id = ?');
		binds.push(options.modelId);
	}
	appendModelIdPrefixCondition(conditions, binds, 'model_id', options.modelIdPrefix, dialect === 'mysql' ? 'mysql' : undefined);
	if (options.routeGroup) {
		conditions.push('route_group = ?');
		binds.push(options.routeGroup);
	}
	if (options.status) {
		conditions.push('status = ?');
		binds.push(options.status);
	}
	if (dialect === 'postgres') {
		// ISO 带 Z，显式转 timestamptz，不依赖连接会话时区。
		conditions.push('created_at >= ?::timestamptz', 'created_at < ?::timestamptz');
		binds.push(options.startDate, options.endDate);
	} else {
		conditions.push('created_at >= ?', 'created_at < ?');
		binds.push(isoToSqlUtcMillis(options.startDate), isoToSqlUtcMillis(options.endDate));
	}

	const metrics = [
		'COUNT(*) AS request_count',
		"COALESCE(SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END), 0) AS success_count",
		"COALESCE(SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END), 0) AS error_count",
		...TOKEN_COLUMNS.map((column) => `COALESCE(SUM(${column}), 0) AS ${column}`),
		...COST_COLUMNS.map((column) => `${moneyText(dialect, `SUM(${column})`)} AS ${column}`),
	];
	const group = groupColumns.join(', ');
	binds.push(options.limit);
	return {
		sql: `SELECT ${group}, ${metrics.join(', ')}
			FROM api_key_request_logs
			WHERE ${conditions.join(' AND ')}
			GROUP BY ${group}
			ORDER BY ${group}
			LIMIT ?`,
		binds,
	};
}

type RawSummaryRow = Record<string, unknown>;

/** 把驱动返回的行规整为契约形状：只保留参与分组的键，数值转 number，金额统一 6 位小数文本。 */
export function mapRequestLogSummaryRows(
	rows: RawSummaryRow[],
	groupBy: RequestLogSummaryDimension[],
): RequestLogSummaryRow[] {
	const keys = groupBy.map((dimension) => DIMENSION_COLUMN[dimension]);
	const text = (value: unknown) => (value === null || value === undefined ? null : String(value));
	const money = (value: unknown) => {
		const number = Number(value ?? 0);
		// 十进制文本原样规整到 6 位小数；D1 的 REAL 在这里变成定点文本。
		return typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value) ? padMoney(value) : number.toFixed(6);
	};
	return rows.map((row) => {
		const key: Record<string, string | null> = {};
		for (const column of keys) key[column] = text(row[column]);
		return {
			...key,
			request_count: Number(row.request_count ?? 0),
			success_count: Number(row.success_count ?? 0),
			error_count: Number(row.error_count ?? 0),
			input_tokens: Number(row.input_tokens ?? 0),
			output_tokens: Number(row.output_tokens ?? 0),
			cache_read_tokens: Number(row.cache_read_tokens ?? 0),
			cache_write_tokens: Number(row.cache_write_tokens ?? 0),
			reasoning_tokens: Number(row.reasoning_tokens ?? 0),
			total_tokens: Number(row.total_tokens ?? 0),
			standard_cost: money(row.standard_cost),
			metered_cost: money(row.metered_cost),
			charged_cost: money(row.charged_cost),
			charged_wallet_cost: money(row.charged_wallet_cost),
		};
	});
}

/** `"1.5"` → `"1.500000"`；已是 6 位小数的文本不变。 */
function padMoney(value: string): string {
	const [integer, fraction = ''] = value.split('.');
	return `${integer}.${fraction.padEnd(6, '0').slice(0, 6)}`;
}
