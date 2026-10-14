/**
 * 用户路由：`POST /v1beta/models/{model}:{generateContent|streamGenerateContent}`（Gemini 风格路径）。
 */
import { GEMINI_EMBED_OPERATION, GEMINI_GENERATE_OPERATION, type GeminiEmbedAction } from '@octafuse/core';
import { Hono } from 'hono';
import { requireApiKey } from '../../middleware/auth';
import { describeEmbeddingsOutcome, describeGeminiOutcome } from '../../services/accounting';
import type { RouteResult } from '../../services/model-router';
import { proxyGeminiContent, proxyGeminiEmbeddings } from '../../services/proxy';
import { buildRouteRequestBody } from '../../services/route-default-params';
import { finalizeRequestLogJson } from '../../services/request-log-shared';
import { summarizeGeminiToolsForLog } from '../../services/request-log-tools-summary';
import { resolveModelRouting } from '../../services/resolve-model-route-group';
import { GatewayErrorCode } from '../../services/gateway-error-codes';
import { gatewayErrorJson } from '../../services/gateway-error-response';
import { runProxyPipeline, type AuthedEnv } from '../../services/proxy-pipeline';
import { forwardGeminiImageGeneration, geminiPathUsesImagePassthrough } from './gemini-image-generation';

export type GeminiAction = 'generateContent' | 'streamGenerateContent';

type GeminiEmbedPipelineBody = {
	payload: Record<string, unknown>;
	action: GeminiEmbedAction;
	search: string;
};

type GeminiPipelineBody = {
	payload: Record<string, unknown>;
	action: GeminiAction;
	search: string;
};

/** Gemini generateContent：去掉 contents / systemInstruction；tools 仅保留名称摘要；并记录 action。 */
export function geminiBodyRedactedForLog(
	body: Record<string, unknown>,
	action?: GeminiAction
): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(body)) {
		if (k === 'contents' || k === 'systemInstruction' || k === 'system_instruction') {
			continue;
		}
		if (k === 'tools') {
			Object.assign(out, summarizeGeminiToolsForLog(v));
			continue;
		}
		out[k] = v;
	}
	if (Array.isArray(body.contents)) {
		out._contents_count = body.contents.length;
	}
	if (action) {
		out._gemini_action = action;
	}
	return out;
}

function geminiRequestBodyForLog(body: Record<string, unknown>, action: GeminiAction): string | null {
	return finalizeRequestLogJson(geminiBodyRedactedForLog(body, action));
}

/** 与 gemini-driver 一致：仅 `buildRouteRequestBody`（模型在 URL）。 */
function geminiUpstreamWireBodyForLog(
	route: RouteResult,
	body: Record<string, unknown>,
	action: GeminiAction
): string | null {
	const merged = buildRouteRequestBody(route, body) as Record<string, unknown>;
	return finalizeRequestLogJson(geminiBodyRedactedForLog(merged, action));
}

/** Embeddings 日志脱敏：去掉 `content` 与 `requests[].content` 原文，只记条数与其余参数。 */
export function geminiEmbedBodyRedactedForLog(
	body: Record<string, unknown>,
	action?: GeminiEmbedAction
): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(body)) {
		if (k === 'content') continue;
		if (k === 'requests' && Array.isArray(v)) {
			out._requests_count = v.length;
			continue;
		}
		out[k] = v;
	}
	if (action) out._gemini_action = action;
	return out;
}

function geminiEmbedUpstreamWireBodyForLog(
	route: RouteResult,
	body: Record<string, unknown>,
	action: GeminiEmbedAction
): string | null {
	const merged = buildRouteRequestBody(route, body) as Record<string, unknown>;
	return finalizeRequestLogJson(geminiEmbedBodyRedactedForLog(merged, action));
}

/** 路径 action 是否为向量入口（单条或批量）。 */
function parseGeminiEmbedAction(modelAction: string): { modelId: string; action: GeminiEmbedAction } | null {
	const idx = modelAction.lastIndexOf(':');
	if (idx <= 0 || idx >= modelAction.length - 1) return null;
	const modelId = modelAction.slice(0, idx).trim();
	const actionRaw = modelAction.slice(idx + 1).trim();
	if (!modelId) return null;
	if (actionRaw !== 'embedContent' && actionRaw !== 'batchEmbedContents') return null;
	return { modelId, action: actionRaw };
}

/**
 * 解析路径参数 `modelAction`：`{modelId}:{generateContent|streamGenerateContent}`（以最后一个 `:` 分隔）。
 * @returns 非法格式或 action 名不对时 null
 */
