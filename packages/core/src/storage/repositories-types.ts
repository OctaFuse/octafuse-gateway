import type { GatewayDatabaseClient } from './database-client';
import type {
	AdminAnalyticsRepository,
	ApiKeyBudgetAuditLogsRepository,
	ApiKeysRepository,
	ModelRoutesRepository,
	ModelRoutingRepository,
	ModelsRepository,
	ProvidersRepository,
	RequestLogsRepository,
	SystemConfigRepository,
} from './gateway-repository-interfaces';
import type { ApiKeysD1Statements, RequestLogsD1Statements } from '../db/d1/d1-repository-extras';

export type ApiKeysRepositoryHandle = ApiKeysRepository & Partial<ApiKeysD1Statements>;
export type RequestLogsRepositoryHandle = RequestLogsRepository & Partial<RequestLogsD1Statements>;

export interface GatewayRepositories {
	readonly client: GatewayDatabaseClient;
	readonly apiKeys: ApiKeysRepositoryHandle;
	readonly requestLogs: RequestLogsRepositoryHandle;
	readonly providers: ProvidersRepository;
	readonly models: ModelsRepository;
	readonly routes: ModelRoutesRepository;
	readonly systemConfig: SystemConfigRepository;
	readonly analytics: AdminAnalyticsRepository;
	readonly modelRouting: ModelRoutingRepository;
	readonly budgetAuditLogs: ApiKeyBudgetAuditLogsRepository;
}

/** 统一取 Hono 上下文中的 `GatewayDatabaseClient`。 */
export function getGatewayDatabaseClient(repositories: GatewayRepositories): GatewayDatabaseClient {
	return repositories.client;
}
