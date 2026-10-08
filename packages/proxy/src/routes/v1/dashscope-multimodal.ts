/**
 * DashScope 同步多模态 ASR HTTP 透传：
 * `POST /v1/dashscope/services/aigc/multimodal-generation/generation`
 *
 * 请求/上游都是 dashscope + audio.transcriptions.multimodal，adapter 必须是 passthrough。
 * 返回原生 JSON，按 usage.duration / usage.seconds 计 audio_per_second。
 */
import {
	isAudioSpeechModel,
	isImageGenerationModel,
	type GatewayRepositories,
	type ModelRow,
	type ResolvedModelSurfaceRow,
} from '@octafuse/core';
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../../app';
import { requireApiKey, type ApiKeyContext } from '../../middleware/auth';
import { resolveRoutesForSurface, type RouteResult } from '../../services/model-router';
import { resolveModelRouting } from '../../services/resolve-model-route-group';
import {
	buildAffinityKey,
	buildTierKeyPrefix,
	resolveRouteStrategyPlan,
} from '../../services/route-strategies';
import { proxyDashScopeJsonPassthrough, proxyDashScopeMultimodalPassthrough, type ProxyResult } from '../../services/proxy';
import type { DashScopePassthroughSurface } from '../../services/egress/dashscope-json-passthrough';
import { finalizeRequestLogJson } from '../../services/request-log-shared';
import { canAffordAudioCost, estimateAudioBudgetPrecheck, recordAudioUsage } from '../../services/audio-usage-charge';
import { canAffordImageCost, estimateImageBudgetPrecheck, recordImageUsage } from '../../services/image-usage-charge';
import { apiKeyHasBalance } from '../../services/tool-usage-charge';
import { formatHttpErrorTextForRequestLog, materializeNonOkResponse } from '../../services/request-log-record-status';
import {
	maybeBlockUserModelCircuit,
	maybeTriggerUserModelCircuitFromUpstream,
	markUserModelSuccess,
} from '../../services/user-model-circuit-route';
import {
	GatewayErrorCode,
	NO_AVAILABLE_ROUTE_MESSAGE,
	type GatewayErrorCodeValue,
} from '../../services/gateway-error-codes';
import { gatewayErrorJson } from '../../services/gateway-error-response';
import { RequestTimingCollector } from '../../services/request-timing';
import { scheduleBackgroundWork } from '../../runtime/schedule-background-work';
import { stickyConfigFromSurface } from '../../services/provider-sticky-routing';

type MultimodalEnv = Env & { Variables: { apiKey: ApiKeyContext } };
type MultimodalContext = Context<MultimodalEnv>;

export const dashScopeMultimodalRoutes = new Hono<MultimodalEnv>();

dashScopeMultimodalRoutes.use('*', requireApiKey);

const DATA_URL_RE = /^data:[^;]+;base64,/i;

function redactDashScopeMultimodalBody(body: Record<string, unknown>): Record<string, unknown> {
	const clone = structuredClone(body);
	const input = clone.input;
	if (input != null && typeof input === 'object' && !Array.isArray(input)) {
		const messages = (input as Record<string, unknown>).messages;
		if (Array.isArray(messages)) {
			for (const message of messages) {
				if (message == null || typeof message !== 'object') continue;
				const content = (message as Record<string, unknown>).content;
				if (!Array.isArray(content)) continue;
				for (const part of content) {
					if (part == null || typeof part !== 'object') continue;
					const inputAudio = (part as Record<string, unknown>).input_audio;
					if (inputAudio != null && typeof inputAudio === 'object' && !Array.isArray(inputAudio)) {
						const data = (inputAudio as Record<string, unknown>).data;
						if (typeof data === 'string' && DATA_URL_RE.test(data)) {
							(inputAudio as Record<string, unknown>).data = `[redacted data-url ${data.length} chars]`;
						}
					}
					const audio = (part as Record<string, unknown>).audio;
					if (typeof audio === 'string' && DATA_URL_RE.test(audio)) {
						(part as Record<string, unknown>).audio = `[redacted data-url ${audio.length} chars]`;
					}
				}
			}
		}
	}
	return clone;
}

