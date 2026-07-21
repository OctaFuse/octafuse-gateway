/**
 * 图片计费：token 分项（text / image in / image out）或 per_image 按张 × 路由 factor。
 * 无有效目录价则不计费（legacy 仅 image 块须显式 `image_billing_mode: per_image`）。
 * 日志不落 prompt 原文 / 参考图 / Base64。
 */
import type { GatewayRepositories, UpstreamProtocol } from '@octafuse/core';
import {
	buildImagePrecheckUsage,
	changedFieldsToJson,
	computeChangedFields,
	computeImagePerImageMeteredCost,
	computeImageTokenMeteredCost,
	getBusinessTimezone,
	getUserBudgetSnapshot,
	insertRequestUsageAndChargeTx,
	parsePricingProfile,
	parseRouteBaseFactors,
	parseRoutePricingSchedule,
	PRICING_AUDIT_JSON_SCHEMA_VERSION,
	profileHasImagePerImagePricing,
	profileHasImageTokenPricing,
	resolveChargedBillingPrices,
	resolveDailyScheduleFactor,
	resolveImageBillingMode,
	resolveImageCatalogUnitPrice,
	resolveStandardBillingPrices,
	resolveSupplierBillingPrices,
	roundGatewayMoney,
	scaleBillingPrices,
	snapshotToJson,
	snapshotWithOverrides,
	userRowToSnapshot,
	type ImageTokenUsage,
	type ParsedPricingProfile,
	type PriceResolutionAuditSide,
} from '@octafuse/core';
import { canAffordToolCost } from './tool-usage-charge';
import type { GatewayCircuitAlertEvent } from './circuit-alert-types';
import { fireGatewayErrorWebhooks } from './alert-webhook';
import type { RequestTimingSnapshot } from './request-timing';

export type ImageBillingParams = {
	modelPricingProfileJson?: string | null;
	routePriceOverrideJson?: string | null;
	quality?: string | null;
	size?: string | null;
	imageCount: number;
	/** generations vs edits（token 预检是否加 image input 余量） */
	isEdit?: boolean;
	/** edits / generations 参考图张数 */
	referenceCount?: number;
	/** 请求进入 Gateway 的时间；每日时段倍率在该时刻锁定 */
	requestStartedAtMs?: number;
	operation?: 'generations' | 'edits';
};

export type ImageCostBreakdown = {
	unitPrice: number;
	imageCount: number;
	meteredCost: number;
	standardCost: number;
	chargedCost: number;
	meteredFactor: number;
	chargedFactor: number;
	pricingAuditJson: string;
	/** token 路径写入日志的列；per_image 全 0 */
	logTokens: {
		inputTokens: number;
		outputTokens: number;
		cacheReadTokens: number;
		cacheWriteTokens: number;
		totalTokens: number;
	};
	logImageCounts?: { inputImageCount: number; outputImageCount: number };
	billingKind: 'image_tokens' | 'image_per_image';
};

export type UncertainResultUsageSource =
	| 'client_abort_precheck'
	| 'gateway_timeout_precheck'
	| 'uncertain_requested';

function pricingAtUtcFromParams(requestStartedAtMs?: number): Date {
	const requestedPricingAtUtc =
		typeof requestStartedAtMs === 'number' && Number.isFinite(requestStartedAtMs)
			? new Date(requestStartedAtMs)
			: new Date();
	return Number.isNaN(requestedPricingAtUtc.getTime()) ? new Date() : requestedPricingAtUtc;
}

