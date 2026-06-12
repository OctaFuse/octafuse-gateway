import type {
	GlobalUserAuditLogRow,
	ModelRow,
	ModelRouteRow,
	ProviderRow,
	RequestLogRow,
	ResolvedGatewayKeyRow,
	UserAuditLogRow,
	UserRow,
	ApiKeyRow,
} from '../types';
import type { InsertUserAuditLogParams } from '../db/user-audit-logs-types';
import type { BudgetFilter, InsertKeyParams } from '../db/api-keys-types';
import type { InsertUserParams, UserMaxBudgetFilter } from '../db/users-types';
import type { ApiKeyListSortField, ApiKeyListSortOrder } from '../db/api-keys-list-sort';
import type { UserListSortField, UserListSortOrder } from '../db/users-list-sort';
import type { ProviderProtocolBases } from '../db/providers-types';
import type { SystemConfigRow } from '../db/system-config-types';
import type {
	AdminApiKeyListItem,
	ModelAnalyticsRow,
	ModelProviderReliabilityRow,
	ModelRouteDetailRow,
	ModelRouteJoinRow,
	ModelWithRouteCountsRow,
	ProviderAdminRow,
	ProviderAnalyticsRow,
	ProviderReliabilityRow,
	UserAnalyticsRow,
} from './repository-dtos';

/** 管理端分析聚合 */
export interface AdminAnalyticsRepository {
	queryModelAnalytics(options: { start: string; end: string; tag?: string }): Promise<ModelAnalyticsRow[]>;
	queryDistinctModelTags(): Promise<string[]>;
	queryUserAnalytics(options: { start: string; end: string; email?: string }): Promise<UserAnalyticsRow[]>;
	queryProviderAnalytics(options: { start: string; end: string; tag?: string }): Promise<ProviderAnalyticsRow[]>;
	queryProviderReliability(options: { start: string; end: string }): Promise<ProviderReliabilityRow[]>;
	queryModelProviderReliability(options: { start: string; end: string }): Promise<ModelProviderReliabilityRow[]>;
}

export interface UserAuditLogsRepository {
	insertUserAuditLog(params: InsertUserAuditLogParams): Promise<void>;
	getUserAuditLogsByUserId(
		userId: string,
		page: number,
		pageSize: number
	): Promise<{ logs: UserAuditLogRow[]; total: number }>;
	getGlobalUserAuditLogs(options: {
		page?: number;
		pageSize?: number;
		userId?: string;
		apiKeyId?: string;
		userEmail?: string;
		eventType?: string;
		actorType?: string;
		reasonCode?: string;
		source?: string;
		correlationId?: string;
		startDate?: string;
		endDate?: string;
	}): Promise<{ logs: GlobalUserAuditLogRow[]; total: number }>;
}

export interface ApiKeysRepository {
	getApiKeyByKey(key: string): Promise<ApiKeyRow | null>;
	getApiKeyByKeyAnyStatus(key: string): Promise<ApiKeyRow | null>;
	getApiKeyById(id: string): Promise<ApiKeyRow | null>;
	getApiKeyWithUserByKey(key: string): Promise<ResolvedGatewayKeyRow | null>;
	getApiKeyWithUserById(id: string): Promise<ResolvedGatewayKeyRow | null>;
	listKeysByUserId(userId: string, options?: { status?: string }): Promise<ApiKeyRow[]>;
	insertApiKey(params: InsertKeyParams): Promise<void>;
	revokeApiKey(id: string): Promise<boolean>;
	deleteApiKeyHard(id: string, secretKey: string): Promise<boolean>;
	updateApiKeyStatusById(id: string, status: string): Promise<boolean>;
	setApiKeyMetadataById(id: string, metadataJson: string | null): Promise<boolean>;
	updateApiKeyName(id: string, name: string | null): Promise<boolean>;
	getAllApiKeys(options?: {
		email?: string;
		userId?: string;
		maxBudget?: BudgetFilter;
		page?: number;
		pageSize?: number;
		sort?: ApiKeyListSortField;
		order?: ApiKeyListSortOrder;
	}): Promise<{ keys: AdminApiKeyListItem[]; total: number }>;
	getActiveApiKeysCount(): Promise<number>;
}

export interface UsersRepository {
	getById(id: string): Promise<UserRow | null>;
	getByExternalPair(externalSystem: string, externalUserId: string): Promise<UserRow | null>;
	listByEmail(email: string): Promise<UserRow[]>;
	list(options?: {
		email?: string;
		externalSystem?: string;
		externalUserId?: string;
		maxBudget?: UserMaxBudgetFilter;
		status?: string;
		page?: number;
		pageSize?: number;
		sort?: UserListSortField;
		order?: UserListSortOrder;
	}): Promise<{ users: UserRow[]; total: number }>;
	createUser(params: InsertUserParams): Promise<void>;
	updateUserPlan(
		id: string,
		budget_max: number | null,
		budget_period: string,
		budget_reset_at: string | null,
		resetBudget?: boolean,
		metadata?: string | null,
		budget_spent_override?: number | null,
		budget_base?: number | null
	): Promise<boolean>;
	updateUserStatus(id: string, status: string): Promise<boolean>;
	setUserMetadataById(id: string, metadataJson: string | null): Promise<boolean>;
	setUserEmailById(id: string, email: string): Promise<boolean>;
	/**
	 * 同时更新一对 external 身份。两者要么都为非空字符串，要么都为 null
	 * （由调用方校验；底层依赖 `users_external_pair_chk` 兜底）。
	 */
	setUserExternalIdentityById(
		id: string,
		externalSystem: string | null,
		externalUserId: string | null
	): Promise<boolean>;
	deleteUserHard(id: string): Promise<boolean>;
}

