/**
 * 音频转写计费：
 * - `per_second`：duration × price_per_second × 路由 factor（whisper）
 * - `token`：上游 usage tokens × $/1M × 路由 factor（gpt-4o-*transcribe）
 * 最终扣费禁止用字节估算冒充 token；缺上游 token usage 时计 0 并审计。
 */
import type { GatewayRepositories, UpstreamProtocol } from '@octafuse/core';
import {
	buildAudioTokenPrecheckUsage,
	changedFieldsToJson,
	computeAudioPerSecondMeteredCost,
	computeAudioPerCharacterMeteredCost,
	computeAudioTokenMeteredCost,
	computeChangedFields,
	EMPTY_AUDIO_TOKEN_USAGE,
	getBusinessTimezone,
	getUserBudgetSnapshot,
	insertRequestUsageAndChargeTx,
	parsePricingProfile,
	parseRouteBaseFactors,
	parseRoutePricingSchedule,
	PRICING_AUDIT_JSON_SCHEMA_VERSION,
	profileHasAudioPerSecondPricing,
	profileHasAudioPerCharacterPricing,
	profileHasAudioTokenPricing,
	resolveAudioBillingMode,
	resolveBillableAudioSeconds,
	resolveBillableAudioCharacters,
	resolveChargedBillingPrices,
	resolveDailyScheduleFactor,
	resolveEffectiveRouteFactor,
	resolveStandardBillingPrices,
	resolveSupplierBillingPrices,
	roundGatewayMoney,
	scaleBillingPrices,
	snapshotToJson,
	snapshotWithOverrides,
	userRowToSnapshot,
	type AudioTokenUsage,
	type AudioPerSecondPricingConfig,
	type AudioPerCharacterPricingConfig,
	type ParsedPricingProfile,
	type PriceResolutionAuditSide,
} from '@octafuse/core';
import { canAffordToolCost } from './tool-usage-charge';
import type { GatewayCircuitAlertEvent } from './circuit-alert-types';
import { fireGatewayErrorWebhooks } from './alert-webhook';
import type { RequestTimingSnapshot } from './request-timing';
import { resolveAudioBillingDuration } from './egress/audio-duration';

export type AudioBillingParams = {
	modelPricingProfileJson?: string | null;
	routePriceOverrideJson?: string | null;
	/** per_second 计费时长；token 模式仅作预检/日志参考 */
	durationSeconds: number;
	durationSource?: 'upstream' | 'media' | 'client' | 'estimated' | 'precheck';
	fileBytes?: number;
	requestStartedAtMs?: number;
	/** token 模式最终扣费：上游真实 usage；缺省则不计费 */
	tokenUsage?: AudioTokenUsage | null;
	/** TTS 最终扣费：上游真实 usage.characters；缺省则不计费 */
	characters?: number | null;
};

export type AudioCostBreakdown = {
	durationSeconds: number;
	billableSeconds: number;
	pricePerSecond: number;
	characters: number;
	billableCharacters: number;
	pricePerCharacter: number;
	meteredCost: number;
	standardCost: number;
	chargedCost: number;
	meteredFactor: number;
	chargedFactor: number;
	pricingAuditJson: string;
	billingKind: 'audio_per_second' | 'audio_tokens' | 'audio_per_character';
	logTokens: {
		inputTokens: number;
		outputTokens: number;
		totalTokens: number;
	};
};

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
	const meteredFactor = resolveEffectiveRouteFactor(
		baseFactors.meteredFactor,
		meteredSch,
		schedule.mode
	);
	const chargedFactor = resolveEffectiveRouteFactor(
		baseFactors.chargedFactor,
		chargedSch,
		schedule.mode
	);
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