/** 同一条多模态路径按模型类型选择透传 operation，转写模型保持原来的 ASR 入口。 */
export function dashScopeMultimodalOperation(model: ModelRow): DashScopePassthroughSurface | 'audio.transcriptions.multimodal' {
	if (isImageGenerationModel(model)) return 'images.generations.multimodal';
	if (isAudioSpeechModel(model)) return 'audio.speech.multimodal';
	return 'audio.transcriptions.multimodal';
}

function modelDisplayName(model: { display_name?: string | null }, baseModelId: string): string {
	return model.display_name != null && String(model.display_name).trim() !== ''
		? String(model.display_name).trim()
		: baseModelId;
}

async function resolveDashScopeMultimodalRoutes(
	repos: GatewayRepositories,
	rawModelId: string,
	requestOperation: string,
): Promise<
	| {
			ok: true;
			model: ModelRow;
			baseModelId: string;
			effectiveRouteGroup: string;
			routes: RouteResult[];
			poolStrategy: string | null;
			poolTierStrategies: string | null;
			stickySurface: ResolvedModelSurfaceRow | null;
	  }
	| { ok: false; status: 400 | 404 | 502; code: GatewayErrorCodeValue; error: string }
> {
	const resolved = await resolveModelRouting(repos, rawModelId);
	if (!resolved) {
		return {
			ok: false,
			status: 404,
			code: GatewayErrorCode.modelNotFound,
			error: `Model not found: ${rawModelId.trim().slice(0, 200)}`,
		};
	}
	const { model, baseModelId, explicitGroup } = resolved;
	const effectiveRouteGroup = explicitGroup?.trim() || 'default';
	try {
		const resolvedSurface = await resolveRoutesForSurface(repos, {
			modelId: baseModelId,
			routeGroup: effectiveRouteGroup,
			requestProtocol: 'dashscope',
			requestOperation,
		});
		if (resolvedSurface.routes.length === 0) {
			return {
				ok: false,
				status: 404,
				code: GatewayErrorCode.noRoute,
				error: NO_AVAILABLE_ROUTE_MESSAGE,
			};
		}
		return {
			ok: true,
			model,
			baseModelId,
			effectiveRouteGroup,
			routes: resolvedSurface.routes,
			poolStrategy: resolvedSurface.surface?.pool_strategy ?? null,
			poolTierStrategies: resolvedSurface.surface?.pool_tier_strategies ?? null,
			stickySurface: resolvedSurface.surface,
		};
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Model route resolution failed';
		return {
			ok: false,
			status: 502,
			code: GatewayErrorCode.routeResolutionFailed,
			error: message,
		};
	}
}

