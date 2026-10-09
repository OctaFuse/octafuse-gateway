/**
 * 统一构造网关自造错误响应：body `{ error: string, code }` + 响应头 `X-OctaFuse-Error-Code`。
 * 保持 `error` 为字符串，兼容老版 Agent 的 flat-error 检测。
 */
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import {
	GATEWAY_ERROR_CODE_HEADER,
	GATEWAY_REQUEST_ID_HEADER,
	type GatewayErrorCodeValue,
} from './gateway-error-codes';
export {
	classifyUpstreamErrorCode,
	withUpstreamErrorCodeHeader,
} from './upstream-error-code';

export type GatewayErrorJsonOptions = {
	status: ContentfulStatusCode;
	code: GatewayErrorCodeValue;
	message: string;
	headers?: Record<string, string>;
};

/** Hono Context：扁平 `{ error, code }` + 错误码响应头。 */
export function gatewayErrorJson(c: Context, opts: GatewayErrorJsonOptions): Response {
	return c.json(
		{ error: opts.message, code: opts.code },
		opts.status,
		{
			[GATEWAY_ERROR_CODE_HEADER]: opts.code,
			...opts.headers,
		}
	);
}

/** 非 Hono 场景（如 failover-dispatch）：同样形状的 Response。 */
export function gatewayErrorResponse(opts: GatewayErrorJsonOptions): Response {
	return new Response(JSON.stringify({ error: opts.message, code: opts.code }), {
		status: opts.status,
		headers: {
			'Content-Type': 'application/json',
			[GATEWAY_ERROR_CODE_HEADER]: opts.code,
			...opts.headers,
		},
	});
}

/** 嵌套 OpenAI 风格错误体（熔断短路等）——仍写入错误码响应头；`error.code` 使用点分 code。 */
export function gatewayNestedErrorResponse(opts: {
	status: number;
	code: GatewayErrorCodeValue;
	/** 嵌套 error 对象（可含 type / message / retry_after_seconds 等） */
	error: Record<string, unknown>;
	headers?: Record<string, string>;
}): Response {
	const body = {
		error: {
			...opts.error,
			code: opts.code,
		},
	};
	return new Response(JSON.stringify(body), {
		status: opts.status,
		headers: {
			'Content-Type': 'application/json',
			[GATEWAY_ERROR_CODE_HEADER]: opts.code,
			...opts.headers,
		},
	});
}

/**
 * 把 Gateway 请求日志主键写进响应头。不读取 body，流式响应可以原样继续。
 * 与上游透传的 `x-request-id` 分开，避免客户端把供应商 ID 当成日志 ID。
 */
export function withGatewayRequestIdHeader(response: Response, requestLogId: string): Response {
	const headers = new Headers(response.headers);
	headers.set(GATEWAY_REQUEST_ID_HEADER, requestLogId);
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}
