import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	ETL_EXCLUDED_TABLES,
	ETL_TABLE_ORDER,
	ETL_TABLES,
	GATEWAY_POSTGRES_SEARCH_PATH,
	MIGRATION_META_TABLES,
	TABLE_CONFLICT_KEYS,
	getEtlTableSpec,
	parseKinds,
} from './migration-tables';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CORE = join(ROOT, 'packages', 'core');

interface Schema {
	tables: Set<string>;
	/** 子表 → 它引用的父表（已处理 rename / drop）。 */
	references: Map<string, Set<string>>;
}

/** 按迁移文件顺序回放 DDL，得到最终存在的表和外键。只认 CREATE / DROP / RENAME / REFERENCES。 */
function replayMigrations(dir: string): Schema {
	const tables = new Set<string>();
	const references = new Map<string, Set<string>>();
	const files = readdirSync(dir)
		.filter((file) => file.endsWith('.sql'))
		.sort();

	const event =
		/\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"?(\w+)"?|\bDROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?"?(\w+)"?|\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?"?(\w+)"?\s+RENAME\s+TO\s+"?(\w+)"?|\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?"?(\w+)"?|\bREFERENCES\s+"?(\w+)"?/gi;

	for (const file of files) {
		const sql = readFileSync(join(dir, file), 'utf8').replace(/--[^\n]*/g, '');
		let current: string | null = null;
		for (const match of sql.matchAll(event)) {
			const [, create, drop, renameFrom, renameTo, alter, ref] = match;
			if (create) {
				tables.add(create);
				current = create;
			} else if (drop) {
				tables.delete(drop);
				references.delete(drop);
				if (current === drop) {
					current = null;
				}
			} else if (renameFrom && renameTo) {
				tables.delete(renameFrom);
				tables.add(renameTo);
				const moved = references.get(renameFrom);
				references.delete(renameFrom);
				if (moved) {
					references.set(renameTo, moved);
				}
				current = renameTo;
			} else if (alter) {
				current = alter;
			} else if (ref && current && ref !== current) {
				const set = references.get(current) ?? new Set<string>();
				set.add(ref);
				references.set(current, set);
			}
		}
	}

	for (const meta of MIGRATION_META_TABLES) {
		tables.delete(meta);
	}
	return { tables, references };
}

const registered = new Set<string>([...ETL_TABLE_ORDER, ...Object.keys(ETL_EXCLUDED_TABLES)]);

