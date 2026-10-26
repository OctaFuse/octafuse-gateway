import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	buildCheckSql,
	buildCountSql,
	buildPruneSql,
	buildStaleCountSql,
	buildSelectBatchSql,
	buildUpsertSql,
	normalizeSince,
	quoteLiteral,
} from './etl-sql';
import { getEtlTableSpec } from './migration-tables';

const logs = getEtlTableSpec('api_key_request_logs');
const users = getEtlTableSpec('users');
const tags = getEtlTableSpec('model_tags');

describe('normalizeSince', () => {
	it('统一成 D1 的 UTC 文本格式', () => {
		assert.equal(normalizeSince('2026-10-25'), '2026-10-25 00:00:00');
		assert.equal(normalizeSince('2026-10-25 06:30:00'), '2026-10-25 06:30:00');
		assert.equal(normalizeSince('2026-10-25T06:30:00Z'), '2026-10-25 06:30:00');
	});

	it('带时区偏移时换算为 UTC', () => {
		assert.equal(normalizeSince('2026-10-25T14:00:00+08:00'), '2026-10-25 06:00:00');
	});

	it('拒绝无法解析的值，避免静默同步全量或空集', () => {
		assert.throws(() => normalizeSince('yesterday'));
		assert.throws(() => normalizeSince('2026-13-40'));
		assert.throws(() => normalizeSince("2026-10-25'; DROP TABLE users;--"));
	});
});

describe('buildSelectBatchSql', () => {
	it('日志表按主键 keyset 分页，不使用 OFFSET', () => {
		const first = buildSelectBatchSql(logs, { batchSize: 1000, offset: 0, lastKey: null, since: null });
		assert.equal(first, 'SELECT * FROM "api_key_request_logs" ORDER BY "id" LIMIT 1000');

		const next = buildSelectBatchSql(logs, { batchSize: 1000, offset: 5000, lastKey: 'abc', since: null });
		assert.equal(next, `SELECT * FROM "api_key_request_logs" WHERE "id" > 'abc' ORDER BY "id" LIMIT 1000`);
		assert.ok(!next.includes('OFFSET'));
	});

	it('--since 与 keyset 同时生效，且保留 created_at 为 NULL 的行', () => {
		const sql = buildSelectBatchSql(logs, {
			batchSize: 500,
			offset: 0,
			lastKey: 'k1',
			since: '2026-10-25 06:00:00',
		});
		assert.match(sql, /\("created_at" >= '2026-10-25 06:00:00' OR "created_at" IS NULL\) AND "id" > 'k1'/);
	});

	it('有 since 且登记了索引时强制走时间列索引，避免顺着主键全表扫描', () => {
		const sql = buildSelectBatchSql(logs, { batchSize: 500, offset: 0, lastKey: null, since: '2026-10-25 06:00:00' });
		assert.match(sql, /^SELECT \* FROM "api_key_request_logs" INDEXED BY "idx_api_key_request_logs_created" WHERE /);
		// 没有 since 时不加提示：全量读取就是按主键顺序扫。
		assert.ok(!buildSelectBatchSql(logs, { batchSize: 500, offset: 0, lastKey: null, since: null }).includes('INDEXED BY'));
		// 审计日志在 D1 里没有 created_at 索引，不能写 INDEXED BY。
		assert.ok(
			!buildSelectBatchSql(getEtlTableSpec('user_audit_logs'), { batchSize: 500, offset: 0, lastKey: null, since: '2026-10-25 06:00:00' }).includes('INDEXED BY')
		);
	});

	it('核心表按 rowid + OFFSET，且不受 --since 影响', () => {
		const sql = buildSelectBatchSql(users, { batchSize: 500, offset: 1000, lastKey: null, since: '2026-10-25 06:00:00' });
		assert.equal(sql, 'SELECT * FROM "users" ORDER BY rowid LIMIT 500 OFFSET 1000');
	});

	it('keyset 值里的单引号被转义', () => {
		assert.equal(quoteLiteral("a'b"), "'a''b'");
		const sql = buildSelectBatchSql(logs, { batchSize: 1, offset: 0, lastKey: "x'; DROP--", since: null });
		assert.ok(sql.includes(`'x''; DROP--'`));
	});
});

describe('after-id / 中断续跑', () => {
	it('计数与首批都从 id > afterId 开始', () => {
		assert.equal(
			buildCountSql(logs, null, 'abc'),
			`SELECT COUNT(*) AS count FROM "api_key_request_logs" WHERE "id" > 'abc'`
		);
		assert.equal(
			buildSelectBatchSql(logs, { batchSize: 10, offset: 0, lastKey: 'abc', since: null }),
			`SELECT * FROM "api_key_request_logs" WHERE "id" > 'abc' ORDER BY "id" LIMIT 10`
		);
	});
});

describe('--before-id 定点修复区间', () => {
	it('与 afterId 圈出 (after, before) 区间，计数与分页一致', () => {
		assert.equal(
			buildCountSql(logs, null, 'a', 'b'),
			`SELECT COUNT(*) AS count FROM "api_key_request_logs" WHERE "id" > 'a' AND "id" < 'b'`
		);
		assert.equal(
			buildSelectBatchSql(logs, { batchSize: 10, offset: 0, lastKey: 'a1', since: null, beforeId: 'b' }),
			`SELECT * FROM "api_key_request_logs" WHERE "id" > 'a1' AND "id" < 'b' ORDER BY "id" LIMIT 10`
		);
	});

	it('核心表不受 beforeId 影响', () => {
		assert.equal(buildCountSql(users, null, null, 'b'), 'SELECT COUNT(*) AS count FROM "users"');
	});
});

