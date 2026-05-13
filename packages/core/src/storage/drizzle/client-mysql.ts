import { mysqlCoreSchema } from './schema.mysql';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import type { Pool, PoolOptions } from 'mysql2/promise';

export type MySqlDrizzleClient = MySql2Database<typeof mysqlCoreSchema>;

export async function initMySqlDrizzle(
	connectionString: string,
	options: PoolOptions = {}
): Promise<{ client: MySqlDrizzleClient; pool: Pool }> {
	const [{ drizzle }, mysql2Promise] = await Promise.all([import('drizzle-orm/mysql2'), import('mysql2/promise')]);
	const pool =
		Object.keys(options).length > 0
			? mysql2Promise.createPool({ ...options, uri: connectionString })
			: mysql2Promise.createPool(connectionString);
	const client = drizzle(pool, { schema: mysqlCoreSchema, mode: 'default' });
	return { client, pool };
}