async function resolveRouteFactors(
	repos: GatewayRepositories,
	routePriceOverrideJson: string | null | undefined,
	requestStartedAtMs?: number
): Promise<{
	meteredFactor: number;
	chargedFactor: number;
	meteredAuditExtras: Pick<PriceResolutionAuditSide, 'base_factor' | 'schedule' | 'effective_factor'>;
	chargedAuditExtras: Pick<PriceResolutionAuditSide, 'base_factor' | 'schedule' | 'effective_factor'>;
}> {
	const pricingAtUtc = pricingAtUtcFromParams(requestStartedAtMs);
	const businessTimezone = await getBusinessTimezone(repos);
	const baseFactors = parseRouteBaseFactors(routePriceOverrideJson ?? null);
	const schedule = parseRoutePricingSchedule(routePriceOverrideJson ?? null);
	const chargedSch = resolveDailyScheduleFactor(schedule.charged, pricingAtUtc, businessTimezone);
	const meteredSch = resolveDailyScheduleFactor(schedule.metered, pricingAtUtc, businessTimezone);
	const meteredFactor = baseFactors.meteredFactor * meteredSch.factor;
	const chargedFactor = baseFactors.chargedFactor * chargedSch.factor;
	const schSide = (sch: typeof chargedSch, base: number, effective: number) => ({
		base_factor: base,
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
	});
	return {
		meteredFactor,
		chargedFactor,
		meteredAuditExtras: schSide(meteredSch, baseFactors.meteredFactor, meteredFactor),
		chargedAuditExtras: schSide(chargedSch, baseFactors.chargedFactor, chargedFactor),
	};
}

function zeroImageCostBreakdown(
	params: ImageBillingParams,
	factors: Awaited<ReturnType<typeof resolveRouteFactors>>,
	billingKind: ImageCostBreakdown['billingKind'],
	audit: Record<string, unknown>
): ImageCostBreakdown {
	return {
		unitPrice: 0,
		imageCount: Math.max(0, Math.floor(params.imageCount)),
		meteredCost: 0,
		standardCost: 0,
		chargedCost: 0,
		meteredFactor: factors.meteredFactor,
		chargedFactor: factors.chargedFactor,
		pricingAuditJson: JSON.stringify({
			v: PRICING_AUDIT_JSON_SCHEMA_VERSION,
			kind: billingKind,
			...audit,
		}),
		logTokens: {
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			totalTokens: 0,
		},
		logImageCounts: { inputImageCount: 0, outputImageCount: 0 },
		billingKind,
	};
}

function estimateImageTokenCosts(
	params: ImageBillingParams,
	usage: ImageTokenUsage,
	factors: Awaited<ReturnType<typeof resolveRouteFactors>>,
	auditExtra?: Record<string, unknown>
): ImageCostBreakdown {
	// Image 目录价通常为单档 flat；仍复用 LLM 的 input-tokens 选档 API（basis 取 text+image_input）。
	const basis = usage.text_tokens + usage.image_input_tokens;
	const supplier = resolveSupplierBillingPrices({
		basisInputTokens: basis,
		modelPricingProfileJson: params.modelPricingProfileJson,
	});
	const standard = resolveStandardBillingPrices({
		basisInputTokens: basis,
		modelPricingProfileJson: params.modelPricingProfileJson,
	});
	const charged = resolveChargedBillingPrices({
		basisInputTokens: basis,
		modelPricingProfileJson: params.modelPricingProfileJson,
	});

	const supplierPrices = scaleBillingPrices(supplier.prices, factors.meteredFactor);
	const chargedPrices = scaleBillingPrices(charged.prices, factors.chargedFactor);

	const meteredCost = roundGatewayMoney(computeImageTokenMeteredCost(usage, supplierPrices));
	const standardCost = roundGatewayMoney(computeImageTokenMeteredCost(usage, standard.prices));
	const chargedCost = roundGatewayMoney(computeImageTokenMeteredCost(usage, chargedPrices));

	const pricingAuditJson = JSON.stringify({
		v: PRICING_AUDIT_JSON_SCHEMA_VERSION,
		kind: 'image_tokens',
		quality: params.quality ?? null,
		size: params.size ?? null,
		...(auditExtra ?? {}),
		tokens: {
			text: usage.text_tokens,
			cached_text: usage.cached_text_tokens,
			image_input: usage.image_input_tokens,
			cached_image_input: usage.cached_image_input_tokens,
			image_output: usage.image_output_tokens,
			total: usage.total_tokens,
		},
		snapshot: {
			supplier: {
				...supplier.audit,
				source: 'model_x_factor',
				...factors.meteredAuditExtras,
				prices: supplierPrices,
			},
			standard: {
				...standard.audit,
				source: 'model',
				prices: standard.prices,
			},
			user_charge: {
				...charged.audit,
				source: 'model_x_factor',
				...factors.chargedAuditExtras,
				prices: chargedPrices,
			},
		},
	});

	return {
		unitPrice: 0,
		imageCount: Math.max(0, Math.floor(params.imageCount)),
		meteredCost,
		standardCost,
		chargedCost,
		meteredFactor: factors.meteredFactor,
		chargedFactor: factors.chargedFactor,
		pricingAuditJson,
		logTokens: {
			inputTokens: usage.text_tokens,
			outputTokens: usage.image_output_tokens,
			cacheReadTokens: usage.cached_text_tokens,
			cacheWriteTokens: 0,
			totalTokens: usage.total_tokens,
		},
		logImageCounts: { inputImageCount: 0, outputImageCount: 0 },
		billingKind: 'image_tokens',
	};
}

