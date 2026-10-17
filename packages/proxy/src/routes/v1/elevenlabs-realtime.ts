/**
 * ElevenLabs 原生实时 WebSocket 入口，路径与官方一致（`/elevenlabs` + 官方 `wss://` 路径）：
 *
 * - `GET /elevenlabs/v1/text-to-speech/:voiceId/stream-input?model_id=`：文本转语音（单路 stream-input）。
 * - `GET /elevenlabs/v1/speech-to-text/realtime?model_id=`：实时转写（Scribe Realtime）。
 *
 * 两条都带 `model_id` query，升级前即可鉴权、校验模型类型、检查余额并选路由，失败直接回 HTTP 错误码。
 * 下游使用网关 API Key（`xi-api-key` / `Authorization: Bearer` / 子协议 `octafuse-api-key.<key>`），
 * 上游使用路由选中的 ElevenLabs Key。不支持 `multi-stream-input`。
 *
 * 路由挂在已有的 TTS / STT 子应用里（见 `elevenlabs-text-to-speech.ts`、`elevenlabs-speech-to-text.ts`），
 * 复用它们的 `requireApiKey`，避免同一请求重复计入限流。
 */
import { type GatewayRepositories, type ModelRow } from '@octafuse/core';
import { isValidElevenLabsVoiceId } from '@octafuse/core/elevenlabs-native';
import { parseDashScopeRealtimeAuthProtocol } from '@octafuse/core/realtime-protocol';
import type { Context } from 'hono';
import type { Env } from '../../app';
import type { ApiKeyContext } from '../../middleware/auth';
import { recordAudioUsage } from '../../services/audio-usage-charge';
import type { ElevenLabsRealtimeOperation } from '../../services/egress/elevenlabs-realtime-driver';
import { GatewayErrorCode, NO_AVAILABLE_ROUTE_MESSAGE } from '../../services/gateway-error-codes';
import { gatewayErrorJson } from '../../services/gateway-error-response';
import { resolveRoutesForSurface } from '../../services/model-router';
import { proxyElevenLabsRealtime, type UsageFromStream } from '../../services/proxy';
import { RequestTimingCollector } from '../../services/request-timing';
import { resolveModelRouting } from '../../services/resolve-model-route-group';
import {
	buildAffinityKey,
	buildTierKeyPrefix,
	resolveRouteStrategyPlan,
} from '../../services/route-strategies';
import { apiKeyHasBalance } from '../../services/tool-usage-charge';
import { scheduleBackgroundWork } from '../../runtime/schedule-background-work';
import { audioModelGuardMessage } from './audio-model-guard';

type RealtimeEnv = Env & { Variables: { apiKey: ApiKeyContext } };
type RealtimeContext = Context<RealtimeEnv>;

function realtimeErrorMessage(usage: UsageFromStream): string | null {
	if (usage.stream_error) return `Realtime stream failed: ${usage.stream_error}`;
	if (usage.cancelled) return 'Client disconnected before realtime audio completed';
	return null;
}

function requireWebSocketUpgrade(c: RealtimeContext): Response | null {
	if (c.req.header('Upgrade')?.toLowerCase() === 'websocket') return null;
	return gatewayErrorJson(c, {
		status: 426,
		code: GatewayErrorCode.invalidRequest,
		message: 'Expected a WebSocket upgrade request',
	});
}

