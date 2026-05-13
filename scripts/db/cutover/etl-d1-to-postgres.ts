import postgres from 'postgres';
import {
	ETL_TABLE_ORDER,
	ETL_TABLES_TO_TRUNCATE,
	TABLE_CONFLICT_KEYS,
	type EtlTableName,
} from '../lib/migration-tables';
import {
	type D1ExecutionConfig,
	getTableColumns,
	parseD1ExecutionConfig,
	runD1ExecuteJson,
	DEFAULT_D1_DATABASE_NAME,
	DEFAULT_D1_PERSIST_TO,
} from '../lib/d1-execute';

interface EtlConfig {
	postgresUrl: string;
	batchSize: number;
	truncateBeforeLoad: boolean;
	tableFilter: Set<string> | null;
	d1: D1ExecutionConfig;
}

function printUsage(): void {
	console.log(`Usage:
  npx tsx scripts/db/cutover/etl-d1-to-postgres.ts [options]

Options:
  --batch-size=<n>           Batch size per INSERT (default: 500)
  --truncate                 TRUNCATE target tables before ETL (recommended first run)
  --tables=<a,b,c>           Only migrate selected tables (do not combine with --truncate)
  --d1-source=remote|local   D1 source (default: remote)
  --d1-persist-to=<path>     Local D1 persist dir when d1-source=local (default: ${DEFAULT_D1_PERSIST_TO})
  -h, --help                 Show this help

Environment:
  DATABASE_URL                 Required target PostgreSQL connection string
  D1_DATABASE_NAME             Optional source database name (default: ${DEFAULT_D1_DATABASE_NAME})
  D1_PERSIST_TO                Optional fallback for local D1 path
`);
}

function parseConfig(): EtlConfig {
	const args = process.argv.slice(2).filter((arg) => arg !== '--');
	if (args.includes('-h') || args.includes('--help')) {
		printUsage();
		process.exit(0);
	}

	const postgresUrl = process.env.DATABASE_URL?.trim();
	if (!postgresUrl) {
		throw new Error('DATABASE_URL is required');
	}

	const batchSizeArg = args.find((arg) => arg.startsWith('--batch-size='))?.split('=')[1];
	const batchSize = batchSizeArg ? Number(batchSizeArg) : 500;
	if (!Number.isFinite(batchSize) || batchSize <= 0) {
		throw new Error('Invalid --batch-size, expected a positive number');
	}

	const tablesArg = args.find((arg) => arg.startsWith('--tables='))?.split('=')[1];
	const tableFilter = tablesArg
		? new Set(
				tablesArg
					.split(',')
					.map((item) => item.trim())
					.filter((item) => item.length > 0)
		  )
		: null;

	const truncateBeforeLoad = args.includes('--truncate');
	if (truncateBeforeLoad && tableFilter) {
		throw new Error(
			'--truncate cannot be combined with --tables: this would still wipe all target tables. Use full ETL with --truncate, or partial --tables without --truncate.'
		);
	}

	return {
		postgresUrl,
		batchSize,
		truncateBeforeLoad,
		tableFilter,
		d1: parseD1ExecutionConfig(args),
	};
}

function quoteIdentifier(value: string): string {
	return `"${value.replace(/"/g, '""')}"`;
}

function toSqlValue(value: unknown): unknown {
	if (value === undefined) {
		return null;
	}
	return value;
}

function buildUpsertClause(tableName: EtlTableName, columns: string[]): string {
	const conflictKeys = TABLE_CONFLICT_KEYS[tableName];
	if (!conflictKeys || conflictKeys.length === 0) {
		return '';
	}
	const updatableColumns = columns.filter((column) => !conflictKeys.includes(column));
	if (updatableColumns.length === 0) {
		return ` ON CONFLICT (${conflictKeys.map(quoteIdentifier).join(', ')}) DO NOTHING`;
	}
	return ` ON CONFLICT (${conflictKeys.map(quoteIdentifier).join(', ')}) DO UPDATE SET ${updatableColumns
		.map((column) => `${quoteIdentifier(column)} = EXCLUDED.${quoteIdentifier(column)}`)
		.join(', ')}`;
}

async function truncateTables(sql: postgres.Sql): Promise<void> {
	const statement = `TRUNCATE TABLE ${ETL_TABLES_TO_TRUNCATE.map(quoteIdentifier).join(', ')} CASCADE`;
	await sql.unsafe(statement);
}

function buildBatchInsertSql(tableName: EtlTableName, columns: string[], rowCount: number): string {
	const quotedColumns = columns.map(quoteIdentifier).join(', ');
	const values = Array.from({ length: rowCount }, (_, rowIndex) => {
		const placeholders = columns
			.map((_, columnIndex) => `$${rowIndex * columns.length + columnIndex + 1}`)
			.join(', ');
		return `(${placeholders})`;
	}).join(', ');
	return `INSERT INTO ${quoteIdentifier(tableName)} (${quotedColumns}) VALUES ${values}${buildUpsertClause(
		tableName,
		columns
	)}`;
}

function parseCount(rows: Record<string, unknown>[]): number {
	const countValue = rows[0]?.count;
	const count = typeof countValue === 'number' ? countValue : Number(countValue ?? 0);
	if (!Number.isFinite(count)) {
		throw new Error(`Invalid count value: ${String(countValue)}`);
	}
	return count;
}

async function migrateTable(sql: postgres.Sql, tableName: (typeof ETL_TABLE_ORDER)[number], config: EtlConfig): Promise<void> {
	const columns = getTableColumns(tableName, config.d1);
	if (columns.length === 0) {
		throw new Error(`Table ${tableName} has no columns or does not exist in D1 source`);
	}

	const totalRows = parseCount(runD1ExecuteJson(`SELECT COUNT(*) AS count FROM "${tableName}"`, config.d1));
	console.log(`\n[ETL] ${tableName}: ${totalRows} rows`);

	let migrated = 0;
	for (let offset = 0; offset < totalRows; offset += config.batchSize) {
		const d1Rows = runD1ExecuteJson(
			`SELECT * FROM "${tableName}" ORDER BY rowid LIMIT ${config.batchSize} OFFSET ${offset}`,
			config.d1
		);
		if (d1Rows.length === 0) {
			break;
		}
		const params = d1Rows.flatMap((row) => columns.map((column) => toSqlValue(row[column])));
		const sqlText = buildBatchInsertSql(tableName, columns, d1Rows.length);
		await sql.unsafe(sqlText, params);
		migrated += d1Rows.length;
		console.log(`[ETL] ${tableName}: ${migrated}/${totalRows}`);
	}
}

async function main(): Promise<void> {
	const config = parseConfig();
	const sql = postgres(config.postgresUrl, { max: 1 });

	try {
		console.log(
			`[ETL] source=D1(${config.d1.source}:${config.d1.databaseName}), target=Postgres, batch=${config.batchSize}`
		);
		if (config.truncateBeforeLoad) {
			console.log('[ETL] truncating target tables before load...');
			await truncateTables(sql);
		}

		for (const tableName of ETL_TABLE_ORDER) {
			if (config.tableFilter && !config.tableFilter.has(tableName)) {
				continue;
			}
			await migrateTable(sql, tableName, config);
		}

		console.log('\n[ETL] Completed.');
	} finally {
		await sql.end();
	}
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