function estimateImagePerImageCosts(
	params: ImageBillingParams,
	profile: ParsedPricingProfile,
	factors: Awaited<ReturnType<typeof resolveRouteFactors>>,
	options?: { outputCount?: number; referenceCount?: number; auditExtra?: Record<string, unknown> }
): ImageCostBreakdown {
	const imageCfg = profile.image!;
	const outputCount = Math.max(0, Math.floor(options?.outputCount ?? params.imageCount));
	const referenceCount = Math.max(
		0,
		Math.floor(options?.referenceCount ?? params.referenceCount ?? 0)
	);
	const outputUnitPrice = resolveImageCatalogUnitPrice(
		imageCfg,
		params.quality,
		params.size,
		'output'
	);
	const inputUnitPrice = resolveImageCatalogUnitPrice(
		imageCfg,
		params.quality,
		params.size,
		'input'
	);
	const baseCost = computeImagePerImageMeteredCost({
		outputCount,
		referenceCount,
		outputUnitPrice,
		inputUnitPrice,
	});
	const meteredCost = roundGatewayMoney(baseCost * factors.meteredFactor);
	const standardCost = roundGatewayMoney(baseCost);
	const chargedCost = roundGatewayMoney(baseCost * factors.chargedFactor);

	const pricingAuditJson = JSON.stringify({
		v: PRICING_AUDIT_JSON_SCHEMA_VERSION,
		kind: 'image_per_image',
		quality: params.quality ?? null,
		size: params.size ?? null,
		output_unit_price: outputUnitPrice,
		input_unit_price: inputUnitPrice,
		input_image_count: referenceCount,
		output_image_count: outputCount,
		...(params.operation ? { operation: params.operation } : {}),
		metered_factor: factors.meteredFactor,
		charged_factor: factors.chargedFactor,
		...(options?.auditExtra ?? {}),
	});

	return {
		unitPrice: outputUnitPrice,
		imageCount: outputCount,
		meteredCost,
		standardCost,
		chargedCost,
		meteredFactor: factors.meteredFactor,
		chargedFactor: factors.chargedFactor,
		pricingAuditJson,
		logTokens: {
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			totalTokens: 0,
		},
		logImageCounts: { inputImageCount: referenceCount, outputImageCount: outputCount },
		billingKind: 'image_per_image',
	};
}

/**
 * 估算用户应付（含路由倍率）；用于预检额度。
 * token：保守预检 usage；per_image：按请求张数 × 目录单价。
 */
