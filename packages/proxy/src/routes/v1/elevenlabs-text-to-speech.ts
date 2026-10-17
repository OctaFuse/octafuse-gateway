/**
 * ElevenLabs 原生文本转语音透传，与官方 SDK 路径一致：
 * `POST /elevenlabs/v1/text-to-speech/:voiceId`
 * `POST /elevenlabs/v1/text-to-speech/:voiceId/stream`
 * `POST /elevenlabs/v1/text-to-speech/:voiceId/with-timestamps`
 * `POST /elevenlabs/v1/text-to-speech/:voiceId/stream/with-timestamps`
 * 四种变体共用 `audio.speech`。body 里的 `model_id` 填 Gateway 模型 ID，query 原样转发。
 * 计费字符取上游 `x-character-count`，缺失时按输入文本长度。
 */
import type { GatewayRepositories } from '@octafuse/core';
import type { ElevenLabsTtsVariant } from '@octafuse/core/elevenlabs-native';
import { isValidElevenLabsVoiceId } from '@octafuse/core/elevenlabs-native';
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
import { proxyElevenLabsTtsPassthrough } from '../../services/proxy';
import { finalizeRequestLogJson } from '../../services/request-log-shared';
import {
	canAffordAudioCost,
	estimateAudioSpeechBudgetPrecheck,
	recordAudioUsage,
} from '../../services/audio-usage-charge';
import { apiKeyHasBalance } from '../../services/tool-usage-charge';
import {
	formatHttpErrorTextForRequestLog,
	materializeNonOkResponse,
} from '../../services/request-log-record-status';
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
import { audioModelGuardMessage } from './audio-model-guard';

type SpeechEnv = Env & { Variables: { apiKey: ApiKeyContext } };

export const elevenLabsTextToSpeechRoutes = new Hono<SpeechEnv>();

elevenLabsTextToSpeechRoutes.use('*', requireApiKey);

const VARIANT_PATHS: ReadonlyArray<readonly [string, ElevenLabsTtsVariant]> = [
	['/:voiceId', 'speech'],
	['/:voiceId/stream', 'stream'],
	['/:voiceId/with-timestamps', 'timestamps'],
	['/:voiceId/stream/with-timestamps', 'stream-timestamps'],
];

for (const [path, variant] of VARIANT_PATHS) {
	elevenLabsTextToSpeechRoutes.post(path, (c) => handleElevenLabsSpeech(c, variant));
}

async function handleElevenLabsSpeech(
	c: Context<SpeechEnv>,
	variant: ElevenLabsTtsVariant,
): Promise<Response> {
	const repos = c.get('repositories');
	const apiKey = c.get('apiKey');
	const start = Date.now();
	const timing = new RequestTimingCollector();
	const voiceId = c.req.param('voiceId') ?? '';
	if (!isValidElevenLabsVoiceId(voiceId)) {
		return gatewayErrorJson(c, {
			status: 400,
			code: GatewayErrorCode.invalidRequest,
			message: 'Invalid voice_id',
		});
	}
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
	const requestBody = body as Record<string, unknown>;
	const rawModelId = typeof requestBody.model_id === 'string' ? requestBody.model_id.trim() : '';
	if (!rawModelId) {
		return gatewayErrorJson(c, { status: 400, code: GatewayErrorCode.invalidRequest, message: 'Missing model_id' });
	}
	const text = typeof requestBody.text === 'string' ? requestBody.text : '';
	if (!text.trim()) {
		return gatewayErrorJson(c, { status: 400, code: GatewayErrorCode.invalidRequest, message: 'Missing text' });
	}
	const preview = await resolveModelRouting(repos, rawModelId);
	if (!preview) {
		return gatewayErrorJson(c, {
			status: 404,
			code: GatewayErrorCode.modelNotFound,
			message: `Model not found: ${rawModelId.slice(0, 200)}`,
		});
	}
	const guardMessage = audioModelGuardMessage(preview.model, 'tts', 'ElevenLabs speech passthrough');
	if (guardMessage) {
		return gatewayErrorJson(c, { status: 400, code: GatewayErrorCode.invalidRequest, message: guardMessage });
	}
	return forwardElevenLabsSpeech(c, repos, apiKey, preview, {
		voiceId,
		variant,
		query: c.req.query(),
		body: requestBody,
		inputCharacters: Array.from(text).length,
		start,
		timing,
	});
}