function buildAudioPerSecondCosts(
	billing: AudioBillingParams,
	profile: ParsedPricingProfile & {
		audio_billing_mode: 'per_second';
		audio: AudioPerSecondPricingConfig;
	},
	factors: Awaited<ReturnType<typeof resolveRouteFactors>>
): AudioCostBreakdown {
	const audioCfg = profile.audio;
	const pricePerSecond = audioCfg.price_per_second;
	const billableSeconds = resolveBillableAudioSeconds(billing.durationSeconds, audioCfg);
	const baseCost = computeAudioPerSecondMeteredCost({
		durationSeconds: billing.durationSeconds,
		pricePerSecond,
		minimumSeconds: audioCfg.minimum_seconds,
	});
	const meteredCost = roundGatewayMoney(baseCost * factors.meteredFactor);
	const standardCost = roundGatewayMoney(baseCost);
	const chargedCost = roundGatewayMoney(baseCost * factors.chargedFactor);
	const pricingAuditJson = JSON.stringify({
		v: PRICING_AUDIT_JSON_SCHEMA_VERSION,
		kind: 'audio_per_second',
		snapshot: {
			kind: 'audio_per_second',
			duration_seconds: billing.durationSeconds,
			billable_seconds: billableSeconds,
			price_per_second: pricePerSecond,
			minimum_seconds: audioCfg.minimum_seconds ?? 1,
			duration_source: billing.durationSource ?? 'upstream',
			file_bytes: billing.fileBytes ?? null,
			supplier: {
				path: 'profile',
				source: 'model_x_factor',
				...factors.meteredAuditExtras,
			},
			standard: {
				path: 'profile',
				source: 'model',
			},
			user_charge: {
				path: 'profile',
				source: 'model_x_factor',
				...factors.chargedAuditExtras,
			},
		},
	});
	return {
		durationSeconds: billing.durationSeconds,
		billableSeconds,
		pricePerSecond,
		characters: 0,
		billableCharacters: 0,
		pricePerCharacter: 0,
		meteredCost,
		standardCost,
		chargedCost,
		meteredFactor: factors.meteredFactor,
		chargedFactor: factors.chargedFactor,
		pricingAuditJson,
		billingKind: 'audio_per_second',
		logTokens: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
	};
}

function buildAudioPerCharacterCosts(
	billing: AudioBillingParams,
	profile: ParsedPricingProfile & {
		audio_billing_mode: 'per_character';
		audio: AudioPerCharacterPricingConfig;
	},
	factors: Awaited<ReturnType<typeof resolveRouteFactors>>
): AudioCostBreakdown {
	const characters = billing.characters ?? 0;
	const pricePerCharacter = profile.audio.price_per_character;
	const billableCharacters = resolveBillableAudioCharacters(characters, profile.audio);
	const baseCost = computeAudioPerCharacterMeteredCost({
		characters,
		pricePerCharacter,
		minimumCharacters: profile.audio.minimum_characters,
	});
	const meteredCost = roundGatewayMoney(baseCost * factors.meteredFactor);
	const standardCost = roundGatewayMoney(baseCost);
	const chargedCost = roundGatewayMoney(baseCost * factors.chargedFactor);
	return {
		durationSeconds: 0,
		billableSeconds: 0,
		pricePerSecond: 0,
		characters,
		billableCharacters,
		pricePerCharacter,
		meteredCost,
		standardCost,
		chargedCost,
		meteredFactor: factors.meteredFactor,
		chargedFactor: factors.chargedFactor,
		pricingAuditJson: JSON.stringify({
			v: PRICING_AUDIT_JSON_SCHEMA_VERSION,
			kind: 'audio_per_character',
			snapshot: {
				kind: 'audio_per_character',
				characters,
				billable_characters: billableCharacters,
				price_per_character: pricePerCharacter,
				minimum_characters: profile.audio.minimum_characters ?? 0,
				usage_source: 'upstream',
				supplier: {
					path: 'profile',
					source: 'model_x_factor',
					...factors.meteredAuditExtras,
				},
				standard: { path: 'profile', source: 'model' },
				user_charge: {
					path: 'profile',
					source: 'model_x_factor',
					...factors.chargedAuditExtras,
				},
			},
		}),
		billingKind: 'audio_per_character',
		logTokens: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
	};
}

