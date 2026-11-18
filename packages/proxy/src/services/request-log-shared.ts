/**
 * `api_key_request_logs` 脱敏 JSON 的公共收尾：序列化 + 长度截断（协议相关的 wire 体拼装留在各 v1 路由内，便于日后按入口单独演进）。
 */
import { redactExtraFieldsForLog } from '@octafuse/core/upstream-extra-fields';
import {
	configuredBodySourceCodes,
	configuredHeaderSources,
	type RequestParameterSources,
} from '@octafuse/core/request-parameter-sources';
import type { RouteResult } from './model-router';

/** 与 `api_key_request_logs.request_body` / `upstream_request_body` 写入一致。 */
export const MAX_REQUEST_LOG_JSON = 16_384;

const LOG_SUMMARY_FIELDS = new Set([
	'_contents_count', '_gemini_action', '_has_instructions', '_input_count', '_input_shape',
	'_messages_count', '_messages_shape', '_tool_names', '_tools_count',
]);

export function requestParameterSourcesForLog(
	route: RouteResult,
	userBody: Record<string, unknown>,
	upstreamBodyForLog: string | null,
	inboundHeaders: Headers,
): RequestParameterSources | undefined {
	const layers = route.customParamsLayers;
	if (!layers) return;
	if (!layers.effective) return { body: '', headers: [] };
	const headers = configuredHeaderSources(layers, inboundHeaders);
	let body: string | null = null;
	try {
		const snapshot = upstreamBodyForLog && JSON.parse(upstreamBodyForLog);
		if (snapshot && !Array.isArray(snapshot) && typeof snapshot === 'object') {
			body = configuredBodySourceCodes(layers, userBody, snapshot, ([key]) =>
				LOG_SUMMARY_FIELDS.has(key) || (route.upstreamProtocol !== 'gemini' && key === 'model'),
			);
		}
	} catch {
		// Truncated snapshots cannot be matched to a field position.
	}
	// Store only field positions and header names for the selected route, within the log body budget.
	const sources = { body, headers };
	return JSON.stringify(sources).length <= MAX_REQUEST_LOG_JSON ? sources : undefined;
}

/**
 * 将脱敏后的对象写入日志列；超长截断；序列化失败返回 null。
 */
export function finalizeRequestLogJson(out: Record<string, unknown>): string | null {
  try {
    let s = JSON.stringify(out);
    if (s.length > MAX_REQUEST_LOG_JSON) {
      s = `${s.slice(0, MAX_REQUEST_LOG_JSON)}...[truncated]`;
    }
    return s;
  } catch {
    return null;
  }
}

/** 把客户端额外字段和被恢复的受保护路径补进已经序列化的请求日志。 */
export function annotateRequestLogWithExtraFields(
	requestBodyForLog: string | null,
	extras: Record<string, unknown> | undefined,
	restoredPaths: readonly string[] | undefined,
): string | null {
	const hasExtras = extras != null && Object.keys(extras).length > 0;
	const hasRestored = restoredPaths != null && restoredPaths.length > 0;
	if (!hasExtras && !hasRestored) return requestBodyForLog;
	let base: Record<string, unknown> = {};
	if (requestBodyForLog) {
		try {
			const parsed = JSON.parse(requestBodyForLog) as unknown;
			if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
				base = parsed as Record<string, unknown>;
			}
		} catch {
			base = {};
		}
	}
	if (hasExtras) base.extra_fields = redactExtraFieldsForLog(extras) as Record<string, unknown>;
	if (hasRestored) base.restored_upstream_paths = [...restoredPaths];
	return finalizeRequestLogJson(base);
}
