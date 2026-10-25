import postgres from 'postgres';
import { ETL_TABLES, GATEWAY_POSTGRES_SEARCH_PATH, parseKinds, type EtlTableKind } from '../lib/migration-tables';
import {
	type D1ExecutionConfig,
	parseD1ExecutionConfig,
	runD1ExecuteMany,
	DEFAULT_D1_DATABASE_NAME,
	DEFAULT_D1_PERSIST_TO,
} from '../lib/d1-execute';

interface ReconcileConfig {
	d1: D1ExecutionConfig;
	postgresUrl: string;
	kinds: Set<EtlTableKind>;
}

interface ReconcileCheck {
	label: string;
	d1Sql: string;
	pgSql: string;
	tolerance?: number;
}

function printUsage(): void {
	console.log(`Usage:
  npx tsx scripts/db/cutover/reconcile-d1-postgres.ts [options]

Options:
  --kind=all|<list>          只校验指定分组，可逗号组合：config（管理员维护的配置表）、
                             state（users / api_keys / 粘性绑定 / system_config）、log（日志）。默认 all。
                             预热阶段旧端仍在写，state / log 必然不一致，请只在冻结写入（维护模式）后校验 all。
                             逐行内容比对请用 ETL 的 --check。
  --d1-source=remote|local   D1 source (default: remote)
  --d1-persist-to=<path>     Local D1 persist dir when d1-source=local (default: ${DEFAULT_D1_PERSIST_TO})
  -h, --help                 Show this help

Environment:
  DATABASE_URL                 Required PostgreSQL connection string
  D1_DATABASE_NAME             Optional source database name (default: ${DEFAULT_D1_DATABASE_NAME})
`);
}

function parseConfig(): ReconcileConfig {
	const args = process.argv.slice(2).filter((arg) => arg !== '--');
	if (args.includes('-h') || args.includes('--help')) {
		printUsage();
		process.exit(0);
	}

	const postgresUrl = process.env.DATABASE_URL?.trim();
	if (!postgresUrl) {
		throw new Error('DATABASE_URL is required');
	}

	const kinds = parseKinds(args.find((arg) => arg.startsWith('--kind='))?.slice('--kind='.length));

	return {
		d1: parseD1ExecutionConfig(args),
		postgresUrl,
		kinds,
	};
}

function normalizeValue(value: unknown): string {
	if (value == null) {
		return 'null';
	}
	if (typeof value === 'number') {
		return Number.isFinite(value) ? String(value) : 'NaN';
	}
	return String(value);
}

function toNumber(value: unknown): number {
	if (value == null) {
		return 0;
	}
	if (typeof value === 'number') {
		return value;
	}
	return Number(value);
}

function quoteIdentifier(value: string): string {
	return `"${value.replace(/"/g, '""')}"`;
}

async function runPgScalar(
	sql: postgres.Sql,
	query: string
): Promise<unknown> {
	const rows = await sql.unsafe<Record<string, unknown>[]>(query);
	if (!rows[0]) {
		return null;
	}
	return rows[0].value ?? null;
}

function compareValues(d1Value: unknown, pgValue: unknown, tolerance = 0): boolean {
	const d1Number = toNumber(d1Value);
	const pgNumber = toNumber(pgValue);
	if (Number.isFinite(d1Number) && Number.isFinite(pgNumber)) {
		return Math.abs(d1Number - pgNumber) <= tolerance;
	}
	return normalizeValue(d1Value) === normalizeValue(pgValue);
}

function buildChecks(kinds: Set<EtlTableKind>): ReconcileCheck[] {
	const wanted = (tableKind: EtlTableKind): boolean => kinds.has(tableKind);

	const checks: ReconcileCheck[] = ETL_TABLES.filter((table) => wanted(table.kind)).map((table) => ({
		label: `row-count:${table.name}`,
		d1Sql: `SELECT COUNT(*) AS value FROM "${table.name}"`,
		pgSql: `SELECT COUNT(*) AS value FROM ${quoteIdentifier(table.name)}`,
	}));

	const sumCheck = (table: string, column: string, round = true): ReconcileCheck => {
		const expr = round ? `ROUND(COALESCE(SUM(${column}), 0), 6)` : `COALESCE(SUM(${column}), 0)`;
		return {
			label: `${table}:sum_${column}`,
			d1Sql: `SELECT ${expr} AS value FROM ${table}`,
			pgSql: `SELECT ${expr} AS value FROM ${table}`,
			tolerance: round ? 0.000001 : 0,
		};
	};

	if (wanted('state')) {
		// 账务真源：用户余额与钱包。任何一项对不上都不能切流量。
		for (const column of ['budget_spent', 'budget_max', 'wallet_granted', 'wallet_spent']) {
			checks.push(sumCheck('users', column));
		}
	}

	if (wanted('log')) {
		checks.push(
			sumCheck('api_key_request_logs', 'charged_cost'),
			sumCheck('api_key_request_logs', 'metered_cost'),
			sumCheck('api_key_request_logs', 'total_tokens', false),
			{
				label: 'user_audit_logs:sum_delta_spent_from_snapshots',
				d1Sql: `SELECT ROUND(COALESCE(SUM(
				COALESCE(CAST(json_extract(after_user_snapshot, '$.budget_spent') AS REAL), 0) -
				COALESCE(CAST(json_extract(before_user_snapshot, '$.budget_spent') AS REAL), 0)
			), 0), 6) AS value FROM user_audit_logs`,
				pgSql: `SELECT ROUND(COALESCE(SUM(
				COALESCE(NULLIF(TRIM(after_user_snapshot::json->>'budget_spent'), '')::numeric, 0) -
				COALESCE(NULLIF(TRIM(before_user_snapshot::json->>'budget_spent'), '')::numeric, 0)
			), 0), 6) AS value FROM user_audit_logs`,
				tolerance: 0.000001,
			}
		);
	}

	return checks;
}

async function main(): Promise<void> {
	const config = parseConfig();
	const sql = postgres(config.postgresUrl, {
		max: 1,
		connection: { search_path: GATEWAY_POSTGRES_SEARCH_PATH, timezone: 'UTC' },
	});
	let failed = 0;

	try {
		console.log(`[Reconcile] D1(${config.d1.source}:${config.d1.databaseName}) vs Postgres`);
		const checks = buildChecks(config.kinds);
		// 全部 D1 查询一次 wrangler 调用读完；固定开销远大于查询本身。
		const d1Batches = runD1ExecuteMany(
			checks.map((check) => check.d1Sql),
			config.d1
		);
		for (const [index, check] of checks.entries()) {
			const d1Value = d1Batches[index][0]?.value ?? null;
			const pgValue = await runPgScalar(sql, check.pgSql);
			const matched = compareValues(d1Value, pgValue, check.tolerance ?? 0);
			const prefix = matched ? 'OK ' : 'ERR';
			console.log(
				`[${prefix}] ${check.label} | d1=${normalizeValue(d1Value)} | pg=${normalizeValue(pgValue)}`
			);
			if (!matched) {
				failed += 1;
			}
		}
	} finally {
		await sql.end();
	}

	if (failed > 0) {
		throw new Error(`Reconciliation failed (${failed} mismatch checks).`);
	}

	console.log('[Reconcile] All checks passed.');
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
