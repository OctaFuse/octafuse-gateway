/**
 * D1 → Postgres ETL / 对账的表注册表（单一来源）。
 *
 * 新增迁移建表时，必须在这里登记：要么加入 `ETL_TABLES`（参与迁移），要么加入
 * `ETL_EXCLUDED_TABLES`（明确不迁并写明原因）。`migration-tables.test.ts` 会比对
 * `packages/core/migrations-*` 实际建出的表，漏登记 CI 直接失败。
 */

/** 与 `packages/core/src/storage/drizzle/client-postgres.ts` 的 GATEWAY_POSTGRES_SEARCH_PATH 保持一致（测试会校验）。 */
export const GATEWAY_POSTGRES_SEARCH_PATH = 'octafuse_gateway, public';

/**
 * 按"谁会改它"分三组，决定切换时在哪个阶段同步：
 *
 * - `config`：只有管理员（Admin）会写。Proxy 请求路径不写，预热时同步一次，
 *   维护窗口内用 `--check` 校验没有漂移即可（有漂移再 `--kind=config --prune` 补一次）。
 * - `state`：会被请求或维护开关改写，窗口内必须在冻结之后再同步（带 `--prune`）。
 *   `users`（预算/钱包）、`api_keys`（last_used_at）、`oauth_access_tokens`（刷新轮换）、`route_pool_sticky_bindings`（Proxy 每次请求都写）。
 *   `system_config` 是特例：只有 Admin 写，但维护模式开关本身就存在这里，
 *   新环境要继承“冻结”状态，所以必须在冻结之后同步。
 * - `log`：只追加的日志，体量大，预热时同步，窗口内只补尾部（`--since`）。
 */
export type EtlTableKind = 'config' | 'state' | 'log';

export const ETL_TABLE_KINDS: readonly EtlTableKind[] = ['config', 'state', 'log'];

/** 解析 `--kind`：`all`、单个值或逗号分隔（如 `state,log`）。写错直接报错，不退化成全量。 */
export function parseKinds(raw: string | undefined): Set<EtlTableKind> {
	const text = (raw ?? 'all').trim();
	if (text === 'all') {
		return new Set(ETL_TABLE_KINDS);
	}
	const kinds = new Set<EtlTableKind>();
	for (const item of text.split(',').map((entry) => entry.trim())) {
		if (!(ETL_TABLE_KINDS as readonly string[]).includes(item)) {
			throw new Error(`Invalid --kind "${item}", expected all or a comma list of ${ETL_TABLE_KINDS.join('|')}`);
		}
		kinds.add(item as EtlTableKind);
	}
	if (kinds.size === 0) {
		throw new Error('Invalid --kind: empty');
	}
	return kinds;
}

export interface EtlTableSpec {
	readonly name: string;
	readonly kind: EtlTableKind;
	/** `ON CONFLICT` 键，保证 ETL 可重复执行。 */
	readonly conflictKeys: readonly string[];
	/**
	 * 设置后按该列 keyset 分页（`WHERE col > last ORDER BY col`），否则按 `rowid` + OFFSET。
	 * 大表必须设置，OFFSET 会随偏移量线性变慢。该列须唯一且非空。
	 */
	readonly keysetColumn?: string;
	/** `--since` 过滤所用的时间列（仅 `log` 表）。 */
	readonly sinceColumn?: string;
	/**
	 * D1 里 `sinceColumn` 上的索引名。设置后 `--since` 的分页查询强制走它（`INDEXED BY`）。
	 * 不加的话 SQLite 为了满足 `ORDER BY id LIMIT` 会顺着主键全表扫描：
	 * 线上 85 万行请求日志补 2000 行尾部要 10 到 39 秒，走索引只要几毫秒。
	 * 索引不存在时 D1 会直接报错（不会静默变慢），测试也会核对迁移里确实建了这个索引。
	 */
	readonly sinceIndex?: string;
	/**
	 * `--check` 比较时忽略的列：运行中会被请求不断改写、与业务内容无关的使用时间戳。
	 * 只影响校验；同步（upsert）仍会照常复制这些列。
	 */
	readonly checkIgnoreColumns?: readonly string[];
}

