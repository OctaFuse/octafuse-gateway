import postgres from 'postgres';
import {
	ETL_EXCLUDED_TABLES,
	ETL_TABLES,
	ETL_TABLES_TO_TRUNCATE,
	ETL_TABLE_KINDS,
	GATEWAY_POSTGRES_SEARCH_PATH,
	parseKinds,
	type EtlTableKind,
	type EtlTableSpec,
} from '../lib/migration-tables';
import {
	MAX_PG_PARAMS,
	buildCheckSql,
	buildCountSql,
	buildKeyListSql,
	buildPruneSql,
	buildSelectBatchSql,
	buildStaleCountSql,
	buildUpsertSql,
	normalizeSince,
	quoteIdentifier,
} from '../lib/etl-sql';
import { createRemoteD1Reader, type D1Reader } from '../lib/d1-rest';
import { ETL_PG_TYPES } from '../lib/pg-types';
import {
	type D1ExecutionConfig,
	getTablesColumns,
	parseD1ExecutionConfig,
	runD1ExecuteJson,
	runD1ExecuteMany,
	DEFAULT_D1_DATABASE_NAME,
	DEFAULT_D1_PERSIST_TO,
} from '../lib/d1-execute';

interface EtlConfig {
	postgresUrl: string;
	batchSize: number;
	truncateBeforeLoad: boolean;
	prune: boolean;
	dryRun: boolean;
	check: boolean;
	/** 读 D1 大表分页的方式：api = 直连 REST（默认，快）；wrangler = 每批启动一次 wrangler。 */
	d1Transport: 'api' | 'wrangler';
	/** 同时写 Postgres 的连接数。 */
	pgConcurrency: number;
	kinds: Set<EtlTableKind>;
	since: string | null;
	/** 日志表中断续跑：只同步 id > 该值的行（通常取 Postgres 里该表 MAX(id)）。 */
	afterId: string | null;
	/** 只同步 id < 该值的日志行，与 --after-id 一起圈出一个区间做定点修复。 */
	beforeId: string | null;
	tableFilter: Set<string> | null;
	/** table → 明确同意丢弃的 D1 列（目标库已无此列）。 */
	skipColumns: Map<string, Set<string>>;
	d1: D1ExecutionConfig;
}

