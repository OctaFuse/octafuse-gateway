/**
 * Gateway 错误细分类 code（点分层级）。
 *
 * - `gateway.*` — 请求未出网关
 * - `circuit.*` — 熔断短路（未打上游）
 * - `upstream.*` — 已打上游，网关分类后透传
 *
 * 约定：body 顶层 `code`（仅网关自造错误）+ 响应头 `X-OctaFuse-Error-Code`（所有非 2xx）。
 * body 中 `error` 字段形状保持不变（字符串或既有嵌套对象），纯增量。
 */

export const GATEWAY_ERROR_CODE_HEADER = 'X-OctaFuse-Error-Code';

export const GatewayErrorCode = {
	// gateway.*
	invalidJson: 'gateway.invalid_json',
	missingModel: 'gateway.missing_model',
	modelNotFound: 'gateway.model_not_found',
	budgetExceeded: 'gateway.budget_exceeded',
	authFailed: 'gateway.auth_failed',
	noRoute: 'gateway.no_route',
	routeResolutionFailed: 'gateway.route_resolution_failed',
	invalidRequest: 'gateway.invalid_request',
	upstreamRequestFailed: 'gateway.upstream_request_failed',
	responsesStateRouteUnavailable: 'responses.state_route_unavailable',
	responsesUnsupportedStateOperation: 'responses.unsupported_state_operation',

	// circuit.*
	circuitSensitiveContent: 'circuit.sensitive_content',
	circuitClientError: 'circuit.client_error',
	circuitUpstreamCapacityExhausted: 'circuit.upstream_capacity_exhausted',

	// upstream.*
	upstreamContentFilter: 'upstream.content_filter',
	upstreamInvalidRequest: 'upstream.invalid_request',
	upstreamRateLimited: 'upstream.rate_limited',
	upstreamAuthFailed: 'upstream.auth_failed',
	upstreamNotFound: 'upstream.not_found',
	upstreamServerError: 'upstream.server_error',
	upstreamTimeout: 'upstream.timeout',
} as const;

export type GatewayErrorCodeValue = (typeof GatewayErrorCode)[keyof typeof GatewayErrorCode];
