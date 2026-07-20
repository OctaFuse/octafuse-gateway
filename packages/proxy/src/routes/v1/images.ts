/**
 * 用户路由：OpenAI 兼容 Images API
 * - `POST /v1/images/generations`（JSON）
 * - `POST /v1/images/edits`（multipart）
 *
 * 流程：鉴权 → 解析 model → 预算预检 → openai 路由故障转移 → 成功后按 Images usage token 分项扣费。
 * 日志禁止写入 prompt 原文、参考图与 Base64。
 */
import type { GatewayRepositories, ModelRow } from '@octafuse/core';
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../../app';
import { requireApiKey, type ApiKeyContext } from '../../middleware/auth';
import {
	getActiveModelRouteRows,
	resolveRouteResultsFromRows,
	type RouteResult,
} from '../../services/model-router';
import { resolveModelRouting } from '../../services/resolve-model-route-group';
import { selectActiveRouteRows } from '../../services/route-selection';
import { buildStickyDispatchContext } from '../../services/failover-dispatch';
import { proxyImageEdits, proxyImageGenerations, type ProxyResult } from '../../services/proxy';
import { finalizeRequestLogJson } from '../../services/request-log-shared';
import {
	canAffordImageCost,
	estimateImageBudgetPrecheck,
	recordImageUsage,
	type ImageBillingParams,
	type ImageCostBreakdown,
} from '../../services/image-usage-charge';
import { applyOpenAiImageGenerationExtras } from '../../services/image-generation-extras';
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
import {
	formatHttpErrorTextForRequestLog,
	materializeNonOkResponse,
} from '../../services/request-log-record-status';
import {
	maybeBlockSensitiveContentCircuit,
	maybeTriggerSensitiveContentCircuitFromUpstream,
} from '../../services/sensitive-content-circuit-route';
import { RequestTimingCollector } from '../../services/request-timing';
import { scheduleBackgroundWork } from '../../runtime/schedule-background-work';

type ImagesEnv = Env & { Variables: { apiKey: ApiKeyContext } };
type ImagesContext = Context<ImagesEnv>;

export const imageRoutes = new Hono<ImagesEnv>();

imageRoutes.use('*', requireApiKey);

