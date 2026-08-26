/**
 * 用户路由：OpenAI 兼容 Images API
 * - `POST /v1/images/generations`（JSON）
 * - `POST /v1/images/edits`（multipart）
 *
 * 流程：鉴权 → 解析 model → 预算预检 → openai 路由故障转移 → 成功后按 Images usage token 分项扣费。
 * 日志禁止写入 prompt 原文、参考图与 Base64。
 */
import type { GatewayRepositories, ModelRow, ResolvedModelSurfaceRow } from '@octafuse/core';
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../../app';
import { requireApiKey, type ApiKeyContext } from '../../middleware/auth';
import type { RouteResult } from '../../services/model-router';
import { resolveModelRouting } from '../../services/resolve-model-route-group';
import { buildProxyFailoverOptions, loadProxyRouteSurface } from '../../services/proxy-pipeline';
import { proxyImageEdits, proxyImageGenerations, type ProxyResult } from '../../services/proxy';
import { finalizeRequestLogJson } from '../../services/request-log-shared';
import {
	canAffordImageCost,
	estimateImageBudgetPrecheck,
	recordImageUsage,
	type ImageBillingParams,
	type ImageCostBreakdown,
} from '../../services/image-usage-charge';
import { apiKeyHasBalance } from '../../services/tool-usage-charge';
import { applyOpenAiImageGenerationExtras, countOpenAiGenerationReferenceImages } from '../../services/image-generation-extras';
import {
	countValidImageResults,
	IMAGE_MAX_BYTES_PER_FILE,
	IMAGE_MAX_REFERENCE_COUNT,
	IMAGE_MAX_TOTAL_UPLOAD_BYTES,
	normalizeImageCommonParams,
	redactImageRequestForLog,
	validateImageUpload,
	type ImageEditUpload,
	type NormalizedImageEditRequest,
} from '../../services/egress/openai-images-driver';
import { maxNForImageRoutes } from '../../services/egress/dashscope-images-driver';
import {
	formatHttpErrorTextForRequestLog,
	materializeNonOkResponse,
} from '../../services/request-log-record-status';
import {
	maybeBlockUserModelCircuit,
	maybeTriggerUserModelCircuitFromUpstream,
	markUserModelSuccess,
} from '../../services/user-model-circuit-route';
import { GatewayErrorCode } from '../../services/gateway-error-codes';
import { gatewayErrorJson } from '../../services/gateway-error-response';
import { RequestTimingCollector } from '../../services/request-timing';
import { scheduleBackgroundWork } from '../../runtime/schedule-background-work';

type ImagesEnv = Env & { Variables: { apiKey: ApiKeyContext } };
type ImagesContext = Context<ImagesEnv>;

export const imageRoutes = new Hono<ImagesEnv>();

imageRoutes.use('*', requireApiKey);

