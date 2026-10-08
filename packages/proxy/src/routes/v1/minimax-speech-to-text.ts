/**
 * MiniMax 原生 ASR 透传：`POST /v1/minimax/speech_to_text`
 *
 * 请求/上游都是 minimax + audio.transcriptions，adapter 必须是 passthrough。
 * 表单原样转发（model 换成供应商模型名），响应不改写，按上游 duration 计 audio_per_second。
 * `language` 可以放请求头，也可以放表单，网关统一转到上游请求头。
 */
import type { GatewayRepositories, ModelRow, ResolvedModelSurfaceRow } from '@octafuse/core';
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
import { proxyMiniMaxAsrPassthrough, type ProxyResult } from '../../services/proxy';
import type { MiniMaxAsrPassthroughRequest } from '../../services/egress/minimax-audio-driver';
import { finalizeRequestLogJson } from '../../services/request-log-shared';
import { canAffordAudioCost, estimateAudioBudgetPrecheck, recordAudioUsage } from '../../services/audio-usage-charge';
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
import {
	AUDIO_MAX_BYTES_PER_FILE,
	normalizeAudioMimeType,
	resolveAudioUploadFilename,
	validateAudioUpload,
} from '../../services/egress/openai-audio-driver';

type SpeechEnv = Env & { Variables: { apiKey: ApiKeyContext } };
type SpeechContext = Context<SpeechEnv>;

export const miniMaxSpeechToTextRoutes = new Hono<SpeechEnv>();

miniMaxSpeechToTextRoutes.use('*', requireApiKey);

function textField(value: unknown): string {
	if (typeof value === 'string') return value;
	if (Array.isArray(value)) {
		const first = value.find((item) => typeof item === 'string');
		return typeof first === 'string' ? first : '';
	}
	return '';
}

function fileField(value: unknown): File | null {
	if (value != null && typeof value === 'object' && 'arrayBuffer' in value) {
		return value as File;
	}
	if (Array.isArray(value)) {
		for (const item of value) {
			if (item != null && typeof item === 'object' && 'arrayBuffer' in item) {
				return item as File;
			}
		}
	}
	return null;
}

function modelDisplayName(model: { display_name?: string | null }, baseModelId: string): string {
	return model.display_name != null && String(model.display_name).trim() !== ''
		? String(model.display_name).trim()
		: baseModelId;
}

