import type { GatewayDatabaseClient } from './database-client';
import type { GatewayRepositories } from './repositories-types';
import { createMySqlAdminAnalyticsRepository } from '../db/mysql/admin-analytics.impl';
import { createMySqlApiKeysRepository } from '../db/mysql/api-keys.impl';
import { createMySqlModelRoutesRepository } from '../db/mysql/model-routes.impl';
import { createMySqlModelRoutingRepository } from '../db/mysql/model-routing.impl';
import { createMySqlModelsRepository } from '../db/mysql/models.impl';
import { createMySqlProvidersRepository } from '../db/mysql/providers.impl';
import { createMySqlProviderApiKeysRepository } from '../db/mysql/provider-api-keys.impl';
import { createMySqlRequestLogsRepository } from '../db/mysql/request-logs.impl';
import { createMySqlSystemConfigRepository } from '../db/mysql/system-config.impl';
import { createMySqlUserAuditLogsRepository } from '../db/mysql/user-audit-logs.impl';
import { createMySqlUsersRepository } from '../db/mysql/users.impl';

export function createMySqlRepositories(client: GatewayDatabaseClient): GatewayRepositories {
	if (client.driver !== 'mysql') {
		throw new Error('createMySqlRepositories: expected MySQL client');
	}
	return {
		client,
		users: createMySqlUsersRepository(client),
		apiKeys: createMySqlApiKeysRepository(client),
		requestLogs: createMySqlRequestLogsRepository(client),
		providers: createMySqlProvidersRepository(client),
		providerKeys: createMySqlProviderApiKeysRepository(client),
		models: createMySqlModelsRepository(client),
		routes: createMySqlModelRoutesRepository(client),
		systemConfig: createMySqlSystemConfigRepository(client),
		analytics: createMySqlAdminAnalyticsRepository(client),
		modelRouting: createMySqlModelRoutingRepository(client),
		userAuditLogs: createMySqlUserAuditLogsRepository(client),
	};
}
