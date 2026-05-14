import postgres from 'postgres';
import { ETL_TABLE_ORDER } from '../lib/migration-tables';
import {
	type D1ExecutionConfig,
	parseD1ExecutionConfig,
	runD1ExecuteJson,
	DEFAULT_D1_DATABASE_NAME,
	DEFAULT_D1_PERSIST_TO,
} from '../lib/d1-execute';

interface ReconcileConfig {
	d1: D1ExecutionConfig;
	postgresUrl: string;
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

	return {
		d1: parseD1ExecutionConfig(args),
		postgresUrl,
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

function runD1Scalar(query: string, config: D1ExecutionConfig): unknown {
	const rows = runD1ExecuteJson(query, config);
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

function buildChecks(): ReconcileCheck[] {
	const checks: ReconcileCheck[] = ETL_TABLE_ORDER.map((table) => ({
		label: `row-count:${table}`,
		d1Sql: `SELECT COUNT(*) AS value FROM "${table}"`,
		pgSql: `SELECT COUNT(*) AS value FROM ${quoteIdentifier(table)}`,
	}));

	checks.push(
		{
			label: 'api_key_request_logs:sum_charged_cost',
			d1Sql: 'SELECT ROUND(COALESCE(SUM(charged_cost), 0), 6) AS value FROM api_key_request_logs',
			pgSql: 'SELECT ROUND(COALESCE(SUM(charged_cost), 0), 6) AS value FROM api_key_request_logs',
			tolerance: 0.000001,
		},
		{
			label: 'api_key_request_logs:sum_metered_cost',
			d1Sql: 'SELECT ROUND(COALESCE(SUM(metered_cost), 0), 6) AS value FROM api_key_request_logs',
			pgSql: 'SELECT ROUND(COALESCE(SUM(metered_cost), 0), 6) AS value FROM api_key_request_logs',
			tolerance: 0.000001,
		},
		{
			label: 'api_key_request_logs:sum_total_tokens',
			d1Sql: 'SELECT COALESCE(SUM(total_tokens), 0) AS value FROM api_key_request_logs',
			pgSql: 'SELECT COALESCE(SUM(total_tokens), 0) AS value FROM api_key_request_logs',
		},
		{
			label: 'users:sum_budget_spent',
			d1Sql: 'SELECT ROUND(COALESCE(SUM(budget_spent), 0), 6) AS value FROM users',
			pgSql: 'SELECT ROUND(COALESCE(SUM(budget_spent), 0), 6) AS value FROM users',
			tolerance: 0.000001,
		},
		{
			label: 'user_audit_logs:sum_delta_spent_from_snapshots',
			d1Sql: `SELECT ROUND(COALESCE(SUM(
				COALESCE(CAST(json_extract(after_user_snapshot, '$.budget_spent') AS REAL), 0) -
				COALESCE(CAST(json_extract(before_user_snapshot, '$.budget_spent') AS REAL), 0)
			), 0), 6) AS value FROM user_audit_logs`,
			pgSql: `SELECT ROUND(COALESCE(SUM(
				COALESCE(NULLIF(TRIM(after_user_snapshot::json->>'budget_spent'), '')::double precision, 0) -
				COALESCE(NULLIF(TRIM(before_user_snapshot::json->>'budget_spent'), '')::double precision, 0)
			), 0), 6) AS value FROM user_audit_logs`,
			tolerance: 0.000001,
		}
	);

	return checks;
}

async function main(): Promise<void> {
	const config = parseConfig();
	const sql = postgres(config.postgresUrl, { max: 1 });
	let failed = 0;

	try {
		console.log(`[Reconcile] D1(${config.d1.source}:${config.d1.databaseName}) vs Postgres`);
		for (const check of buildChecks()) {
			const d1Value = runD1Scalar(check.d1Sql, config.d1);
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
