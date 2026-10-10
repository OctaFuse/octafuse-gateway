import type { MySqlDatabaseClient } from '../../storage/database-client';
import { createMcpServersSqlRepository, type SqlExec } from '../mcp-servers.repository';

export function createMySqlMcpServersRepository(db: MySqlDatabaseClient) {
	const exec: SqlExec = async (query, params) => {
		const [rows] = await db.raw.query(query, params);
		return Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : [];
	};
	return createMcpServersSqlRepository(exec);
}