async function forwardElevenLabsSpeech(
	c: Context<SpeechEnv>,
	repos: GatewayRepositories,
	apiKey: ApiKeyContext,
	preview: Awaited<ReturnType<typeof resolveModelRouting>> & object,
	input: {
		voiceId: string;
		variant: ElevenLabsTtsVariant;
		query: Record<string, string>;
		body: Record<string, unknown>;
		inputCharacters: number;
		start: number;
		timing: RequestTimingCollector;
	},
): Promise<Response> {
	const { start, timing } = input;
	const { model, baseModelId, explicitGroup } = preview;
	const effectiveRouteGroup = explicitGroup?.trim() || 'default';
	let resolvedSurface;
	try {
		resolvedSurface = await resolveRoutesForSurface(repos, {
			modelId: baseModelId,
			routeGroup: effectiveRouteGroup,
			requestProtocol: 'elevenlabs',
			requestOperation: 'audio.speech',
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
	const estimate = await estimateAudioSpeechBudgetPrecheck(
		repos,
		{
			modelPricingProfileJson: model.pricing_profile ?? null,
			catalogModelId: baseModelId,
			userChargedCostFactorsJson: apiKey.chargedCostFactors,
			routeGroup: effectiveRouteGroup,
			inputCharacters: input.inputCharacters,
			requestStartedAtMs: start,
		},
		routes.map((route) => route.priceOverrideRaw),
	);
	if (
		!canAffordAudioCost(
			apiKey.budgetMax,
			apiKey.budgetSpent,
			estimate.chargedCost,
			apiKey.walletGranted,
			apiKey.walletSpent,
		)
	) {
		return gatewayErrorJson(c, { status: 403, code: GatewayErrorCode.budgetExceeded, message: 'Budget exceeded' });
	}
	const requestBodyForLog = finalizeRequestLogJson({
		...input.body,
		voice_id: input.voiceId,
		variant: input.variant,
		...(Object.keys(input.query).length > 0 ? { query: input.query } : {}),
	});
	const circuitBlocked = maybeBlockUserModelCircuit(c, repos, apiKey, {
		baseModelId,
		modelNameForLog,
		requestBodyForLog,
		requestProtocol: 'elevenlabs',
		startMs: start,
		timing,
		clientErrorCircuitEnabled: false,
	});
	if (circuitBlocked) return circuitBlocked;
	const strategyPlan = await resolveRouteStrategyPlan({
		routePolicyRaw: model.route_policy ?? null,
		poolStrategy: resolvedSurface.surface?.pool_strategy ?? null,
		poolTierStrategies: resolvedSurface.surface?.pool_tier_strategies ?? null,
		protocol: 'elevenlabs',
		capability: 'audio.speech',
		routeGroup: effectiveRouteGroup,
		repos,
	});
	timing.markGatewayComplete();
	const proxyResult = await proxyElevenLabsTtsPassthrough(
		repos,
		routes,
		{
			voiceId: input.voiceId,
			variant: input.variant,
			query: input.query,
			body: input.body,
			inputCharacters: input.inputCharacters,
		},
		c.req.raw.signal,
		{
			affinityKey: buildAffinityKey(apiKey.userId, baseModelId, effectiveRouteGroup, 'elevenlabs'),
			tierKeyPrefix: buildTierKeyPrefix(baseModelId, effectiveRouteGroup, 'elevenlabs'),
			strategy: strategyPlan.base,
			tierStrategies: strategyPlan.tierOverrides,
			timing,
			sticky: stickyConfigFromSurface(resolvedSurface.surface),
			inboundHeaders: c.req.raw.headers,
		},
	);
	const { response, errorBodyText } = await materializeNonOkResponse(proxyResult.response);
	const streaming = input.variant === 'stream' || input.variant === 'stream-timestamps';
	if (response.ok && !streaming) markUserModelSuccess(apiKey.userId, baseModelId);
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
			const usage = await proxyResult.usagePromise.catch(() => null);
			const streamError = usage?.stream_error;
			if (streaming && response.ok && !streamError && !usage?.cancelled) {
				markUserModelSuccess(apiKey.userId, baseModelId);
			}
			const ok = response.ok && !streamError && !usage?.cancelled;
			const stickyTraceSnapshot = proxyResult.stickyTrace ? await proxyResult.stickyTrace() : null;
			await recordAudioUsage({
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
				requestProtocol: 'elevenlabs',
				requestOperation: 'audio.speech',
				upstreamProtocol: proxyResult.chosenRoute.upstreamProtocol,
				upstreamOperation: proxyResult.chosenRoute.upstreamOperation,
				modelSurfaceId: proxyResult.chosenRoute.modelSurfaceId,
				routePoolId: proxyResult.chosenRoute.routePoolId,
				routeTargetId: proxyResult.chosenRoute.targetId,
				adapter: proxyResult.chosenRoute.adapter,
				stickyTrace: stickyTraceSnapshot,
				routeGroup: effectiveRouteGroup,
				status: ok ? 'success' : 'error',
				latencyMs: Date.now() - start,
				errorMessage: ok
					? undefined
					: usage?.cancelled
						? 'Client disconnected before speech stream completed'
						: streamError
							? `Speech stream failed: ${streamError}`
							: errorBodyText != null
								? formatHttpErrorTextForRequestLog(
										response.status,
										response.headers.get('content-type'),
										errorBodyText,
									)
								: `HTTP ${response.status}`,
				billing: {
					modelPricingProfileJson: model.pricing_profile ?? null,
					catalogModelId: baseModelId,
					userChargedCostFactorsJson: apiKey.chargedCostFactors,
					routeGroup: effectiveRouteGroup,
					routePriceOverrideJson: proxyResult.chosenRoute.priceOverrideRaw,
					durationSeconds: 0,
					durationSource: 'estimated',
					fileBytes: 0,
					characters: ok ? (usage?.audio_characters ?? proxyResult.meta?.audioCharacters ?? null) : null,
					requestStartedAtMs: start,
				},
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
				`[Gateway Audio] record ElevenLabs speech passthrough failed baseModelId=${baseModelId} error=${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		}),
	);
	if (proxyResult.stickyMutationPromise) scheduleBackgroundWork(c, proxyResult.stickyMutationPromise);
	return response;
}
