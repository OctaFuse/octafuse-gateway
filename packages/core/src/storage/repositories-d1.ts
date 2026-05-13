import type { GatewayDatabaseClient } from './database-client';
import type { GatewayRepositories } from './repositories-types';
import { createD1AdminAnalyticsRepository } from '../db/d1/admin-analytics.impl';
import { createD1ApiKeysRepository } from '../db/d1/api-keys.impl';
import { createD1ModelRoutesRepository } from '../db/d1/model-routes.impl';
import { createD1ModelRoutingRepository } from '../db/d1/model-routing.impl';
import { createD1ModelsRepository } from '../db/d1/models.impl';
import { createD1ProvidersRepository } from '../db/d1/providers.impl';
import { createD1RequestLogsRepository } from '../db/d1/request-logs.impl';
import { createD1SystemConfigRepository } from '../db/d1/system-config.impl';
import { createD1UserAuditLogsRepository } from '../db/d1/user-audit-logs.impl';
import { createD1UsersRepository } from '../db/d1/users.impl';

export function createD1Repositories(client: GatewayDatabaseClient): GatewayRepositories {
	if (client.driver !== 'd1') {
		throw new Error('createD1Repositories: expected D1 client');
	}
	return {
		client,
		users: createD1UsersRepository(client),
		apiKeys: createD1ApiKeysRepository(client),
		requestLogs: createD1RequestLogsRepository(client),
		providers: createD1ProvidersRepository(client),
		models: createD1ModelsRepository(client),
		routes: createD1ModelRoutesRepository(client),
		systemConfig: createD1SystemConfigRepository(client),
		analytics: createD1AdminAnalyticsRepository(client),
		modelRouting: createD1ModelRoutingRepository(client),
		userAuditLogs: createD1UserAuditLogsRepository(client),
	};
}