function buildAudioTokenCosts(
	billing: AudioBillingParams,
	usage: AudioTokenUsage,
	factors: Awaited<ReturnType<typeof resolveRouteFactors>>,
	auditExtra?: Record<string, unknown>
): AudioCostBreakdown {
	const basis = usage.input_tokens;
	const supplier = resolveSupplierBillingPrices({
		basisInputTokens: basis,
		modelPricingProfileJson: billing.modelPricingProfileJson,
	});
	const standard = resolveStandardBillingPrices({
		basisInputTokens: basis,
		modelPricingProfileJson: billing.modelPricingProfileJson,
	});
	const charged = resolveChargedBillingPrices({
		basisInputTokens: basis,
		modelPricingProfileJson: billing.modelPricingProfileJson,
	});

	const supplierPrices = scaleBillingPrices(supplier.prices, factors.meteredFactor);
	const chargedPrices = scaleBillingPrices(charged.prices, factors.chargedFactor);

	const meteredCost = roundGatewayMoney(computeAudioTokenMeteredCost(usage, supplierPrices));
	const standardCost = roundGatewayMoney(computeAudioTokenMeteredCost(usage, standard.prices));
	const chargedCost = roundGatewayMoney(computeAudioTokenMeteredCost(usage, chargedPrices));

	const pricingAuditJson = JSON.stringify({
		v: PRICING_AUDIT_JSON_SCHEMA_VERSION,
		kind: 'audio_tokens',
		...(auditExtra ?? {}),
		tokens: {
			input: usage.input_tokens,
			output: usage.output_tokens,
			audio: usage.audio_tokens,
			text: usage.text_tokens,
			total: usage.total_tokens,
		},
		duration_seconds: billing.durationSeconds,
		duration_source: billing.durationSource ?? null,
		file_bytes: billing.fileBytes ?? null,
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
		durationSeconds: billing.durationSeconds,
		billableSeconds: 0,
		pricePerSecond: 0,
		characters: 0,
		billableCharacters: 0,
		pricePerCharacter: 0,
		meteredCost,
		standardCost,
		chargedCost,
		meteredFactor: factors.meteredFactor,
		chargedFactor: factors.chargedFactor,
		pricingAuditJson,
		billingKind: 'audio_tokens',
		logTokens: {
			inputTokens: usage.input_tokens,
			outputTokens: usage.output_tokens,
			totalTokens: usage.total_tokens,
		},
	};
}

function zeroAudioCostBreakdown(
	billing: AudioBillingParams,
	factors: Awaited<ReturnType<typeof resolveRouteFactors>>,
	billingKind: AudioCostBreakdown['billingKind'],
	auditExtra?: Record<string, unknown>
): AudioCostBreakdown {
	return {
		durationSeconds: billing.durationSeconds,
		billableSeconds: 0,
		pricePerSecond: 0,
		characters: billing.characters ?? 0,
		billableCharacters: 0,
		pricePerCharacter: 0,
		meteredCost: 0,
		standardCost: 0,
		chargedCost: 0,
		meteredFactor: factors.meteredFactor,
		chargedFactor: factors.chargedFactor,
		pricingAuditJson: JSON.stringify({
			v: PRICING_AUDIT_JSON_SCHEMA_VERSION,
			kind: billingKind,
			duration_seconds: billing.durationSeconds,
			duration_source: billing.durationSource ?? null,
			file_bytes: billing.fileBytes ?? null,
			...auditExtra,
		}),
		billingKind,
		logTokens: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
	};
}

function resolveAudioCostsForProfile(
	billing: AudioBillingParams,
	profile: ParsedPricingProfile | null,
	factors: Awaited<ReturnType<typeof resolveRouteFactors>>,
	options?: { allowTokenPrecheckEstimate?: boolean }
): AudioCostBreakdown {
	const mode = resolveAudioBillingMode(profile);

	if (mode === 'per_second' && profile && profileHasAudioPerSecondPricing(profile)) {
		return buildAudioPerSecondCosts(billing, profile, factors);
	}

	if (mode === 'token' && profile && profileHasAudioTokenPricing(profile)) {
		const usage =
			billing.tokenUsage ??
			(options?.allowTokenPrecheckEstimate
				? buildAudioTokenPrecheckUsage(billing.durationSeconds)
				: null);
		if (!usage || (usage.input_tokens === 0 && usage.output_tokens === 0 && usage.total_tokens === 0)) {
			return zeroAudioCostBreakdown(billing, factors, 'audio_tokens', {
				error: 'missing_upstream_token_usage',
			});
		}
		return buildAudioTokenCosts(billing, usage, factors, {
			usage_source: billing.tokenUsage
				? 'upstream'
				: options?.allowTokenPrecheckEstimate
					? 'precheck_estimate'
					: 'upstream',
		});
	}

	if (mode === 'per_character' && profile && profileHasAudioPerCharacterPricing(profile)) {
		if (billing.characters == null) {
			return zeroAudioCostBreakdown(billing, factors, 'audio_per_character', {
				error: 'missing_upstream_character_usage',
			});
		}
		return buildAudioPerCharacterCosts(billing, profile, factors);
	}

	return zeroAudioCostBreakdown(billing, factors, 'audio_per_second', {
		error: 'missing_audio_pricing',
	});
}

/** 单条 TTS 路由的按字符成本；characters 必须来自上游，null 会明确审计为缺失。 */
export async function estimateAudioSpeechCosts(
	repos: GatewayRepositories,
	billing: Pick<AudioBillingParams, 'modelPricingProfileJson' | 'requestStartedAtMs' | 'characters'> & {
		routePriceOverrideJson?: string | null;
	}
): Promise<AudioCostBreakdown> {
	const params: AudioBillingParams = {
		...billing,
		durationSeconds: 0,
	};
	return resolveAudioCostsForProfile(
		params,
		parsePricingProfile(billing.modelPricingProfileJson ?? null),
		await resolveRouteFactors(repos, billing.routePriceOverrideJson, billing.requestStartedAtMs)
	);
}

/** TTS 预算预检允许用输入字符数；最终扣费仍只接受上游 usage.characters。 */
export async function estimateAudioSpeechBudgetPrecheck(
	repos: GatewayRepositories,
	billing: Pick<AudioBillingParams, 'modelPricingProfileJson' | 'requestStartedAtMs'> & {
		inputCharacters: number;
	},
	routePriceOverrides: Array<string | null | undefined>
): Promise<AudioCostBreakdown> {
	const params: AudioBillingParams = {
		...billing,
		durationSeconds: 0,
		durationSource: 'precheck',
		characters: billing.inputCharacters,
	};
	const profile = parsePricingProfile(billing.modelPricingProfileJson ?? null);
	let best: AudioCostBreakdown | null = null;
	for (const override of routePriceOverrides.length > 0 ? routePriceOverrides : [null]) {
		const factors = await resolveRouteFactors(repos, override, billing.requestStartedAtMs);
		const costs = resolveAudioCostsForProfile(
			{ ...params, routePriceOverrideJson: override },
			profile,
			factors
		);
		if (!best || costs.chargedCost >= best.chargedCost) best = costs;
	}
	return best ?? zeroAudioCostBreakdown(
		params,
		await resolveRouteFactors(repos, null, billing.requestStartedAtMs),
		'audio_per_character',
		{ error: 'missing_audio_pricing' }
	);
}

/** 预算预检：per_second 用时长；token 用保守 token 上界（不用于最终扣费）。 */
export async function estimateAudioBudgetPrecheck(
	repos: GatewayRepositories,
	billing: Omit<AudioBillingParams, 'durationSeconds' | 'durationSource' | 'tokenUsage'> & {
		fileBytes: number;
		mimeType?: string;
		fileBytesForParse?: Uint8Array;
		clientDurationSeconds?: number;
	},
	routePriceOverrides: Array<string | null | undefined>
): Promise<AudioCostBreakdown> {
	const resolved = resolveAudioBillingDuration({
		upstreamSeconds: null,
		fileBytes: billing.fileBytes,
		mimeType: billing.mimeType ?? 'application/octet-stream',
		fileBytesForParse: billing.fileBytesForParse,
		clientSeconds: billing.clientDurationSeconds,
	});
	const durationSeconds = resolved.seconds;
	const params: AudioBillingParams = {
		...billing,
		durationSeconds,
		durationSource: resolved.source === 'estimated' ? 'precheck' : resolved.source,
	};
	const profile = parsePricingProfile(billing.modelPricingProfileJson ?? null);
	let maxCharged = 0;
	let best: AudioCostBreakdown | null = null;
	const overrides =
		routePriceOverrides.length > 0 ? routePriceOverrides : [billing.routePriceOverrideJson];
	for (const override of overrides) {
		const factors = await resolveRouteFactors(repos, override, billing.requestStartedAtMs);
		const costs = resolveAudioCostsForProfile(
			{ ...params, routePriceOverrideJson: override },
			profile,
			factors,
			{ allowTokenPrecheckEstimate: true }
		);
		if (costs.chargedCost >= maxCharged) {
			maxCharged = costs.chargedCost;
			best = costs;
		}
	}
	return best ?? zeroAudioCostBreakdown(params, await resolveRouteFactors(repos, null), 'audio_per_second', {
		error: 'missing_audio_pricing',
	});
}

export const canAffordAudioCost = canAffordToolCost;

export type RecordAudioUsageParams = {
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
	requestProtocol: UpstreamProtocol;
	requestOperation?: string | null;
	upstreamProtocol: UpstreamProtocol;
	upstreamOperation?: string | null;
	modelSurfaceId?: string | null;
	routePoolId?: string | null;
	routeTargetId?: string | null;
	adapter?: string | null;
	/** Provider sticky routing observation (merged into route_trace.sticky). */
	stickyTrace?: {
		lookup: string;
		attempted_target: string | null;
		result: string;
	} | null;
	routeGroup: string;
	status: 'success' | 'error';
	latencyMs: number;
	errorMessage?: string | null;
	billing: AudioBillingParams;
	providerKeyId?: string | null;
	providerKeyLabel?: string | null;
	providerKeyFingerprint?: string | null;
	upstreamRequestId?: string | null;
	timing?: RequestTimingSnapshot | null;
	circuitEvents?: GatewayCircuitAlertEvent[];
	suppressErrorAlert?: boolean;
};

export async function recordAudioUsage(params: RecordAudioUsageParams): Promise<{
	requestLogId: string;
	chargedCost: number;
}> {
	const profile = parsePricingProfile(params.billing.modelPricingProfileJson ?? null);
	const factors = await resolveRouteFactors(
		params.repos,
		params.billing.routePriceOverrideJson,
		params.billing.requestStartedAtMs
	);

	let costs: AudioCostBreakdown;
	if (params.status === 'error') {
		const mode = resolveAudioBillingMode(profile);
		costs = zeroAudioCostBreakdown(
			params.billing,
			factors,
			mode === 'token'
				? 'audio_tokens'
				: mode === 'per_character'
					? 'audio_per_character'
					: 'audio_per_second',
			{ error: 'request_failed' }
		);
	} else {
		// 最终扣费：token 模式只用上游 usage，禁止预检估算
		costs = resolveAudioCostsForProfile(params.billing, profile, factors, {
			allowTokenPrecheckEstimate: false,
		});
	}

	const chargedCost = params.status === 'error' ? 0 : costs.chargedCost;
	const meteredCost = params.status === 'error' ? 0 : costs.meteredCost;
	const standardCost = params.status === 'error' ? 0 : costs.standardCost;
	const shouldChargeBudget = params.status !== 'error' && chargedCost > 0;
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

	const usage = params.billing.tokenUsage ?? EMPTY_AUDIO_TOKEN_USAGE;
	const rawUsage =
		params.status === 'success'
			? JSON.stringify({
					billing_kind: costs.billingKind,
					duration_seconds: costs.durationSeconds,
					billable_seconds: costs.billableSeconds,
					characters: costs.characters,
					billable_characters: costs.billableCharacters,
					duration_source: params.billing.durationSource ?? null,
					file_bytes: params.billing.fileBytes ?? null,
					...(costs.billingKind === 'audio_tokens'
						? {
								input_tokens: usage.input_tokens,
								output_tokens: usage.output_tokens,
								audio_tokens: usage.audio_tokens,
								text_tokens: usage.text_tokens,
								total_tokens: usage.total_tokens,
								upstream_usage: usage.raw_usage,
							}
						: {}),
				})
			: null;

	console.log(
		`[Gateway Usage] recordAudioUsage model_id=${params.modelId} status=${params.status} kind=${costs.billingKind} duration=${costs.durationSeconds} billable=${costs.billableSeconds} characters=${costs.characters} billableCharacters=${costs.billableCharacters} in=${costs.logTokens.inputTokens} out=${costs.logTokens.outputTokens} metered=${meteredCost} standard=${standardCost} charged=${chargedCost}`
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
			requestOperation: params.requestOperation ?? null,
			upstreamProtocol: params.upstreamProtocol,
			upstreamOperation: params.upstreamOperation ?? null,
			modelSurfaceId: params.modelSurfaceId ?? null,
			routePoolId: params.routePoolId ?? null,
			routeTargetId: params.routeTargetId ?? null,
			adapter: params.adapter ?? null,
			routeTrace: JSON.stringify({
				surface: params.modelSurfaceId ?? null,
				pool: params.routePoolId ?? null,
				target: params.routeTargetId ?? null,
				...(params.stickyTrace ? { sticky: params.stickyTrace } : {}),
			}),
			inputTokens: params.status === 'success' ? costs.logTokens.inputTokens : 0,
			outputTokens: params.status === 'success' ? costs.logTokens.outputTokens : 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			reasoningTokens: 0,
			totalTokens: params.status === 'success' ? costs.logTokens.totalTokens : 0,
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
			inputImageCount: 0,
			outputImageCount: 0,
			audioDurationSeconds:
				params.status === 'success' && costs.billingKind !== 'audio_per_character'
					? costs.durationSeconds
					: null,
			audioCharacters:
				params.status === 'success' && costs.billingKind === 'audio_per_character'
					? costs.characters
					: null,
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
			reasonCode: 'audio_usage_charged_cost',
			reasonText: `Audio charge: ${params.modelId}`,
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
