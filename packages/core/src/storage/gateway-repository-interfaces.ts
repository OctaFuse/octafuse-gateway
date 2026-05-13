import type {
	ApiKeyBudgetAuditLogRow,
	ApiKeyRow,
	GlobalApiKeyBudgetAuditLogRow,
	ModelRow,
	ModelRouteRow,
	ProviderRow,
	RequestLogRow,
} from '../types';
import type { InsertApiKeyBudgetAuditLogParams } from '../db/api-key-budget-audit-logs-types';
import type { BudgetFilter, InsertKeyParams } from '../db/api-keys-types';
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

export interface ApiKeyBudgetAuditLogsRepository {
	insertApiKeyBudgetAuditLog(params: InsertApiKeyBudgetAuditLogParams): Promise<void>;
	getApiKeyBudgetAuditLogsByKeyId(
		apiKeyId: string,
		page: number,
		pageSize: number
	): Promise<{ logs: ApiKeyBudgetAuditLogRow[]; total: number }>;
	getGlobalApiKeyBudgetAuditLogs(options: {
		page?: number;
		pageSize?: number;
		apiKeyId?: string;
		userEmail?: string;
		eventType?: string;
		actorType?: string;
		startDate?: string;
		endDate?: string;
	}): Promise<{ logs: GlobalApiKeyBudgetAuditLogRow[]; total: number }>;
}

export interface ApiKeysRepository {
	getApiKeyByKey(key: string): Promise<ApiKeyRow | null>;
	getApiKeyByKeyAnyStatus(key: string): Promise<ApiKeyRow | null>;
	getApiKeyById(id: string): Promise<ApiKeyRow | null>;
	getApiKeyByUserId(userId: string): Promise<ApiKeyRow | null>;
	insertApiKey(params: InsertKeyParams): Promise<void>;
	revokeApiKey(id: string): Promise<boolean>;
	deleteApiKeyHard(id: string, secretKey: string): Promise<boolean>;
	updateApiKeyStatusById(id: string, status: string): Promise<boolean>;
	setApiKeyUserEmailById(id: string, userEmail: string | null): Promise<boolean>;
	updateApiKeyBudget(id: string, budget_spent: number, budget_reset_at: string | null): Promise<void>;
	buildUpdateApiKeyBudgetStatement(id: string, budget_spent: number, budget_reset_at: string | null): Promise<void>;
	updateApiKeyBudgetWithAudit(
		id: string,
		budget_spent: number,
		budget_reset_at: string | null,
		audit: Omit<InsertApiKeyBudgetAuditLogParams, 'id' | 'apiKeyId' | 'afterSpent' | 'afterBudgetResetAt'>
	): Promise<void>;
	updateApiKeyPlan(
		id: string,
		budget_max: number | null,
		budget_period: string,
		budget_reset_at: string | null,
		resetBudget?: boolean,
		metadata?: string | null,
		budget_spent_override?: number | null,
		/**
		 * 周期 reset 时 `budget_max` 的恢复基准：
		 * - `undefined`：不修改 `budget_base`（仅调整 `budget_max` 的临时改额场景）。
		 * - `number`：SET `budget_base = ?`。
		 * - `null`：SET `budget_base = 0`（与库列的 NOT NULL DEFAULT 0 一致）。
		 */
		budget_base?: number | null
	): Promise<boolean>;
	setApiKeyMetadataById(id: string, metadataJson: string | null): Promise<boolean>;
	getAllApiKeys(options?: {
		email?: string;
		maxBudget?: BudgetFilter;
		page?: number;
		pageSize?: number;
	}): Promise<{ keys: AdminApiKeyListItem[]; total: number }>;
	getActiveApiKeysCount(): Promise<number>;
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
		supportsImages: unknown;
		description: unknown;
		metadata: unknown;
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
