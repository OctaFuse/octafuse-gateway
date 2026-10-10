import type { D1DatabaseClient } from '../../storage/database-client';
import { createMcpServersSqlRepository, type SqlExec } from '../mcp-servers.repository';

function toRows(result: { results?: Array<Record<string, unknown>> } | null): Array<Record<string, unknown>> {
	return result?.results ?? [];
}

export function createD1McpServersRepository(db: D1DatabaseClient) {
	const exec: SqlExec = async (query, params) => {
		const statement = db.raw.prepare(query).bind(...params);
		if (/^\s*(select|with)\b/i.test(query)) {
			const result = await statement.all<Record<string, unknown>>();
			return toRows(result);
		}
		await statement.run();
		return [];
	};
	return createMcpServersSqlRepository(exec);
}
