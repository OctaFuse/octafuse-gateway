/**
 * `api_key_request_logs.pricing_audit` 列：存 **JSON 字符串**（D1 / MySQL / Postgres 均为 TEXT）。
 *
 * 写入侧 `JSON.stringify`；读侧按需 `JSON.parse`。
 *
 * ## 当前形状（`v === 4`）
 * ```json
 * {
 *   "v": 4,
 *   "basis_tokens": 200000,
 *   "snapshot": {
 *     "supplier": {
 *       "path": "profile",
 *       "source": "model_x_factor",
 *       "basis_tokens": 200000,
 *       "base_factor": 1.0,
 *       "schedule": { "timezone": "Asia/Shanghai", "local_time": "07:15", "evaluated_at_utc": "2026-07-09T23:15:00.000Z", "factor": 0.5, "window": { ... } },
 *       "effective_factor": 0.5,
 *       "prices": { ... }
 *     },
 *     "standard": { "path": "profile", "source": "model", "basis_tokens": 200000, "prices": { ... } },
 *     "user_charge": { "...": "same shape as supplier" }
 *   }
 * }
 * ```
 * - `snapshot.user_charge` / `supplier`：目录选档 × base_factor × schedule_factor 后的单价。
 * - `basis_tokens`：选档依据（上游 usage 的 input 侧 token 数）。
 */

/** 当前写入的 `pricing_audit` JSON schema 版本号。 */
export const PRICING_AUDIT_JSON_SCHEMA_VERSION = 4 as const;

/** 写入 `pricing_audit` 时的 JSON 形状参考。 */
export interface PricingAuditJson {
	v: typeof PRICING_AUDIT_JSON_SCHEMA_VERSION;
	basis_tokens?: number;
	snapshot?: Record<string, unknown>;
}
