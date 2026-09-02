/**
 * 纯函数：把协议解读结果与请求上下文合成可序列化的 `AccountingEvent`。
 * 无 I/O；`requestLogId` 在此生成（或由调用方注入，供阶段二重放）。
 */
import type { UpstreamProtocol } from '@octafuse/core';
import type { ApiKeyContext } from '../../middleware/auth';
import type { GatewayCircuitAlertEvent } from '../circuit-alert-types';
import type { RouteResult } from '../model-router';
import type { UsageFromStream } from '../proxy';
import {
	computeRequestLogStatus,
	formatHttpErrorTextForRequestLog,
} from '../request-log-record-status';
import type { RequestTimingSnapshot } from '../request-timing';
import type { DescribedOutcome } from './describe-outcome';
import { allocateRequestLogId, type AccountingEvent } from './types';

export type BuildAccountingEventInput = {
	/** 省略则现生成；阶段二重放时传入 spool 中的稳定 id。 */
	requestLogId?: string;
	apiKey: Pick<ApiKeyContext, 'keyId' | 'userId' | 'userEmail' | 'chargedCostFactors'>;
	described: DescribedOutcome;
	usage: UsageFromStream;
	responseOk: boolean;
	errorBodyText: string | null;
	responseStatus: number;
	responseContentType: string | null;
	baseModelId: string;
	modelName: string;
	modelPricingProfile: string | null;
	requestProtocol: Extract<UpstreamProtocol, 'openai' | 'anthropic' | 'gemini'>;
	requestOperation: string;
	requestBodyForLog: string | null;
	upstreamRequestBody: string | null;
	chosenRoute: Pick<
		RouteResult,
		| 'providerId'
		| 'providerModelName'
		| 'providerName'
		| 'upstreamProtocol'
		| 'upstreamOperation'
		| 'modelSurfaceId'
		| 'routePoolId'
		| 'targetId'
		| 'adapter'
		| 'priceOverrideRaw'
		| 'routeMeteredProfileJson'
		| 'routeChargedProfileJson'
		| 'routeGroup'
		| 'providerKeyId'
		| 'providerKeyLabel'
		| 'providerKeyFingerprint'
	>;
	stickyTrace: AccountingEvent['sticky_trace'];
	requestStartedAtMs: number;
	latencyMs: number;
	timing: RequestTimingSnapshot | null;
	circuitEvents: GatewayCircuitAlertEvent[];
	suppressErrorAlert: boolean;
};

export function resolveAccountingErrorMessage(input: {
	status: AccountingEvent['status'];
	described: DescribedOutcome;
	errorBodyText: string | null;
	responseStatus: number;
	responseContentType: string | null;
}): string | undefined {
	if (input.status === 'success') return undefined;
	if (input.status === 'cancelled') return 'Client disconnected (e.g. user cancelled)';
	if (input.status === 'incomplete') return input.described.incompleteErrorMessage;
	if (input.errorBodyText != null) {
		return formatHttpErrorTextForRequestLog(
			input.responseStatus,
			input.responseContentType,
			input.errorBodyText
		);
	}
	return input.described.httpErrorFallback;
}

export function buildAccountingEvent(input: BuildAccountingEventInput): AccountingEvent {
	const requestLogId = input.requestLogId ?? allocateRequestLogId();
	const incomplete = !input.described.hasUsage;
	const status = computeRequestLogStatus({
		cancelled: Boolean(input.usage.cancelled),
		responseOk: input.responseOk,
		incomplete,
	});
	const errorMessage = resolveAccountingErrorMessage({
		status,
		described: input.described,
		errorBodyText: input.errorBodyText,
		responseStatus: input.responseStatus,
		responseContentType: input.responseContentType,
	});
	return {
		requestLogId,
		api_key_id: input.apiKey.keyId,
		user_id: input.apiKey.userId,
		user_email: input.apiKey.userEmail,
		model_id: input.baseModelId,
		provider_id: input.chosenRoute.providerId,
		provider_model_name: input.chosenRoute.providerModelName,
		model_name: input.modelName,
		provider_name: input.chosenRoute.providerName,
		request_body: input.requestBodyForLog,
		upstream_request_body: input.upstreamRequestBody,
		request_protocol: input.requestProtocol,
		request_operation: input.requestOperation,
		upstream_protocol: input.chosenRoute.upstreamProtocol,
		upstream_operation: input.chosenRoute.upstreamOperation,
		model_surface_id: input.chosenRoute.modelSurfaceId,
		route_pool_id: input.chosenRoute.routePoolId,
		route_target_id: input.chosenRoute.targetId,
		adapter: input.chosenRoute.adapter,
		sticky_trace: input.stickyTrace,
		usage: input.usage,
		model_pricing_profile: input.modelPricingProfile,
		route_price_override_json: input.chosenRoute.priceOverrideRaw,
		user_charged_cost_factors_json: input.apiKey.chargedCostFactors,
		route_metered_profile_json: input.chosenRoute.routeMeteredProfileJson,
		route_charged_profile_json: input.chosenRoute.routeChargedProfileJson,
		request_started_at_ms: input.requestStartedAtMs,
		route_group: input.chosenRoute.routeGroup,
		status,
		latency_ms: input.latencyMs,
		timing: input.timing,
		error_message: errorMessage,
		provider_key_id: input.chosenRoute.providerKeyId ?? null,
		provider_key_label: input.chosenRoute.providerKeyLabel ?? null,
		provider_key_fingerprint: input.chosenRoute.providerKeyFingerprint ?? null,
		upstream_request_id: input.described.loggedRequestId,
		upstream_message_id: input.usage.upstreamMessageId ?? null,
		circuit_events: input.circuitEvents.length > 0 ? input.circuitEvents : undefined,
		suppress_error_alert: input.suppressErrorAlert || undefined,
		...input.described.extraRecordUsage,
	};
}
