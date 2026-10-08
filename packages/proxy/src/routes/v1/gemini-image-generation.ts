/**
 * Gemini 图片模型走原生 generateContent 透传，按 usageMetadata 的 TEXT / IMAGE 分项计费。
 * 入口仍是 `POST /v1beta/models/{model}:{generateContent|streamGenerateContent}`。
 * 没有非 thought 图片、客户端取消、网关超时都不扣费。
 */
import {
	buildImagePrecheckUsage,
	estimateGeminiImageOutputTokens,
	GEMINI_GENERATE_OPERATION,
	GEMINI_IMAGE_PRECHECK_TEXT_OUTPUT_HEADROOM,
	isImageGenerationModel,
	type GatewayRepositories,
	type ModelKindFields,
} from '@octafuse/core';
import {
	countGeminiReferenceImages,
	geminiImageBillingSize,
	requestedGeminiImageCount,
} from '@octafuse/core/gemini-image-native';
import type { Context } from 'hono';
import type { ApiKeyContext } from '../../middleware/auth';
import { canAffordImageCost, estimateImageBudgetPrecheck, recordImageUsage } from '../../services/image-usage-charge';
import { apiKeyHasBalance } from '../../services/tool-usage-charge';
import { resolveRoutesForSurface } from '../../services/model-router';
import type { ResolvedModelRouting } from '../../services/resolve-model-route-group';
import {
	buildAffinityKey,
	buildTierKeyPrefix,
	resolveRouteStrategyPlan,
} from '../../services/route-strategies';
import { proxyGeminiImagePassthrough } from '../../services/proxy';
import { buildRouteRequestBody } from '../../services/route-default-params';
import { finalizeRequestLogJson } from '../../services/request-log-shared';
import { formatHttpErrorTextForRequestLog, materializeNonOkResponse } from '../../services/request-log-record-status';
import {
	maybeBlockUserModelCircuit,
	maybeTriggerUserModelCircuitFromUpstream,
	markUserModelSuccess,
} from '../../services/user-model-circuit-route';
import { GatewayErrorCode, NO_AVAILABLE_ROUTE_MESSAGE } from '../../services/gateway-error-codes';
import { gatewayErrorJson } from '../../services/gateway-error-response';
import { RequestTimingCollector } from '../../services/request-timing';
import { scheduleBackgroundWork } from '../../runtime/schedule-background-work';
import { stickyConfigFromSurface } from '../../services/provider-sticky-routing';
import type { AuthedEnv } from '../../services/proxy-pipeline';
import { geminiBodyRedactedForLog, type GeminiAction } from './gemini';

/** 图片模型走原生生图透传；文本模型继续走原来的 Gemini 管线。 */
export function geminiPathUsesImagePassthrough(model: ModelKindFields): boolean {
	return isImageGenerationModel(model);
}

export async function forwardGeminiImageGeneration(
	c: Context<AuthedEnv>,
	preview: ResolvedModelRouting,
	action: GeminiAction,
): Promise<Response> {
	const repos = c.get('repositories');
	const apiKey = c.get('apiKey');
	const start = Date.now();
	const timing = new RequestTimingCollector();
	let body: unknown;
	try {
		body = await c.req.json();
	} catch {
		return gatewayErrorJson(c, { status: 400, code: GatewayErrorCode.invalidJson, message: 'Invalid JSON body' });
	}
	if (body == null || typeof body !== 'object' || Array.isArray(body)) {
		return gatewayErrorJson(c, {
			status: 400,
			code: GatewayErrorCode.invalidRequest,
			message: 'JSON body must be an object',
		});
	}
	return forwardGeminiImage(c, repos, apiKey, preview, action, body as Record<string, unknown>, start, timing);
}

