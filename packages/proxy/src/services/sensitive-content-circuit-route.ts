/**
 * v1 代理路由共用的敏感内容熔断：请求前短路 + 上游触发写入 + 短路请求记账。
 */
import type { Context } from 'hono';
import type { GatewayRepositories } from '@octafuse/core';
import type { ApiKeyContext } from '../middleware/auth';
import { scheduleBackgroundWork } from '../runtime/schedule-background-work';
import { EMPTY_USAGE } from './proxy';
import {
	buildSensitiveContentCircuitOpenResponse,
	formatSensitiveContentCircuitOpenErrorMessage,
	getSensitiveContentCircuitOpen,
	isSensitiveUpstreamResponse,
	recordSensitiveContentCircuitTrigger,
} from './sensitive-content-circuit-breaker';
import type { GatewayCircuitAlertEvent } from './circuit-alert-types';
import { recordUsage } from './usage-tracker';

const GATEWAY_PROVIDER_ID = 'gateway';

export type SensitiveContentCircuitRouteContext = {
	baseModelId: string;
	modelNameForLog: string;
	requestBodyForLog: string | null;
	requestProtocol: 'openai' | 'anthropic' | 'gemini';
	startMs: number;
};

/**
 * 若当前 user+model 处于熔断窗口，记录短路日志并返回 429 Response；否则返回 null 继续正常转发。
 */
export function maybeBlockSensitiveContentCircuit(
	c: Context,
	repos: GatewayRepositories,
	apiKey: ApiKeyContext,
	ctx: SensitiveContentCircuitRouteContext
): Response | null {
	const open = getSensitiveContentCircuitOpen(apiKey.userId, ctx.baseModelId);
	if (!open) {
		return null;
	}
	const latencyMs = Date.now() - ctx.startMs;
	scheduleBackgroundWork(
		c,
		recordUsage(repos, {
			api_key_id: apiKey.keyId,
			user_id: apiKey.userId,
			user_email: apiKey.userEmail,
			model_id: ctx.baseModelId,
			provider_id: GATEWAY_PROVIDER_ID,
			model_name: ctx.modelNameForLog,
			request_body: ctx.requestBodyForLog,
			request_protocol: ctx.requestProtocol,
			upstream_protocol: ctx.requestProtocol,
			usage: EMPTY_USAGE,
			route_group: 'default',
			status: 'error',
			latency_ms: latencyMs,
			error_message: formatSensitiveContentCircuitOpenErrorMessage(open),
			suppress_error_alert: true,
		}).catch((err) => {
			console.error(
				'[Gateway] sensitive content circuit open recordUsage failed',
				err instanceof Error ? err.message : String(err)
			);
		})
	);
	return buildSensitiveContentCircuitOpenResponse(open);
}

export function maybeTriggerSensitiveContentCircuitFromUpstream(
	userId: string,
	modelId: string,
	status: number,
	contentType: string | null,
	errorBodyText: string | null | undefined,
	errorMessageForLog?: string
): GatewayCircuitAlertEvent | null {
	if (errorBodyText == null) {
		return null;
	}
	if (!isSensitiveUpstreamResponse(status, contentType, errorBodyText)) {
		return null;
	}
	const info = recordSensitiveContentCircuitTrigger(userId, modelId, errorMessageForLog);
	return {
		kind: 'user_model',
		userId,
		modelId,
		reason: 'sensitive_content',
		openUntil: info.blockedUntil,
		cooldownMs: info.retryAfterSeconds * 1000,
	};
}