async function resolveOpenAiImageRoutes(
	repos: GatewayRepositories,
	rawModelId: string,
	requestOperation: 'images.generations' | 'images.edits'
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
	| { ok: false; status: 400 | 404 | 502; error: string }
> {
	const resolved = await resolveModelRouting(repos, rawModelId);
	if (!resolved) {
		const modelForLog = truncateModelIdForLog(rawModelId);
		console.warn(`[Gateway Images] model not found clientModel=${modelForLog}`);
		return { ok: false, status: 404, error: `Model not found: ${modelForLog}` };
	}
	const { model, baseModelId, explicitGroup } = resolved;
	const effectiveRouteGroup = explicitGroup?.trim() || 'default';
	const loaded = await loadProxyRouteSurface(repos, {
		modelId: baseModelId,
		routeGroup: effectiveRouteGroup,
		requestProtocol: 'openai',
		requestOperation,
	});
	if (!loaded.ok) {
		return { ok: false, status: 502, error: loaded.message };
	}
	if (loaded.loaded.routes.length === 0) {
		return {
			ok: false,
			status: 502,
			error: `No OpenAI route in route group "${effectiveRouteGroup}" for this model`,
		};
	}
	return {
		ok: true,
		model,
		baseModelId,
		effectiveRouteGroup,
		...loaded.loaded,
	};
}

function modelDisplayName(model: { display_name?: string | null }, baseModelId: string): string {
	return model.display_name != null && String(model.display_name).trim() !== ''
		? String(model.display_name).trim()
		: baseModelId;
}

/** Cap length so a pathological clientModel cannot flood logs / error bodies. */
function truncateModelIdForLog(rawModelId: string, maxLen = 200): string {
	const trimmed = rawModelId.trim();
	if (trimmed.length <= maxLen) {
		return trimmed;
	}
	return `${trimmed.slice(0, maxLen)}…`;
}

/**
 * Return an error message when Content-Type is not multipart/form-data; otherwise null.
 * Hono `parseBody` returns `{}` without reading the body for non-form types, which used to
 * surface as a misleading "Missing model".
 * @internal exported for unit tests
 */
export function validateImagesEditsContentType(contentType: string | null | undefined): string | null {
	const ct = (contentType ?? '').trim();
	if (!ct.toLowerCase().startsWith('multipart/form-data')) {
		return `Unsupported Content-Type for /v1/images/edits: expected multipart/form-data, got "${ct || '(missing)'}"`;
	}
	return null;
}

/** Summarize multipart/JSON field shapes for diagnostics (keys + type only; never values). */
function summarizeBodyKeys(body: Record<string, unknown>): string[] {
	return Object.keys(body)
		.map((key) => {
			const value = body[key];
			if (value == null) return `${key}:null`;
			if (typeof value === 'string') return `${key}:string`;
			if (typeof value === 'number' || typeof value === 'boolean') return `${key}:${typeof value}`;
			if (Array.isArray(value)) {
				const first = value[0];
				const itemType =
					first == null
						? 'empty'
						: typeof first === 'object' && first !== null && 'arrayBuffer' in first
							? 'file'
							: typeof first;
				return `${key}:array(${value.length},${itemType})`;
			}
			if (typeof value === 'object' && 'arrayBuffer' in value) return `${key}:file`;
			return `${key}:object`;
		})
		.slice(0, 40);
}

type ImageRejectDiag = {
	operation: 'generations' | 'edits';
	contentType?: string | null;
	contentLength?: string | null;
	bodyKeys?: string[];
	hasModel?: boolean;
	clientModel?: string;
	promptChars?: number;
	referenceCount?: number;
	totalUploadBytes?: number;
};

/**
 * Log + return a client-facing Images 4xx/403. Never logs prompt / base64 / image bytes.
 */
function rejectImageRequest(
	c: ImagesContext,
	status: 400 | 403 | 404 | 502,
	error: string,
	diag: ImageRejectDiag
): Response {
	const apiKey = c.get('apiKey');
	console.warn('[Gateway Images] request rejected', {
		operation: diag.operation,
		status,
		error,
		contentType: diag.contentType ?? c.req.header('content-type') ?? null,
		contentLength: diag.contentLength ?? c.req.header('content-length') ?? null,
		keyId: apiKey?.keyId ?? null,
		userId: apiKey?.userId ?? null,
		bodyKeys: diag.bodyKeys ?? null,
		hasModel: diag.hasModel ?? null,
		clientModel: diag.clientModel ? truncateModelIdForLog(diag.clientModel) : null,
		promptChars: diag.promptChars ?? null,
		referenceCount: diag.referenceCount ?? null,
		totalUploadBytes: diag.totalUploadBytes ?? null,
	});
	return gatewayErrorJson(c, {
		status,
		code:
			status === 403
				? GatewayErrorCode.budgetExceeded
				: status === 404
					? GatewayErrorCode.modelNotFound
					: status === 502
						? GatewayErrorCode.routeResolutionFailed
						: GatewayErrorCode.invalidRequest,
		message: error,
	});
}

type MultipartEditsParseResult =
	| { ok: true; model: string; edit: NormalizedImageEditRequest; totalUploadBytes: number }
	| {
			ok: false;
			error: string;
			diag: Omit<ImageRejectDiag, 'operation'>;
	  };

async function parseMultipartEdits(c: ImagesContext): Promise<MultipartEditsParseResult> {
	const contentType = c.req.header('content-type') ?? '';
	const contentLength = c.req.header('content-length') ?? null;
	const baseDiag = {
		contentType: contentType || null,
		contentLength,
	};

	const contentTypeError = validateImagesEditsContentType(contentType);
	if (contentTypeError) {
		return {
			ok: false,
			error: contentTypeError,
			diag: {
				...baseDiag,
				bodyKeys: [],
				hasModel: false,
			},
		};
	}

	let body: Record<string, unknown>;
	try {
		body = (await c.req.parseBody({ all: true })) as Record<string, unknown>;
	} catch {
		return {
			ok: false,
			error: 'Invalid multipart body',
			diag: {
				...baseDiag,
				bodyKeys: [],
				hasModel: false,
			},
		};
	}

	const bodyKeys = summarizeBodyKeys(body);
	const modelRaw = body.model;
	const model = typeof modelRaw === 'string' ? modelRaw.trim() : '';
	if (!model) {
		return {
			ok: false,
			error: 'Missing model',
			diag: {
				...baseDiag,
				bodyKeys,
				hasModel: false,
			},
		};
	}

	const common = normalizeImageCommonParams({
		prompt: body.prompt,
		n: body.n,
		size: body.size,
		quality: body.quality,
		background: body.background,
	});
	if (!common.ok) {
		return {
			ok: false,
			error: common.error,
			diag: {
				...baseDiag,
				bodyKeys,
				hasModel: true,
				clientModel: model,
				promptChars: typeof body.prompt === 'string' ? body.prompt.length : 0,
			},
		};
	}

	const images: ImageEditUpload[] = [];
	let totalBytes = 0;
	const collectFile = async (value: unknown, fallbackName: string): Promise<string | null> => {
		if (value == null) return null;
		// Hono File / Blob：先按 size 预检再读入，避免无界 arrayBuffer
		if (typeof value === 'object' && value !== null && 'arrayBuffer' in value) {
			const file = value as File;
			const declaredSize =
				typeof file.size === 'number' && Number.isFinite(file.size) ? file.size : null;
			if (declaredSize != null) {
				if (declaredSize > IMAGE_MAX_BYTES_PER_FILE) {
					return `each image must be at most ${IMAGE_MAX_BYTES_PER_FILE} bytes`;
				}
				if (totalBytes + declaredSize > IMAGE_MAX_TOTAL_UPLOAD_BYTES) {
					return `total image upload must be at most ${IMAGE_MAX_TOTAL_UPLOAD_BYTES} bytes`;
				}
			}
			const buf = new Uint8Array(await file.arrayBuffer());
			if (buf.byteLength > IMAGE_MAX_BYTES_PER_FILE) {
				return `each image must be at most ${IMAGE_MAX_BYTES_PER_FILE} bytes`;
			}
			if (totalBytes + buf.byteLength > IMAGE_MAX_TOTAL_UPLOAD_BYTES) {
				return `total image upload must be at most ${IMAGE_MAX_TOTAL_UPLOAD_BYTES} bytes`;
			}
			totalBytes += buf.byteLength;
			images.push({
				filename: (file as { name?: string }).name || fallbackName,
				mimeType: file.type || 'application/octet-stream',
				bytes: buf,
			});
			return null;
		}
		if (typeof value === 'string' && value.startsWith('data:')) {
			return null;
		}
		return null;
	};

	const imageField = body.image ?? body.images;
	if (Array.isArray(imageField)) {
		let i = 0;
		for (const item of imageField) {
			const err = await collectFile(item, `image-${i++}.png`);
			if (err) {
				return {
					ok: false,
					error: err,
					diag: {
						...baseDiag,
						bodyKeys,
						hasModel: true,
						clientModel: model,
						promptChars: common.prompt.length,
						referenceCount: images.length,
						totalUploadBytes: totalBytes,
					},
				};
			}
		}
	} else {
		const err = await collectFile(imageField, 'image.png');
		if (err) {
			return {
				ok: false,
				error: err,
				diag: {
					...baseDiag,
					bodyKeys,
					hasModel: true,
					clientModel: model,
					promptChars: common.prompt.length,
					referenceCount: images.length,
					totalUploadBytes: totalBytes,
				},
			};
		}
	}

	// Also accept image[] style keys if parseBody flattened differently
	for (const [key, value] of Object.entries(body)) {
		if (key === 'image' || key === 'images') continue;
		if (!/^image(\[\])?$/i.test(key) && !/^image_\d+$/i.test(key)) continue;
		if (Array.isArray(value)) {
			let i = 0;
			for (const item of value) {
				const err = await collectFile(item, `image-${i++}.png`);
				if (err) {
					return {
						ok: false,
						error: err,
						diag: {
							...baseDiag,
							bodyKeys,
							hasModel: true,
							clientModel: model,
							promptChars: common.prompt.length,
							referenceCount: images.length,
							totalUploadBytes: totalBytes,
						},
					};
				}
			}
		} else {
			const err = await collectFile(value, 'image.png');
			if (err) {
				return {
					ok: false,
					error: err,
					diag: {
						...baseDiag,
						bodyKeys,
						hasModel: true,
						clientModel: model,
						promptChars: common.prompt.length,
						referenceCount: images.length,
						totalUploadBytes: totalBytes,
					},
				};
			}
		}
	}

	if (images.length === 0) {
		return {
			ok: false,
			error: 'At least one image file is required',
			diag: {
				...baseDiag,
				bodyKeys,
				hasModel: true,
				clientModel: model,
				promptChars: common.prompt.length,
				referenceCount: 0,
				totalUploadBytes: totalBytes,
			},
		};
	}
	if (images.length > IMAGE_MAX_REFERENCE_COUNT) {
		return {
			ok: false,
			error: `At most ${IMAGE_MAX_REFERENCE_COUNT} reference images are allowed`,
			diag: {
				...baseDiag,
				bodyKeys,
				hasModel: true,
				clientModel: model,
				promptChars: common.prompt.length,
				referenceCount: images.length,
				totalUploadBytes: totalBytes,
			},
		};
	}
	for (const img of images) {
		const err = validateImageUpload(img);
		if (err) {
			return {
				ok: false,
				error: err,
				diag: {
					...baseDiag,
					bodyKeys,
					hasModel: true,
					clientModel: model,
					promptChars: common.prompt.length,
					referenceCount: images.length,
					totalUploadBytes: totalBytes,
				},
			};
		}
	}

	return {
		ok: true,
		model,
		edit: {
			prompt: common.prompt,
			n: common.n,
			size: common.size,
			quality: common.quality,
			background: common.background,
			images,
		},
		totalUploadBytes: totalBytes,
	};
}

type FinalizeImageParams = {
	c: ImagesContext;
	proxyResult: ProxyResult;
	apiKey: ApiKeyContext;
	repos: GatewayRepositories;
	baseModelId: string;
	effectiveRouteGroup: string;
	modelNameForLog: string;
	requestBodyForLog: string | null;
	operation: 'generations' | 'edits';
	billing: ImageBillingParams;
	/** 入口预算预检（客户端取消时按此金额扣费） */
	budgetPrecheck: ImageCostBreakdown;
	/** generations 用 rawModelId；edits 同 */
	clientModelId: string;
	common: {
		prompt: string;
		n: number;
		size?: string;
		quality?: string;
		background?: string;
	};
	referenceCount?: number;
	start: number;
	timing: RequestTimingCollector;
};

/**
 * generations / edits 共用：materialize → 用量/状态 → 后台记费 → 统一响应。
 * 优先消费 driver 经 failover 透传的 `meta.parsedBody` / `meta.imageUsage`，避免重复 JSON.parse。
 */
async function finalizeImageResponse(params: FinalizeImageParams): Promise<Response> {
	const {
		c,
		proxyResult,
		apiKey,
		repos,
		baseModelId,
		effectiveRouteGroup,
		modelNameForLog,
		requestBodyForLog,
		operation,
		billing,
		budgetPrecheck,
		clientModelId,
		common,
		referenceCount,
		start,
		timing,
	} = params;

	const {
		chosenRoute,
		upstreamRequestId,
		circuitEvents,
		suppressErrorAlert,
		stickyTrace,
		stickyMutationPromise,
	} = proxyResult;
	if (stickyMutationPromise) {
		scheduleBackgroundWork(c, stickyMutationPromise);
	}
	const { response, errorBodyText } = await materializeNonOkResponse(proxyResult.response);
	await proxyResult.usagePromise.catch(() => undefined);

	const parsedBody = proxyResult.meta?.parsedBody ?? null;
	const imageUsage = response.ok ? (proxyResult.meta?.imageUsage ?? null) : null;
	const validImages = response.ok ? countValidImageResults(parsedBody) : 0;
	const latency = Date.now() - start;
	const imageAbortReason = proxyResult.meta?.imageAbortReason ?? null;
	const clientAbortPrecheck =
		imageAbortReason === 'client_abort' || imageAbortReason === 'gateway_timeout'
			? budgetPrecheck
			: null;

	let upstreamSupplierCostUsdTicks: number | null = null;
	if (parsedBody && typeof parsedBody === 'object' && !Array.isArray(parsedBody)) {
		const usage = (parsedBody as Record<string, unknown>).usage;
		if (usage && typeof usage === 'object' && !Array.isArray(usage)) {
			const ticks = (usage as Record<string, unknown>).cost_in_usd_ticks;
			if (typeof ticks === 'number' && Number.isFinite(ticks)) {
				upstreamSupplierCostUsdTicks = ticks;
			}
		}
	}

	let responseText: string;
	if (errorBodyText != null) {
		responseText = errorBodyText;
	} else if (parsedBody !== null && parsedBody !== undefined) {
		responseText = JSON.stringify(parsedBody);
	} else {
		responseText = await response.clone().text();
	}

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
			formatHttpErrorTextForRequestLog(
				response.status,
				response.headers.get('content-type'),
				errorBodyText
			),
			{ clientErrorCircuitEnabled: false }
		);
	}
	const alertCircuitEvents = userModelCircuitEvent
		? [...circuitEvents, userModelCircuitEvent]
		: circuitEvents;

	const status: 'success' | 'error' = response.ok && validImages > 0 ? 'success' : 'error';
	let errorMessage: string | undefined;
	if (status === 'error') {
		if (response.ok && validImages === 0) {
			errorMessage = 'Upstream returned no image data';
		} else if (errorBodyText != null) {
			errorMessage = formatHttpErrorTextForRequestLog(
				response.status,
				response.headers.get('content-type'),
				errorBodyText
			);
		} else {
			errorMessage = `HTTP ${response.status}`;
		}
	}

	const upstreamRequestBodyForLog = finalizeRequestLogJson(
		redactImageRequestForLog({
			operation,
			model: chosenRoute.providerModelName,
			n: common.n,
			size: common.size,
			quality: common.quality,
			background: common.background,
			prompt: common.prompt,
			referenceCount,
		})
	);

	scheduleBackgroundWork(
		c,
		(async () => {
			const stickyTraceSnapshot = stickyTrace ? await stickyTrace() : null;
			await recordImageUsage({
				repos,
				apiKeyId: apiKey.keyId,
				userId: apiKey.userId,
				userEmail: apiKey.userEmail,
				modelId: baseModelId,
				providerId: chosenRoute.providerId,
				providerModelName: chosenRoute.providerModelName,
				modelName: modelNameForLog,
				providerName: chosenRoute.providerName,
				requestBody: requestBodyForLog,
				upstreamRequestBody: upstreamRequestBodyForLog,
				requestProtocol: 'openai',
				requestOperation: operation === 'generations' ? 'images.generations' : 'images.edits',
				upstreamProtocol: chosenRoute.upstreamProtocol,
				upstreamOperation: chosenRoute.upstreamOperation,
				modelSurfaceId: chosenRoute.modelSurfaceId,
				routePoolId: chosenRoute.routePoolId,
				routeTargetId: chosenRoute.targetId,
				adapter: chosenRoute.adapter,
				stickyTrace: stickyTraceSnapshot,
				routeGroup: effectiveRouteGroup,
				status,
				latencyMs: latency,
				errorMessage,
				billing: {
					...billing,
					size: proxyResult.meta?.imageBillingSize ?? billing.size,
				},
				effectiveImageCount: validImages,
				imageUsage,
				clientAbortPrecheck,
				imageAbortReason,
				resultConfirmed: status === 'success' && validImages > 0,
				upstreamSupplierCostUsdTicks,
				providerKeyId: chosenRoute.providerKeyId ?? null,
				providerKeyLabel: chosenRoute.providerKeyLabel ?? null,
				providerKeyFingerprint: chosenRoute.providerKeyFingerprint ?? null,
				upstreamRequestId,
				timing: timing.snapshot(),
				circuitEvents: alertCircuitEvents.length > 0 ? alertCircuitEvents : undefined,
				suppressErrorAlert: suppressErrorAlert || undefined,
			});
		})().catch((err) => {
			console.error(
				`[Gateway Images] recordImageUsage failed baseModelId=${baseModelId} keyId=${apiKey.keyId} clientModel=${clientModelId} error=${err instanceof Error ? err.message : String(err)}`
			);
		})
	);

	if (status === 'success') {
		return new Response(responseText, {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		});
	}
	if (response.ok && validImages === 0) {
		return c.json({ error: 'Upstream returned no image data' }, 502);
	}
	return new Response(responseText, {
		status: response.status >= 400 && response.status < 600 ? response.status : 502,
		headers: { 'Content-Type': 'application/json' },
	});
}

