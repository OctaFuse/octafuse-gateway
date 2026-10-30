import type { D1DatabaseClient } from '../../storage/database-client';
import { createOAuthAccessTokensSqlRepository, type SqlExec } from '../oauth-access-tokens.repository';

export function createD1OAuthAccessTokensRepository(db: D1DatabaseClient) {
	const exec: SqlExec = async (query, params) => {
		const statement = db.raw.prepare(query).bind(...params);
		if (/^\s*(select|with)\b/i.test(query)) {
			const result = await statement.all<Record<string, unknown>>();
			return result?.results ?? [];
		}
		await statement.run();
		return [];
	};
	return createOAuthAccessTokensSqlRepository(exec);
}
