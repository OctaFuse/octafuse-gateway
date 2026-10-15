/**
 * 用户路由：`POST /v1/embeddings`（OpenAI 协议）。
 * 公共流水线见 `proxy-pipeline.ts`；本文件只保留 Embeddings 的脱敏与 dispatch。
 */
import { Hono } from 'hono';
import { requireApiKey } from '../../middleware/auth';
import { describeEmbeddingsOutcome } from '../../services/accounting';
import type { RouteResult } from '../../services/model-router';
import { proxyEmbeddings } from '../../services/proxy';
import { finalizeRequestLogJson } from '../../services/request-log-shared';
import { buildRouteRequestBody } from '../../services/route-default-params';
import {
	parseJsonModelBody,
	runProxyPipeline,
	type AuthedEnv,
} from '../../services/proxy-pipeline';

/** 去掉 `input` 原文，只保留条数与其余参数（dimensions / encoding_format 等）。 */
export function embeddingsBodyRedactedForLog(body: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(body)) {
		if (k === 'input') continue;
		out[k] = v;
	}
	const input = body.input;
	if (Array.isArray(input)) {
		out._input_count = input.length;
	} else if (input != null) {
		out._input_count = 1;
	}
	return out;
}

function embeddingsRequestBodyForLog(body: Record<string, unknown>): string | null {
	return finalizeRequestLogJson(embeddingsBodyRedactedForLog(body));
}

function embeddingsUpstreamWireBodyForLog(route: RouteResult, body: Record<string, unknown>): string | null {
	const merged = buildRouteRequestBody(route, body);
	const wire = { ...merged, model: route.providerModelName };
	return finalizeRequestLogJson(embeddingsBodyRedactedForLog(wire));
}

export const embeddingsRoutes = new Hono<AuthedEnv>();

embeddingsRoutes.use('*', requireApiKey);

/** body 须含 `model` 与 `input`；同步返回，用量取上游 `usage.prompt_tokens`。 */
embeddingsRoutes.post('/', async (c) =>
	runProxyPipeline(c, {
		requestProtocol: 'openai',
		requestOperation: 'embeddings',
		strategyCapability: 'embeddings',
		logTag: 'Embeddings',
		parseRequest: parseJsonModelBody,
		dispatch: ({ repos, routes, body, requestSignal, options }) =>
			proxyEmbeddings(repos, routes, body, requestSignal, options),
		accounting: {
			requestBodyForLog: embeddingsRequestBodyForLog,
			upstreamWireBodyForLog: embeddingsUpstreamWireBodyForLog,
			describeOutcome: describeEmbeddingsOutcome,
		},
		logForward: true,
		logRouteResolutionError: true,
		logEmptyRoutes: true,
		logRecordUsageError: true,
	})
);