async function resolveOpenAiImageRoutes(
	repos: GatewayRepositories,
	rawModelId: string
): Promise<
	| {
			ok: true;
			model: ModelRow;
			baseModelId: string;
			effectiveRouteGroup: string;
			routes: RouteResult[];
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
	try {
		const routeRows = await getActiveModelRouteRows(repos, baseModelId);
		const selectedRows = selectActiveRouteRows(routeRows, explicitGroup);
		if (selectedRows.length === 0) {
			return {
				ok: false,
				status: 400,
				error: `No active routes for route group "${effectiveRouteGroup}" for this model`,
			};
		}
		let routes = await resolveRouteResultsFromRows(repos, selectedRows);
		routes = routes.filter((route) => route.upstreamProtocol === 'openai');
		if (routes.length === 0) {
			return {
				ok: false,
				status: 502,
				error: `No OpenAI route in route group "${effectiveRouteGroup}" for this model`,
			};
		}
		return { ok: true, model, baseModelId, effectiveRouteGroup, routes };
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Model route resolution failed';
		return { ok: false, status: 502, error: message };
	}
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

async function parseMultipartEdits(c: {
	req: { parseBody: (options?: { all?: boolean }) => Promise<Record<string, unknown>> };
}): Promise<
	| { ok: true; model: string; edit: NormalizedImageEditRequest }
	| { ok: false; error: string }
> {
	let body: Record<string, unknown>;
	try {
		body = (await c.req.parseBody({ all: true })) as Record<string, unknown>;
	} catch {
		return { ok: false, error: 'Invalid multipart body' };
	}

	const modelRaw = body.model;
	const model = typeof modelRaw === 'string' ? modelRaw.trim() : '';
	if (!model) {
		return { ok: false, error: 'Missing model' };
	}

	const common = normalizeImageCommonParams({
		prompt: body.prompt,
		n: body.n,
		size: body.size,
		quality: body.quality,
		background: body.background,
	});
	if (!common.ok) {
		return { ok: false, error: common.error };
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
			if (err) return { ok: false, error: err };
		}
	} else {
		const err = await collectFile(imageField, 'image.png');
		if (err) return { ok: false, error: err };
	}

	// Also accept image[] style keys if parseBody flattened differently
	for (const [key, value] of Object.entries(body)) {
		if (key === 'image' || key === 'images') continue;
		if (!/^image(\[\])?$/i.test(key) && !/^image_\d+$/i.test(key)) continue;
		if (Array.isArray(value)) {
			let i = 0;
			for (const item of value) {
				const err = await collectFile(item, `image-${i++}.png`);
				if (err) return { ok: false, error: err };
			}
		} else {
			const err = await collectFile(value, 'image.png');
			if (err) return { ok: false, error: err };
		}
	}

	if (images.length === 0) {
		return { ok: false, error: 'At least one image file is required' };
	}
	if (images.length > IMAGE_MAX_REFERENCE_COUNT) {
		return { ok: false, error: `At most ${IMAGE_MAX_REFERENCE_COUNT} reference images are allowed` };
	}
	for (const img of images) {
		const err = validateImageUpload(img);
		if (err) {
			return { ok: false, error: err };
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

	const { chosenRoute, upstreamRequestId, circuitEvents, suppressErrorAlert } = proxyResult;
	const { response, errorBodyText } = await materializeNonOkResponse(proxyResult.response);
	await proxyResult.usagePromise.catch(() => undefined);

	const parsedBody = proxyResult.meta?.parsedBody ?? null;
	const imageUsage = response.ok ? (proxyResult.meta?.imageUsage ?? null) : null;
	const validImages = response.ok ? countValidImageResults(parsedBody) : 0;
	const latency = Date.now() - start;
	const clientAbortPrecheck =
		proxyResult.meta?.imageAbortReason === 'client_abort' ? budgetPrecheck : null;

	let responseText: string;
	if (errorBodyText != null) {
		responseText = errorBodyText;
	} else if (parsedBody !== null && parsedBody !== undefined) {
		responseText = JSON.stringify(parsedBody);
	} else {
		responseText = await response.clone().text();
	}

	let sensitiveCircuitEvent = null;
	if (errorBodyText != null) {
		sensitiveCircuitEvent = maybeTriggerSensitiveContentCircuitFromUpstream(
			apiKey.userId,
			baseModelId,
			response.status,
			response.headers.get('content-type'),
			errorBodyText,
			formatHttpErrorTextForRequestLog(
				response.status,
				response.headers.get('content-type'),
				errorBodyText
			)
		);
	}
	const alertCircuitEvents = sensitiveCircuitEvent
		? [...circuitEvents, sensitiveCircuitEvent]
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
		recordImageUsage({
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
			upstreamProtocol: chosenRoute.upstreamProtocol,
			routeGroup: effectiveRouteGroup,
			status,
			latencyMs: latency,
			errorMessage,
			billing,
			effectiveImageCount: validImages,
			imageUsage,
			clientAbortPrecheck,
			providerKeyId: chosenRoute.providerKeyId ?? null,
			providerKeyLabel: chosenRoute.providerKeyLabel ?? null,
			providerKeyFingerprint: chosenRoute.providerKeyFingerprint ?? null,
			upstreamRequestId,
			timing: timing.snapshot(),
			circuitEvents: alertCircuitEvents.length > 0 ? alertCircuitEvents : undefined,
			suppressErrorAlert: suppressErrorAlert || undefined,
		}).catch((err) => {
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

	let body: Record<string, unknown>;
	try {
		body = await c.req.json();
	} catch {
		return c.json({ error: 'Invalid JSON body' }, 400);
	}

	const rawModelId = typeof body.model === 'string' ? body.model.trim() : '';
	if (!rawModelId) {
		return c.json({ error: 'Missing model' }, 400);
	}

	const common = normalizeImageCommonParams({
		prompt: body.prompt,
		n: body.n,
		size: body.size,
		quality: body.quality,
		background: body.background,
	});
	if (!common.ok) {
		return c.json({ error: common.error }, 400);
	}

	const routed = await resolveOpenAiImageRoutes(repos, rawModelId);
	if (!routed.ok) {
		if (routed.status !== 404) {
			console.warn(
				`[Gateway Images] generations route resolve failed status=${routed.status} clientModel=${truncateModelIdForLog(rawModelId)} error=${routed.error}`
			);
		}
		return c.json({ error: routed.error }, routed.status);
	}
	const { model, baseModelId, effectiveRouteGroup, routes } = routed;
	const modelNameForLog = modelDisplayName(model, baseModelId);

	if (apiKey.budgetMax != null && apiKey.budgetSpent >= apiKey.budgetMax) {
		return c.json({ error: 'Budget exceeded' }, 403);
	}

	const estimate = await estimateImageBudgetPrecheck(
		repos,
		{
			modelPricingProfileJson: model.pricing_profile ?? null,
			quality: common.quality ?? 'auto',
			size: common.size ?? 'auto',
			imageCount: common.n,
			isEdit: false,
			requestStartedAtMs: start,
		},
		routes.map((route) => route.priceOverrideRaw)
	);
	if (!canAffordImageCost(apiKey.budgetMax, apiKey.budgetSpent, estimate.chargedCost)) {
		return c.json({ error: 'Budget exceeded' }, 403);
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

	const circuitBlocked = maybeBlockSensitiveContentCircuit(c, repos, apiKey, {
		baseModelId,
		modelNameForLog,
		requestBodyForLog,
		requestProtocol: 'openai',
		startMs: start,
		timing,
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

	const stickyContext = buildStickyDispatchContext({
		stickyConfigRaw: model.sticky_config ?? null,
		userId: apiKey.userId,
		baseModelId,
		routeGroup: effectiveRouteGroup,
		protocol: 'openai',
	});
	timing.markGatewayComplete();

	console.log(
		`[Gateway Images] generations baseModelId=${baseModelId} keyId=${apiKey.keyId} n=${common.n}`
	);

	const proxyResult = await proxyImageGenerations(repos, routes, upstreamBody, c.req.raw.signal, {
		sticky: stickyContext,
		timing,
	});

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
			routePriceOverrideJson: proxyResult.chosenRoute.priceOverrideRaw,
			quality: common.quality ?? 'auto',
			size: common.size ?? 'auto',
			imageCount: common.n,
			isEdit: false,
			requestStartedAtMs: start,
		},
		budgetPrecheck: estimate,
		clientModelId: rawModelId,
		common,
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
		return c.json({ error: parsed.error }, 400);
	}
	const { model: rawModelId, edit } = parsed;

	const routed = await resolveOpenAiImageRoutes(repos, rawModelId);
	if (!routed.ok) {
		if (routed.status !== 404) {
			console.warn(
				`[Gateway Images] edits route resolve failed status=${routed.status} clientModel=${truncateModelIdForLog(rawModelId)} error=${routed.error}`
			);
		}
		return c.json({ error: routed.error }, routed.status);
	}
	const { model, baseModelId, effectiveRouteGroup, routes } = routed;
	const modelNameForLog = modelDisplayName(model, baseModelId);

	if (apiKey.budgetMax != null && apiKey.budgetSpent >= apiKey.budgetMax) {
		return c.json({ error: 'Budget exceeded' }, 403);
	}

	const estimate = await estimateImageBudgetPrecheck(
		repos,
		{
			modelPricingProfileJson: model.pricing_profile ?? null,
			quality: edit.quality ?? 'auto',
			size: edit.size ?? 'auto',
			imageCount: edit.n,
			isEdit: true,
			referenceCount: edit.images.length,
			requestStartedAtMs: start,
		},
		routes.map((route) => route.priceOverrideRaw)
	);
	if (!canAffordImageCost(apiKey.budgetMax, apiKey.budgetSpent, estimate.chargedCost)) {
		return c.json({ error: 'Budget exceeded' }, 403);
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

	const circuitBlocked = maybeBlockSensitiveContentCircuit(c, repos, apiKey, {
		baseModelId,
		modelNameForLog,
		requestBodyForLog,
		requestProtocol: 'openai',
		startMs: start,
		timing,
	});
	if (circuitBlocked) {
		return circuitBlocked;
	}

	const stickyContext = buildStickyDispatchContext({
		stickyConfigRaw: model.sticky_config ?? null,
		userId: apiKey.userId,
		baseModelId,
		routeGroup: effectiveRouteGroup,
		protocol: 'openai',
	});
	timing.markGatewayComplete();

	console.log(
		`[Gateway Images] edits baseModelId=${baseModelId} keyId=${apiKey.keyId} refs=${edit.images.length}`
	);

	const proxyResult = await proxyImageEdits(repos, routes, edit, c.req.raw.signal, {
		sticky: stickyContext,
		timing,
	});

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
			routePriceOverrideJson: proxyResult.chosenRoute.priceOverrideRaw,
			quality: edit.quality ?? 'auto',
			size: edit.size ?? 'auto',
			imageCount: edit.n,
			isEdit: true,
			referenceCount: edit.images.length,
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
