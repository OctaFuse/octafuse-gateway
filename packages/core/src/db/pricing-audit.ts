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
 *
 * ## Image 计费扩展（`snapshot` 内 `kind` 字段）
 * - **`kind: 'image_tokens'`**：OpenAI GPT Image token 分项；沿用 tier `image_*` 与 usage 分项。
 * - **`kind: 'image_per_image'`**：按张计费；典型字段：
 *   - `operation`：`generations` | `edits`
 *   - `input_image_count` / `output_image_count`：参考图 / 生成张数
 *   - `output_unit_price` / `input_unit_price`：目录选档后单价（$/张）
 *   - `result_confirmed`：上游是否确认 output 张数
 *   - `uncertain_result_policy`：`requested` | `zero`（profile `image.uncertain_result_policy`）
 *   - `usage_source`：计费张数来源（如 `response.data` / `request.n`）
 * 对应 `api_key_request_logs.billing_kind` / `input_image_count` / `output_image_count` 列。
 */

/** 当前写入的 `pricing_audit` JSON schema 版本号。 */
export const PRICING_AUDIT_JSON_SCHEMA_VERSION = 4 as const;

/** 写入 `pricing_audit` 时的 JSON 形状参考。 */
export interface PricingAuditJson {
	v: typeof PRICING_AUDIT_JSON_SCHEMA_VERSION;
	basis_tokens?: number;
	snapshot?: Record<string, unknown>;
}