/**
 * 顺序即写入顺序，必须满足外键依赖（被引用表在前）。
 * 测试会从迁移脚本里解析 `REFERENCES` 校验这一点。
 */
export const ETL_TABLES = [
	{ name: 'users', kind: 'state', conflictKeys: ['id'] },
	{ name: 'api_keys', kind: 'state', conflictKeys: ['id'] },
	// 访问令牌随授权 / 刷新改写；last_used_at 随每次 MCP 调用改写，不参与一致性校验。
	{ name: 'oauth_access_tokens', kind: 'state', conflictKeys: ['id'], checkIgnoreColumns: ['last_used_at'] },
	{ name: 'providers', kind: 'config', conflictKeys: ['id'] },
	{ name: 'models', kind: 'config', conflictKeys: ['id'] },
	{ name: 'model_tags', kind: 'config', conflictKeys: ['model_id', 'tag'] },
	{ name: 'route_pools', kind: 'config', conflictKeys: ['id'] },
	{ name: 'model_routes', kind: 'config', conflictKeys: ['id'] },
	{ name: 'model_surfaces', kind: 'config', conflictKeys: ['id'] },
	{ name: 'route_pool_sticky_bindings', kind: 'state', conflictKeys: ['route_pool_id', 'affinity_hash'] },
	{ name: 'mcp_servers', kind: 'config', conflictKeys: ['id'] },
	{ name: 'mcp_server_items', kind: 'config', conflictKeys: ['id'] },
	{ name: 'system_config', kind: 'state', conflictKeys: ['key'] },
	// last_used_at 在每次调用 Admin API 时被改写（维护窗口里读接口仍放行），不能参与一致性校验。
	{ name: 'admin_api_keys', kind: 'config', conflictKeys: ['id'], checkIgnoreColumns: ['last_used_at'] },
	{
		name: 'api_key_request_logs',
		kind: 'log',
		conflictKeys: ['id'],
		keysetColumn: 'id',
		sinceColumn: 'created_at',
		sinceIndex: 'idx_api_key_request_logs_created',
	},
	{
		name: 'user_audit_logs',
		kind: 'log',
		conflictKeys: ['id'],
		keysetColumn: 'id',
		sinceColumn: 'created_at',
	},
] as const satisfies readonly EtlTableSpec[];

export type EtlTableName = (typeof ETL_TABLES)[number]['name'];

/** 明确不迁移的表及原因。 */
export const ETL_EXCLUDED_TABLES: Readonly<Record<string, string>> = {
	admin_sessions: '后台登录会话，到新环境让管理员重新登录即可',
};

/** 迁移工具自己的元数据表，不属于业务表（测试解析时忽略）。 */
export const MIGRATION_META_TABLES: readonly string[] = ['d1_migrations', 'schema_migrations'];

export const ETL_TABLE_ORDER: readonly EtlTableName[] = ETL_TABLES.map((table) => table.name);

export const ETL_TABLES_TO_TRUNCATE: readonly EtlTableName[] = [...ETL_TABLE_ORDER].reverse();

export const TABLE_CONFLICT_KEYS: Readonly<Record<EtlTableName, readonly string[]>> = Object.fromEntries(
	ETL_TABLES.map((table) => [table.name, table.conflictKeys])
) as unknown as Record<EtlTableName, readonly string[]>;

export function getEtlTableSpec(name: string): EtlTableSpec {
	const spec = (ETL_TABLES as readonly EtlTableSpec[]).find((table) => table.name === name);
	if (!spec) {
		throw new Error(`Unknown ETL table: ${name}`);
	}
	return spec;
}
