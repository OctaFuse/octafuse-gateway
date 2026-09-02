/**
 * 用户路由：`POST /v1/chat/completions`（OpenAI 协议）。
 * 公共流水线见 `proxy-pipeline.ts`；本文件只保留 Chat 的脱敏与 dispatch。
 */
import { Hono } from 'hono';
import { requireApiKey } from '../../middleware/auth';
import { describeChatOutcome } from '../../services/accounting';
import type { RouteResult } from '../../services/model-router';
import { proxyChatCompletions } from '../../services/proxy';
import { finalizeRequestLogJson } from '../../services/request-log-shared';
import { summarizeOpenAiToolsForLog } from '../../services/request-log-tools-summary';
import { buildRouteRequestBody } from '../../services/route-default-params';
import {
	parseJsonModelBody,
	runProxyPipeline,
	type AuthedEnv,
} from '../../services/proxy-pipeline';

/** OpenAI Chat Completions：去掉消息与内嵌多模态 data，保留采样/工具等元数据。 */
function openAiBodyRedactedForLog(body: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(body)) {
		if (k === 'messages' || k === 'input' || k === 'prompt' || k === 'data') {
			continue;
		}
		if (k === 'tools') {
			Object.assign(out, summarizeOpenAiToolsForLog(v));
			continue;
		}
		out[k] = v;
	}
	if (Array.isArray(body.messages)) {
		out._messages_count = body.messages.length;
	}
	return out;
}

function openAiRequestBodyForLog(body: Record<string, unknown>): string | null {
	return finalizeRequestLogJson(openAiBodyRedactedForLog(body));
}

/** 与 openai-driver 一致：`{ ...buildRouteRequestBody, model }` 再脱敏（与 messages 分写，便于日后分叉）。 */
function openAiUpstreamWireBodyForLog(route: RouteResult, body: Record<string, unknown>): string | null {
	const merged = buildRouteRequestBody(route, body);
	const wire = { ...merged, model: route.providerModelName };
	return finalizeRequestLogJson(openAiBodyRedactedForLog(wire));
}

export const chatRoutes = new Hono<AuthedEnv>();

chatRoutes.use('*', requireApiKey);

/** body 须含 `model`；流式结束时异步记账，含 usage 兜底超时。 */
chatRoutes.post('/', async (c) =>
	runProxyPipeline(c, {
		requestProtocol: 'openai',
		requestOperation: 'chat',
		strategyCapability: 'chat',
		logTag: 'Chat',
		noRouteMessage: (routeGroup) =>
			`No OpenAI route in route group "${routeGroup}" for this model`,
		parseRequest: parseJsonModelBody,
		dispatch: ({ repos, routes, body, requestSignal, options }) =>
			proxyChatCompletions(repos, routes, body, requestSignal, options),
		accounting: {
			requestBodyForLog: openAiRequestBodyForLog,
			upstreamWireBodyForLog: openAiUpstreamWireBodyForLog,
			describeOutcome: describeChatOutcome,
		},
		logForward: true,
		logRouteResolutionError: true,
		logEmptyRoutes: true,
		logRecordUsageError: true,
	})
);
