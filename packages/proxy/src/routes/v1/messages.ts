/**
 * 用户路由：`POST /v1/messages`（Anthropic Messages 协议），逻辑与 chat 对称，仅上游 driver 与协议筛选不同。
 */
import { Hono } from 'hono';
import { requireApiKey } from '../../middleware/auth';
import { describeMessagesOutcome } from '../../services/accounting';
import type { RouteResult } from '../../services/model-router';
import { proxyAnthropicMessages } from '../../services/proxy';
import { finalizeRequestLogJson } from '../../services/request-log-shared';
import { summarizeAnthropicToolsForLog } from '../../services/request-log-tools-summary';
import { buildRouteRequestBody } from '../../services/route-default-params';
import {
	parseJsonModelBody,
	runProxyPipeline,
	type AuthedEnv,
} from '../../services/proxy-pipeline';

/** Anthropic Messages：去掉 messages / system 正文；tools 仅保留名称摘要。 */
function anthropicBodyRedactedForLog(body: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(body)) {
		if (k === 'messages' || k === 'system') {
			continue;
		}
		if (k === 'tools') {
			Object.assign(out, summarizeAnthropicToolsForLog(v));
			continue;
		}
		out[k] = v;
	}
	if (Array.isArray(body.messages)) {
		out._messages_count = body.messages.length;
	}
	return out;
}

function anthropicRequestBodyForLog(body: Record<string, unknown>): string | null {
	return finalizeRequestLogJson(anthropicBodyRedactedForLog(body));
}

/** 与 anthropic-driver 一致：`{ ...buildRouteRequestBody, model }` 再脱敏（与 chat 分写，便于日后分叉）。 */
function anthropicUpstreamWireBodyForLog(route: RouteResult, body: Record<string, unknown>): string | null {
	const merged = buildRouteRequestBody(route, body);
	const wire = { ...merged, model: route.providerModelName };
	return finalizeRequestLogJson(anthropicBodyRedactedForLog(wire));
}

export const messagesRoutes = new Hono<AuthedEnv>();

messagesRoutes.use('*', requireApiKey);

/** Anthropic Messages：路由解析、预算与 failover 与 chat 对称，仅上游协议为 `anthropic`。 */
messagesRoutes.post('/', async (c) =>
	runProxyPipeline(c, {
		requestProtocol: 'anthropic',
		requestOperation: 'messages',
		strategyCapability: 'messages',
		logTag: 'Messages',
		noRouteMessage: (routeGroup) =>
			`No Anthropic route in route group "${routeGroup}" for this model`,
		parseRequest: parseJsonModelBody,
		dispatch: ({ repos, routes, body, requestSignal, options }) =>
			proxyAnthropicMessages(repos, routes, body, requestSignal, options),
		accounting: {
			requestBodyForLog: anthropicRequestBodyForLog,
			upstreamWireBodyForLog: anthropicUpstreamWireBodyForLog,
			describeOutcome: describeMessagesOutcome,
		},
	})
);
