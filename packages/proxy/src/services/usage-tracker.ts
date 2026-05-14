/**
 * 用量与计费：按百万 token 单价计算 `metered_cost`（供应成本）、`standard_cost`（目录标准成本）、`charged_cost`（用户预算）。
 * - `metered_cost`：路由 `price_override.metered` 优先，否则 `models.pricing_profile`。
 * - `standard_cost`：仅 `models.pricing_profile`（与目录价侧一致）。
 * - `charged_cost`：路由 `price_override.charged` 优先，否则 `models.pricing_profile`；倍率见 `price_override.charged_factor`（仅展示/配置，不参与本公式）。
 * 写入 `api_key_request_logs`（含 `pricing_audit` JSON，见 `PRICING_AUDIT_JSON_SCHEMA_VERSION`）并在非 error 且 charged>0 时累加 `users.budget_spent`。
 */
import type { GatewayRepositories, UpstreamProtocol } from '@octafuse/core';
import {
	getUserBudgetSnapshot,
	insertRequestUsageAndChargeTx,
	PRICING_AUDIT_JSON_SCHEMA_VERSION,
	roundGatewayMoney,
	type PriceResolutionAuditSide,
	resolveChargedBillingPrices,
	resolveStandardBillingPrices,
	resolveSupplierBillingPrices,
	changedFieldsToJson,
	computeChangedFields,
	snapshotToJson,
	snapshotWithOverrides,
	userRowToSnapshot,
} from '@octafuse/core';
import type { UsageFromStream } from './proxy';
import { fireGatewayErrorWebhooks } from './alert-webhook';

const TOKENS_PER_MILLION = 1_000_000;

/**
 * 根据 token 数量与模型单价（每百万 token）计算原始成本；纯本地计算，不采用上游账单字段。
 */
export function computeMeteredCost(
	usage: UsageFromStream,
	input_price: number | null,
	output_price: number | null,
	cache_read_price: number | null,
	cache_write_price: number | null
): number {
	const inputPrice = input_price ?? 0;
	const outputPrice = output_price ?? 0;
	const cacheReadPrice = cache_read_price ?? inputPrice;
	const cacheWritePrice = cache_write_price ?? inputPrice;
	const regularInput = usage.input_tokens - usage.cache_read_tokens - usage.cache_write_tokens;
	return (
		(regularInput * inputPrice +
			usage.cache_read_tokens * cacheReadPrice +
			usage.cache_write_tokens * cacheWritePrice +
			usage.output_tokens * outputPrice) /
		TOKENS_PER_MILLION
	);
}

function buildRequestPricingAuditJson(options: {
	usage: UsageFromStream;
	supplierAudit: PriceResolutionAuditSide;
	standardAudit: PriceResolutionAuditSide;
	chargedAudit: PriceResolutionAuditSide;
}): string {
	return JSON.stringify({
		v: PRICING_AUDIT_JSON_SCHEMA_VERSION,
		basis_tokens: options.usage.input_tokens,
		snapshot: {
			supplier: options.supplierAudit,
			standard: options.standardAudit,
			user_charge: options.chargedAudit,
		},
	});
}

/**
 * 写入 `api_key_request_logs` 并在合适条件下增加 `users.budget_spent`（与插入日志同一 batch）。
 */
