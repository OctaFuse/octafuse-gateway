/**
 * DashScope 原生实时音频入口。路径与官方端点一致（`/dashscope` + 官方 `wss://` 路径）：
 *
 * - `GET /dashscope/api-ws/v1/realtime?model=<gateway-model>`：session 协议（Qwen-ASR/TTS-Realtime）。
 *   升级前用 `?model=` 选路由，ASR 还是 TTS 由模型类型决定。
 * - `GET /dashscope/api-ws/v1/inference`：run-task 协议（Fun-ASR / Paraformer / CosyVoice）。
 *   先接受下游，等第一帧 run-task 里的 `payload.model` / `payload.task` 再选路由、连上游。
 * - TEMP(soloent) `GET /v1/dashscope/realtime?model=&operation=`：旧入口别名，升级前选路由。
 *   删除条件见 `app.ts` 里的 TEMP 注释。
 *
 * 下游使用网关 API Key，上游使用路由选中的 DashScope API Key。事件保持 DashScope 原生语义。
 */
import { resolveModelKind, type GatewayRepositories, type ModelRow } from '@octafuse/core';
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../../app';
import { requireApiKey, type ApiKeyContext } from '../../middleware/auth';
import {
	DASHSCOPE_REALTIME_OPERATIONS,
	type DashScopeRealtimeOperation,
} from '../../services/egress/dashscope-realtime-driver';
import { GatewayErrorCode, NO_AVAILABLE_ROUTE_MESSAGE } from '../../services/gateway-error-codes';
import { gatewayErrorJson } from '../../services/gateway-error-response';
import { resolveRoutesForSurface } from '../../services/model-router';
import {
	EMPTY_USAGE,
	proxyDashScopeRealtime,
	proxyDashScopeRealtimeDeferred,
	type UsageFromStream,
} from '../../services/proxy';
import {
	DashScopeRealtimeClientSession,
	dashScopeInferenceOperationForTask,
	type DeferredRealtimeRuntime,
} from '../../services/egress/dashscope-realtime-session';
import { createWorkersDeferredRealtime } from '../../services/egress/dashscope-realtime-driver';
import { recordAudioUsage } from '../../services/audio-usage-charge';
import { resolveModelRouting } from '../../services/resolve-model-route-group';
import {
	buildAffinityKey,
	buildTierKeyPrefix,
	resolveRouteStrategyPlan,
} from '../../services/route-strategies';
import { RequestTimingCollector } from '../../services/request-timing';
import { scheduleBackgroundWork } from '../../runtime/schedule-background-work';
import { parseDashScopeRealtimeAuthProtocol } from '@octafuse/core/realtime-protocol';

type RealtimeEnv = Env & { Variables: { apiKey: ApiKeyContext } };
type RealtimeContext = Context<RealtimeEnv>;

/** TEMP(soloent)：旧入口 `/v1/dashscope/realtime`，升级前选路由；见 `app.ts`。 */
export const dashScopeRealtimeRoutes = new Hono<RealtimeEnv>();
/** 官方 session 协议入口：`/dashscope/api-ws/v1/realtime?model=`。 */
export const dashScopeRealtimeSessionRoutes = new Hono<RealtimeEnv>();
/** 官方 run-task 协议入口：`/dashscope/api-ws/v1/inference`，延迟连接上游。 */
export const dashScopeRealtimeInferenceRoutes = new Hono<RealtimeEnv>();

dashScopeRealtimeRoutes.use('*', requireApiKey);
dashScopeRealtimeSessionRoutes.use('*', requireApiKey);
dashScopeRealtimeInferenceRoutes.use('*', requireApiKey);

function isRealtimeOperation(value: string): value is DashScopeRealtimeOperation {
	return (DASHSCOPE_REALTIME_OPERATIONS as readonly string[]).includes(value);
}

function isSpeechOperation(operation: DashScopeRealtimeOperation): boolean {
	return operation.startsWith('audio.speech.');
}

function realtimeErrorMessage(usage: UsageFromStream): string | null {
	if (usage.stream_error) return `Realtime stream failed: ${usage.stream_error}`;
	if (usage.cancelled) return 'Client disconnected before realtime audio completed';
	return null;
}

function modelDisplayName(model: { display_name?: string | null }, baseModelId: string): string {
	const displayName = model.display_name == null ? '' : String(model.display_name).trim();
	return displayName || baseModelId;
}