function recordRealtimeUsage(params: {
	c: RealtimeContext;
	repos: GatewayRepositories;
	apiKey: ApiKeyContext;
	model: ModelRow;
	baseModelId: string;
	effectiveRouteGroup: string;
	operation: ElevenLabsRealtimeOperation;
	requestBodyForLog: string;
	start: number;
	timing: RequestTimingCollector;
	proxyResult: Awaited<ReturnType<typeof proxyElevenLabsRealtime>>;
}): void {
	const {
		c,
		repos,
		apiKey,
		model,
		baseModelId,
		effectiveRouteGroup,
		operation,
		requestBodyForLog,
		start,
		timing,
		proxyResult,
	} = params;
	const route = proxyResult.chosenRoute;
	const isSpeech = operation === 'audio.speech.realtime';
	const modelName =
		model.display_name != null && String(model.display_name).trim() !== ''
			? String(model.display_name).trim()
			: baseModelId;
	scheduleBackgroundWork(
		c,
		proxyResult.usagePromise
			.then((usage) => {
				const errorMessage = realtimeErrorMessage(usage);
				return recordAudioUsage({
					repos,
					apiKeyId: apiKey.keyId,
					userId: apiKey.userId,
					userEmail: apiKey.userEmail,
					ingressHost: apiKey.ingressHost,
					modelId: baseModelId,
					providerId: route.providerId,
					providerModelName: route.providerModelName,
					modelName,
					providerName: route.providerName,
					requestBody: requestBodyForLog,
					requestProtocol: 'elevenlabs',
					requestOperation: operation,
					upstreamProtocol: route.upstreamProtocol,
					upstreamOperation: route.upstreamOperation,
					modelSurfaceId: route.modelSurfaceId,
					routePoolId: route.routePoolId,
					routeTargetId: route.targetId,
					adapter: route.adapter,
					routeGroup: effectiveRouteGroup,
					status: errorMessage ? 'error' : 'success',
					latencyMs: Date.now() - start,
					errorMessage,
					billing: {
						modelPricingProfileJson: model.pricing_profile ?? null,
						catalogModelId: baseModelId,
						userChargedCostFactorsJson: apiKey.chargedCostFactors,
						routeGroup: effectiveRouteGroup,
						routePriceOverrideJson: route.priceOverrideRaw,
						durationSeconds: isSpeech ? 0 : (usage.audio_duration_seconds ?? 0),
						// 网关按客户端发出的音频字节 / 文本字符折算，不是上游回报值。
						durationSource: 'estimated',
						characters: isSpeech ? (usage.audio_characters ?? 0) : null,
						requestStartedAtMs: start,
					},
					providerKeyId: route.providerKeyId ?? null,
					providerKeyLabel: route.providerKeyLabel ?? null,
					providerKeyFingerprint: route.providerKeyFingerprint ?? null,
					upstreamRequestId: proxyResult.upstreamRequestId,
					timing: timing.snapshot(),
					circuitEvents:
						proxyResult.circuitEvents.length > 0 ? proxyResult.circuitEvents : undefined,
					suppressErrorAlert: proxyResult.suppressErrorAlert || undefined,
				});
			})
			.catch((error) => {
				console.error(
					`[Gateway Realtime] record ElevenLabs usage failed modelId=${baseModelId} error=${error instanceof Error ? error.message : String(error)}`
				);
			})
	);
}

