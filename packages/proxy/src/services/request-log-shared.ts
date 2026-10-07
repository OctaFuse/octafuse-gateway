/**
 * `api_key_request_logs` 脱敏 JSON 的公共收尾：序列化 + 长度截断（协议相关的 wire 体拼装留在各 v1 路由内，便于日后按入口单独演进）。
 */
import { redactExtraFieldsForLog } from '@octafuse/core/upstream-extra-fields';

/** 与 `api_key_request_logs.request_body` / `upstream_request_body` 写入一致。 */
export const MAX_REQUEST_LOG_JSON = 16_384;

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