export async function recordUsage(
	repos: GatewayRepositories,
	params: {
		api_key_id: string;
		user_id: string;
		user_email: string | null;
		model_id: string;
		provider_id: string;
		provider_model_name?: string | null;
		model_name?: string | null;
		provider_name?: string | null;
		request_body?: string | null;
		upstream_request_body?: string | null;
		request_protocol: 'openai' | 'anthropic' | 'gemini';
		upstream_protocol: UpstreamProtocol;
		usage: UsageFromStream;
		model_pricing_profile?: string | null;
		route_price_override_json?: string | null;
		/** `price_override.metered` 的 JSON 字符串 */
		route_metered_profile_json?: string | null;
		/** `price_override.charged` 的 JSON 字符串 */
		route_charged_profile_json?: string | null;
		route_group: string;
		status: 'success' | 'error' | 'incomplete' | 'cancelled';
		latency_ms?: number;
		error_message?: string;
	}
): Promise<void> {
	const basis = params.usage.input_tokens;
	const supplierResolved = resolveSupplierBillingPrices({
		basisInputTokens: basis,
		routePriceOverrideJson: params.route_price_override_json ?? null,
		routeNestedMeteredProfileJson: params.route_metered_profile_json ?? null,
		modelPricingProfileJson: params.model_pricing_profile ?? null,
	});
	const standardResolved = resolveStandardBillingPrices({
		basisInputTokens: basis,
		modelPricingProfileJson: params.model_pricing_profile ?? null,
	});
	const chargedResolved = resolveChargedBillingPrices({
		basisInputTokens: basis,
		routePriceOverrideJson: params.route_price_override_json ?? null,
		routeNestedChargedProfileJson: params.route_charged_profile_json ?? null,
		modelPricingProfileJson: params.model_pricing_profile ?? null,
	});
	const supplierCost = computeMeteredCost(
		params.usage,
		supplierResolved.prices.input_price,
		supplierResolved.prices.output_price,
		supplierResolved.prices.cache_read_price,
		supplierResolved.prices.cache_write_price
	);
	const standardCost = computeMeteredCost(
		params.usage,
		standardResolved.prices.input_price,
		standardResolved.prices.output_price,
		standardResolved.prices.cache_read_price,
		standardResolved.prices.cache_write_price
	);
	const chargedRaw = computeMeteredCost(
		params.usage,
		chargedResolved.prices.input_price,
		chargedResolved.prices.output_price,
		chargedResolved.prices.cache_read_price,
		chargedResolved.prices.cache_write_price
	);
	const chargedCost = roundGatewayMoney(chargedRaw);
	const supplierCostR = roundGatewayMoney(supplierCost);
	const standardCostR = roundGatewayMoney(standardCost);
	const pricingAuditJson = buildRequestPricingAuditJson({
		usage: params.usage,
		supplierAudit: supplierResolved.audit,
		standardAudit: standardResolved.audit,
		chargedAudit: chargedResolved.audit,
	});
	console.log(
		`[Gateway Usage] recordUsage model_id=${params.model_id} request_protocol=${params.request_protocol} status=${params.status} route_group=${params.route_group} input_tokens=${params.usage.input_tokens} output_tokens=${params.usage.output_tokens} reasoning_tokens=${params.usage.reasoning_tokens} metered=${supplierCostR} standard=${standardCostR} charged=${chargedCost}`
	);
	const id = crypto.randomUUID();
	const shouldChargeBudget = params.status !== 'error' && chargedCost > 0;
	const userSnapshot = shouldChargeBudget ? await getUserBudgetSnapshot(repos, params.user_id) : null;
	const beforeSpent = userSnapshot?.budgetSpent ?? 0;
	const userRow = shouldChargeBudget ? await repos.users.getById(params.user_id) : null;
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
	await insertRequestUsageAndChargeTx(repos, {
		userId: params.user_id,
		requestLog: {
			id,
			userId: params.user_id,
			apiKeyId: params.api_key_id,
			userEmail: params.user_email,
			modelId: params.model_id,
			providerId: params.provider_id,
			providerModelName: params.provider_model_name ?? null,
			modelName: params.model_name ?? null,
			providerName: params.provider_name ?? null,
			requestBody: params.request_body ?? null,
			upstreamRequestBody: params.upstream_request_body ?? null,
			requestProtocol: params.request_protocol,
			upstreamProtocol: params.upstream_protocol,
			inputTokens: params.usage.input_tokens,
			outputTokens: params.usage.output_tokens,
			cacheReadTokens: params.usage.cache_read_tokens,
			cacheWriteTokens: params.usage.cache_write_tokens,
			reasoningTokens: params.usage.reasoning_tokens,
			totalTokens: params.usage.total_tokens,
			meteredCost: supplierCostR,
			standardCost: standardCostR,
			chargedCost: chargedCost,
			routeGroup: params.route_group,
			status: params.status,
			latencyMs: params.latency_ms ?? null,
			errorMessage: params.error_message ?? null,
			rawUsage: params.usage.raw_usage ?? null,
			pricingAudit: pricingAuditJson,
		},
		shouldChargeBudget,
		beforeSpent,
		chargedCost,
		audit: {
			apiKeyId: params.api_key_id,
			eventType: 'usage_charge',
			actorType: 'system',
			reasonCode: 'request_usage_charged_cost',
			reasonText: 'Usage charge',
			beforeSpent: beforeSpent,
			beforeBudgetMax: userSnapshot?.budgetMax ?? null,
			afterBudgetMax: userSnapshot?.budgetMax ?? null,
			beforeBudgetPeriod: userSnapshot?.budgetPeriod ?? null,
			afterBudgetPeriod: userSnapshot?.budgetPeriod ?? null,
			beforeBudgetResetAt: userSnapshot?.budgetResetAt ?? null,
			afterBudgetResetAt: userSnapshot?.budgetResetAt ?? null,
			requestLogId: id,
			metadata: null,
			beforeUserSnapshot: usageSnaps?.before ?? null,
			afterUserSnapshot: usageSnaps?.after ?? null,
			changedFields: usageSnaps?.changed ?? null,
			correlationId: id,
			source: 'usage_charge',
		},
	});
	if (params.status === 'error') {
		await fireGatewayErrorWebhooks(repos, {
			requestLogId: id,
			apiKeyId: params.api_key_id,
			userEmail: params.user_email,
			modelId: params.model_id,
			providerId: params.provider_id,
			providerModelName: params.provider_model_name ?? null,
			routeGroup: params.route_group,
			requestProtocol: params.request_protocol,
			upstreamProtocol: params.upstream_protocol,
			errorMessage: params.error_message ?? null,
			latencyMs: params.latency_ms ?? null,
		}).catch((err: unknown) => {
			console.warn(
				'[Gateway Alert] webhook dispatch failed',
				err instanceof Error ? err.stack ?? err.message : err
			);
		});
	}
}
