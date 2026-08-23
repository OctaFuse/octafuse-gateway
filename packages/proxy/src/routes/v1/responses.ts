/**
 * 用户路由：`POST /v1/responses`（OpenAI Responses 协议透传）。
 * 公共流水线见 `proxy-pipeline.ts`；本文件只保留 Responses 的脱敏、状态路由守卫与 dispatch。
 */
import { Hono } from 'hono';
import { requireApiKey } from '../../middleware/auth';
import type { RouteResult } from '../../services/model-router';
import { proxyResponses } from '../../services/proxy';
import { finalizeRequestLogJson } from '../../services/request-log-shared';
import { summarizeOpenAiToolsForLog } from '../../services/request-log-tools-summary';
import { buildRouteRequestBody } from '../../services/route-default-params';
import { GatewayErrorCode } from '../../services/gateway-error-codes';
import { gatewayErrorJson } from '../../services/gateway-error-response';
import {
	parseJsonModelBody,
	runProxyPipeline,
	type AuthedEnv,
} from '../../services/proxy-pipeline';

function responsesBodyRedactedForLog(body: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(body)) {
		if (k === 'input' || k === 'messages' || k === 'prompt' || k === 'data' || k === 'instructions') {
			continue;
		}
		if (k === 'tools') {
			Object.assign(out, summarizeOpenAiToolsForLog(v));
			continue;
		}
		out[k] = v;
	}
	if (Array.isArray(body.input)) {
		out._input_count = body.input.length;
	} else if (typeof body.input === 'string') {
		out._input_count = 1;
	}
	if (typeof body.instructions === 'string' && body.instructions.length > 0) {
		out._has_instructions = true;
	}
	return out;
}

function responsesRequestBodyForLog(body: Record<string, unknown>): string | null {
	return finalizeRequestLogJson(responsesBodyRedactedForLog(body));
}

function responsesUpstreamWireBodyForLog(route: RouteResult, body: Record<string, unknown>): string | null {
	const merged = buildRouteRequestBody(route, body);
	const wire = { ...merged, model: route.providerModelName };
	return finalizeRequestLogJson(responsesBodyRedactedForLog(wire));
}

export function readPreviousResponseId(body: Record<string, unknown>): string | null {
	const raw = body.previous_response_id;
	if (typeof raw !== 'string') return null;
	const trimmed = raw.trim();
	return trimmed || null;
}

/** 多 Target 且无法保证回到同一上游时，状态请求 fail closed。 */
export function responsesStateRouteUnavailable(routes: RouteResult[], previousResponseId: string | null): boolean {
	if (!previousResponseId) return false;
	const targetIds = new Set(routes.map((route) => route.targetId).filter(Boolean));
	return targetIds.size > 1;
}

export const responsesRoutes = new Hono<AuthedEnv>();

responsesRoutes.use('*', requireApiKey);

responsesRoutes.post('/', async (c) =>
	runProxyPipeline(c, {
		requestProtocol: 'openai',
		requestOperation: 'responses',
		strategyCapability: 'responses',
		logTag: 'Responses',
		noRouteMessage: (routeGroup) =>
			`No OpenAI Responses route in route group "${routeGroup}" for this model`,
		parseRequest: parseJsonModelBody,
		requestBodyForLog: responsesRequestBodyForLog,
		upstreamWireBodyForLog: responsesUpstreamWireBodyForLog,
		dispatch: ({ repos, routes, body, requestSignal, options }) =>
			proxyResponses(repos, routes, body, requestSignal, options),
		afterRoutesResolved: (ctx, { routes, body }) => {
			const previousResponseId = readPreviousResponseId(body);
			if (responsesStateRouteUnavailable(routes, previousResponseId)) {
				return gatewayErrorJson(ctx, {
					status: 409,
					code: GatewayErrorCode.responsesStateRouteUnavailable,
					message:
						'previous_response_id cannot be routed: multiple upstream targets are eligible and Gateway does not bind Response IDs yet',
				});
			}
			return null;
		},
		logForward: true,
		logRouteResolutionError: true,
		logEmptyRoutes: true,
		logRecordUsageError: true,
		incompleteErrorMessage: (usage, timedOut) =>
			timedOut
				? 'Stream usage timeout (no usage within limit)'
				: usage.stream_error || 'Stream ended before usage available',
		httpErrorFallback: (usage, status) => usage.stream_error || `HTTP ${status}`,
	})
);
