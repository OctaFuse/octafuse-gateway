/**
 * v1 代理路由共用的 user+model 熔断：请求前短路 + 上游触发写入 + 成功清零 + 短路请求记账。
 */
import type { Context } from 'hono';
import type { GatewayRepositories } from '@octafuse/core';
import type { ApiKeyContext } from '../middleware/auth';
import { scheduleBackgroundWork } from '../runtime/schedule-background-work';
import { EMPTY_USAGE } from './proxy';
import {
	buildUserModelCircuitOpenResponse,
	formatUserModelCircuitOpenErrorMessage,
	getUserModelCircuitOpen,
	isSensitiveUpstreamResponse,
	markUserModelSuccess,
	recordUserModelCircuitTrigger,
} from './user-model-circuit-breaker';
import type { GatewayCircuitAlertEvent } from './circuit-alert-types';
import { allocateRequestLogId } from './accounting';
import { recordUsage } from './usage-tracker';
import type { RequestTimingCollector } from './request-timing';

const GATEWAY_PROVIDER_ID = 'gateway';

export type UserModelCircuitRouteContext = {
	baseModelId: string;
	modelNameForLog: string;
	requestBodyForLog: string | null;
	requestProtocol: 'openai' | 'anthropic' | 'gemini';
	startMs: number;
	timing?: RequestTimingCollector | null;
	/**
	 * 是否因普通上游 400（`client_error`）短路。省略视为 true。
	 * images / audio 设为 false，避免 agent 修正参数后重试被误挡；
	 * 仍会因 `sensitive_content` 短路。
	 */
	clientErrorCircuitEnabled?: boolean;
};

export type UserModelCircuitTriggerOptions = {
	/**
	 * 是否因普通上游 400 写入 `client_error` 熔断。省略视为 true。
	 * images / audio 设为 false；敏感内容仍会触发。
	 */
	clientErrorCircuitEnabled?: boolean;
};

/**
 * 若当前 user+model 处于熔断窗口，记录短路日志并返回短路 Response；否则 null。
 */
export function maybeBlockUserModelCircuit(
	c: Context,
	repos: GatewayRepositories,
	apiKey: ApiKeyContext,
	ctx: UserModelCircuitRouteContext
): Response | null {
	const open = getUserModelCircuitOpen(apiKey.userId, ctx.baseModelId);
	if (!open) {
		return null;
	}
	// images / audio：忽略其它协议路由可能写入的 client_error 状态
	if (ctx.clientErrorCircuitEnabled === false && open.reason === 'client_error') {
		return null;
	}
	const latencyMs = Date.now() - ctx.startMs;
	ctx.timing?.markGatewayComplete();
	scheduleBackgroundWork(
		c,
		recordUsage(repos, {
			requestLogId: allocateRequestLogId(),
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
			user_charged_cost_factors_json: apiKey.chargedCostFactors,
			request_started_at_ms: ctx.startMs,
			route_group: 'default',
			status: 'error',
			latency_ms: latencyMs,
			timing: ctx.timing?.snapshot() ?? null,
			error_message: formatUserModelCircuitOpenErrorMessage(open),
			suppress_error_alert: true,
		}).catch((err) => {
			console.error(
				'[Gateway] user-model circuit open recordUsage failed',
				err instanceof Error ? err.message : String(err)
			);
		})
	);
	return buildUserModelCircuitOpenResponse(open);
}

/** @deprecated 使用 {@link maybeBlockUserModelCircuit} */
export const maybeBlockSensitiveContentCircuit = maybeBlockUserModelCircuit;

/**
 * 上游非 2xx：敏感词或普通 400 → 同一套 user+model 递增退避；
 * 仅 `reason` / 短路 code 区分类别。
 * `options.clientErrorCircuitEnabled === false` 时跳过普通 400（仍记 sensitive）。
 */
export function maybeTriggerUserModelCircuitFromUpstream(
	userId: string,
	modelId: string,
	status: number,
	contentType: string | null,
	errorBodyText: string | null | undefined,
	errorMessageForLog?: string,
	options?: UserModelCircuitTriggerOptions
): GatewayCircuitAlertEvent | null {
	if (errorBodyText == null) {
		return null;
	}

	const sensitive = isSensitiveUpstreamResponse(status, contentType, errorBodyText);
	if (!sensitive) {
		if (status !== 400) {
			return null;
		}
		if (options?.clientErrorCircuitEnabled === false) {
			return null;
		}
	}

	const reason = sensitive ? 'sensitive_content' : 'client_error';
	const info = recordUserModelCircuitTrigger(userId, modelId, reason, errorMessageForLog);
	return {
		kind: 'user_model',
		userId,
		modelId,
		reason,
		openUntil: info.blockedUntil,
		cooldownMs: info.retryAfterSeconds * 1000,
	};
}

/** @deprecated 使用 {@link maybeTriggerUserModelCircuitFromUpstream} */
export function maybeTriggerSensitiveContentCircuitFromUpstream(
	userId: string,
	modelId: string,
	status: number,
	contentType: string | null,
	errorBodyText: string | null | undefined,
	errorMessageForLog?: string
): GatewayCircuitAlertEvent | null {
	return maybeTriggerUserModelCircuitFromUpstream(
		userId,
		modelId,
		status,
		contentType,
		errorBodyText,
		errorMessageForLog
	);
}

export { markUserModelSuccess };
