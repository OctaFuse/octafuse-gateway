import type { MySqlDatabaseClient } from '../../storage/database-client';
import { createOAuthAccessTokensSqlRepository, type SqlExec } from '../oauth-access-tokens.repository';

export function createMySqlOAuthAccessTokensRepository(db: MySqlDatabaseClient) {
	const exec: SqlExec = async (query, params) => {
		const [rows] = await db.raw.query(query, params);
		return Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : [];
	};
	return createOAuthAccessTokensSqlRepository(exec);
}