imageRoutes.post('/generations', async (c) => {
	const repos = c.get('repositories');
	const apiKey = c.get('apiKey');
	const start = Date.now();
	const timing = new RequestTimingCollector();
	const contentType = c.req.header('content-type') ?? null;
	const contentLength = c.req.header('content-length') ?? null;

	let body: Record<string, unknown>;
	try {
		body = await c.req.json();
	} catch {
		return rejectImageRequest(c, 400, 'Invalid JSON body', {
			operation: 'generations',
			contentType,
			contentLength,
			bodyKeys: [],
			hasModel: false,
		});
	}

	const bodyKeys = summarizeBodyKeys(body);
	const rawModelId = typeof body.model === 'string' ? body.model.trim() : '';
	if (!rawModelId) {
		return rejectImageRequest(c, 400, 'Missing model', {
			operation: 'generations',
			contentType,
			contentLength,
			bodyKeys,
			hasModel: false,
		});
	}

	const routed = await resolveOpenAiImageRoutes(repos, rawModelId, 'images.generations');
	if (!routed.ok) {
		return rejectImageRequest(c, routed.status, routed.error, {
			operation: 'generations',
			contentType,
			contentLength,
			bodyKeys,
			hasModel: true,
			clientModel: rawModelId,
			promptChars: typeof body.prompt === 'string' ? body.prompt.length : 0,
		});
	}
	const { model, baseModelId, effectiveRouteGroup, routes } = routed;

	const common = normalizeImageCommonParams(
		{
			prompt: body.prompt,
			n: body.n,
			size: body.size,
			quality: body.quality,
			background: body.background,
		},
		{ maxN: maxNForImageRoutes(routes) }
	);
	if (!common.ok) {
		return rejectImageRequest(c, 400, common.error, {
			operation: 'generations',
			contentType,
			contentLength,
			bodyKeys,
			hasModel: true,
			clientModel: rawModelId,
			promptChars: typeof body.prompt === 'string' ? body.prompt.length : 0,
		});
	}
	const modelNameForLog = modelDisplayName(model, baseModelId);

	if (!apiKeyHasBalance(apiKey)) {
		return rejectImageRequest(c, 403, 'Budget exceeded', {
			operation: 'generations',
			contentType,
			contentLength,
			bodyKeys,
			hasModel: true,
			clientModel: rawModelId,
			promptChars: common.prompt.length,
		});
	}

	const referenceCount = countOpenAiGenerationReferenceImages(body);

	const estimate = await estimateImageBudgetPrecheck(
		repos,
		{
			modelPricingProfileJson: model.pricing_profile ?? null,
			catalogModelId: baseModelId,
			userChargedCostFactorsJson: apiKey.chargedCostFactors,
			quality: common.quality ?? 'auto',
			size: common.size ?? 'auto',
			imageCount: common.n,
			isEdit: false,
			referenceCount,
			operation: 'generations',
			requestStartedAtMs: start,
		},
		routes.map((route) => route.priceOverrideRaw)
	);
	if (!canAffordImageCost(apiKey.budgetMax, apiKey.budgetSpent, estimate.chargedCost, apiKey.walletGranted, apiKey.walletSpent)) {
		return rejectImageRequest(c, 403, 'Budget exceeded', {
			operation: 'generations',
			contentType,
			contentLength,
			bodyKeys,
			hasModel: true,
			clientModel: rawModelId,
			promptChars: common.prompt.length,
			referenceCount,
		});
	}

	const requestBodyForLog = finalizeRequestLogJson(
		redactImageRequestForLog({
			operation: 'generations',
			model: rawModelId,
			n: common.n,
			size: common.size,
			quality: common.quality,
			background: common.background,
			prompt: common.prompt,
		})
	);

	const circuitBlocked = maybeBlockUserModelCircuit(c, repos, apiKey, {
		baseModelId,
		modelNameForLog,
		requestBodyForLog,
		requestProtocol: 'openai',
		startMs: start,
		timing,
		clientErrorCircuitEnabled: false,
	});
	if (circuitBlocked) {
		return circuitBlocked;
	}

	const upstreamBody: Record<string, unknown> = {
		prompt: common.prompt,
		n: common.n,
	};
	if (common.size) upstreamBody.size = common.size;
	if (common.quality) upstreamBody.quality = common.quality;
	if (common.background) upstreamBody.background = common.background;
	// 仅显式透传：GPT Image 不接受 response_format（DALL·E 遗留），默认由上游决定
	if (typeof body.response_format === 'string' && body.response_format.trim() !== '') {
		upstreamBody.response_format = body.response_format.trim();
	}
	if (typeof body.output_format === 'string') {
		upstreamBody.output_format = body.output_format;
	}
	// Seedream 等兼容扩展：用户显式传入时透传；亦可由 route `custom_params` 注入默认值
	applyOpenAiImageGenerationExtras(upstreamBody, body);

	const failoverOptions = await buildProxyFailoverOptions({
		repos,
		apiKey,
		model,
		baseModelId,
		effectiveRouteGroup,
		protocol: 'openai',
		capability: 'images.generations',
		poolStrategy: routed.poolStrategy,
		poolTierStrategies: routed.poolTierStrategies,
		stickySurface: routed.stickySurface,
		routes,
		timing,
	});
	timing.markGatewayComplete();

	console.log(
		`[Gateway Images] generations baseModelId=${baseModelId} keyId=${apiKey.keyId} n=${common.n}`
	);

	const proxyResult = await proxyImageGenerations(
		repos,
		routes,
		upstreamBody,
		c.req.raw.signal,
		failoverOptions
	);

	return finalizeImageResponse({
		c,
		proxyResult,
		apiKey,
		repos,
		baseModelId,
		effectiveRouteGroup,
		modelNameForLog,
		requestBodyForLog,
		operation: 'generations',
		billing: {
			modelPricingProfileJson: model.pricing_profile ?? null,
			catalogModelId: baseModelId,
			userChargedCostFactorsJson: apiKey.chargedCostFactors,
			routePriceOverrideJson: proxyResult.chosenRoute.priceOverrideRaw,
			quality: common.quality ?? 'auto',
			size: common.size ?? 'auto',
			imageCount: common.n,
			isEdit: false,
			referenceCount,
			operation: 'generations',
			requestStartedAtMs: start,
		},
		budgetPrecheck: estimate,
		clientModelId: rawModelId,
		common,
		referenceCount,
		start,
		timing,
	});
});

