import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRequire } from 'node:module';

type SqliteDatabase = {
	exec(sql: string): void;
	prepare(sql: string): {
		run(...values: string[]): { changes: number | bigint };
		get(...values: string[]): Record<string, unknown> | undefined;
		all(...values: string[]): Array<Record<string, unknown>>;
	};
	close(): void;
};
// Admin keeps Node 20 ambient types; tests run on the same SQLite-capable Node as core tests.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
	DatabaseSync: new (path: string) => SqliteDatabase;
};
import type { GatewayRepositories } from '@octafuse/core';
import type {
	D1DatabaseClient,
	PostgresDatabaseClient,
	MySqlDatabaseClient,
} from '../../../../core/src/storage/database-client';
import { createD1ModelsRepository } from '../../../../core/src/db/d1/models.impl';
import { createPostgresModelsRepository } from '../../../../core/src/db/postgres/models.impl';
import { createMySqlModelsRepository } from '../../../../core/src/db/mysql/models.impl';
import { deleteModelService } from './models-service';
import { AdminServiceError } from './errors';

function repositories(
	options: { routes?: unknown[]; deleted?: number; exists?: boolean } = {}
) {
	let writes = 0;
	const repos = {
		routes: {
			listModelRoutesWithJoins: async (filter: unknown) => {
				assert.deepEqual(filter, { modelId: 'm1' });
				return options.routes ?? [];
			},
		},
		models: {
			deleteModelIfUnrouted: async (id: string) => {
				assert.equal(id, 'm1');
				writes++;
				return options.deleted ?? 1;
			},
			getModelDetailWithRouteCounts: async () =>
				options.exists ? { id: 'm1' } : null,
		},
	} as unknown as GatewayRepositories;
	return { repos, writes: () => writes };
}
const status = (code: number) => (error: unknown) =>
	error instanceof AdminServiceError && error.status === code;

describe('model deletion service', () => {
	for (const routeStatus of ['active', 'disabled'])
		it(`blocks ${routeStatus} routes before any delete`, async () => {
			const { repos, writes } = repositories({
				routes: [{ id: 'r1', status: routeStatus }],
			});
			await assert.rejects(deleteModelService(repos, 'm1'), status(409));
			assert.equal(writes(), 0);
		});
	it('deletes an unrouted model', async () => {
		const { repos, writes } = repositories();
		await deleteModelService(repos, 'm1');
		assert.equal(writes(), 1);
	});
	it('returns conflict if a route appeared after the first check', async () => {
		const { repos } = repositories({ deleted: 0, exists: true });
		await assert.rejects(deleteModelService(repos, 'm1'), status(409));
	});
	it('returns not found for a missing model', async () => {
		const { repos } = repositories({ deleted: 0 });
		await assert.rejects(deleteModelService(repos, 'm1'), status(404));
	});
});

// Execute the actual DELETE statements produced by all three adapters against a disposable
// SQLite FK schema. This checks statement semantics, not network/driver integration.
function adapter(name: string, sqlite: SqliteDatabase) {
	if (name === 'D1')
		return createD1ModelsRepository({
			raw: {
				prepare(sql: string) {
					return {
						bind(...values: string[]) {
							return {
								async run() {
									const result = sqlite.prepare(sql).run(...values);
									return { meta: { changes: Number(result.changes) } };
								},
							};
						},
					};
				},
			},
		} as unknown as D1DatabaseClient);
	if (name === 'Postgres')
		return createPostgresModelsRepository({
			raw: async (parts: TemplateStringsArray, ...values: string[]) =>
				sqlite.prepare(parts.join('?')).all(...values),
		} as unknown as PostgresDatabaseClient);
	return createMySqlModelsRepository({
		raw: {
			async execute(sql: string, values: string[]) {
				const result = sqlite.prepare(sql).run(...values);
				return [{ affectedRows: Number(result.changes) }, []];
			},
		},
	} as unknown as MySqlDatabaseClient);
}
for (const name of ['D1', 'Postgres', 'MySQL'])
	describe(`${name} guarded model deletion statements`, () => {
		for (const routeStatus of ['active', 'disabled'])
			it(`preserves the model, ${routeStatus} route and tags`, async () => {
				const sqlite = new DatabaseSync(':memory:');
				try {
					sqlite.exec(
						`PRAGMA foreign_keys=ON; CREATE TABLE models(id TEXT PRIMARY KEY); CREATE TABLE model_tags(model_id TEXT REFERENCES models(id) ON DELETE CASCADE, tag TEXT); CREATE TABLE model_routes(id TEXT PRIMARY KEY, model_id TEXT REFERENCES models(id), status TEXT); INSERT INTO models VALUES('m1'); INSERT INTO model_tags VALUES('m1','tag');`
					);
					sqlite
						.prepare('INSERT INTO model_routes VALUES(?,?,?)')
						.run('r1', 'm1', routeStatus);
					const repo = adapter(name, sqlite);
					assert.equal(await repo.deleteModelIfUnrouted('m1'), 0);
					assert.equal(
						sqlite.prepare('SELECT count(*) AS n FROM models').get()?.n,
						1
					);
					assert.equal(
						sqlite.prepare('SELECT count(*) AS n FROM model_tags').get()?.n,
						1
					);
					assert.equal(
						sqlite.prepare('SELECT count(*) AS n FROM model_routes').get()?.n,
						1
					);
					sqlite.exec("DELETE FROM model_routes WHERE id='r1'");
					assert.equal(await repo.deleteModelIfUnrouted('m1'), 1);
					assert.equal(
						sqlite.prepare('SELECT count(*) AS n FROM models').get()?.n,
						0
					);
					assert.equal(
						sqlite.prepare('SELECT count(*) AS n FROM model_tags').get()?.n,
						0
					);
					assert.equal(await repo.deleteModelIfUnrouted('m1'), 0);
				} finally {
					sqlite.close();
				}
			});
	});