export async function estimateImageCosts(
	repos: GatewayRepositories,
	params: ImageBillingParams,
	options?: { usage?: ImageTokenUsage | null; auditExtra?: Record<string, unknown> }
): Promise<ImageCostBreakdown> {
	const profile = parsePricingProfile(params.modelPricingProfileJson ?? null);
	const factors = await resolveRouteFactors(
		repos,
		params.routePriceOverrideJson,
		params.requestStartedAtMs
	);
	const mode = resolveImageBillingMode(profile);

	if (mode === 'per_image' && profile && profileHasImagePerImagePricing(profile)) {
		return estimateImagePerImageCosts(params, profile, factors, {
			outputCount: params.imageCount,
			referenceCount: params.referenceCount,
			auditExtra: options?.auditExtra,
		});
	}

	if (mode === 'token' && profile && profileHasImageTokenPricing(profile)) {
		const usage =
			options?.usage ??
			buildImagePrecheckUsage({
				quality: params.quality,
				size: params.size,
				isEdit: params.isEdit,
				imageCount: params.imageCount,
				referenceCount: params.referenceCount,
			});
		return estimateImageTokenCosts(params, usage, factors, options?.auditExtra);
	}

	return zeroImageCostBreakdown(params, factors, 'image_tokens', {
		error: 'missing_image_pricing',
	});
}

/**
 * 预算预检：对全部候选路由分别估算，取 **最高 charged_cost**。
 * 避免首路由失败后由更高 charged_factor 的 failover 路由成功导致预算越界。
 */
export async function estimateImageBudgetPrecheck(
	repos: GatewayRepositories,
	params: Omit<ImageBillingParams, 'routePriceOverrideJson'>,
	routePriceOverrideJsons: Array<string | null | undefined>
): Promise<ImageCostBreakdown> {
	const overrides =
		routePriceOverrideJsons.length > 0 ? routePriceOverrideJsons : [null];
	let best: ImageCostBreakdown | null = null;
	for (const override of overrides) {
		const costs = await estimateImageCosts(repos, {
			...params,
			routePriceOverrideJson: override ?? null,
		});
		if (!best || costs.chargedCost > best.chargedCost) {
			best = costs;
		}
	}
	return best!;
}

export function canAffordImageCost(
	budgetMax: number | null,
	budgetSpent: number,
	chargedCost: number
): boolean {
	return canAffordToolCost(budgetMax, budgetSpent, chargedCost);
}

/** 将 breakdown 标为未确认结果扣费审计（client abort / gateway timeout / 按请求张数）。 */
export function withUncertainResultAudit(
	costs: ImageCostBreakdown,
	usageSource: UncertainResultUsageSource
): ImageCostBreakdown {
	let audit: Record<string, unknown> = {};
	try {
		const parsed = JSON.parse(costs.pricingAuditJson) as unknown;
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
			audit = parsed as Record<string, unknown>;
		}
	} catch {
		/* keep empty */
	}
	return {
		...costs,
		pricingAuditJson: JSON.stringify({
			...audit,
			usage_source: usageSource,
		}),
	};
}

/** 将预算预检 breakdown 标为客户端取消扣费审计。 */
export function withClientAbortPrecheckAudit(costs: ImageCostBreakdown): ImageCostBreakdown {
	return withUncertainResultAudit(costs, 'client_abort_precheck');
}

function resolveUncertainUsageSource(
	imageAbortReason?: 'client_abort' | 'gateway_timeout' | null
): UncertainResultUsageSource {
	if (imageAbortReason === 'client_abort') {
		return 'client_abort_precheck';
	}
	if (imageAbortReason === 'gateway_timeout') {
		return 'gateway_timeout_precheck';
	}
	return 'uncertain_requested';
}