function recordRealtimeUsage(params: {
	c: RealtimeContext;
	repos: GatewayRepositories;
	apiKey: ApiKeyContext;
	model: ModelRow;
	baseModelId: string;
	effectiveRouteGroup: string;
	operation: DashScopeRealtimeOperation;
	start: number;
	timing: RequestTimingCollector;
	proxyResult: Awaited<ReturnType<typeof proxyDashScopeRealtime>>;
}): void {
	const {
		c,
		repos,
		apiKey,
		model,
		baseModelId,
		effectiveRouteGroup,
		operation,
		start,
		timing,
		proxyResult,
	} = params;
	const route = proxyResult.chosenRoute;
	scheduleBackgroundWork(
		c,
		proxyResult.usagePromise
			.then((usage) => {
				const errorMessage = realtimeErrorMessage(usage);
				const status: 'success' | 'error' = errorMessage ? 'error' : 'success';
				const tokenUsage =
					usage.input_tokens > 0 || usage.output_tokens > 0 || usage.total_tokens > 0
						? {
								input_tokens: usage.input_tokens,
								output_tokens: usage.output_tokens,
								audio_tokens: usage.output_tokens,
								text_tokens: usage.input_tokens,
								total_tokens: usage.total_tokens,
								raw_usage: usage.raw_usage,
							}
						: null;
				return recordAudioUsage({
					repos,
					apiKeyId: apiKey.keyId,
					userId: apiKey.userId,
					userEmail: apiKey.userEmail,
					ingressHost: apiKey.ingressHost,
					modelId: baseModelId,
					providerId: route.providerId,
					providerModelName: route.providerModelName,
					modelName: modelDisplayName(model, baseModelId),
					providerName: route.providerName,
					requestBody: JSON.stringify({ kind: 'dashscope_realtime', operation }),
					requestProtocol: 'dashscope',
					requestOperation: operation,
					upstreamProtocol: route.upstreamProtocol,
					upstreamOperation: route.upstreamOperation,
					modelSurfaceId: route.modelSurfaceId,
					routePoolId: route.routePoolId,
					routeTargetId: route.targetId,
					adapter: route.adapter,
					routeGroup: effectiveRouteGroup,
					status,
					latencyMs: Date.now() - start,
					errorMessage,
					billing: {
						modelPricingProfileJson: model.pricing_profile ?? null,
						catalogModelId: baseModelId,
						userChargedCostFactorsJson: apiKey.chargedCostFactors,
						routeGroup: effectiveRouteGroup,
						routePriceOverrideJson: route.priceOverrideRaw,
						durationSeconds: isSpeechOperation(operation)
							? 0
							: (usage.audio_duration_seconds ?? 0),
						durationSource: 'upstream',
						characters: isSpeechOperation(operation)
							? (usage.audio_characters ?? null)
							: null,
						tokenUsage,
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
					`[Gateway Realtime] record usage failed modelId=${baseModelId} error=${error instanceof Error ? error.message : String(error)}`
				);
			})
	);
}

function requireWebSocketUpgrade(c: RealtimeContext): Response | null {
	if (c.req.header('Upgrade')?.toLowerCase() === 'websocket') return null;
	return gatewayErrorJson(c, {
		status: 426,
		code: GatewayErrorCode.invalidRequest,
		message: 'Expected a WebSocket upgrade request',
	});
}

function failoverOptionsFor(params: {
	apiKey: ApiKeyContext;
	baseModelId: string;
	effectiveRouteGroup: string;
	strategyPlan: Awaited<ReturnType<typeof resolveRouteStrategyPlan>>;
	timing: RequestTimingCollector;
	inboundHeaders: Headers;
}) {
	const { apiKey, baseModelId, effectiveRouteGroup, strategyPlan, timing, inboundHeaders } = params;
	return {
		affinityKey: buildAffinityKey(apiKey.userId, baseModelId, effectiveRouteGroup, 'dashscope'),
		tierKeyPrefix: buildTierKeyPrefix(baseModelId, effectiveRouteGroup, 'dashscope'),
		strategy: strategyPlan.base,
		tierStrategies: strategyPlan.tierOverrides,
		timing,
		inboundHeaders,
	};
}

/**
 * 升级前选路由并连上游（旧入口与 session 入口共用）。
 * `pickOperation` 在模型解析之后决定 operation；返回 `Response` 表示直接用它拒绝请求。
 */
async function connectUpfront(
	c: RealtimeContext,
	start: number,
	rawModelId: string,
	pickOperation: (model: ModelRow) => DashScopeRealtimeOperation | Response
): Promise<Response> {
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
	const picked = pickOperation(model);
	if (picked instanceof Response) return picked;
	const operation = picked;
	const effectiveRouteGroup = explicitGroup?.trim() || 'default';
	let surface;
	try {
		surface = await resolveRoutesForSurface(repos, {
			modelId: baseModelId,
			routeGroup: effectiveRouteGroup,
			requestProtocol: 'dashscope',
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

	const strategyPlan = await resolveRouteStrategyPlan({
		routePolicyRaw: model.route_policy ?? null,
		poolStrategy: surface.surface?.pool_strategy ?? null,
		poolTierStrategies: surface.surface?.pool_tier_strategies ?? null,
		protocol: 'dashscope',
		capability: operation,
		routeGroup: effectiveRouteGroup,
		repos,
	});
	const timing = new RequestTimingCollector();
	const proxyResult = await proxyDashScopeRealtime(
		repos,
		surface.routes,
		operation,
		c.req.raw.signal,
		{
			nodeDispatch: c.env.NODE_REALTIME_DISPATCH,
			responseProtocol: parseDashScopeRealtimeAuthProtocol(
				c.req.header('Sec-WebSocket-Protocol')
			)?.protocol,
			...failoverOptionsFor({
				apiKey,
				baseModelId,
				effectiveRouteGroup,
				strategyPlan,
				timing,
				inboundHeaders: c.req.raw.headers,
			}),
		}
	);
	const nodeUpgrade =
		c.env.NODE_REALTIME_DISPATCH != null &&
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
		start,
		timing,
		proxyResult,
	});
	return proxyResult.response;
}

// TEMP(soloent)：旧入口，要求 `?model=` 与 `?operation=`。
dashScopeRealtimeRoutes.get('/', async (c) => {
	const start = Date.now();
	const notUpgrade = requireWebSocketUpgrade(c);
	if (notUpgrade) return notUpgrade;
	const rawModelId = c.req.query('model')?.trim() ?? '';
	if (!rawModelId) {
		return gatewayErrorJson(c, {
			status: 400,
			code: GatewayErrorCode.missingModel,
			message: 'Missing model query parameter',
		});
	}
	const operationRaw = c.req.query('operation')?.trim() ?? '';
	if (!isRealtimeOperation(operationRaw)) {
		return gatewayErrorJson(c, {
			status: 400,
			code: GatewayErrorCode.invalidRequest,
			message: `Unsupported realtime operation: ${operationRaw || '(empty)'}`,
		});
	}
	return connectUpfront(c, start, rawModelId, () => operationRaw);
});

/** session 入口：`?model=` 选路由，模型类型（asr / tts）决定 operation，和官方一样靠模型区分。 */
dashScopeRealtimeSessionRoutes.get('/', async (c) => {
	const start = Date.now();
	const notUpgrade = requireWebSocketUpgrade(c);
	if (notUpgrade) return notUpgrade;
	const rawModelId = c.req.query('model')?.trim() ?? '';
	if (!rawModelId) {
		return gatewayErrorJson(c, {
			status: 400,
			code: GatewayErrorCode.missingModel,
			message: 'Missing model query parameter',
		});
	}
	return connectUpfront(c, start, rawModelId, (model) => {
		const kind = resolveModelKind(model);
		if (kind === 'asr') return 'audio.transcriptions.realtime.session';
		if (kind === 'tts') return 'audio.speech.realtime.session';
		return gatewayErrorJson(c, {
			status: 400,
			code: GatewayErrorCode.invalidRequest,
			message: `Realtime session requires a transcription (asr) or speech (tts) model, got kind: ${kind}`,
		});
	});
});

/** 上游连不上时从 failover 的最后一个响应里取 `task-failed` 的 code / message。 */
async function describeFailedResponse(
	response: Response
): Promise<{ code: string; message: string }> {
	const headerCode = response.headers.get('X-OctaFuse-Error-Code');
	let message = '';
	let bodyCode = '';
	try {
		const body = (await response.clone().json()) as {
			code?: unknown;
			error?: unknown;
			message?: unknown;
		};
		if (typeof body.code === 'string') bodyCode = body.code;
		if (typeof body.error === 'string') message = body.error;
		else if (body.error && typeof body.error === 'object') {
			const nested = (body.error as { message?: unknown }).message;
			if (typeof nested === 'string') message = nested;
		}
		if (!message && typeof body.message === 'string') message = body.message;
	} catch {
		// 非 JSON 响应体，退回状态码
	}
	return {
		code: headerCode || bodyCode || GatewayErrorCode.upstreamRequestFailed,
		message: message || `Upstream request failed (HTTP ${response.status})`,
	};
}

/**
 * inference 入口的会话：下游升级已完成，等 run-task 之后选路由、连上游、桥接。
 * 升级之后不能再回 HTTP 错误码，所有失败都按 DashScope 格式回 `task-failed` 再关闭。
 */
async function runDeferredInferenceSession(params: {
	c: RealtimeContext;
	runtime: DeferredRealtimeRuntime;
	repos: GatewayRepositories;
	apiKey: ApiKeyContext;
	start: number;
	inboundHeaders: Headers;
}): Promise<void> {
	const { c, runtime, repos, apiKey, start, inboundHeaders } = params;
	const session = new DashScopeRealtimeClientSession(runtime.client);
	const waited = await session.waitForRunTask();
	if (!waited.ok) return;
	const request = waited.request;
	const fail = (code: string, message: string) => {
		session.failAndClose(request.taskId, code, message);
	};

	const operation = dashScopeInferenceOperationForTask(request.task);
	if (!operation) {
		return fail(
			'InvalidParameter',
			`Unsupported payload.task: ${request.task || '(empty)'}; expected "asr" or "tts"`
		);
	}
	if (!request.model) {
		return fail('InvalidParameter', 'Missing payload.model in run-task');
	}
	const resolved = await resolveModelRouting(repos, request.model);
	if (!resolved) {
		return fail(
			GatewayErrorCode.modelNotFound,
			`Model not found: ${request.model.slice(0, 200)}`
		);
	}
	const { model, baseModelId, explicitGroup } = resolved;
	const effectiveRouteGroup = explicitGroup?.trim() || 'default';
	let surface;
	try {
		surface = await resolveRoutesForSurface(repos, {
			modelId: baseModelId,
			routeGroup: effectiveRouteGroup,
			requestProtocol: 'dashscope',
			requestOperation: operation,
		});
	} catch (error) {
		return fail(
			GatewayErrorCode.routeResolutionFailed,
			error instanceof Error ? error.message : 'Realtime route resolution failed'
		);
	}
	if (surface.routes.length === 0) {
		return fail(GatewayErrorCode.noRoute, NO_AVAILABLE_ROUTE_MESSAGE);
	}
	if (session.isClientClosed) return;

	const strategyPlan = await resolveRouteStrategyPlan({
		routePolicyRaw: model.route_policy ?? null,
		poolStrategy: surface.surface?.pool_strategy ?? null,
		poolTierStrategies: surface.surface?.pool_tier_strategies ?? null,
		protocol: 'dashscope',
		capability: operation,
		routeGroup: effectiveRouteGroup,
		repos,
	});
	const timing = new RequestTimingCollector();
	const deferred = await proxyDashScopeRealtimeDeferred(
		repos,
		surface.routes,
		operation,
		runtime.connectUpstream,
		session.signal,
		failoverOptionsFor({
			apiKey,
			baseModelId,
			effectiveRouteGroup,
			strategyPlan,
			timing,
			inboundHeaders,
		})
	);
	const { result: proxyResult, upstream } = deferred;
	if (!upstream) {
		if (session.isClientClosed) return;
		const failure = await describeFailedResponse(proxyResult.response);
		return fail(failure.code, failure.message);
	}
	if (session.isClientClosed) {
		try {
			upstream.close(1000, 'Client WebSocket closed');
		} finally {
			deferred.finishUsage(EMPTY_USAGE);
		}
		return;
	}

	void session
		.bridge({
			upstream,
			route: proxyResult.chosenRoute,
			operation,
			model: request.model,
			timing,
		})
		.then(deferred.finishUsage);
	recordRealtimeUsage({
		c,
		repos,
		apiKey,
		model,
		baseModelId,
		effectiveRouteGroup,
		operation,
		start,
		timing,
		proxyResult,
	});
}

dashScopeRealtimeInferenceRoutes.get('/', async (c) => {
	const start = Date.now();
	const notUpgrade = requireWebSocketUpgrade(c);
	if (notUpgrade) return notUpgrade;

	let runtime: DeferredRealtimeRuntime;
	let response: Response;
	const nodeRuntime = c.env.NODE_REALTIME_DEFERRED;
	if (nodeRuntime) {
		// Node：upgrade 已由 http.Server 完成，响应只是告诉 node.ts 可以恢复读取下游帧。
		runtime = nodeRuntime();
		response = new Response(null, {
			status: 200,
			headers: {
				'X-Octafuse-Realtime-Protocol': 'dashscope',
				'X-Octafuse-Realtime-Upgrade': '1',
			},
		});
	} else {
		const workers = createWorkersDeferredRealtime({
			responseProtocol: parseDashScopeRealtimeAuthProtocol(
				c.req.header('Sec-WebSocket-Protocol')
			)?.protocol,
		});
		if (!workers) {
			return gatewayErrorJson(c, {
				status: 501,
				code: GatewayErrorCode.invalidRequest,
				message: 'DashScope realtime requires the Cloudflare Workers runtime',
			});
		}
		runtime = workers.runtime;
		response = workers.response;
	}

	// 升级响应先返回；会话在后台等 run-task，失败只能回 task-failed。
	scheduleBackgroundWork(
		c,
		runDeferredInferenceSession({
			c,
			runtime,
			repos: c.get('repositories'),
			apiKey: c.get('apiKey'),
			start,
			inboundHeaders: c.req.raw.headers,
		}).catch((error) => {
			console.error(
				`[Gateway Realtime] deferred inference session failed error=${error instanceof Error ? error.message : String(error)}`
			);
			runtime.client.close(1011, 'Gateway realtime session failed');
		})
	);
	return response;
});