describe('D1 → Postgres ETL 表注册表', () => {
	for (const engine of ['postgres', 'd1'] as const) {
		const schema = replayMigrations(join(CORE, `migrations-${engine}`));

		it(`${engine} 迁移里的每张业务表都已登记（迁移或明确排除）`, () => {
			const missing = [...schema.tables].filter((table) => !registered.has(table)).sort();
			assert.deepEqual(
				missing,
				[],
				`新表未登记到 scripts/db/lib/migration-tables.ts：${missing.join(', ')}。` +
					'加入 ETL_TABLES（并排好外键顺序），或加入 ETL_EXCLUDED_TABLES 并写明原因。'
			);
		});

		it(`登记的表在 ${engine} 迁移里都真实存在（没有已被删除的表）`, () => {
			const stale = [...registered].filter((table) => !schema.tables.has(table)).sort();
			assert.deepEqual(stale, [], `这些表已不在 ${engine} schema 里，请从注册表移除：${stale.join(', ')}`);
		});
	}

	it('ETL 顺序满足外键依赖（被引用表在前）', () => {
		const { references } = replayMigrations(join(CORE, 'migrations-postgres'));
		const position = new Map(ETL_TABLE_ORDER.map((name, index) => [name, index]));
		const violations: string[] = [];
		for (const [child, parents] of references) {
			const childPosition = position.get(child as never);
			if (childPosition === undefined) {
				continue;
			}
			for (const parent of parents) {
				const parentPosition = position.get(parent as never);
				if (parentPosition !== undefined && parentPosition > childPosition) {
					violations.push(`${child} 引用 ${parent}，但 ${parent} 排在后面`);
				}
			}
		}
		assert.deepEqual(violations, []);
	});

	it('不会引用一张既不迁移也未排除的表', () => {
		const { references } = replayMigrations(join(CORE, 'migrations-postgres'));
		const orphans: string[] = [];
		for (const [child, parents] of references) {
			if (!ETL_TABLE_ORDER.includes(child as never)) {
				continue;
			}
			for (const parent of parents) {
				if (!ETL_TABLE_ORDER.includes(parent as never)) {
					orphans.push(`${child} → ${parent}`);
				}
			}
		}
		assert.deepEqual(orphans, [], '被迁移表引用的父表必须同样被迁移，否则外键写入会失败');
	});

	it('表名无重复，且排除表与迁移表不重叠', () => {
		assert.equal(new Set(ETL_TABLE_ORDER).size, ETL_TABLE_ORDER.length);
		for (const excluded of Object.keys(ETL_EXCLUDED_TABLES)) {
			assert.ok(!ETL_TABLE_ORDER.includes(excluded as never), `${excluded} 同时出现在迁移与排除列表`);
		}
	});

	it('冲突键与 Postgres 主键一致', () => {
		const baseline = readdirSync(join(CORE, 'migrations-postgres'))
			.filter((file) => file.endsWith('.sql'))
			.sort()
			.map((file) => readFileSync(join(CORE, 'migrations-postgres', file), 'utf8'))
			.join('\n');
		for (const table of ETL_TABLES) {
			const create = new RegExp(`CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${table.name}\\s*\\(([\\s\\S]*?)\\n\\);`, 'i').exec(
				baseline
			);
			assert.ok(create, `找不到 ${table.name} 的 CREATE TABLE`);
			const body = create[1];
			const composite = /PRIMARY\s+KEY\s*\(([^)]+)\)/i.exec(body);
			const keys = composite
				? composite[1].split(',').map((key) => key.trim().replace(/"/g, ''))
				: [/^\s*"?(\w+)"?\s+\w+[^\n]*PRIMARY\s+KEY/im.exec(body)?.[1] ?? ''];
			assert.deepEqual([...TABLE_CONFLICT_KEYS[table.name]], keys, `${table.name} 的 conflictKeys 与主键不一致`);
		}
	});

	it('日志表使用 keyset 分页，其余表不使用', () => {
		for (const table of ETL_TABLES) {
			const spec = table as { kind: string; keysetColumn?: string; sinceColumn?: string };
			if (spec.kind === 'log') {
				assert.ok(spec.keysetColumn, `${table.name} 是日志表，必须配置 keysetColumn（OFFSET 在大表上线性变慢）`);
				assert.ok(spec.sinceColumn, `${table.name} 是日志表，必须配置 sinceColumn 以支持尾部补偿`);
			} else {
				assert.equal(spec.keysetColumn, undefined);
				assert.equal(spec.sinceColumn, undefined);
			}
		}
	});

	it('分组：会被请求或维护开关改写的表必须是 state，不能放进 config', () => {
		// config 表在窗口内只做 --check，不会重新复制。把请求路径会写的表放进 config，
		// 窗口内的改动就会被漏掉。这里把已核实的结论钉死；要改分组必须先重新核实写入方。
		const expected: Record<string, string> = {
			users: 'state', // budget_spent、钱包随请求变化
			api_keys: 'state', // last_used_at 随请求变化
			oauth_access_tokens: 'state', // 刷新轮换哈希与过期时间，last_used_at 随 MCP 调用变化
			route_pool_sticky_bindings: 'state', // Proxy 每次请求写
			system_config: 'state', // 维护模式开关存在这里，新环境要继承冻结状态
			providers: 'config',
			models: 'config',
			model_tags: 'config',
			route_pools: 'config',
			model_routes: 'config',
			model_surfaces: 'config',
			mcp_servers: 'config',
			mcp_server_items: 'config',
			admin_api_keys: 'config',
			api_key_request_logs: 'log',
			user_audit_logs: 'log',
		};
		assert.deepEqual(
			Object.fromEntries(ETL_TABLES.map((table) => [table.name, table.kind])),
			expected
		);
		assert.equal(getEtlTableSpec('system_config').kind, 'state');
	});

	it('search_path 与 Proxy/Admin 运行时保持一致', () => {
		const source = readFileSync(join(CORE, 'src', 'storage', 'drizzle', 'client-postgres.ts'), 'utf8');
		const match = /GATEWAY_POSTGRES_SEARCH_PATH\s*=\s*'([^']+)'/.exec(source);
		assert.ok(match, '找不到运行时的 GATEWAY_POSTGRES_SEARCH_PATH');
		assert.equal(GATEWAY_POSTGRES_SEARCH_PATH, match[1]);
	});
});

describe('parseKinds', () => {
	it('默认和 all 是全部三组', () => {
		assert.deepEqual([...parseKinds(undefined)].sort(), ['config', 'log', 'state']);
		assert.deepEqual([...parseKinds('all')].sort(), ['config', 'log', 'state']);
	});

	it('支持单个值与逗号组合', () => {
		assert.deepEqual([...parseKinds('config')], ['config']);
		assert.deepEqual([...parseKinds('state, log')].sort(), ['log', 'state']);
	});

	it('旧的 core 或拼错的值直接报错，不退化成全量', () => {
		assert.throws(() => parseKinds('core'), /Invalid --kind "core"/);
		assert.throws(() => parseKinds('config,logs'));
		assert.throws(() => parseKinds(''));
	});
});

describe('sinceIndex', () => {
	it('登记的索引确实在 D1 迁移里建过，且建在 sinceColumn 上', () => {
		const sql = readdirSync(join(CORE, 'migrations-d1'))
			.filter((file) => file.endsWith('.sql'))
			.sort()
			.map((file) => readFileSync(join(CORE, 'migrations-d1', file), 'utf8').replace(/--[^\n]*/g, ''))
			.join('\n');
		for (const spec of ETL_TABLES as readonly { name: string; sinceColumn?: string; sinceIndex?: string }[]) {
			if (!spec.sinceIndex) {
				continue;
			}
			assert.ok(spec.sinceColumn, `${spec.name} 登记了 sinceIndex 却没有 sinceColumn`);
			const created = new RegExp(`CREATE\\s+INDEX\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${spec.sinceIndex}\\s+ON\\s+${spec.name}\\s*\\(\\s*${spec.sinceColumn}\\s*\\)`, 'i');
			assert.match(sql, created, `${spec.name}: D1 迁移里没有建过 ${spec.sinceIndex}(${spec.sinceColumn})`);
		}
	});
});