export type RecordImageUsageParams = {
	repos: GatewayRepositories;
	apiKeyId: string;
	userId: string;
	userEmail: string | null;
	modelId: string;
	providerId: string;
	providerModelName?: string | null;
	modelName?: string | null;
	providerName?: string | null;
	requestBody?: string | null;
	upstreamRequestBody?: string | null;
	requestProtocol: 'openai';
	upstreamProtocol: UpstreamProtocol;
	routeGroup: string;
	status: 'success' | 'error';
	latencyMs: number;
	errorMessage?: string | null;
	billing: ImageBillingParams;
	/** 成功时实际有效图片数（per_image 扣费权威；token 仅日志摘要） */
	effectiveImageCount?: number;
	/** 上游解析的 token usage；token 路径扣费权威 */
	imageUsage?: ImageTokenUsage | null;
	/**
	 * 客户端取消 / Gateway 超时：传入入口预算预检 breakdown（token 路径扣费权威）。
	 * per_image 路径仍按 profile uncertain_result_policy 重算张数。
	 */
	clientAbortPrecheck?: ImageCostBreakdown | null;
	imageAbortReason?: 'client_abort' | 'gateway_timeout' | null;
	resultConfirmed?: boolean;
	upstreamSupplierCostUsdTicks?: number | null;
	providerKeyId?: string | null;
	providerKeyLabel?: string | null;
	providerKeyFingerprint?: string | null;
	upstreamRequestId?: string | null;
	timing?: RequestTimingSnapshot | null;
	circuitEvents?: GatewayCircuitAlertEvent[];
	suppressErrorAlert?: boolean;
};

/**
 * 写入用量日志并在成功（或防亏损预检扣费）且 charged>0 时扣费。
 */
