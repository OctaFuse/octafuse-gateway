import type { GatewayDatabaseClient } from './database-client';
import type { GatewayRepositories } from './repositories-types';
import { createPostgresAdminAnalyticsRepository } from '../db/postgres/admin-analytics.impl';
import { createPostgresApiKeysRepository } from '../db/postgres/api-keys.impl';
import { createPostgresModelRoutesRepository } from '../db/postgres/model-routes.impl';
import { createPostgresModelRoutingRepository } from '../db/postgres/model-routing.impl';
import { createPostgresModelsRepository } from '../db/postgres/models.impl';
import { createPostgresProvidersRepository } from '../db/postgres/providers.impl';
import { createPostgresRequestLogsRepository } from '../db/postgres/request-logs.impl';
import { createPostgresSystemConfigRepository } from '../db/postgres/system-config.impl';
import { createPostgresRoutePoolStickyBindingsRepository } from '../db/postgres/route-pool-sticky-bindings.impl';
import { createPostgresUserAuditLogsRepository } from '../db/postgres/user-audit-logs.impl';
import { createPostgresUsersRepository } from '../db/postgres/users.impl';
import { createPostgresAdminAccessRepository } from '../db/postgres/admin-access.impl';

export function createPostgresRepositories(client: GatewayDatabaseClient): GatewayRepositories {
	if (client.driver !== 'postgres') {
		throw new Error('createPostgresRepositories: expected Postgres client');
	}
	return {
		client,
		users: createPostgresUsersRepository(client),
		apiKeys: createPostgresApiKeysRepository(client),
		requestLogs: createPostgresRequestLogsRepository(client),
		providers: createPostgresProvidersRepository(client),
		models: createPostgresModelsRepository(client),
		routes: createPostgresModelRoutesRepository(client),
		systemConfig: createPostgresSystemConfigRepository(client),
		analytics: createPostgresAdminAnalyticsRepository(client),
		modelRouting: createPostgresModelRoutingRepository(client),
		userAuditLogs: createPostgresUserAuditLogsRepository(client),
		routePoolSticky: createPostgresRoutePoolStickyBindingsRepository(client),
		adminAccess: createPostgresAdminAccessRepository(client),
	};
}