function parseGeminiAction(modelAction: string): { modelId: string; action: GeminiAction } | null {
	const idx = modelAction.lastIndexOf(':');
	if (idx <= 0 || idx >= modelAction.length - 1) {
		return null;
	}
	const modelId = modelAction.slice(0, idx).trim();
	const actionRaw = modelAction.slice(idx + 1).trim();
	if (!modelId) return null;
	if (actionRaw !== 'generateContent' && actionRaw !== 'streamGenerateContent') {
		return null;
	}
	return { modelId, action: actionRaw };
}

export const geminiRoutes = new Hono<AuthedEnv>();

geminiRoutes.use('*', requireApiKey);

/** `modelAction` 形如 `{modelId}:{generateContent|streamGenerateContent}`（见 `parseGeminiAction`）。 */
geminiRoutes.post('/models/:modelAction', async (c) => {
	if (parseGeminiEmbedAction(c.req.param('modelAction') ?? '')) {
		return runProxyPipeline<GeminiEmbedPipelineBody>(c, {
			requestProtocol: 'gemini',
			requestOperation: GEMINI_EMBED_OPERATION,
			strategyCapability: GEMINI_EMBED_OPERATION,
			logTag: 'GeminiEmbed',
			parseRequest: async (ctx) => {
				const parsedEmbed = parseGeminiEmbedAction(ctx.req.param('modelAction') ?? '');
				if (!parsedEmbed) {
					return gatewayErrorJson(ctx, {
						status: 400,
						code: GatewayErrorCode.invalidRequest,
						message:
							'Invalid Gemini path, expected /v1beta/models/{model}:{embedContent|batchEmbedContents}',
					});
				}
				let payload: Record<string, unknown>;
				try {
					payload = await ctx.req.json();
				} catch {
					return gatewayErrorJson(ctx, {
						status: 400,
						code: GatewayErrorCode.invalidJson,
						message: 'Invalid JSON body',
					});
				}
				return {
					body: {
						payload,
						action: parsedEmbed.action,
						search: ctx.req.url.includes('?') ? ctx.req.url.slice(ctx.req.url.indexOf('?')) : '',
					},
					rawModelId: parsedEmbed.modelId,
				};
			},
			dispatch: ({ repos, routes, body, requestSignal, options }) =>
				proxyGeminiEmbeddings(repos, routes, body.action, body.payload, body.search, requestSignal, options),
			accounting: {
				requestBodyForLog: (body) =>
					finalizeRequestLogJson(geminiEmbedBodyRedactedForLog(body.payload, body.action)),
				upstreamWireBodyForLog: (route, body) =>
					geminiEmbedUpstreamWireBodyForLog(route, body.payload, body.action),
				describeOutcome: describeEmbeddingsOutcome,
			},
			logForward: true,
			logRouteResolutionError: true,
			logEmptyRoutes: true,
			logRecordUsageError: true,
		});
	}
	const parsedAction = parseGeminiAction(c.req.param('modelAction') ?? '');
	if (parsedAction) {
		const preview = await resolveModelRouting(c.get('repositories'), parsedAction.modelId);
		if (preview && geminiPathUsesImagePassthrough(preview.model)) {
			return forwardGeminiImageGeneration(c, preview, parsedAction.action);
		}
	}
	return runProxyPipeline<GeminiPipelineBody>(c, {
		requestProtocol: 'gemini',
		requestOperation: GEMINI_GENERATE_OPERATION,
		strategyCapability: GEMINI_GENERATE_OPERATION,
		logTag: 'Gemini',
		parseRequest: async (ctx) => {
			const parsedAction = parseGeminiAction(ctx.req.param('modelAction') ?? '');
			if (!parsedAction) {
				return gatewayErrorJson(ctx, {
					status: 400,
					code: GatewayErrorCode.invalidRequest,
					message:
						'Invalid Gemini path, expected /v1beta/models/{model}:{generateContent|streamGenerateContent}',
				});
			}
			let payload: Record<string, unknown>;
			try {
				payload = await ctx.req.json();
			} catch {
				return gatewayErrorJson(ctx, {
					status: 400,
					code: GatewayErrorCode.invalidJson,
					message: 'Invalid JSON body',
				});
			}
			return {
				body: {
					payload,
					action: parsedAction.action,
					search: ctx.req.url.includes('?') ? ctx.req.url.slice(ctx.req.url.indexOf('?')) : '',
				},
				rawModelId: parsedAction.modelId,
			};
		},
		dispatch: ({ repos, routes, body, requestSignal, options }) =>
			proxyGeminiContent(repos, routes, body.action, body.payload, body.search, requestSignal, options),
		accounting: {
			requestBodyForLog: (body) => geminiRequestBodyForLog(body.payload, body.action),
			upstreamWireBodyForLog: (route, body) =>
				geminiUpstreamWireBodyForLog(route, body.payload, body.action),
			describeOutcome: describeGeminiOutcome,
		},
	});
});
