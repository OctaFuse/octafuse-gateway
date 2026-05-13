/**
 * mysql2/promise 类型辅助。
 *
 * mysql2 的 query/execute 使用重载泛型，在 tsc strict 模式下难以自动推断；
 * 统一通过本文件的辅助函数进行类型断言，避免在各 impl 文件重复 `as unknown as T`。
 *
 * 使用原则：
 * - 结构化查询（SELECT + 简单 WHERE/ORDER）优先使用 Drizzle（`db.drizzle.select(...)`）获取编译时安全。
 * - 复杂 SQL（聚合、子查询、JOIN 等）或 INSERT/UPDATE/DELETE 使用 `mysqlQueryRows` / `mysqlExecute`。
 * - 需要事务时通过 `pool.getConnection()` 获取连接，再调用 `conn.execute()`。
 */

import type { Pool, PoolConnection, RowDataPacket, ResultSetHeader } from 'mysql2/promise';

export interface MySqlConnectionLike {
	query<T = unknown>(sql: string, values?: unknown[]): Promise<[T, unknown]>;
	execute<T = unknown>(sql: string, values?: unknown[]): Promise<[T, unknown]>;
	beginTransaction(): Promise<void>;
	commit(): Promise<void>;
	rollback(): Promise<void>;
	release(): void;
}

export interface MySqlPoolLike {
	query<T = unknown>(sql: string, values?: unknown[]): Promise<[T, unknown]>;
	execute<T = unknown>(sql: string, values?: unknown[]): Promise<[T, unknown]>;
	getConnection(): Promise<MySqlConnectionLike>;
}

export function asMySqlPool(pool: unknown): MySqlPoolLike {
	return pool as MySqlPoolLike;
}

/**
 * 执行 SELECT 并以 `RowDataPacket & T` 数组返回结果。
 * 所有需要 raw SQL 读查询的 impl 都应通过此函数，把类型断言收敛在这里。
 */
export async function mysqlQueryRows<T extends RowDataPacket>(
	pool: Pool | MySqlPoolLike,
	sql: string,
	values?: unknown[]
): Promise<T[]> {
	const [rows] = await (pool as MySqlPoolLike).query<T[]>(sql, values);
	return rows;
}

/**
 * 执行 INSERT / UPDATE / DELETE，返回 ResultSetHeader（含 affectedRows 等）。
 */
export async function mysqlExecute(
	pool: Pool | MySqlPoolLike | PoolConnection | MySqlConnectionLike,
	sql: string,
	values?: unknown[]
): Promise<ResultSetHeader> {
	const [result] = await (pool as MySqlPoolLike).execute<ResultSetHeader>(sql, values);
	return result;
}
