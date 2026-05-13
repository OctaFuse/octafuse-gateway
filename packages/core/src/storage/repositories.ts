import type { GatewayDatabaseClient } from './database-client';
import type { GatewayRepositories } from './repositories-types';

export type {
	ApiKeysRepositoryHandle,
	GatewayRepositories,
	RequestLogsRepositoryHandle,
} from './repositories-types';
export { getGatewayDatabaseClient } from './repositories-types';

export { createD1Repositories } from './repositories-d1';

/**
 * 按 driver 装配仓储。MySQL / Postgres 实现经动态 import，避免 Cloudflare Worker（D1）打包进 `drizzle-orm/mysql-core` 等 Node 专用依赖。
 */
export async function createRepositories(client: GatewayDatabaseClient): Promise<GatewayRepositories> {
	if (client.driver === 'd1') {
		const { createD1Repositories } = await import('./repositories-d1');
		return createD1Repositories(client);
	}
	if (client.driver === 'mysql') {
		const { createMySqlRepositories } = await import('./repositories-mysql');
		return createMySqlRepositories(client);
	}
	const { createPostgresRepositories } = await import('./repositories-postgres');
	return createPostgresRepositories(client);
}