imageRoutes.post('/edits', async (c) => {
	const repos = c.get('repositories');
	const apiKey = c.get('apiKey');
	const start = Date.now();
	const timing = new RequestTimingCollector();

	const parsed = await parseMultipartEdits(c);
	if (!parsed.ok) {
		return rejectImageRequest(c, 400, parsed.error, {
			operation: 'edits',
			...parsed.diag,
		});
	}
	const { model: rawModelId, edit, totalUploadBytes } = parsed;

	const routed = await resolveOpenAiImageRoutes(repos, rawModelId, 'images.edits');
	if (!routed.ok) {
		return rejectImageRequest(c, routed.status, routed.error, {
			operation: 'edits',
			contentType: c.req.header('content-type') ?? null,
			contentLength: c.req.header('content-length') ?? null,
			hasModel: true,
			clientModel: rawModelId,
			promptChars: edit.prompt.length,
			referenceCount: edit.images.length,
			totalUploadBytes,
		});
	}
	const { model, baseModelId, effectiveRouteGroup, routes } = routed;
	const modelNameForLog = modelDisplayName(model, baseModelId);

	if (!apiKeyHasBalance(apiKey)) {
		return rejectImageRequest(c, 403, 'Budget exceeded', {
			operation: 'edits',
			contentType: c.req.header('content-type') ?? null,
			contentLength: c.req.header('content-length') ?? null,
			hasModel: true,
			clientModel: rawModelId,
			promptChars: edit.prompt.length,
			referenceCount: edit.images.length,
			totalUploadBytes,
		});
	}

	const estimate = await estimateImageBudgetPrecheck(
		repos,
		{
			modelPricingProfileJson: model.pricing_profile ?? null,
			catalogModelId: baseModelId,
			userChargedCostFactorsJson: apiKey.chargedCostFactors,
			quality: edit.quality ?? 'auto',
			size: edit.size ?? 'auto',
			imageCount: edit.n,
			isEdit: true,
			referenceCount: edit.images.length,
			operation: 'edits',
			requestStartedAtMs: start,
		},
		routes.map((route) => route.priceOverrideRaw)
	);
	if (!canAffordImageCost(apiKey.budgetMax, apiKey.budgetSpent, estimate.chargedCost, apiKey.walletGranted, apiKey.walletSpent)) {
		return rejectImageRequest(c, 403, 'Budget exceeded', {
			operation: 'edits',
			contentType: c.req.header('content-type') ?? null,
			contentLength: c.req.header('content-length') ?? null,
			hasModel: true,
			clientModel: rawModelId,
			promptChars: edit.prompt.length,
			referenceCount: edit.images.length,
			totalUploadBytes,
		});
	}

	const requestBodyForLog = finalizeRequestLogJson(
		redactImageRequestForLog({
			operation: 'edits',
			model: rawModelId,
			n: edit.n,
			size: edit.size,
			quality: edit.quality,
			background: edit.background,
			prompt: edit.prompt,
			referenceCount: edit.images.length,
		})
	);

	const circuitBlocked = maybeBlockUserModelCircuit(c, repos, apiKey, {
		baseModelId,
		modelNameForLog,
		requestBodyForLog,
		requestProtocol: 'openai',
		startMs: start,
		timing,
		clientErrorCircuitEnabled: false,
	});
	if (circuitBlocked) {
		return circuitBlocked;
	}

	const failoverOptions = await buildProxyFailoverOptions({
		repos,
		apiKey,
		model,
		baseModelId,
		effectiveRouteGroup,
		protocol: 'openai',
		capability: 'images.edits',
		poolStrategy: routed.poolStrategy,
		poolTierStrategies: routed.poolTierStrategies,
		stickySurface: routed.stickySurface,
		routes,
		timing,
	});
	timing.markGatewayComplete();

	console.log(
		`[Gateway Images] edits baseModelId=${baseModelId} keyId=${apiKey.keyId} refs=${edit.images.length}`
	);

	const proxyResult = await proxyImageEdits(repos, routes, edit, c.req.raw.signal, failoverOptions);

	return finalizeImageResponse({
		c,
		proxyResult,
		apiKey,
		repos,
		baseModelId,
		effectiveRouteGroup,
		modelNameForLog,
		requestBodyForLog,
		operation: 'edits',
		billing: {
			modelPricingProfileJson: model.pricing_profile ?? null,
			catalogModelId: baseModelId,
			userChargedCostFactorsJson: apiKey.chargedCostFactors,
			routePriceOverrideJson: proxyResult.chosenRoute.priceOverrideRaw,
			quality: edit.quality ?? 'auto',
			size: edit.size ?? 'auto',
			imageCount: edit.n,
			isEdit: true,
			referenceCount: edit.images.length,
			operation: 'edits',
			requestStartedAtMs: start,
		},
		budgetPrecheck: estimate,
		clientModelId: rawModelId,
		common: {
			prompt: edit.prompt,
			n: edit.n,
			size: edit.size,
			quality: edit.quality,
			background: edit.background,
		},
		referenceCount: edit.images.length,
		start,
		timing,
	});
});