function printUsage(): void {
	console.log(`Usage:
  npx tsx scripts/db/cutover/etl-d1-to-postgres.ts [options]

Options:
  --batch-size=<n>           Rows fetched from D1 per round trip (default: 500)
  --d1-transport=api|wrangler  读 D1 分页的方式（default: api）。api 直连 Cloudflare REST，省掉每批约 3 秒的
                             wrangler 启动；取不到令牌或账号时自动退回 wrangler。小表与预检仍用 wrangler。
  --pg-concurrency=<n>       同时写 Postgres 的连接数（default: 3）
  --kind=all|<list>          按“谁会改它”选组，可逗号组合（default: all）：
                               config = 只有管理员会写的配置表
                               state  = users / api_keys / 粘性绑定 / system_config（请求或维护开关会改）
                               log    = 请求日志与审计日志
                             例：--kind=config  ·  --kind=state,log
  --since=<time>             仅同步 log 表中 created_at >= 该时间的行（UTC；如 2026-10-25T06:00:00Z）。
                             config / state 表始终全量 upsert。用于维护窗口内补日志尾部。
  --after-id=<id>            只同步 id > 该值的日志行。中断续跑时不要直接取 Postgres 的 MAX(id)：
                             同一批的几段是并发写入的，中途被打断时后段可能已提交而前段没有，
                             MAX(id) 会跳过前段。请再往回多退一批以上（重复写入是幂等的）。
  --before-id=<id>           只同步 id < 该值的日志行；与 --after-id 圈出区间，用于定点修复。
                             只能与 --kind=log 搭配，且必须指定单张表（--tables=）。
  --check                    只校验、零写入：逐行让 Postgres 判断与 D1 是否不同（事务内回滚），
                             并统计 Postgres 比 D1 多出的行。有差异则以退出码 2 结束。
  --tables=<a,b,c>           只迁移指定表（不能与 --truncate 同用）
  --skip-columns=<t.c,...>   明确丢弃 D1 里目标库已不存在的旧列（如 models.supports_images）。
                             不加则列不一致一律报错，避免静默丢数据。
  --truncate                 先清空目标库全部 ETL 表（仅用于第一次全量预热）
  --prune                    先删除 Postgres 里 D1 已不存在的 config / state 表行，再 upsert（维护窗口内最终同步用）
  --dry-run                  只连接并统计行数，不写入
  --d1-source=remote|local   D1 source (default: remote)
  --d1-persist-to=<path>     Local D1 persist dir when d1-source=local (default: ${DEFAULT_D1_PERSIST_TO})
  -h, --help                 Show this help

Environment:
  DATABASE_URL                 Required target PostgreSQL connection string
  D1_DATABASE_NAME             Optional source database name (default: ${DEFAULT_D1_DATABASE_NAME})
  D1_PERSIST_TO                Optional fallback for local D1 path

Excluded tables: ${Object.entries(ETL_EXCLUDED_TABLES)
		.map(([name, reason]) => `${name} (${reason})`)
		.join('; ')}
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

	const argValue = (name: string): string | undefined => args.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);

	const batchSizeArg = argValue('--batch-size');
	const batchSize = batchSizeArg ? Number(batchSizeArg) : 500;
	if (!Number.isInteger(batchSize) || batchSize <= 0) {
		throw new Error('Invalid --batch-size, expected a positive integer');
	}

	const transportArg = argValue('--d1-transport') ?? 'api';
	if (transportArg !== 'api' && transportArg !== 'wrangler') {
		throw new Error(`Invalid --d1-transport "${transportArg}", expected "api" or "wrangler"`);
	}
	const pgConcurrencyArg = argValue('--pg-concurrency');
	const pgConcurrency = pgConcurrencyArg ? Number(pgConcurrencyArg) : 3;
	if (!Number.isInteger(pgConcurrency) || pgConcurrency <= 0 || pgConcurrency > 16) {
		throw new Error('Invalid --pg-concurrency, expected an integer between 1 and 16');
	}

	const kinds = parseKinds(argValue('--kind'));

	const tablesArg = argValue('--tables');
	const tableFilter = tablesArg
		? new Set(
				tablesArg
					.split(',')
					.map((item) => item.trim())
					.filter((item) => item.length > 0)
			)
		: null;
	if (tableFilter) {
		for (const name of tableFilter) {
			if (name in ETL_EXCLUDED_TABLES) {
				throw new Error(`Table ${name} is excluded from ETL: ${ETL_EXCLUDED_TABLES[name]}`);
			}
			if (!ETL_TABLES.some((table) => table.name === name)) {
				throw new Error(
					`Unknown table in --tables: ${name}. Known: ${ETL_TABLES.map((table) => table.name).join(', ')}`
				);
			}
		}
	}

	const skipColumns = new Map<string, Set<string>>();
	for (const item of (argValue('--skip-columns') ?? '').split(',').map((entry) => entry.trim()).filter(Boolean)) {
		const [table, column, ...rest] = item.split('.');
		if (!table || !column || rest.length > 0 || !ETL_TABLES.some((spec) => spec.name === table)) {
			throw new Error(`Invalid --skip-columns entry "${item}", expected <table>.<column> for a known ETL table`);
		}
		skipColumns.set(table, (skipColumns.get(table) ?? new Set<string>()).add(column));
	}

	const sinceArg = argValue('--since');
	const since = sinceArg ? normalizeSince(sinceArg) : null;
	const afterId = argValue('--after-id')?.trim() || null;
	const beforeId = argValue('--before-id')?.trim() || null;
	if ((afterId || beforeId) && (!kinds.has('log') || kinds.size !== 1)) {
		throw new Error('--after-id / --before-id only apply to log tables; use --kind=log.');
	}
	if ((afterId || beforeId) && (!tableFilter || tableFilter.size !== 1)) {
		throw new Error('--after-id / --before-id require --tables=<one log table> so the cursor applies to a single table.');
	}
	if (afterId && beforeId && afterId >= beforeId) {
		throw new Error(`Invalid id range: --after-id=${afterId} must be smaller than --before-id=${beforeId}.`);
	}

	const truncateBeforeLoad = args.includes('--truncate');
	const prune = args.includes('--prune');
	const check = args.includes('--check');

	if (truncateBeforeLoad && (tableFilter || kinds.size !== ETL_TABLE_KINDS.length || since)) {
		throw new Error(
			'--truncate wipes every ETL table, so it cannot be combined with --tables, --kind or --since. Use it only for the first full load.'
		);
	}
	if (truncateBeforeLoad && prune) {
		throw new Error('--truncate and --prune are mutually exclusive (truncate already empties the target).');
	}
	if (check && (truncateBeforeLoad || prune || args.includes('--dry-run'))) {
		throw new Error('--check is read-only; it cannot be combined with --truncate, --prune or --dry-run.');
	}
	if (since && !kinds.has('log')) {
		throw new Error('--since only applies to log tables; add log to --kind (e.g. --kind=state,log).');
	}
	if (prune && !kinds.has('config') && !kinds.has('state')) {
		throw new Error('--prune only applies to config / state tables; add config or state to --kind.');
	}

	return {
		postgresUrl,
		batchSize,
		truncateBeforeLoad,
		prune,
		dryRun: args.includes('--dry-run'),
		check,
		d1Transport: transportArg,
		pgConcurrency,
		kinds,
		since,
		afterId,
		beforeId,
		tableFilter,
		skipColumns,
		d1: parseD1ExecutionConfig(args),
	};
}

function selectTables(config: EtlConfig): EtlTableSpec[] {
	return (ETL_TABLES as readonly EtlTableSpec[]).filter(
		(table) => config.kinds.has(table.kind) && (!config.tableFilter || config.tableFilter.has(table.name))
	);
}

function toSqlValue(value: unknown): unknown {
	return value === undefined ? null : value;
}

function parseCount(rows: Record<string, unknown>[]): number {
	const countValue = rows[0]?.count;
	const count = typeof countValue === 'number' ? countValue : Number(countValue ?? 0);
	if (!Number.isFinite(count)) {
		throw new Error(`Invalid count value: ${String(countValue)}`);
	}
	return count;
}

async function truncateTables(sql: postgres.Sql): Promise<void> {
	await sql.unsafe(`TRUNCATE TABLE ${ETL_TABLES_TO_TRUNCATE.map(quoteIdentifier).join(', ')} CASCADE`);
}

/**
 * 写入前一次性检查所有待迁移表：目标表存在，且 D1 的每一列在 PG 里都有（或被明确跳过）。
 * 一次列出全部差异，避免跑到一半才在某张大表上失败。返回每张表实际要迁移的列。
 */
async function preflight(sql: postgres.Sql, tables: EtlTableSpec[], config: EtlConfig): Promise<Map<string, string[]>> {
	const columnsByTable = new Map<string, string[]>();
	const problems: string[] = [];

	const d1ColumnsByTable = getTablesColumns(
		tables.map((table) => table.name),
		config.d1
	);
	for (const spec of tables) {
		const d1Columns = d1ColumnsByTable.get(spec.name) ?? [];
		if (d1Columns.length === 0) {
			problems.push(`${spec.name}: D1 里没有这张表，或没有任何列`);
			continue;
		}
		const rows = await sql<{ column_name: string }[]>`
			SELECT column_name FROM information_schema.columns
			WHERE table_schema = ANY(current_schemas(false)) AND table_name = ${spec.name}
		`;
		if (rows.length === 0) {
			problems.push(
				`${spec.name}: Postgres 里没有这张表（search_path=${GATEWAY_POSTGRES_SEARCH_PATH}），先执行 npm run db:migrate:pg`
			);
			continue;
		}
		const pgColumns = new Set(rows.map((row) => row.column_name));
		const skipped = config.skipColumns.get(spec.name) ?? new Set<string>();
		const missing = d1Columns.filter((column) => !pgColumns.has(column) && !skipped.has(column));
		if (missing.length > 0) {
			problems.push(
				`${spec.name}: D1 有而 Postgres 没有的列 ${missing.join(', ')}。` +
					`两边应用同一套迁移；若确认是已废弃的旧列，用 --skip-columns=${missing.map((column) => `${spec.name}.${column}`).join(',')} 明确丢弃`
			);
			continue;
		}
		columnsByTable.set(
			spec.name,
			d1Columns.filter((column) => !skipped.has(column))
		);
	}

	if (problems.length > 0) {
		throw new Error(`Preflight failed, nothing was written:\n  - ${problems.join('\n  - ')}`);
	}
	return columnsByTable;
}

/**
 * 把“每表几次 wrangler 调用”合并成常数次：一次取全部计数、一次取全部主键、一次取全部首页。
 * 小表（配置、状态）因此一次调用就读完；只有超过一页的大表才继续分页。
 */
interface D1Snapshot {
	counts: Map<string, number>;
	/** 仅 config / state 表，且仅在 --prune / --check 时读取。 */
	keys: Map<string, string[][]>;
	firstPages: Map<string, Record<string, unknown>[]>;
}

function sinceFor(spec: EtlTableSpec, config: EtlConfig): string | null {
	return spec.sinceColumn ? config.since : null;
}

function afterIdFor(spec: EtlTableSpec, config: EtlConfig): string | null {
	return spec.keysetColumn ? config.afterId : null;
}

function beforeIdFor(spec: EtlTableSpec, config: EtlConfig): string | null {
	return spec.keysetColumn ? config.beforeId : null;
}

function loadSnapshot(tables: EtlTableSpec[], config: EtlConfig): D1Snapshot {
	const counts = new Map<string, number>();
	const countBatches = runD1ExecuteMany(
		tables.map((spec) => buildCountSql(spec, sinceFor(spec, config), afterIdFor(spec, config), beforeIdFor(spec, config))),
		config.d1
	);
	tables.forEach((spec, index) => counts.set(spec.name, parseCount(countBatches[index])));

	const keys = new Map<string, string[][]>();
	if (config.prune || config.check) {
		const keyed = tables.filter((spec) => spec.kind !== 'log');
		const keyBatches = runD1ExecuteMany(keyed.map(buildKeyListSql), config.d1);
		keyed.forEach((spec, index) => {
			const rows = keyBatches[index];
			if (rows.length * spec.conflictKeys.length > MAX_PG_PARAMS) {
				throw new Error(`Table ${spec.name} is too large to compare keys safely (${rows.length} keys).`);
			}
			keys.set(
				spec.name,
				spec.conflictKeys.map((key) => rows.map((row) => String(row[key] ?? '')))
			);
		});
	}

	const firstPages = new Map<string, Record<string, unknown>[]>();
	if (!config.dryRun) {
		// 日志表（keyset 分页）的每一页都走 streamD1Batches 的读取器，不在这里预取：
		// 两张大表的首页塞进同一次 wrangler 调用，响应体过大会让该请求直接失败。
		const nonEmpty = tables.filter((spec) => !spec.keysetColumn && (counts.get(spec.name) ?? 0) > 0);
		const pageBatches = runD1ExecuteMany(
			nonEmpty.map((spec) =>
				buildSelectBatchSql(spec, { batchSize: config.batchSize, offset: 0, lastKey: null, since: sinceFor(spec, config) })
			),
			config.d1
		);
		nonEmpty.forEach((spec, index) => firstPages.set(spec.name, pageBatches[index]));
	}
	return { counts, keys, firstPages };
}

async function pruneTable(sql: postgres.Sql, spec: EtlTableSpec, snapshot: D1Snapshot): Promise<void> {
	const deleted = await sql.unsafe(buildPruneSql(spec), snapshot.keys.get(spec.name) ?? []);
	console.log(`[ETL] prune ${spec.name}: removed ${deleted.count} stale row(s) not present in D1`);
}

let readerPromise: Promise<D1Reader> | undefined;

/** 分页读取用的 D1 读取器（进程内只建一次）。remote + api 时直连 REST，失败则退回 wrangler。 */
function getD1Reader(config: EtlConfig): Promise<D1Reader> {
	readerPromise ??= (async (): Promise<D1Reader> => {
		const viaWrangler: D1Reader = async (sqlText) => runD1ExecuteJson(sqlText, config.d1);
		if (config.d1.source !== 'remote' || config.d1Transport !== 'api') {
			return viaWrangler;
		}
		try {
			const reader = createRemoteD1Reader(config.d1.databaseName);
			console.log('[ETL] D1 读取：直连 Cloudflare REST /raw');
			return reader;
		} catch (error) {
			console.warn(`[ETL] 无法直连 REST，退回 wrangler：${error instanceof Error ? error.message : String(error)}`);
			return viaWrangler;
		}
	})();
	return readerPromise;
}

/** 以最多 `limit` 个并发处理 items。 */
async function runLimited<T>(items: readonly T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
	let next = 0;
	const worker = async (): Promise<void> => {
		while (next < items.length) {
			const item = items[next];
			next += 1;
			await work(item);
		}
	};
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/** 按 keyset（日志）或 rowid+OFFSET（其余）分批读 D1，逐批交给 onBatch。返回读到的总行数。 */
async function streamD1Batches(
	spec: EtlTableSpec,
	config: EtlConfig,
	since: string | null,
	totalRows: number,
	firstPage: Record<string, unknown>[] | undefined,
	onBatch: (rows: Record<string, unknown>[]) => Promise<void>
): Promise<number> {
	const reader = await getD1Reader(config);
	let read = 0;
	let lastKey: string | null = afterIdFor(spec, config);
	const fetchPage = (key: string | null, offset: number): Promise<Record<string, unknown>[]> => {
		const pending = reader(
			buildSelectBatchSql(spec, { batchSize: config.batchSize, offset, lastKey: key, since, beforeId: beforeIdFor(spec, config) })
		);
		pending.catch(() => undefined); // 出错时由 await 处抛出；避免写入失败后这里变成未处理的 rejection
		return pending;
	};
	let upcoming: Promise<Record<string, unknown>[]> | undefined = firstPage ? Promise.resolve(firstPage) : undefined;
	while (true) {
		const readStartedAt = Date.now();
		const d1Rows: Record<string, unknown>[] = await (upcoming ?? fetchPage(lastKey, read));
		upcoming = undefined;
		if (d1Rows.length === 0) {
			break;
		}
		const readWaitMs = Date.now() - readStartedAt;

		const nextKey: string | null = spec.keysetColumn ? String(d1Rows[d1Rows.length - 1][spec.keysetColumn]) : lastKey;
		const hasMore = d1Rows.length >= config.batchSize;
		// 写当前批的同时就开始读下一批：D1 单线程串行出数据，Postgres 写入与它重叠，总耗时取二者较大者。
		if (hasMore) {
			upcoming = fetchPage(nextKey, read + d1Rows.length);
		}

		const writeStartedAt = Date.now();
		await onBatch(d1Rows);
		const writeMs = Date.now() - writeStartedAt;

		read += d1Rows.length;
		lastKey = nextKey;
		// 分段耗时：读等待 = 写完后还要等多久才拿到下一批（接近 0 说明瓶颈在 Postgres 写入，否则在 D1 读取）。
		console.log(
			`[ETL] ${spec.name}: ${read}/${totalRows} (等待 D1 ${(readWaitMs / 1000).toFixed(1)}s · PG 写 ${(writeMs / 1000).toFixed(1)}s)`
		);
		if (!hasMore) {
			break;
		}
	}
	return read;
}

function rowsPerInsertFor(columns: string[], config: EtlConfig): number {
	return Math.max(1, Math.min(config.batchSize, Math.floor(MAX_PG_PARAMS / columns.length)));
}

function announceTable(
	spec: EtlTableSpec,
	totalRows: number,
	since: string | null,
	afterId: string | null,
	beforeId: string | null
): void {
	const parts: string[] = [];
	if (since) {
		parts.push(`created_at >= ${since} UTC`);
	}
	if (afterId) {
		parts.push(`id > ${afterId}`);
	}
	if (beforeId) {
		parts.push(`id < ${beforeId}`);
	}
	const scope = parts.length ? ` (${parts.join('; ')})` : '';
	console.log(`\n[ETL] ${spec.name} [${spec.kind}]: ${totalRows} rows remaining${scope}`);
}

async function migrateTable(
	sql: postgres.Sql,
	spec: EtlTableSpec,
	columns: string[],
	config: EtlConfig,
	snapshot: D1Snapshot
): Promise<number> {
	const since = sinceFor(spec, config);
	const totalRows = snapshot.counts.get(spec.name) ?? 0;
	announceTable(spec, totalRows, since, afterIdFor(spec, config), beforeIdFor(spec, config));
	if (config.dryRun || totalRows === 0) {
		return 0;
	}

	const rowsPerInsert = rowsPerInsertFor(columns, config);
	return streamD1Batches(spec, config, since, totalRows, snapshot.firstPages.get(spec.name), async (d1Rows) => {
		const starts: number[] = [];
		for (let start = 0; start < d1Rows.length; start += rowsPerInsert) {
			starts.push(start);
		}
		// 同一批里主键互不相同，多连接并发 upsert 不会互相冲突。
		await runLimited(starts, config.pgConcurrency, async (start) => {
			const chunk = d1Rows.slice(start, start + rowsPerInsert);
			const params = chunk.flatMap((row) => columns.map((column) => toSqlValue(row[column])));
			await sql.unsafe(buildUpsertSql(spec, columns, chunk.length), params as postgres.ParameterOrJSON<never>[]);
		});
	});
}

interface CheckResult {
	table: string;
	rows: number;
	/** D1 里有、但 Postgres 里不存在或内容不同的行。 */
	differ: number;
	/** Postgres 里有、但 D1 里已不存在的行（config / state 才检查）。 */
	stale: number;
}

/** 只读校验。必须在最终会回滚的事务里调用（见 runCheck）。 */
async function checkTable(
	tx: postgres.Sql,
	spec: EtlTableSpec,
	columns: string[],
	config: EtlConfig,
	snapshot: D1Snapshot
): Promise<CheckResult> {
	const since = sinceFor(spec, config);
	const totalRows = snapshot.counts.get(spec.name) ?? 0;
	announceTable(spec, totalRows, since, afterIdFor(spec, config), beforeIdFor(spec, config));
	let differ = 0;

	if (totalRows > 0) {
		const rowsPerInsert = rowsPerInsertFor(columns, config);
		await streamD1Batches(spec, config, since, totalRows, snapshot.firstPages.get(spec.name), async (d1Rows) => {
			for (let start = 0; start < d1Rows.length; start += rowsPerInsert) {
				const chunk = d1Rows.slice(start, start + rowsPerInsert);
				const params = chunk.flatMap((row) => columns.map((column) => toSqlValue(row[column])));
				const result = await tx.unsafe<{ changed: number }[]>(
					buildCheckSql(spec, columns, chunk.length),
					params as postgres.ParameterOrJSON<never>[]
				);
				differ += Number(result[0]?.changed ?? 0);
			}
		});
	}

	let stale = 0;
	if (spec.kind !== 'log') {
		const result = await tx.unsafe<{ stale: number }[]>(buildStaleCountSql(spec), snapshot.keys.get(spec.name) ?? []);
		stale = Number(result[0]?.stale ?? 0);
	}

	const verdict = differ === 0 && stale === 0 ? 'OK ' : 'DIFF';
	console.log(`[${verdict}] ${spec.name}: rows=${totalRows} differ=${differ} stale=${stale}`);
	return { table: spec.name, rows: totalRows, differ, stale };
}

class CheckRollback extends Error {}

/**
 * 所有表放进同一个事务、最后统一回滚：检查会“假装”插入新行，
 * 子表（如 model_routes）引用的父表行（如新建的 route_pools）在同一事务里对它可见，不会误报外键错误。
 * 事务绝不会提交，所以整个过程零写入。
 */
async function runCheck(
	sql: postgres.Sql,
	tables: EtlTableSpec[],
	columnsByTable: Map<string, string[]>,
	config: EtlConfig,
	snapshot: D1Snapshot
): Promise<CheckResult[]> {
	const results: CheckResult[] = [];
	try {
		await sql.begin(async (tx) => {
			for (const spec of tables) {
				results.push(
					await checkTable(tx as unknown as postgres.Sql, spec, columnsByTable.get(spec.name) ?? [], config, snapshot)
				);
			}
			throw new CheckRollback();
		});
	} catch (error) {
		if (!(error instanceof CheckRollback)) {
			throw error;
		}
	}
	return results;
}

async function main(): Promise<void> {
	const config = parseConfig();
	// 表在专用 schema 里，必须与 Proxy/Admin/迁移保持同一 search_path。
	// D1 的 created_at 是不带时区的 UTC 文本，session 时区必须是 UTC，否则 timestamptz 会整体偏移。
	const sql = postgres(config.postgresUrl, {
		max: config.pgConcurrency,
		types: ETL_PG_TYPES,
		// 迁移可整体重跑（按主键 upsert），所以关闭同步提交：事务不等 WAL 落盘，写入更快。
		connection: { search_path: GATEWAY_POSTGRES_SEARCH_PATH, timezone: 'UTC', synchronous_commit: 'off' },
	});

	try {
		const tables = selectTables(config);
		console.log(
			`[ETL] source=D1(${config.d1.source}:${config.d1.databaseName}) target=Postgres batch=${config.batchSize} kind=${[...config.kinds].join(',')}` +
				`${config.since ? ` since=${config.since}` : ''}${config.prune ? ' prune' : ''}${config.dryRun ? ' dry-run' : ''}${config.check ? ' check(read-only)' : ''}`
		);
		console.log(`[ETL] tables: ${tables.map((table) => table.name).join(', ')}`);

		const columnsByTable = await preflight(sql, tables, config);
		console.log('[ETL] preflight ok: 所有表存在且列一致');
		const snapshot = loadSnapshot(tables, config);

		if (config.check) {
			const results = await runCheck(sql, tables, columnsByTable, config, snapshot);
			const drifted = results.filter((result) => result.differ > 0 || result.stale > 0);
			if (drifted.length > 0) {
				console.error(
					`\n[ETL] check FAILED: ${drifted.map((result) => `${result.table}(differ=${result.differ},stale=${result.stale})`).join(' ')}`
				);
				console.error('[ETL] 重新同步这些表（config / state 加 --prune），再执行一次 --check 确认。');
				process.exitCode = 2;
			} else {
				console.log('\n[ETL] check OK: Postgres 与 D1 内容一致（零写入）。');
			}
			return;
		}

		if (config.truncateBeforeLoad && !config.dryRun) {
			console.log('[ETL] truncating target tables before load...');
			await truncateTables(sql);
		}

		if (config.prune && !config.dryRun) {
			// 先删子表再删父表；必须在 upsert 之前，避免“D1 里删了又重建（新 id、同名）”撞上 PG 里残留旧行的唯一约束。
			for (const spec of [...tables].reverse()) {
				if (spec.kind !== 'log') {
					await pruneTable(sql, spec, snapshot);
				}
			}
		}

		const summary: string[] = [];
		for (const spec of tables) {
			const migrated = await migrateTable(sql, spec, columnsByTable.get(spec.name) ?? [], config, snapshot);
			summary.push(`${spec.name}=${migrated}`);
		}

		console.log(`\n[ETL] Completed. ${summary.join(' ')}`);
		console.log('[ETL] 下一步：npx tsx scripts/db/cutover/reconcile-d1-postgres.ts');
	} finally {
		await sql.end();
	}
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
