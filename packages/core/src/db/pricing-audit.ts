/**
 * `api_key_request_logs.pricing_audit` 列：存 **JSON 字符串**（D1 / MySQL / Postgres 均为 TEXT）。
 *
 * 写入侧 `JSON.stringify`；读侧按需 `JSON.parse`。
 *
 * ## 当前形状（`v === 3`）
 * ```json
 * {
 *   "v": 3,
 *   "basis_tokens": 200000,
 *   "snapshot": {
 *     "supplier": { "path": "profile", "source": "model", "basis_tokens": 200000, "prices": { ... } },
 *     "standard": { "path": "profile", "source": "model", "basis_tokens": 200000, "prices": { ... } },
 *     "user_charge": { "path": "profile", "source": "route_nested" | "model", "basis_tokens": 200000, "prices": { ... } }
 *   }
 * }
 * ```
 * - `snapshot.user_charge`：计入预算的单价选档快照（路由 `price_override.charged` 优先，否则模型目录 `pricing_profile`）。
 * - `basis_tokens`：选档依据（上游 usage 的 input 侧 token 数）。
 */

/** 当前写入的 `pricing_audit` JSON schema 版本号。 */
export const PRICING_AUDIT_JSON_SCHEMA_VERSION = 3 as const;

/** 写入 `pricing_audit` 时的 JSON 形状参考。 */
export interface PricingAuditJson {
	v: typeof PRICING_AUDIT_JSON_SCHEMA_VERSION;
	basis_tokens?: number;
	snapshot?: Record<string, unknown>;
}