dashScopeMultimodalRoutes.post('/', async (c) => {
	const repos = c.get('repositories');
	const apiKey = c.get('apiKey');
	const start = Date.now();
	const timing = new RequestTimingCollector();
	let body: unknown;
	try {
		body = await c.req.json();
	} catch {
		return gatewayErrorJson(c, {
			status: 400,
			code: GatewayErrorCode.invalidJson,
			message: 'Invalid JSON body',
		});
	}
	if (body == null || typeof body !== 'object' || Array.isArray(body)) {
		return gatewayErrorJson(c, {
			status: 400,
			code: GatewayErrorCode.invalidRequest,
			message: 'JSON body must be an object',
		});
	}
	const requestBody = body as Record<string, unknown>;
	const rawModelId = typeof requestBody.model === 'string' ? requestBody.model.trim() : '';
	if (!rawModelId) {
		return gatewayErrorJson(c, {
			status: 400,
			code: GatewayErrorCode.invalidRequest,
			message: 'Missing model',
		});
	}

	const preview = await resolveModelRouting(repos, rawModelId);
	if (!preview) {
		return gatewayErrorJson(c, {
			status: 404,
			code: GatewayErrorCode.modelNotFound,
			message: `Model not found: ${rawModelId.trim().slice(0, 200)}`,
		});
	}
	const requestOperation = dashScopeMultimodalOperation(preview.model);
	const routed = await resolveDashScopeMultimodalRoutes(repos, rawModelId, requestOperation);
	if (!routed.ok) {
		return gatewayErrorJson(c, {
			status: routed.status,
			code: routed.code,
			message: routed.error,
		});
	}
	const { model, baseModelId, effectiveRouteGroup, routes, stickySurface } = routed;
	const modelNameForLog = modelDisplayName(model, baseModelId);
	if (!apiKeyHasBalance(apiKey)) {
		return gatewayErrorJson(c, {
			status: 403,
			code: GatewayErrorCode.budgetExceeded,
			message: 'Budget exceeded',
		});
	}
	if (requestOperation === 'images.generations.multimodal') {
		const requested = requestBody.parameters;
		const n =
			requested != null && typeof requested === 'object' && !Array.isArray(requested)
				? Number((requested as Record<string, unknown>).n ?? 1)
				: 1;
		const estimate = await estimateImageBudgetPrecheck(
			repos,
			{
				modelPricingProfileJson: model.pricing_profile ?? null,
				catalogModelId: baseModelId,
				userChargedCostFactorsJson: apiKey.chargedCostFactors,
				routeGroup: effectiveRouteGroup,
				imageCount: Number.isFinite(n) && n > 0 ? Math.floor(n) : 1,
			},
			routes.map((route) => route.priceOverrideRaw),
		);
		if (!canAffordImageCost(apiKey.budgetMax, apiKey.budgetSpent, estimate.chargedCost, apiKey.walletGranted, apiKey.walletSpent)) {
			return gatewayErrorJson(c, {
				status: 403,
				code: GatewayErrorCode.budgetExceeded,
				message: 'Budget exceeded',
			});
		}
	} else {
		const estimate = await estimateAudioBudgetPrecheck(
			repos,
			{
				modelPricingProfileJson: model.pricing_profile ?? null,
				catalogModelId: baseModelId,
				userChargedCostFactorsJson: apiKey.chargedCostFactors,
				routeGroup: effectiveRouteGroup,
				fileBytes: 0,
				requestStartedAtMs: start,
			},
			routes.map((route) => route.priceOverrideRaw),
		);
		if (!canAffordAudioCost(apiKey.budgetMax, apiKey.budgetSpent, estimate.chargedCost, apiKey.walletGranted, apiKey.walletSpent)) {
			return gatewayErrorJson(c, {
				status: 403,
				code: GatewayErrorCode.budgetExceeded,
				message: 'Budget exceeded',
			});
		}
	}

	const requestBodyForLog = finalizeRequestLogJson(redactDashScopeMultimodalBody(requestBody));
	const circuitBlocked = maybeBlockUserModelCircuit(c, repos, apiKey, {
		baseModelId,
		modelNameForLog,
		requestBodyForLog,
		requestProtocol: 'dashscope',
		startMs: start,
		timing,
		clientErrorCircuitEnabled: false,
	});
	if (circuitBlocked) return circuitBlocked;

	const strategyPlan = await resolveRouteStrategyPlan({
		routePolicyRaw: model.route_policy ?? null,
		poolStrategy: routed.poolStrategy,
		poolTierStrategies: routed.poolTierStrategies,
		protocol: 'dashscope',
		capability: requestOperation,
		routeGroup: effectiveRouteGroup,
		repos,
	});
	timing.markGatewayComplete();
	const proxyOptions = {
		affinityKey: buildAffinityKey(apiKey.userId, baseModelId, effectiveRouteGroup, 'dashscope'),
		tierKeyPrefix: buildTierKeyPrefix(baseModelId, effectiveRouteGroup, 'dashscope'),
		strategy: strategyPlan.base,
		tierStrategies: strategyPlan.tierOverrides,
		timing,
		sticky: stickyConfigFromSurface(stickySurface),
		inboundHeaders: c.req.raw.headers,
	};
	const proxyResult =
		requestOperation === 'audio.transcriptions.multimodal'
			? await proxyDashScopeMultimodalPassthrough(repos, routes, requestBody, c.req.raw.signal, proxyOptions)
			: await proxyDashScopeJsonPassthrough(
					repos,
					routes,
					requestOperation,
					requestBody,
					c.req.raw.signal,
					{
						...proxyOptions,
						dashScopeJson: { sse: c.req.header('X-DashScope-SSE') },
					},
				);
	return finalizeMultimodalResponse({
		c,
		proxyResult,
		apiKey,
		repos,
		baseModelId,
		effectiveRouteGroup,
		modelNameForLog,
		requestBodyForLog,
		modelPricingProfileJson: model.pricing_profile ?? null,
		start,
		timing,
		requestOperation,
	});
});

