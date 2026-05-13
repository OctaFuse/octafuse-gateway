import { pgCoreSchema } from './schema.pg';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type postgres from 'postgres';

export type PgDrizzleClient = PostgresJsDatabase<typeof pgCoreSchema>;

/**
 * 与 `packages/core/migrations-postgres/*.sql` 一致：业务表在 `octafuse_gateway`，不在 `public`。
 * 通过 postgres.js 的 Startup `connection` 参数设置会话级 `search_path`，
 * 使 Drizzle 与 `db/postgres/*.impl.ts` 中未带 schema 限定的 SQL 都命中正确表。
 *
 * 注意：`postgres` 会把连接串 query 里的参数合并进 `connection` 且可能覆盖同名键；
 * 若 `DATABASE_URL` 含冲突的 `search_path`，请先移除。
 */
export const GATEWAY_POSTGRES_SEARCH_PATH = 'octafuse_gateway, public';

export async function initPostgresDrizzle(
	connectionString: string,
	options: postgres.Options<Record<string, postgres.PostgresType>> = {}
): Promise<{ client: PgDrizzleClient; sql: postgres.Sql<Record<string, postgres.PostgresType>> }> {
	const [{ drizzle }, { default: postgresFactory }] = await Promise.all([
		import('drizzle-orm/postgres-js'),
		import('postgres'),
	]);

	const pgOptions: postgres.Options<Record<string, postgres.PostgresType>> = {
		...options,
		connection: {
			...(options.connection ?? {}),
			search_path: GATEWAY_POSTGRES_SEARCH_PATH,
		},
	};

	const sql = postgresFactory(connectionString, pgOptions);
	const client = drizzle(sql, { schema: pgCoreSchema });
	return { client, sql };
}
