import type { D1Database } from '@cloudflare/workers-types';
import type { PoolOptions } from 'mysql2/promise';
import type postgres from 'postgres';
import { initD1Drizzle, type D1DrizzleClient } from './drizzle/client-d1';
import type { MySqlDrizzleClient } from './drizzle/client-mysql';
import type { PgDrizzleClient } from './drizzle/client-postgres';

export type DatabaseDriver = 'd1' | 'postgres' | 'mysql';

export interface DatabaseClient {
	readonly driver: DatabaseDriver;
}

export interface D1DatabaseClient extends DatabaseClient {
	readonly driver: 'd1';
	readonly raw: D1Database;
	readonly drizzle: D1DrizzleClient;
}

export interface PostgresDatabaseClient extends DatabaseClient {
	readonly driver: 'postgres';
	readonly raw: postgres.Sql<Record<string, postgres.PostgresType>>;
	readonly drizzle: PgDrizzleClient;
}

export interface MySqlDatabaseClient extends DatabaseClient {
	readonly driver: 'mysql';
	readonly raw: import('mysql2/promise').Pool;
	readonly drizzle: MySqlDrizzleClient;
}

export type GatewayDatabaseClient = D1DatabaseClient | PostgresDatabaseClient | MySqlDatabaseClient;

export function createD1DatabaseClient(db: D1Database): D1DatabaseClient {
	return {
		driver: 'd1',
		raw: db,
		drizzle: initD1Drizzle(db),
	};
}

export async function createPostgresDatabaseClient(
	connectionString: string,
	options: postgres.Options<Record<string, postgres.PostgresType>> = {}
): Promise<PostgresDatabaseClient> {
	const { initPostgresDrizzle } = await import('./drizzle/client-postgres');
	const { client, sql } = await initPostgresDrizzle(connectionString, options);
	return {
		driver: 'postgres',
		raw: sql,
		drizzle: client,
	};
}

export async function createMySqlDatabaseClient(
	connectionString: string,
	options: PoolOptions = {}
): Promise<MySqlDatabaseClient> {
	const { initMySqlDrizzle } = await import('./drizzle/client-mysql');
	const { client, pool } = await initMySqlDrizzle(connectionString, options);
	return {
		driver: 'mysql',
		raw: pool,
		drizzle: client,
	};
}
