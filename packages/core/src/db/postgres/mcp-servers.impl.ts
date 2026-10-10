import type { PostgresDatabaseClient } from '../../storage/database-client';
import { createMcpServersSqlRepository, type SqlExec } from '../mcp-servers.repository';

function toPg(query: string): string {
	let index = 0;
	return query.replace(/\?/g, () => {
		index += 1;
		return `$${index}`;
	});
}

export function createPostgresMcpServersRepository(db: PostgresDatabaseClient) {
	const exec: SqlExec = async (query, params) => {
		const rows = await db.raw.unsafe(toPg(query), params as never[]);
		return Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : [];
	};
	return createMcpServersSqlRepository(exec);
}
