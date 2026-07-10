/**
 * 用量与计费：按百万 token 单价计算 `metered_cost`（供应成本）、`standard_cost`（目录标准成本）、`charged_cost`（用户预算）。
 * - 基数始终来自 `models.pricing_profile`（按 input_tokens 选档）。
 * - `metered_cost` = 目录价 × `metered_factor` × `schedule.metered`（缺省倍率 1）。
 * - `charged_cost` = 目录价 × `charged_factor` × `schedule.charged`（缺省倍率 1）。
 * - `standard_cost` = 目录价（不乘路由倍率）。
 * - nested `price_override.metered` / `charged` tiers 忽略不计价。
 * 写入 `api_key_request_logs`（含 `pricing_audit` JSON，见 `PRICING_AUDIT_JSON_SCHEMA_VERSION`）并在非 error 且 charged>0 时累加 `users.budget_spent`。
 */
import type { GatewayRepositories, UpstreamProtocol } from '@octafuse/core';
import {
	getBusinessTimezone,
	getUserBudgetSnapshot,
	insertRequestUsageAndChargeTx,
	parseRouteBaseFactors,
	parseRoutePricingSchedule,
	PRICING_AUDIT_JSON_SCHEMA_VERSION,
	resolveChargedBillingPrices,
	resolveDailyScheduleFactor,
	resolveStandardBillingPrices,
	resolveSupplierBillingPrices,
	roundGatewayMoney,
	scaleBillingPrices,
	type BillingPriceSnapshot,
	type PriceResolutionAuditSide,
	changedFieldsToJson,
	computeChangedFields,
	snapshotToJson,
	snapshotWithOverrides,
	userRowToSnapshot,
} from '@octafuse/core';
import type { UsageFromStream } from './proxy';
import { fireGatewayErrorWebhooks } from './alert-webhook';
import type { GatewayCircuitAlertEvent } from './circuit-alert-types';
import type { RequestTimingSnapshot } from './request-timing';

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