describe('buildCountSql', () => {
	it('日志表带 since，核心表忽略 since', () => {
		assert.match(buildCountSql(logs, '2026-10-25 06:00:00'), /WHERE \("created_at" >=/);
		assert.equal(buildCountSql(users, '2026-10-25 06:00:00'), 'SELECT COUNT(*) AS count FROM "users"');
	});
});

describe('buildUpsertSql', () => {
	it('按冲突键 upsert，并更新其余列', () => {
		const sql = buildUpsertSql(users, ['id', 'email', 'budget_spent'], 2);
		assert.equal(
			sql,
			'INSERT INTO "users" ("id", "email", "budget_spent") VALUES ($1, $2, $3), ($4, $5, $6) ' +
				'ON CONFLICT ("id") DO UPDATE SET "email" = EXCLUDED."email", "budget_spent" = EXCLUDED."budget_spent"'
		);
	});

	it('复合主键；全部列都是键时 DO NOTHING', () => {
		const sql = buildUpsertSql(tags, ['model_id', 'tag'], 1);
		assert.match(sql, /ON CONFLICT \("model_id", "tag"\) DO NOTHING$/);
	});
});

describe('buildPruneSql', () => {
	it('单键表', () => {
		assert.equal(
			buildPruneSql(users),
			'DELETE FROM "users" AS t WHERE NOT EXISTS (SELECT 1 FROM unnest($1::text[]) AS d(k0) WHERE t."id"::text = d.k0)'
		);
	});

	it('复合键表按下标对齐', () => {
		assert.equal(
			buildPruneSql(tags),
			'DELETE FROM "model_tags" AS t WHERE NOT EXISTS (SELECT 1 FROM unnest($1::text[], $2::text[]) AS d(k0, k1) ' +
				'WHERE t."model_id"::text = d.k0 AND t."tag"::text = d.k1)'
		);
	});
});

describe('buildStaleCountSql', () => {
	it('与 prune 同一判据，只数不删', () => {
		const sql = buildStaleCountSql(users);
		assert.equal(
			sql,
			'SELECT COUNT(*)::int AS stale FROM "users" AS t WHERE NOT EXISTS (SELECT 1 FROM unnest($1::text[]) AS d(k0) WHERE t."id"::text = d.k0)'
		);
		assert.ok(!/DELETE/i.test(sql));
		assert.equal(buildPruneSql(users).split(' WHERE ')[1], sql.split(' WHERE ')[1]);
	});
});

describe('buildCheckSql', () => {
	it('只在新行或内容不同时命中，不比较键列', () => {
		const sql = buildCheckSql(users, ['id', 'email', 'budget_spent'], 1);
		assert.equal(
			sql,
			'WITH changed AS (INSERT INTO "users" AS t ("id", "email", "budget_spent") VALUES ($1, $2, $3) ' +
				'ON CONFLICT ("id") DO UPDATE SET "email" = EXCLUDED."email", "budget_spent" = EXCLUDED."budget_spent" ' +
				'WHERE (t."email", t."budget_spent") IS DISTINCT FROM (EXCLUDED."email", EXCLUDED."budget_spent") RETURNING 1) ' +
				'SELECT COUNT(*)::int AS changed FROM changed'
		);
	});

	it('登记为忽略的使用时间戳不参与比较，但同步仍会复制它', () => {
		const keys = getEtlTableSpec('admin_api_keys');
		assert.deepEqual(keys.checkIgnoreColumns, ['last_used_at']);
		const columns = ['id', 'name', 'status', 'last_used_at'];
		const check = buildCheckSql(keys, columns, 1);
		assert.match(
			check,
			/WHERE \(t\."name", t\."status"\) IS DISTINCT FROM \(EXCLUDED\."name", EXCLUDED\."status"\) RETURNING 1\)/
		);
		assert.ok(!/IS DISTINCT FROM[^)]*last_used_at/.test(check));
		assert.match(buildUpsertSql(keys, columns, 1), /"last_used_at" = EXCLUDED\."last_used_at"/);
	});

	it('非键列全部被忽略时等同于只有键列', () => {
		const sql = buildCheckSql({ ...getEtlTableSpec('admin_api_keys'), checkIgnoreColumns: ['name'] }, ['id', 'name'], 1);
		assert.match(sql, /DO NOTHING RETURNING 1\)/);
	});

	it('其他登记表不忽略任何列', () => {
		for (const name of ['users', 'api_keys', 'providers', 'models', 'system_config']) {
			assert.equal(getEtlTableSpec(name).checkIgnoreColumns, undefined, name);
		}
	});

	it('全部列都是键时只有新插入的行命中', () => {
		const sql = buildCheckSql(tags, ['model_id', 'tag'], 2);
		assert.match(sql, /ON CONFLICT \("model_id", "tag"\) DO NOTHING RETURNING 1\)/);
		assert.ok(!sql.includes('IS DISTINCT FROM'));
	});
});
