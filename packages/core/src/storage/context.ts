import type { D1Database } from '@cloudflare/workers-types';
import type { PoolOptions } from 'mysql2/promise';
import type postgres from 'postgres';
import {
	createD1DatabaseClient,
	createMySqlDatabaseClient,
	createPostgresDatabaseClient,
	type GatewayDatabaseClient,
} from './database-client';
import { createD1Repositories } from './repositories-d1';
import type { GatewayRepositories } from './repositories-types';

export interface StorageContext {
	readonly client: GatewayDatabaseClient;
	readonly repositories: GatewayRepositories;
}

export function createD1StorageContext(db: D1Database): StorageContext {
	const client = createD1DatabaseClient(db);
	const repositories = createD1Repositories(client);
	return { client, repositories };
}

export async function createPostgresStorageContext(
	connectionString: string,
	options: postgres.Options<Record<string, postgres.PostgresType>> = {}
): Promise<StorageContext> {
	const client = await createPostgresDatabaseClient(connectionString, options);
	const { createPostgresRepositories } = await import('./repositories-postgres');
	const repositories = createPostgresRepositories(client);
	return { client, repositories };
}

export async function createMySqlStorageContext(
	connectionString: string,
	options: PoolOptions = {}
): Promise<StorageContext> {
	const client = await createMySqlDatabaseClient(connectionString, options);
	const { createMySqlRepositories } = await import('./repositories-mysql');
	const repositories = createMySqlRepositories(client);
	return { client, repositories };
}