function applyRouteFactorsToSide(options: {
	catalog: { prices: BillingPriceSnapshot; audit: PriceResolutionAuditSide };
	baseFactor: number;
	scheduleFactor: ReturnType<typeof resolveDailyScheduleFactor>;
}): { prices: BillingPriceSnapshot; audit: PriceResolutionAuditSide } {
	const effective = options.baseFactor * options.scheduleFactor.factor;
	const prices = scaleBillingPrices(options.catalog.prices, effective);
	const sch = options.scheduleFactor;
	return {
		prices,
		audit: {
			...options.catalog.audit,
			source: 'model_x_factor',
			base_factor: options.baseFactor,
			schedule: {
				timezone: sch.timezone,
				local_time: sch.localTime,
				evaluated_at_utc: sch.evaluatedAtUtc,
				factor: sch.factor,
				window: sch.window
					? { start: sch.window.start, end: sch.window.end, factor: sch.window.factor }
					: null,
			},
			effective_factor: effective,
			prices,
		},
	};
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
		/** @deprecated Ignored; nested metered tiers are not used for billing. */
		route_metered_profile_json?: string | null;
		/** @deprecated Ignored; nested charged tiers are not used for billing. */
		route_charged_profile_json?: string | null;
		/** 请求进入 Gateway 的时间；每日时段倍率在该时刻锁定。 */
		request_started_at_ms?: number;
		route_group: string;
		status: 'success' | 'error' | 'incomplete' | 'cancelled';
		latency_ms?: number;
		timing?: RequestTimingSnapshot | null;
		error_message?: string;
		provider_key_id?: string | null;
		provider_key_label?: string | null;
		provider_key_fingerprint?: string | null;
		/** 上游响应头 request id（传输层追踪，见 `upstream-request-id.ts`） */
		upstream_request_id?: string | null;
		/** 上游响应 body message id（应用层生成结果 id：chatcmpl-* / msg_* / responseId） */
		upstream_message_id?: string | null;
		/** 本次错误关联的熔断事件（展示在 webhook 告警中） */
		circuit_events?: GatewayCircuitAlertEvent[];
		/** 已有熔断短路等场景：写日志但不发 webhook */
		suppress_error_alert?: boolean;
	}
): Promise<void> {
	const basis = params.usage.input_tokens;
	const requestStartedAtMs = params.request_started_at_ms;
	const requestedPricingAtUtc =
		typeof requestStartedAtMs === 'number' && Number.isFinite(requestStartedAtMs)
			? new Date(requestStartedAtMs)
			: new Date();
	const pricingAtUtc = Number.isNaN(requestedPricingAtUtc.getTime())
		? new Date()
		: requestedPricingAtUtc;
	const businessTimezone = await getBusinessTimezone(repos);
	const baseFactors = parseRouteBaseFactors(params.route_price_override_json ?? null);
	const schedule = parseRoutePricingSchedule(params.route_price_override_json ?? null);
	const chargedSch = resolveDailyScheduleFactor(schedule.charged, pricingAtUtc, businessTimezone);
	const meteredSch = resolveDailyScheduleFactor(schedule.metered, pricingAtUtc, businessTimezone);

	const catalogSupplier = resolveSupplierBillingPrices({
		basisInputTokens: basis,
		modelPricingProfileJson: params.model_pricing_profile ?? null,
	});
	const standardResolved = resolveStandardBillingPrices({
		basisInputTokens: basis,
		modelPricingProfileJson: params.model_pricing_profile ?? null,
	});
	const catalogCharged = resolveChargedBillingPrices({
		basisInputTokens: basis,
		modelPricingProfileJson: params.model_pricing_profile ?? null,
	});

	const supplierResolved = applyRouteFactorsToSide({
		catalog: catalogSupplier,
		baseFactor: baseFactors.meteredFactor,
		scheduleFactor: meteredSch,
	});
	const chargedResolved = applyRouteFactorsToSide({
		catalog: catalogCharged,
		baseFactor: baseFactors.chargedFactor,
		scheduleFactor: chargedSch,
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
		`[Gateway Usage] recordUsage model_id=${params.model_id} request_protocol=${params.request_protocol} status=${params.status} route_group=${params.route_group} input_tokens=${params.usage.input_tokens} output_tokens=${params.usage.output_tokens} reasoning_tokens=${params.usage.reasoning_tokens} metered=${supplierCostR} standard=${standardCostR} charged=${chargedCost} charged_eff=${chargedResolved.audit.effective_factor} metered_eff=${supplierResolved.audit.effective_factor}`
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
			gatewayOverheadMs: params.timing?.gatewayOverheadMs ?? null,
			upstreamResponseMs: params.timing?.upstreamResponseMs ?? null,
			finalUpstreamHeadersMs: params.timing?.finalUpstreamHeadersMs ?? null,
			firstReasoningTokenMs: params.timing?.firstReasoningTokenMs ?? null,
			firstTokenMs: params.timing?.firstTokenMs ?? null,
			streamDurationMs: params.timing?.streamDurationMs ?? null,
			upstreamAttemptCount: params.timing?.upstreamAttemptCount ?? null,
			upstreamFailoverCount: params.timing?.upstreamFailoverCount ?? null,
			timingMetadata: params.timing?.timingMetadata ?? null,
			errorMessage: params.error_message ?? null,
			rawUsage: params.usage.raw_usage ?? null,
			pricingAudit: pricingAuditJson,
			providerKeyId: params.provider_key_id ?? null,
			providerKeyLabel: params.provider_key_label ?? null,
			providerKeyFingerprint: params.provider_key_fingerprint ?? null,
			upstreamRequestId: params.upstream_request_id ?? null,
			upstreamMessageId: params.upstream_message_id ?? null,
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
			beforeUserSnapshot: usageSnaps?.before ?? null,
			afterUserSnapshot: usageSnaps?.after ?? null,
			changedFields: usageSnaps?.changed ?? null,
			correlationId: id,
			source: 'gateway_usage',
		},
	});
	if (params.status === 'error' && !params.suppress_error_alert) {
		await fireGatewayErrorWebhooks(repos, {
			requestLogId: id,
			occurredAt: new Date().toISOString(),
			apiKeyId: params.api_key_id,
			userEmail: params.user_email,
			modelId: params.model_id,
			modelName: params.model_name ?? null,
			providerId: params.provider_id,
			providerName: params.provider_name ?? null,
			providerModelName: params.provider_model_name ?? null,
			routeGroup: params.route_group,
			requestProtocol: params.request_protocol,
			upstreamProtocol: params.upstream_protocol,
			errorMessage: params.error_message ?? null,
			latencyMs: params.latency_ms ?? null,
			providerKeyId: params.provider_key_id ?? null,
			providerKeyLabel: params.provider_key_label ?? null,
			providerKeyFingerprint: params.provider_key_fingerprint ?? null,
			upstreamRequestId: params.upstream_request_id ?? null,
			circuitEvents: params.circuit_events,
		}).catch((err: unknown) => {
			console.warn(
				'[Gateway Alert] webhook dispatch failed',
				err instanceof Error ? err.stack ?? err.message : err
			);
		});
	}
}