export async function recordImageUsage(params: RecordImageUsageParams): Promise<{
	requestLogId: string;
	chargedCost: number;
}> {
	const profile = parsePricingProfile(params.billing.modelPricingProfileJson ?? null);
	const mode = resolveImageBillingMode(profile);
	const imageAbortReason = params.imageAbortReason ?? null;
	const isUncertainCharge =
		params.status === 'error' &&
		(imageAbortReason === 'client_abort' ||
			imageAbortReason === 'gateway_timeout' ||
			params.clientAbortPrecheck != null);

	const chargeUncertain =
		isUncertainCharge &&
		((params.clientAbortPrecheck != null && params.clientAbortPrecheck.chargedCost > 0) ||
			(mode === 'per_image' &&
				profile != null &&
				profileHasImagePerImagePricing(profile) &&
				(profile.image?.uncertain_result_policy ?? 'requested') !== 'zero'));

	const outputImageCountForLog =
		params.status === 'success'
			? Math.max(0, Math.floor(params.effectiveImageCount ?? params.billing.imageCount))
			: chargeUncertain
				? Math.max(0, Math.floor(params.billing.imageCount))
				: 0;

	let costs: ImageCostBreakdown;
	if (isUncertainCharge) {
		if (mode === 'per_image' && profile && profileHasImagePerImagePricing(profile)) {
			const policy = profile.image?.uncertain_result_policy ?? 'requested';
			if (policy === 'zero') {
				const factors = await resolveRouteFactors(
					params.repos,
					params.billing.routePriceOverrideJson,
					params.billing.requestStartedAtMs
				);
				costs = zeroImageCostBreakdown(params.billing, factors, 'image_per_image', {
					uncertain_result_policy: 'zero',
					result_confirmed: false,
					usage_source: resolveUncertainUsageSource(imageAbortReason),
				});
			} else {
				const factors = await resolveRouteFactors(
					params.repos,
					params.billing.routePriceOverrideJson,
					params.billing.requestStartedAtMs
				);
				costs = estimateImagePerImageCosts(params.billing, profile, factors, {
					outputCount: params.billing.imageCount,
					referenceCount: params.billing.referenceCount,
					auditExtra: {
						result_confirmed: false,
						uncertain_result_policy: policy,
					},
				});
				costs = withUncertainResultAudit(
					costs,
					resolveUncertainUsageSource(imageAbortReason)
				);
			}
		} else if (params.clientAbortPrecheck && params.clientAbortPrecheck.chargedCost > 0) {
			costs = withUncertainResultAudit(
				params.clientAbortPrecheck,
				resolveUncertainUsageSource(imageAbortReason)
			);
		} else {
			const factors = await resolveRouteFactors(
				params.repos,
				params.billing.routePriceOverrideJson,
				params.billing.requestStartedAtMs
			);
			costs = zeroImageCostBreakdown(params.billing, factors, 'image_tokens', {
				error: 'request_failed',
			});
		}
	} else if (params.status === 'error') {
		const factors = await resolveRouteFactors(
			params.repos,
			params.billing.routePriceOverrideJson,
			params.billing.requestStartedAtMs
		);
		costs = zeroImageCostBreakdown(params.billing, factors, 'image_tokens', {
			error: 'request_failed',
		});
	} else if (mode === 'per_image' && profile && profileHasImagePerImagePricing(profile)) {
		const factors = await resolveRouteFactors(
			params.repos,
			params.billing.routePriceOverrideJson,
			params.billing.requestStartedAtMs
		);
		const auditExtra: Record<string, unknown> = { result_confirmed: params.resultConfirmed ?? true };
		if (params.upstreamSupplierCostUsdTicks != null) {
			auditExtra.supplier_cost_usd_ticks = params.upstreamSupplierCostUsdTicks;
		}
		costs = estimateImagePerImageCosts(params.billing, profile, factors, {
			outputCount: outputImageCountForLog,
			referenceCount: params.billing.referenceCount,
			auditExtra,
		});
	} else if (mode === 'token' && profile && profileHasImageTokenPricing(profile)) {
		if (params.imageUsage) {
			costs = await estimateImageCosts(
				params.repos,
				{ ...params.billing, imageCount: outputImageCountForLog },
				{ usage: params.imageUsage }
			);
		} else {
			const fallbackUsage = buildImagePrecheckUsage({
				quality: params.billing.quality,
				size: params.billing.size,
				isEdit: params.billing.isEdit,
				imageCount: outputImageCountForLog,
				referenceCount: params.billing.referenceCount,
			});
			costs = await estimateImageCosts(
				params.repos,
				{ ...params.billing, imageCount: outputImageCountForLog },
				{
					usage: fallbackUsage,
					auditExtra: { usage_source: 'precheck_fallback', error: 'missing_upstream_usage' },
				}
			);
		}
	} else {
		costs = await estimateImageCosts(params.repos, {
			...params.billing,
			imageCount: outputImageCountForLog,
		});
	}

	const errorWithoutCharge = params.status === 'error' && !chargeUncertain;
	const chargedCost = errorWithoutCharge ? 0 : costs.chargedCost;
	const meteredCost = errorWithoutCharge ? 0 : costs.meteredCost;
	const standardCost = errorWithoutCharge ? 0 : costs.standardCost;
	const shouldChargeBudget = !errorWithoutCharge && chargedCost > 0;
	const id = crypto.randomUUID();
	const userSnapshot = shouldChargeBudget
		? await getUserBudgetSnapshot(params.repos, params.userId)
		: null;
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

	const logInputImages = costs.logImageCounts?.inputImageCount ?? 0;
	const logOutputImages =
		costs.logImageCounts?.outputImageCount ?? outputImageCountForLog;

	const rawUsage =
		params.imageUsage?.raw_usage ??
		(params.status === 'success'
			? JSON.stringify({
					image_count: logOutputImages,
					billing_kind: costs.billingKind,
					input_image_count: logInputImages,
					output_image_count: logOutputImages,
				})
			: chargeUncertain
				? JSON.stringify({
						image_count: logOutputImages,
						billing_kind: costs.billingKind,
						input_image_count: logInputImages,
						output_image_count: logOutputImages,
						usage_source: resolveUncertainUsageSource(imageAbortReason),
					})
				: null);

	console.log(
		`[Gateway Usage] recordImageUsage model_id=${params.modelId} status=${params.status} kind=${costs.billingKind} images=${logOutputImages} input_images=${logInputImages} metered=${meteredCost} standard=${standardCost} charged=${chargedCost}${
			chargeUncertain ? ` uncertain_charge=1 reason=${imageAbortReason ?? 'precheck'}` : ''
		}`
	);

	await insertRequestUsageAndChargeTx(params.repos, {
		userId: params.userId,
		requestLog: {
			id,
			userId: params.userId,
			apiKeyId: params.apiKeyId,
			userEmail: params.userEmail,
			modelId: params.modelId,
			providerId: params.providerId,
			providerModelName: params.providerModelName ?? null,
			modelName: params.modelName ?? null,
			providerName: params.providerName ?? null,
			requestBody: params.requestBody ?? null,
			upstreamRequestBody: params.upstreamRequestBody ?? null,
			requestProtocol: params.requestProtocol,
			upstreamProtocol: params.upstreamProtocol,
			inputTokens: costs.logTokens.inputTokens,
			outputTokens: costs.logTokens.outputTokens,
			cacheReadTokens: costs.logTokens.cacheReadTokens,
			cacheWriteTokens: costs.logTokens.cacheWriteTokens,
			reasoningTokens: 0,
			totalTokens: costs.logTokens.totalTokens,
			meteredCost,
			standardCost,
			chargedCost,
			routeGroup: params.routeGroup,
			status: params.status,
			latencyMs: params.latencyMs,
			gatewayOverheadMs: params.timing?.gatewayOverheadMs ?? null,
			upstreamResponseMs: params.timing?.upstreamResponseMs ?? null,
			finalUpstreamHeadersMs: params.timing?.finalUpstreamHeadersMs ?? null,
			firstReasoningTokenMs: params.timing?.firstReasoningTokenMs ?? null,
			firstTokenMs: params.timing?.firstTokenMs ?? null,
			streamDurationMs: params.timing?.streamDurationMs ?? null,
			upstreamAttemptCount: params.timing?.upstreamAttemptCount ?? null,
			upstreamFailoverCount: params.timing?.upstreamFailoverCount ?? null,
			timingMetadata: params.timing?.timingMetadata ?? null,
			errorMessage: params.errorMessage ?? null,
			rawUsage,
			pricingAudit: costs.pricingAuditJson,
			billingKind: costs.billingKind,
			inputImageCount: logInputImages,
			outputImageCount: logOutputImages,
			providerKeyId: params.providerKeyId ?? null,
			providerKeyLabel: params.providerKeyLabel ?? null,
			providerKeyFingerprint: params.providerKeyFingerprint ?? null,
			upstreamRequestId: params.upstreamRequestId ?? null,
			upstreamMessageId: null,
		},
		shouldChargeBudget,
		beforeSpent,
		chargedCost,
		audit: {
			apiKeyId: params.apiKeyId,
			eventType: 'usage_charge',
			actorType: 'system',
			reasonCode: 'image_usage_charged_cost',
			reasonText: `Image charge: ${params.modelId}`,
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
			source: 'gateway_usage',
		},
	});

	if (params.status === 'error' && !params.suppressErrorAlert) {
		await fireGatewayErrorWebhooks(params.repos, {
			requestLogId: id,
			occurredAt: new Date().toISOString(),
			apiKeyId: params.apiKeyId,
			userEmail: params.userEmail,
			modelId: params.modelId,
			modelName: params.modelName ?? null,
			providerId: params.providerId,
			providerName: params.providerName ?? null,
			providerModelName: params.providerModelName ?? null,
			routeGroup: params.routeGroup,
			requestProtocol: params.requestProtocol,
			upstreamProtocol: params.upstreamProtocol,
			errorMessage: params.errorMessage ?? null,
			latencyMs: params.latencyMs,
			providerKeyId: params.providerKeyId ?? null,
			providerKeyLabel: params.providerKeyLabel ?? null,
			providerKeyFingerprint: params.providerKeyFingerprint ?? null,
			upstreamRequestId: params.upstreamRequestId ?? null,
			circuitEvents: params.circuitEvents,
		}).catch((err: unknown) => {
			console.warn(
				'[Gateway Alert] webhook dispatch failed',
				err instanceof Error ? err.stack ?? err.message : err
			);
		});
	}

	return { requestLogId: id, chargedCost };
}