async function resolveMiniMaxSpeechRoutes(
	repos: GatewayRepositories,
	rawModelId: string,
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
			requestProtocol: 'minimax',
			requestOperation: 'audio.transcriptions',
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

miniMaxSpeechToTextRoutes.post('/', async (c) => {
	const repos = c.get('repositories');
	const apiKey = c.get('apiKey');
	const start = Date.now();
	const timing = new RequestTimingCollector();

	let body: Record<string, unknown>;
	try {
		body = (await c.req.parseBody({ all: true })) as Record<string, unknown>;
	} catch {
		return gatewayErrorJson(c, {
			status: 400,
			code: GatewayErrorCode.invalidRequest,
			message: 'Invalid multipart body',
		});
	}

	const rawModelId = textField(body.model).trim();
	if (!rawModelId) {
		return gatewayErrorJson(c, {
			status: 400,
			code: GatewayErrorCode.invalidRequest,
			message: 'Missing model',
		});
	}
	const upload = fileField(body.file);
	if (!upload) {
		return gatewayErrorJson(c, {
			status: 400,
			code: GatewayErrorCode.invalidRequest,
			message: 'Missing audio file',
		});
	}
	const declaredSize = typeof upload.size === 'number' && Number.isFinite(upload.size) ? upload.size : null;
	if (declaredSize != null && declaredSize > AUDIO_MAX_BYTES_PER_FILE) {
		return gatewayErrorJson(c, {
			status: 400,
			code: GatewayErrorCode.invalidRequest,
			message: `audio file must be at most ${AUDIO_MAX_BYTES_PER_FILE} bytes`,
		});
	}
	const bytes = new Uint8Array(await upload.arrayBuffer());
	const mimeType = normalizeAudioMimeType(upload.type || '') || 'application/octet-stream';
	const filename = resolveAudioUploadFilename((upload as { name?: string }).name || '', mimeType);
	const file = { filename, mimeType, bytes };
	const uploadError = validateAudioUpload(file);
	if (uploadError) {
		return gatewayErrorJson(c, {
			status: 400,
			code: GatewayErrorCode.invalidRequest,
			message: uploadError,
		});
	}

	const fields: Record<string, string> = {};
	for (const [key, value] of Object.entries(body)) {
		if (key === 'model' || key === 'file') continue;
		const text = textField(value).trim();
		if (text !== '') fields[key] = text;
	}
	const languageHeader = c.req.header('language')?.trim() || undefined;
	const request: MiniMaxAsrPassthroughRequest = {
		file,
		fields,
		languageHeader,
	};

	const routed = await resolveMiniMaxSpeechRoutes(repos, rawModelId);
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
	const estimate = await estimateAudioBudgetPrecheck(
		repos,
		{
			modelPricingProfileJson: model.pricing_profile ?? null,
			catalogModelId: baseModelId,
			userChargedCostFactorsJson: apiKey.chargedCostFactors,
			routeGroup: effectiveRouteGroup,
			fileBytes: bytes.byteLength,
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

	const requestBodyForLog = finalizeRequestLogJson({
		model: rawModelId,
		...fields,
		file: `${filename} (${bytes.byteLength} bytes, ${mimeType})`,
	});
	const circuitBlocked = maybeBlockUserModelCircuit(c, repos, apiKey, {
		baseModelId,
		modelNameForLog,
		requestBodyForLog,
		requestProtocol: 'minimax',
		startMs: start,
		timing,
		clientErrorCircuitEnabled: false,
	});
	if (circuitBlocked) return circuitBlocked;

	const strategyPlan = await resolveRouteStrategyPlan({
		routePolicyRaw: model.route_policy ?? null,
		poolStrategy: routed.poolStrategy,
		poolTierStrategies: routed.poolTierStrategies,
		protocol: 'minimax',
		capability: 'audio.transcriptions',
		routeGroup: effectiveRouteGroup,
		repos,
	});
	timing.markGatewayComplete();
	const proxyResult = await proxyMiniMaxAsrPassthrough(repos, routes, request, c.req.raw.signal, {
		affinityKey: buildAffinityKey(apiKey.userId, baseModelId, effectiveRouteGroup, 'minimax'),
		tierKeyPrefix: buildTierKeyPrefix(baseModelId, effectiveRouteGroup, 'minimax'),
		strategy: strategyPlan.base,
		tierStrategies: strategyPlan.tierOverrides,
		timing,
		sticky: stickyConfigFromSurface(stickySurface),
		inboundHeaders: c.req.raw.headers,
	});
	return finalizeSpeechResponse({
		c,
		proxyResult,
		apiKey,
		repos,
		baseModelId,
		effectiveRouteGroup,
		modelNameForLog,
		requestBodyForLog,
		modelPricingProfileJson: model.pricing_profile ?? null,
		fileBytes: bytes.byteLength,
		start,
		timing,
	});
});

async function finalizeSpeechResponse(params: {
	c: SpeechContext;
	proxyResult: ProxyResult;
	apiKey: ApiKeyContext;
	repos: GatewayRepositories;
	baseModelId: string;
	effectiveRouteGroup: string;
	modelNameForLog: string;
	requestBodyForLog: string | null;
	modelPricingProfileJson: string | null;
	fileBytes: number;
	start: number;
	timing: RequestTimingCollector;
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
		fileBytes,
		start,
		timing,
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
				requestProtocol: 'minimax',
				requestOperation: 'audio.transcriptions',
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
					fileBytes,
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
				`[Gateway Audio] record MiniMax ASR passthrough usage failed baseModelId=${baseModelId} error=${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		}),
	);
	return response;
}
