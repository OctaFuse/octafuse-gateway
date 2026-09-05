/**
 * 固定单价工具调用记账：写入 request log（三账本）并原子增加 budget_spent（仅 charged）。
 */
import {
	buildFixedToolCostPricingAudit,
	canAffordTotalCost,
	changedFieldsToJson,
	computeChangedFields,
	computeTotalRemaining,
	getUserBudgetSnapshot,
	hasPositiveTotalBalance,
	insertRequestUsageAndChargeTx,
	roundGatewayMoney,
	snapshotToJson,
	snapshotWithOverrides,
	splitChargeFromBudgetSnapshot,
	userRowToSnapshot,
	type GatewayRepositories,
	type ToolUnitPrices,
} from '@octafuse/core';

export type ChargeToolUsageParams = {
	repos: GatewayRepositories;
	apiKeyId: string;
	userId: string;
	userEmail: string | null;
	/** 记入 model_id，如 tool:web-search */
	toolId: string;
	/**
	 * Active 引擎 id（如 `bocha`、`tencent_tms`）。
	 * 写入 `provider_model_name`，并进入 `pricing_audit.provider`。
	 */
	toolProvider: string;
	/** 供应成本（写入 metered_cost） */
	meteredCost: number;
	/** 目录标准价（写入 standard_cost） */
	standardCost: number;
	/** 用户扣费（写入 charged_cost；唯一累加 budget_spent） */
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
	/** Request Host (observe only) */
	ingressHost?: string | null;
	/** pricing_audit 计费单位；默认 request */
	pricingUnit?: 'request' | 'chars';
	/** 计费单元数；默认 1 */
	billingUnits?: number;
	/**
	 * 单价（缩放前）。缺省时按 totals / billingUnits 反推。
	 */
	unitPrices?: ToolUnitPrices;
	/** 合并进 `pricing_audit`（勿覆盖 `provider`；以 {@link toolProvider} 为准） */
	pricingAuditExtra?: Record<string, unknown>;
};

/**
 * 成功路径应调用；`status=error` 时写日志但不扣费（三列均为 0）。
 */
export async function chargeToolUsage(params: ChargeToolUsageParams): Promise<{ requestLogId: string; chargedCost: number }> {
	const isError = params.status === 'error';
	const meteredCost = roundGatewayMoney(isError ? 0 : params.meteredCost);
	const standardCost = roundGatewayMoney(isError ? 0 : params.standardCost);
	const chargedCost = roundGatewayMoney(isError ? 0 : params.chargedCost);
	const shouldChargeBudget = !isError && chargedCost > 0;
	const billingUnits =
		params.billingUnits != null && Number.isFinite(params.billingUnits) && params.billingUnits > 0
			? params.billingUnits
			: 1;
	const pricingUnit = params.pricingUnit ?? 'request';
	const unitPrices: ToolUnitPrices = params.unitPrices
		? {
				metered: roundGatewayMoney(params.unitPrices.metered),
				standard: roundGatewayMoney(params.unitPrices.standard),
				charged: roundGatewayMoney(params.unitPrices.charged),
			}
		: {
				metered: roundGatewayMoney(meteredCost / billingUnits),
				standard: roundGatewayMoney(standardCost / billingUnits),
				charged: roundGatewayMoney(chargedCost / billingUnits),
			};

	const toolProvider = params.toolProvider.trim();
	const pricingAudit = buildFixedToolCostPricingAudit({
		toolId: params.toolId,
		unit: pricingUnit,
		billingUnits,
		unitPrices,
		totals: { metered: meteredCost, standard: standardCost, charged: chargedCost },
		extra: {
			...(params.pricingAuditExtra ?? {}),
			...(toolProvider ? { provider: toolProvider } : {}),
		},
	});

	const id = crypto.randomUUID();
	const userSnapshot = shouldChargeBudget ? await getUserBudgetSnapshot(params.repos, params.userId) : null;
	const beforeSpent = userSnapshot?.budgetSpent ?? 0;
	const split = splitChargeFromBudgetSnapshot(userSnapshot, chargedCost);
	const userRow = shouldChargeBudget ? await params.repos.users.getById(params.userId) : null;
	const afterSpentVal = split.afterPeriodSpent;
	let usageSnaps: { before: string; after: string; changed: string | null } | null = null;
	if (userRow) {
		const beforeS = userRowToSnapshot(userRow);
		const afterS = snapshotWithOverrides(beforeS, {
			budget_spent: afterSpentVal,
			wallet_spent: roundGatewayMoney(Number(userRow.wallet_spent ?? 0) + split.fromWallet),
		});
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
			/** 引擎 id；Request Logs ROUTE 列第二行展示（不再重复写 tool id） */
			providerModelName: toolProvider || params.toolId,
			modelName: params.toolId,
			providerName: 'OctaFuse Tools',
			requestBody: params.requestBody ?? null,
			upstreamRequestBody: null,
			requestProtocol: 'openai',
			/**
			 * 列类型仅允许 openai|anthropic|gemini；Tools 无真正 upstream protocol。
			 * Admin Request Logs 对 `provider_id=octafuse-tools` 会隐藏该徽章，避免误读为模型上游。
			 */
			upstreamProtocol: 'openai',
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			reasoningTokens: 0,
			totalTokens: 0,
			meteredCost,
			standardCost,
			chargedCost,
			chargedWalletCost: split.fromWallet,
			routeGroup: 'default',
			status: params.status,
			latencyMs: params.latencyMs,
			errorMessage: params.errorMessage ?? null,
			rawUsage: params.responseBody ?? null,
			pricingAudit: JSON.stringify(pricingAudit),
			ingressHost: params.ingressHost ?? null,
		},
		shouldChargeBudget,
		beforeSpent,
		chargedCost,
		chargedFromWallet: split.fromWallet,
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

type AffordPools = {
	budgetMax: number | null;
	budgetSpent: number;
	walletGranted?: number;
	walletSpent?: number;
};

/** 预检：总余额是否够支付固定费用（budget_max 为 null 表示不限）。 */
export function canAffordToolCost(totalRemaining: number | null, toolCost: number): boolean;
export function canAffordToolCost(
	budgetMax: number | null,
	budgetSpent: number,
	toolCost: number,
	walletGranted?: number,
	walletSpent?: number
): boolean;
export function canAffordToolCost(
	a: number | null,
	b: number,
	c?: number,
	walletGranted = 0,
	walletSpent = 0
): boolean {
	if (c === undefined) {
		if (a == null) return true;
		return roundGatewayMoney(b) <= roundGatewayMoney(a);
	}
	return canAffordTotalCost(a, b, walletGranted, walletSpent, c);
}

export function apiKeyTotalRemaining(apiKey: AffordPools): number | null {
	return computeTotalRemaining(
		apiKey.budgetMax,
		apiKey.budgetSpent,
		apiKey.walletGranted ?? 0,
		apiKey.walletSpent ?? 0
	);
}

export function apiKeyHasBalance(apiKey: AffordPools): boolean {
	return hasPositiveTotalBalance(
		apiKey.budgetMax,
		apiKey.budgetSpent,
		apiKey.walletGranted ?? 0,
		apiKey.walletSpent ?? 0
	);
}