async function handleElevenLabsRealtime(
	c: RealtimeContext,
	input: { operation: ElevenLabsRealtimeOperation; voiceId?: string }
): Promise<Response> {
	const start = Date.now();
	const { operation } = input;
	const isSpeech = operation === 'audio.speech.realtime';
	const notUpgrade = requireWebSocketUpgrade(c);
	if (notUpgrade) return notUpgrade;

	if (isSpeech && !isValidElevenLabsVoiceId(input.voiceId ?? '')) {
		return gatewayErrorJson(c, {
			status: 400,
			code: GatewayErrorCode.invalidRequest,
			message: 'Invalid voice_id',
		});
	}
	const query = c.req.query();
	const rawModelId = (query.model_id ?? '').trim();
	if (!rawModelId) {
		return gatewayErrorJson(c, {
			status: 400,
			code: GatewayErrorCode.missingModel,
			message: 'Missing model_id query parameter',
		});
	}

	const repos = c.get('repositories');
	const apiKey = c.get('apiKey');
	const resolved = await resolveModelRouting(repos, rawModelId);
	if (!resolved) {
		return gatewayErrorJson(c, {
			status: 404,
			code: GatewayErrorCode.modelNotFound,
			message: `Model not found: ${rawModelId.slice(0, 200)}`,
		});
	}
	const { model, baseModelId, explicitGroup } = resolved;
	const guardMessage = audioModelGuardMessage(
		model,
		isSpeech ? 'tts' : 'asr',
		isSpeech ? 'ElevenLabs speech realtime' : 'ElevenLabs transcription realtime'
	);
	if (guardMessage) {
		return gatewayErrorJson(c, {
			status: 400,
			code: GatewayErrorCode.invalidRequest,
			message: guardMessage,
		});
	}

	const effectiveRouteGroup = explicitGroup?.trim() || 'default';
	let surface;
	try {
		surface = await resolveRoutesForSurface(repos, {
			modelId: baseModelId,
			routeGroup: effectiveRouteGroup,
			requestProtocol: 'elevenlabs',
			requestOperation: operation,
		});
	} catch (error) {
		return gatewayErrorJson(c, {
			status: 502,
			code: GatewayErrorCode.routeResolutionFailed,
			message: error instanceof Error ? error.message : 'Realtime route resolution failed',
		});
	}
	if (surface.routes.length === 0) {
		return gatewayErrorJson(c, {
			status: 404,
			code: GatewayErrorCode.noRoute,
			message: NO_AVAILABLE_ROUTE_MESSAGE,
		});
	}
	// 实时会话事先不知道会用多少字符 / 多少秒，只检查还有余额；不做会话中途的额度截断。
	if (!apiKeyHasBalance(apiKey)) {
		return gatewayErrorJson(c, {
			status: 403,
			code: GatewayErrorCode.budgetExceeded,
			message: 'Budget exceeded',
		});
	}

	const strategyPlan = await resolveRouteStrategyPlan({
		routePolicyRaw: model.route_policy ?? null,
		poolStrategy: surface.surface?.pool_strategy ?? null,
		poolTierStrategies: surface.surface?.pool_tier_strategies ?? null,
		protocol: 'elevenlabs',
		capability: operation,
		routeGroup: effectiveRouteGroup,
		repos,
	});
	const timing = new RequestTimingCollector();
	const proxyResult = await proxyElevenLabsRealtime(
		repos,
		surface.routes,
		{ operation, voiceId: input.voiceId, query },
		c.req.raw.signal,
		{
			nodeDispatch: c.env.NODE_ELEVENLABS_REALTIME_DISPATCH,
			responseProtocol: parseDashScopeRealtimeAuthProtocol(
				c.req.header('Sec-WebSocket-Protocol')
			)?.protocol,
			affinityKey: buildAffinityKey(apiKey.userId, baseModelId, effectiveRouteGroup, 'elevenlabs'),
			tierKeyPrefix: buildTierKeyPrefix(baseModelId, effectiveRouteGroup, 'elevenlabs'),
			strategy: strategyPlan.base,
			tierStrategies: strategyPlan.tierOverrides,
			timing,
			inboundHeaders: c.req.raw.headers,
		}
	);
	const nodeUpgrade =
		c.env.NODE_ELEVENLABS_REALTIME_DISPATCH != null &&
		proxyResult.response.headers.get('x-octafuse-realtime-upgrade') === '1';
	if (!nodeUpgrade && (proxyResult.response.status !== 101 || !proxyResult.response.webSocket)) {
		return proxyResult.response;
	}

	recordRealtimeUsage({
		c,
		repos,
		apiKey,
		model,
		baseModelId,
		effectiveRouteGroup,
		operation,
		requestBodyForLog: JSON.stringify({
			kind: 'elevenlabs_realtime',
			operation,
			...(input.voiceId ? { voice_id: input.voiceId } : {}),
			query: Object.fromEntries(
				Object.entries(query).filter(([key]) => !/^(xi[-_]api[-_]key|api_key|authorization|token)$/i.test(key))
			),
		}),
		start,
		timing,
		proxyResult,
	});
	return proxyResult.response;
}

/** `GET /elevenlabs/v1/text-to-speech/:voiceId/stream-input`（挂在 TTS 子应用里）。 */
export function handleElevenLabsTtsRealtime(c: RealtimeContext): Promise<Response> {
	return handleElevenLabsRealtime(c, {
		operation: 'audio.speech.realtime',
		voiceId: c.req.param('voiceId') ?? '',
	});
}

/** `GET /elevenlabs/v1/speech-to-text/realtime`（挂在 STT 子应用里）。 */
export function handleElevenLabsSttRealtime(c: RealtimeContext): Promise<Response> {
	return handleElevenLabsRealtime(c, { operation: 'audio.transcriptions.realtime' });
}
