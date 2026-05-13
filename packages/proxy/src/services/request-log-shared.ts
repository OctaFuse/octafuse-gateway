/**
 * `api_key_request_logs` 脱敏 JSON 的公共收尾：序列化 + 长度截断（协议相关的 wire 体拼装留在各 v1 路由内，便于日后按入口单独演进）。
 */

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