async function finalizeMultimodalResponse(params: {
	c: MultimodalContext;
	proxyResult: ProxyResult;
	apiKey: ApiKeyContext;
	repos: GatewayRepositories;
	baseModelId: string;
	effectiveRouteGroup: string;
	modelNameForLog: string;
	requestBodyForLog: string | null;
	modelPricingProfileJson: string | null;
	start: number;
	timing: RequestTimingCollector;
	requestOperation: string;
}): Promise<Response> {
	const {
		c,
		proxyResult,
		apiKey,
		repos,
		baseModelId,
		effectiveRouteGroup,
		modelNameForLog,
		requestBodyForLog,
		modelPricingProfileJson,
		start,
		timing,
		requestOperation,
	} = params;
	const { chosenRoute, upstreamRequestId, circuitEvents, suppressErrorAlert, stickyTrace, stickyMutationPromise } =
		proxyResult;
	if (stickyMutationPromise) {
		scheduleBackgroundWork(c, stickyMutationPromise);
	}
	const { response, errorBodyText } = await materializeNonOkResponse(proxyResult.response);
	await proxyResult.usagePromise.catch(() => undefined);
	const meta = proxyResult.meta;
	const durationSeconds = response.ok ? (meta?.audioDurationSeconds ?? 0) : 0;
	const durationSource = response.ok && meta?.audioDurationSource ? meta.audioDurationSource : 'estimated';

	let userModelCircuitEvent = null;
	if (response.ok) {
		markUserModelSuccess(apiKey.userId, baseModelId);
	} else if (errorBodyText != null) {
		userModelCircuitEvent = maybeTriggerUserModelCircuitFromUpstream(
			apiKey.userId,
			baseModelId,
			response.status,
			response.headers.get('content-type'),
			errorBodyText,
			formatHttpErrorTextForRequestLog(response.status, response.headers.get('content-type'), errorBodyText),
			{ clientErrorCircuitEnabled: false },
		);
	}
	const alertCircuitEvents = userModelCircuitEvent ? [...circuitEvents, userModelCircuitEvent] : circuitEvents;
	const status: 'success' | 'error' = response.ok ? 'success' : 'error';
	const errorMessage =
		status === 'error'
			? errorBodyText != null
				? formatHttpErrorTextForRequestLog(response.status, response.headers.get('content-type'), errorBodyText)
				: `HTTP ${response.status}`
			: undefined;

	scheduleBackgroundWork(
		c,
		(async () => {
			const stickyTraceSnapshot = stickyTrace ? await stickyTrace() : null;
			if (requestOperation === 'images.generations.multimodal') {
				await recordImageUsage({
					repos,
					apiKeyId: apiKey.keyId,
					userId: apiKey.userId,
					userEmail: apiKey.userEmail,
					ingressHost: apiKey.ingressHost,
					modelId: baseModelId,
					providerId: chosenRoute.providerId,
					providerModelName: chosenRoute.providerModelName,
					modelName: modelNameForLog,
					providerName: chosenRoute.providerName,
					requestBody: requestBodyForLog,
					requestProtocol: 'dashscope',
					requestOperation,
					upstreamProtocol: chosenRoute.upstreamProtocol,
					upstreamOperation: chosenRoute.upstreamOperation,
					modelSurfaceId: chosenRoute.modelSurfaceId,
					routePoolId: chosenRoute.routePoolId,
					routeTargetId: chosenRoute.targetId,
					adapter: chosenRoute.adapter,
					stickyTrace: stickyTraceSnapshot,
					routeGroup: effectiveRouteGroup,
					status,
					latencyMs: Date.now() - start,
					errorMessage,
					billing: {
						modelPricingProfileJson,
						catalogModelId: baseModelId,
						userChargedCostFactorsJson: apiKey.chargedCostFactors,
						routeGroup: effectiveRouteGroup,
						routePriceOverrideJson: chosenRoute.priceOverrideRaw,
						imageCount: response.ok ? (meta?.imageCount ?? 0) : 0,
					},
					effectiveImageCount: response.ok ? (meta?.imageCount ?? 0) : 0,
					resultConfirmed: response.ok && (meta?.imageCount ?? 0) > 0,
					providerKeyId: chosenRoute.providerKeyId ?? null,
					providerKeyLabel: chosenRoute.providerKeyLabel ?? null,
					providerKeyFingerprint: chosenRoute.providerKeyFingerprint ?? null,
					upstreamRequestId,
					timing: timing.snapshot(),
					circuitEvents: alertCircuitEvents.length > 0 ? alertCircuitEvents : undefined,
					suppressErrorAlert: suppressErrorAlert || undefined,
				});
				return;
			}
			const usage = await proxyResult.usagePromise.catch(() => null);
			await recordAudioUsage({
				repos,
				apiKeyId: apiKey.keyId,
				userId: apiKey.userId,
				userEmail: apiKey.userEmail,
				ingressHost: apiKey.ingressHost,
				modelId: baseModelId,
				providerId: chosenRoute.providerId,
				providerModelName: chosenRoute.providerModelName,
				modelName: modelNameForLog,
				providerName: chosenRoute.providerName,
				requestBody: requestBodyForLog,
				requestProtocol: 'dashscope',
				requestOperation,
				upstreamProtocol: chosenRoute.upstreamProtocol,
				upstreamOperation: chosenRoute.upstreamOperation,
				modelSurfaceId: chosenRoute.modelSurfaceId,
				routePoolId: chosenRoute.routePoolId,
				routeTargetId: chosenRoute.targetId,
				adapter: chosenRoute.adapter,
				stickyTrace: stickyTraceSnapshot,
				routeGroup: effectiveRouteGroup,
				status,
				latencyMs: Date.now() - start,
				errorMessage,
				billing: {
					modelPricingProfileJson,
					catalogModelId: baseModelId,
					userChargedCostFactorsJson: apiKey.chargedCostFactors,
					routeGroup: effectiveRouteGroup,
					routePriceOverrideJson: chosenRoute.priceOverrideRaw,
					durationSeconds,
					durationSource,
					fileBytes: 0,
					characters: response.ok ? (meta?.audioCharacters ?? usage?.audio_characters ?? null) : null,
					requestStartedAtMs: start,
				},
				providerKeyId: chosenRoute.providerKeyId ?? null,
				providerKeyLabel: chosenRoute.providerKeyLabel ?? null,
				providerKeyFingerprint: chosenRoute.providerKeyFingerprint ?? null,
				upstreamRequestId,
				timing: timing.snapshot(),
				circuitEvents: alertCircuitEvents.length > 0 ? alertCircuitEvents : undefined,
				suppressErrorAlert: suppressErrorAlert || undefined,
			});
		})().catch((error) => {
			console.error(
				`[Gateway Audio] record DashScope multimodal usage failed baseModelId=${baseModelId} error=${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		}),
	);
	return response;
}
