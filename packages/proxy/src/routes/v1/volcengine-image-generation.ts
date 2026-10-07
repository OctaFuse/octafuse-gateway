/**
 * 火山方舟 / BytePlus Seedream 生图透传。
 * `POST /v1/volcengine/images/generations`
 * 请求和响应保持方舟原文，只替换 model。非流式 JSON 与 `stream: true` SSE 共用。
 * 按 `usage.generated_images`（或 SSE 成功事件）计 per_image。
 */
import { isImageGenerationModel, type GatewayRepositories } from '@octafuse/core';
import { requestedVolcengineImageCount } from '@octafuse/core/volcengine-native';
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../../app';
import { requireApiKey, type ApiKeyContext } from '../../middleware/auth';
import { resolveRoutesForSurface } from '../../services/model-router';
import { resolveModelRouting } from '../../services/resolve-model-route-group';
import {
	buildAffinityKey,
	buildTierKeyPrefix,
	resolveRouteStrategyPlan,
} from '../../services/route-strategies';
import { proxyVolcengineJsonPassthrough } from '../../services/proxy';
import { countOpenAiGenerationReferenceImages } from '../../services/image-generation-extras';
import { finalizeRequestLogJson } from '../../services/request-log-shared';
import { canAffordImageCost, estimateImageBudgetPrecheck, recordImageUsage } from '../../services/image-usage-charge';
import { apiKeyHasBalance } from '../../services/tool-usage-charge';
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

type ImageEnv = Env & { Variables: { apiKey: ApiKeyContext } };

const DATA_URL_RE = /^data:[^;]+;base64,/i;

export const volcengineImageGenerationRoutes = new Hono<ImageEnv>();

volcengineImageGenerationRoutes.use('*', requireApiKey);

function redactImageValue(value: unknown): unknown {
	if (typeof value === 'string' && DATA_URL_RE.test(value)) {
		return `[redacted data-url ${value.length} chars]`;
	}
	if (!Array.isArray(value)) return value;
	return value.map((item) =>
		typeof item === 'string' && DATA_URL_RE.test(item) ? `[redacted data-url ${item.length} chars]` : item,
	);
}

function redactVolcengineImageBody(body: Record<string, unknown>): Record<string, unknown> {
	const clone = structuredClone(body);
	if ('image' in clone) clone.image = redactImageValue(clone.image);
	return clone;
}

function billingSize(body: Record<string, unknown>): string {
	return typeof body.size === 'string' && body.size.trim() !== '' ? body.size.trim() : 'auto';
}

volcengineImageGenerationRoutes.post('/', async (c) => {
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
		return gatewayErrorJson(c, { status: 400, code: GatewayErrorCode.invalidRequest, message: 'JSON body must be an object' });
	}
	const requestBody = body as Record<string, unknown>;
	const rawModelId = typeof requestBody.model === 'string' ? requestBody.model.trim() : '';
	if (!rawModelId) {
		return gatewayErrorJson(c, { status: 400, code: GatewayErrorCode.invalidRequest, message: 'Missing model' });
	}
	const preview = await resolveModelRouting(repos, rawModelId);
	if (!preview) {
		return gatewayErrorJson(c, {
			status: 404,
			code: GatewayErrorCode.modelNotFound,
			message: `Model not found: ${rawModelId.slice(0, 200)}`,
		});
	}
	if (!isImageGenerationModel(preview.model)) {
		return gatewayErrorJson(c, {
			status: 400,
			code: GatewayErrorCode.invalidRequest,
			message: 'Volcengine image passthrough requires an image model',
		});
	}
	return forwardVolcengineImage(c, repos, apiKey, preview, requestBody, start, timing);
});

async function forwardVolcengineImage(
	c: Context<ImageEnv>,
	repos: GatewayRepositories,
	apiKey: ApiKeyContext,
	preview: Awaited<ReturnType<typeof resolveModelRouting>> & object,
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
			requestProtocol: 'volcengine',
			requestOperation: 'images.generations',
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
	const referenceCount = countOpenAiGenerationReferenceImages(requestBody);
	const requestedCount = requestedVolcengineImageCount(requestBody);
	const size = billingSize(requestBody);
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
			isEdit: false,
			referenceCount,
			operation: 'generations',
			requestStartedAtMs: start,
		},
		routes.map((route) => route.priceOverrideRaw),
	);
	if (!canAffordImageCost(apiKey.budgetMax, apiKey.budgetSpent, estimate.chargedCost, apiKey.walletGranted, apiKey.walletSpent)) {
		return gatewayErrorJson(c, { status: 403, code: GatewayErrorCode.budgetExceeded, message: 'Budget exceeded' });
	}
	const requestBodyForLog = finalizeRequestLogJson(redactVolcengineImageBody(requestBody));
	const circuitBlocked = maybeBlockUserModelCircuit(c, repos, apiKey, {
		baseModelId,
		modelNameForLog,
		requestBodyForLog,
		requestProtocol: 'volcengine',
		startMs: start,
		timing,
		clientErrorCircuitEnabled: false,
	});
	if (circuitBlocked) return circuitBlocked;
	const strategyPlan = await resolveRouteStrategyPlan({
		routePolicyRaw: model.route_policy ?? null,
		poolStrategy: resolvedSurface.surface?.pool_strategy ?? null,
		poolTierStrategies: resolvedSurface.surface?.pool_tier_strategies ?? null,
		protocol: 'volcengine',
		capability: 'images.generations',
		routeGroup: effectiveRouteGroup,
		repos,
	});
	timing.markGatewayComplete();
	const streaming = requestBody.stream === true;
	const proxyResult = await proxyVolcengineJsonPassthrough(
		repos,
		routes,
		requestBody,
		c.req.raw.signal,
		{
			affinityKey: buildAffinityKey(apiKey.userId, baseModelId, effectiveRouteGroup, 'volcengine'),
			tierKeyPrefix: buildTierKeyPrefix(baseModelId, effectiveRouteGroup, 'volcengine'),
			strategy: strategyPlan.base,
			tierStrategies: strategyPlan.tierOverrides,
			timing,
			sticky: stickyConfigFromSurface(resolvedSurface.surface),
			inboundHeaders: c.req.raw.headers,
		},
	);
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
			const imageCount =
				response.ok && imageAbortReason == null ? Math.max(0, proxyResult.meta?.imageCount ?? 0) : 0;
			if (streaming && response.ok && imageAbortReason == null && imageCount > 0) {
				markUserModelSuccess(apiKey.userId, baseModelId);
			}
			const status = response.ok && imageAbortReason == null && imageCount > 0 ? 'success' : 'error';
			const stickyTraceSnapshot = proxyResult.stickyTrace ? await proxyResult.stickyTrace() : null;
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
				requestProtocol: 'volcengine',
				requestOperation: 'images.generations',
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
							? formatHttpErrorTextForRequestLog(response.status, response.headers.get('content-type'), errorBodyText)
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
					isEdit: false,
					referenceCount,
					operation: 'generations',
					requestStartedAtMs: start,
				},
				effectiveImageCount: imageCount,
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
				`[Gateway Image] record Volcengine image passthrough failed baseModelId=${baseModelId} error=${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		}),
	);
	if (proxyResult.stickyMutationPromise) scheduleBackgroundWork(c, proxyResult.stickyMutationPromise);
	return response;
}
