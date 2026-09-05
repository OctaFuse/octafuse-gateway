/**
 * 可序列化的记账事件：`recordUsage` 入参 + 稳定 `requestLogId`。
 * 纯数据，不含 Promise / 函数；阶段二 spool 将直接缓冲本对象。
 */
import type { UpstreamProtocol } from '@octafuse/core';
import type { GatewayCircuitAlertEvent } from '../circuit-alert-types';
import type { UsageFromStream } from '../proxy';
import type { RequestTimingSnapshot } from '../request-timing';

export function allocateRequestLogId(): string {
	return crypto.randomUUID();
}

/**
 * `recordUsage` 入参。`requestLogId` 同时是请求日志主键；阶段二还将作为 spool 键与审计 `dedup_key`。
 */
export type RecordUsageParams = {
	requestLogId: string;
	api_key_id: string;
	user_id: string;
	user_email: string | null;
	model_id: string;
	provider_id: string;
	provider_model_name?: string | null;
	model_name?: string | null;
	provider_name?: string | null;
	request_body?: string | null;
	upstream_request_body?: string | null;
	request_protocol: 'openai' | 'anthropic' | 'gemini';
	request_operation?: string | null;
	upstream_protocol: UpstreamProtocol;
	upstream_operation?: string | null;
	model_surface_id?: string | null;
	route_pool_id?: string | null;
	route_target_id?: string | null;
	adapter?: string | null;
	/** Gemini wire action from URL (`generateContent` / `streamGenerateContent`); stored in route_trace. */
	gemini_wire_action?: string | null;
	/** Provider sticky routing observation (merged into route_trace.sticky). */
	sticky_trace?: {
		lookup: string;
		attempted_target: string | null;
		result: string;
	} | null;
	usage: UsageFromStream;
	model_pricing_profile?: string | null;
	route_price_override_json?: string | null;
	/** `users.charged_cost_factors` JSON；按 `model_id` 精确匹配后再乘路由 charged */
	user_charged_cost_factors_json?: string | null;
	/** @deprecated Ignored; nested metered tiers are not used for billing. */
	route_metered_profile_json?: string | null;
	/** @deprecated Ignored; nested charged tiers are not used for billing. */
	route_charged_profile_json?: string | null;
	/** 请求进入 Gateway 的时间；分时时段倍率在该时刻锁定。 */
	request_started_at_ms?: number;
	route_group: string;
	status: 'success' | 'error' | 'incomplete' | 'cancelled';
	latency_ms?: number;
	timing?: RequestTimingSnapshot | null;
	error_message?: string;
	provider_key_id?: string | null;
	provider_key_label?: string | null;
	provider_key_fingerprint?: string | null;
	/** 上游响应头 request id（传输层追踪，见 `upstream-request-id.ts`） */
	upstream_request_id?: string | null;
	/** 上游响应 body message id（应用层生成结果 id：chatcmpl-* / msg_* / responseId） */
	upstream_message_id?: string | null;
	/** 本次错误关联的熔断事件（展示在 webhook 告警中） */
	circuit_events?: GatewayCircuitAlertEvent[];
	/** 已有熔断短路等场景：写日志但不发 webhook */
	suppress_error_alert?: boolean;
	/** Request Host (observe only; not used for admission) */
	ingress_host?: string | null;
};

export type AccountingEvent = RecordUsageParams;
