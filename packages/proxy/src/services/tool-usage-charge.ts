/**
 * 固定单价工具调用记账：写入 request log 并原子增加 budget_spent。
 */
import {
	changedFieldsToJson,
	computeChangedFields,
	getUserBudgetSnapshot,
	insertRequestUsageAndChargeTx,
	roundGatewayMoney,
	snapshotToJson,
	snapshotWithOverrides,
	userRowToSnapshot,
	type GatewayRepositories,
} from '@octafuse/core';

export type ChargeToolUsageParams = {
	repos: GatewayRepositories;
	apiKeyId: string;
	userId: string;
	userEmail: string | null;
	/** 记入 model_id，如 tool:web-search */
	toolId: string;
	chargedCost: number;
	latencyMs: number;
	/** 工具入参 JSON（如 query） */
	requestBody?: string | null;
	/**
	 * 工具出参摘要 JSON（如搜索结果 title/url）。
	 * 复用 `api_key_request_logs.raw_usage`；工具无 token usage。
	 */
	responseBody?: string | null;
	errorMessage?: string | null;
	status: 'success' | 'error';
};

/**
 * 成功路径应调用；`status=error` 时写日志但不扣费。
 */
export async function chargeToolUsage(params: ChargeToolUsageParams): Promise<{ requestLogId: string; chargedCost: number }> {
	const chargedCost = roundGatewayMoney(params.status === 'error' ? 0 : params.chargedCost);
	const shouldChargeBudget = params.status !== 'error' && chargedCost > 0;
	const id = crypto.randomUUID();
	const userSnapshot = shouldChargeBudget ? await getUserBudgetSnapshot(params.repos, params.userId) : null;
	const beforeSpent = userSnapshot?.budgetSpent ?? 0;
	const userRow = shouldChargeBudget ? await params.repos.users.getById(params.userId) : null;
	const afterSpentVal = roundGatewayMoney(beforeSpent + chargedCost);
	let usageSnaps: { before: string; after: string; changed: string | null } | null = null;
	if (userRow) {
		const beforeS = userRowToSnapshot(userRow);
		const afterS = snapshotWithOverrides(beforeS, { budget_spent: afterSpentVal });
		usageSnaps = {
			before: snapshotToJson(beforeS),
			after: snapshotToJson(afterS),
			changed: changedFieldsToJson(computeChangedFields(beforeS, afterS)),
		};
	}

	await insertRequestUsageAndChargeTx(params.repos, {
		userId: params.userId,
		requestLog: {
			id,
			userId: params.userId,
			apiKeyId: params.apiKeyId,
			userEmail: params.userEmail,
			modelId: params.toolId,
			providerId: 'octafuse-tools',
			providerModelName: params.toolId,
			modelName: params.toolId,
			providerName: 'OctaFuse Tools',
			requestBody: params.requestBody ?? null,
			upstreamRequestBody: null,
			requestProtocol: 'openai',
			upstreamProtocol: 'openai',
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			reasoningTokens: 0,
			totalTokens: 0,
			meteredCost: chargedCost,
			standardCost: chargedCost,
			chargedCost,
			routeGroup: 'default',
			status: params.status,
			latencyMs: params.latencyMs,
			errorMessage: params.errorMessage ?? null,
			rawUsage: params.responseBody ?? null,
			pricingAudit: JSON.stringify({
				kind: 'fixed_tool_cost',
				tool_id: params.toolId,
				charged_usd: chargedCost,
			}),
		},
		shouldChargeBudget,
		beforeSpent,
		chargedCost,
		audit: {
			apiKeyId: params.apiKeyId,
			eventType: 'usage_charge',
			actorType: 'system',
			reasonCode: 'tool_usage_charged_cost',
			reasonText: `Tool charge: ${params.toolId}`,
			beforeSpent,
			beforeBudgetMax: userSnapshot?.budgetMax ?? null,
			afterBudgetMax: userSnapshot?.budgetMax ?? null,
			beforeBudgetPeriod: userSnapshot?.budgetPeriod ?? null,
			afterBudgetPeriod: userSnapshot?.budgetPeriod ?? null,
			beforeBudgetResetAt: userSnapshot?.budgetResetAt ?? null,
			afterBudgetResetAt: userSnapshot?.budgetResetAt ?? null,
			requestLogId: id,
			beforeUserSnapshot: usageSnaps?.before ?? null,
			afterUserSnapshot: usageSnaps?.after ?? null,
			changedFields: usageSnaps?.changed ?? null,
			correlationId: id,
			/** 与 chat 用量扣费同属 `gateway_usage`；用 `reason_code=tool_usage_charged_cost` 区分 */
			source: 'gateway_usage',
		},
	});

	return { requestLogId: id, chargedCost };
}

/** 预检：当前额度是否够支付固定费用（budget_max 为 null 表示不限）。 */
export function canAffordToolCost(
	budgetMax: number | null,
	budgetSpent: number,
	toolCost: number
): boolean {
	if (budgetMax == null) {
		return true;
	}
	const cost = roundGatewayMoney(toolCost);
	return roundGatewayMoney(budgetSpent + cost) <= roundGatewayMoney(budgetMax);
}
