import type { MySqlDatabaseClient } from '../../storage/database-client';
import type { SqlExec } from '../oauth-access-tokens.repository';
import { createOAuthServerSqlRepository } from '../oauth-server.repository';

export function createMySqlOAuthServerRepository(db: MySqlDatabaseClient) {
	const exec: SqlExec = async (query, params) => {
		const [rows] = await db.raw.query(query, params);
		return Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : [];
	};
	return createOAuthServerSqlRepository(exec);
}