/** 模型列表页、标签、级联删除（models + model_tags + model_routes） */
export interface ModelsRepository {
	listModelsWithRouteCounts(): Promise<ModelWithRouteCountsRow[]>;
	getModelDetailWithRouteCounts(id: string): Promise<ModelWithRouteCountsRow | null>;
	insertModel(params: {
		id: string;
		displayName: unknown;
		vendor: string;
		contextWindow: unknown;
		maxTokens: unknown;
		pricingProfile?: unknown;
		description: unknown;
		metadata: unknown;
		inputModalities?: unknown;
		outputModalities?: unknown;
		releasedAt?: unknown;
	}): Promise<void>;
	replaceModelTags(modelId: string, tags: string[]): Promise<void>;
	updateModelByPatch(id: string, rest: Record<string, unknown>): Promise<number>;
	deleteModelCascade(id: string): Promise<number>;
}

/** 推理路径：模型行（含 tags）、活跃路由列表、按 modelId 取路由 */
export interface ModelRoutingRepository {
	getModelById(id: string): Promise<ModelRow | null>;
	listModelsWithActiveRoutes(): Promise<ModelRow[]>;
	getModelRoutesByModelId(modelId: string): Promise<ModelRouteRow[]>;
}

export interface ModelRoutesRepository {
	listModelRoutesWithJoins(filters: { modelId?: string; providerId?: string }): Promise<ModelRouteJoinRow[]>;
	insertModelRoute(params: {
		id: string;
		modelId: string;
		providerId: string;
		providerModelName: string;
		priority: number;
		status: string;
		routeGroup: string;
		priceOverride: unknown;
		customParams: string | null;
		upstreamProtocol: string;
	}): Promise<void>;
	getModelRouteRowById(id: string): Promise<ModelRouteDetailRow | null>;
	updateModelRouteByPatch(id: string, patch: Record<string, unknown>): Promise<number>;
	deleteModelRouteById(id: string): Promise<number>;
}

export interface ProvidersRepository {
	listProviders(): Promise<ProviderAdminRow[]>;
	providerIdExists(id: string): Promise<boolean>;
	insertProvider(params: {
		id: string;
		name: string;
		baseUrlOpenai: string | null;
		baseUrlAnthropic: string | null;
		baseUrlGemini: string | null;
		apiKey: string;
		description: unknown;
	}): Promise<void>;
	updateProviderByPatch(id: string, body: Record<string, unknown>): Promise<number>;
	deleteProviderById(id: string): Promise<number>;
	getProviderById(id: string): Promise<ProviderRow | null>;
	getProviderRowById(id: string): Promise<ProviderAdminRow | null>;
	getProviderProtocolBases(providerId: string): Promise<ProviderProtocolBases | null>;
}

/** Filters for {@link RequestLogsRepository.getRequestLogsByKeyId}. If `includeStatuses` is non-empty after whitelist, use `status IN (...)`; else if `excludeStatus` is set, use `(status IS NULL OR status != ?)`; else no status predicate. */
export type RequestLogsByKeyIdFilter = {
	excludeStatus?: string;
	includeStatuses?: string[];
};

export interface RequestLogsRepository {
	getRequestLogsByKeyId(
		apiKeyId: string,
		page: number,
		pageSize: number,
		filter?: RequestLogsByKeyIdFilter
	): Promise<{ logs: RequestLogRow[]; total: number }>;
	getRequestLogs(options: {
		page?: number;
		pageSize?: number;
		apiKeyId?: string;
		userId?: string;
		userEmail?: string;
		modelId?: string;
		providerId?: string;
		routeGroup?: string;
		protocol?: string;
		status?: string;
		startDate?: string;
		endDate?: string;
	}): Promise<{ logs: RequestLogRow[]; total: number }>;
	getRequestStatsByRange(options: {
		startDate: string;
		endDate: string;
		endExclusive?: boolean;
	}): Promise<{
		totalRequests: number;
		errorCount: number;
		successCount: number;
		chargedCost: number;
		meteredCost: number;
		standardCost: number;
	}>;
	getRecentLogs(limit: number): Promise<RequestLogRow[]>;
	getRecentErrors(limit: number): Promise<RequestLogRow[]>;
	getDistinctActiveUsersCount(options: { startDate: string; endDate: string; endExclusive?: boolean }): Promise<number>;
}

export interface SystemConfigRepository {
	listSystemConfigRows(): Promise<SystemConfigRow[]>;
	upsertSystemConfigValue(key: string, value: string): Promise<void>;
	getConfig(key: string): Promise<string | null>;
	getAllConfig(): Promise<Record<string, string>>;
}