async function forwardGeminiImage(
	c: Context<AuthedEnv>,
	repos: GatewayRepositories,
	apiKey: ApiKeyContext,
	preview: ResolvedModelRouting,
	action: GeminiAction,
	requestBody: Record<string, unknown>,
	start: number,
	timing: RequestTimingCollector,
): Promise<Response> {
	const { model, baseModelId, explicitGroup } = preview;
	const effectiveRouteGroup = explicitGroup?.trim() || 'default';
	let resolvedSurface;
	try {
		resolvedSurface = await resolveRoutesForSurface(repos, {
			modelId: baseModelId,
			routeGroup: effectiveRouteGroup,
			requestProtocol: 'gemini',
			requestOperation: GEMINI_GENERATE_OPERATION,
		});
	} catch (err) {
		return gatewayErrorJson(c, {
			status: 502,
			code: GatewayErrorCode.routeResolutionFailed,
			message: err instanceof Error ? err.message : 'Model route resolution failed',
		});
	}
	if (resolvedSurface.routes.length === 0) {
		return gatewayErrorJson(c, { status: 404, code: GatewayErrorCode.noRoute, message: NO_AVAILABLE_ROUTE_MESSAGE });
	}
	const routes = resolvedSurface.routes;
	const modelNameForLog =
		model.display_name != null && String(model.display_name).trim() !== ''
			? String(model.display_name).trim()
			: baseModelId;
	if (!apiKeyHasBalance(apiKey)) {
		return gatewayErrorJson(c, { status: 403, code: GatewayErrorCode.budgetExceeded, message: 'Budget exceeded' });
	}
	const referenceCount = countGeminiReferenceImages(requestBody);
	const requestedCount = requestedGeminiImageCount(requestBody);
	const size = geminiImageBillingSize(requestBody);
	const imageOperation = referenceCount > 0 ? 'edits' : 'generations';
	const search = c.req.url.includes('?') ? c.req.url.slice(c.req.url.indexOf('?')) : '';
	const precheckUsage = buildImagePrecheckUsage({
		size,
		imageCount: requestedCount,
		isEdit: referenceCount > 0,
		referenceCount,
		outputTokensPerImage: estimateGeminiImageOutputTokens(size),
		textOutputTokens: GEMINI_IMAGE_PRECHECK_TEXT_OUTPUT_HEADROOM,
	});
	const estimate = await estimateImageBudgetPrecheck(
		repos,
		{
			modelPricingProfileJson: model.pricing_profile ?? null,
			catalogModelId: baseModelId,
			userChargedCostFactorsJson: apiKey.chargedCostFactors,
			routeGroup: effectiveRouteGroup,
			quality: 'auto',
			size,
			imageCount: requestedCount,
			isEdit: referenceCount > 0,
			referenceCount,
			operation: imageOperation,
			requestStartedAtMs: start,
		},
		routes.map((route) => route.priceOverrideRaw),
		{ usage: precheckUsage },
	);
	if (
		!canAffordImageCost(
			apiKey.budgetMax,
			apiKey.budgetSpent,
			estimate.chargedCost,
			apiKey.walletGranted,
			apiKey.walletSpent,
		)
	) {
		return gatewayErrorJson(c, { status: 403, code: GatewayErrorCode.budgetExceeded, message: 'Budget exceeded' });
	}
	const requestBodyForLog = finalizeRequestLogJson(geminiBodyRedactedForLog(requestBody, action));
	const circuitBlocked = maybeBlockUserModelCircuit(c, repos, apiKey, {
		baseModelId,
		modelNameForLog,
		requestBodyForLog,
		requestProtocol: 'gemini',
		startMs: start,
		timing,
		clientErrorCircuitEnabled: false,
	});
	if (circuitBlocked) return circuitBlocked;
	const strategyPlan = await resolveRouteStrategyPlan({
		routePolicyRaw: model.route_policy ?? null,
		poolStrategy: resolvedSurface.surface?.pool_strategy ?? null,
		poolTierStrategies: resolvedSurface.surface?.pool_tier_strategies ?? null,
		protocol: 'gemini',
		capability: GEMINI_GENERATE_OPERATION,
		routeGroup: effectiveRouteGroup,
		repos,
	});
	timing.markGatewayComplete();
	const streaming = action === 'streamGenerateContent';
	const proxyResult = await proxyGeminiImagePassthrough(repos, routes, action, requestBody, search, c.req.raw.signal, {
		affinityKey: buildAffinityKey(apiKey.userId, baseModelId, effectiveRouteGroup, 'gemini'),
		tierKeyPrefix: buildTierKeyPrefix(baseModelId, effectiveRouteGroup, 'gemini'),
		strategy: strategyPlan.base,
		tierStrategies: strategyPlan.tierOverrides,
		timing,
		sticky: stickyConfigFromSurface(resolvedSurface.surface),
		inboundHeaders: c.req.raw.headers,
	});
	const { response, errorBodyText } = await materializeNonOkResponse(proxyResult.response);
	if (!streaming) await proxyResult.usagePromise.catch(() => undefined);
	if (response.ok && !streaming && (proxyResult.meta?.imageCount ?? 0) > 0) {
		markUserModelSuccess(apiKey.userId, baseModelId);
	}
	const userModelCircuitEvent =
		!response.ok && errorBodyText != null
			? maybeTriggerUserModelCircuitFromUpstream(
					apiKey.userId,
					baseModelId,
					response.status,
					response.headers.get('content-type'),
					errorBodyText,
					formatHttpErrorTextForRequestLog(response.status, response.headers.get('content-type'), errorBodyText),
					{ clientErrorCircuitEnabled: false },
				)
			: null;
	const alertCircuitEvents = userModelCircuitEvent
		? [...proxyResult.circuitEvents, userModelCircuitEvent]
		: proxyResult.circuitEvents;
	scheduleBackgroundWork(
		c,
		(async () => {
			if (streaming) await proxyResult.usagePromise.catch(() => undefined);
			const imageAbortReason = proxyResult.meta?.imageAbortReason ?? null;
			const imageCount = response.ok && imageAbortReason == null ? Math.max(0, proxyResult.meta?.imageCount ?? 0) : 0;
			if (streaming && response.ok && imageAbortReason == null && imageCount > 0) {
				markUserModelSuccess(apiKey.userId, baseModelId);
			}
			const status = response.ok && imageAbortReason == null && imageCount > 0 ? 'success' : 'error';
			const stickyTraceSnapshot = proxyResult.stickyTrace ? await proxyResult.stickyTrace() : null;
			const upstreamMerged = buildRouteRequestBody(proxyResult.chosenRoute, requestBody) as Record<string, unknown>;
			await recordImageUsage({
				repos,
				apiKeyId: apiKey.keyId,
				userId: apiKey.userId,
				userEmail: apiKey.userEmail,
				ingressHost: apiKey.ingressHost,
				modelId: baseModelId,
				providerId: proxyResult.chosenRoute.providerId,
				providerModelName: proxyResult.chosenRoute.providerModelName,
				modelName: modelNameForLog,
				providerName: proxyResult.chosenRoute.providerName,
				requestBody: requestBodyForLog,
				upstreamRequestBody: finalizeRequestLogJson(geminiBodyRedactedForLog(upstreamMerged, action)),
				requestProtocol: 'gemini',
				requestOperation: GEMINI_GENERATE_OPERATION,
				upstreamProtocol: proxyResult.chosenRoute.upstreamProtocol,
				upstreamOperation: proxyResult.chosenRoute.upstreamOperation,
				modelSurfaceId: proxyResult.chosenRoute.modelSurfaceId,
				routePoolId: proxyResult.chosenRoute.routePoolId,
				routeTargetId: proxyResult.chosenRoute.targetId,
				adapter: proxyResult.chosenRoute.adapter,
				stickyTrace: stickyTraceSnapshot,
				routeGroup: effectiveRouteGroup,
				status,
				latencyMs: Date.now() - start,
				errorMessage:
					status === 'error'
						? errorBodyText != null
							? formatHttpErrorTextForRequestLog(
									response.status,
									response.headers.get('content-type'),
									errorBodyText,
								)
							: imageAbortReason != null
								? imageAbortReason
								: response.ok
									? 'Upstream returned no image data'
									: `HTTP ${response.status}`
						: undefined,
				billing: {
					modelPricingProfileJson: model.pricing_profile ?? null,
					catalogModelId: baseModelId,
					userChargedCostFactorsJson: apiKey.chargedCostFactors,
					routeGroup: effectiveRouteGroup,
					routePriceOverrideJson: proxyResult.chosenRoute.priceOverrideRaw,
					quality: 'auto',
					size,
					imageCount: requestedCount,
					isEdit: referenceCount > 0,
					referenceCount,
					operation: imageOperation,
					requestStartedAtMs: start,
				},
				effectiveImageCount: imageCount,
				imageUsage: status === 'success' ? (proxyResult.meta?.imageUsage ?? null) : null,
				resultConfirmed: status === 'success',
				imageAbortReason,
				clientAbortPrecheck:
					imageAbortReason === 'client_abort' || imageAbortReason === 'gateway_timeout' ? estimate : null,
				providerKeyId: proxyResult.chosenRoute.providerKeyId ?? null,
				providerKeyLabel: proxyResult.chosenRoute.providerKeyLabel ?? null,
				providerKeyFingerprint: proxyResult.chosenRoute.providerKeyFingerprint ?? null,
				upstreamRequestId: proxyResult.upstreamRequestId,
				timing: timing.snapshot(),
				circuitEvents: alertCircuitEvents.length > 0 ? alertCircuitEvents : undefined,
				suppressErrorAlert: proxyResult.suppressErrorAlert || undefined,
			});
		})().catch((error) => {
			console.error(
				`[Gateway Image] record Gemini image passthrough failed baseModelId=${baseModelId} error=${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		}),
	);
	if (proxyResult.stickyMutationPromise) scheduleBackgroundWork(c, proxyResult.stickyMutationPromise);
	return response;
}
