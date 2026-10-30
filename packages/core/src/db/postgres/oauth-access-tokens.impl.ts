import type { PostgresDatabaseClient } from '../../storage/database-client';
import { createOAuthAccessTokensSqlRepository, type SqlExec } from '../oauth-access-tokens.repository';

function toPg(query: string): string {
	let index = 0;
	return query.replace(/\?/g, () => {
		index += 1;
		return `$${index}`;
	});
}

export function createPostgresOAuthAccessTokensRepository(db: PostgresDatabaseClient) {
	const exec: SqlExec = async (query, params) => {
		const rows = await db.raw.unsafe(toPg(query), params as never[]);
		return Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : [];
	};
	return createOAuthAccessTokensSqlRepository(exec);
}
