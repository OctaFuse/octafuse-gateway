-- Provider 级默认 custom_params（按上游协议分组的 headers/body，无 force_override）。
-- 可空、无默认值；存量行一律为 NULL，等价于现状（回归基线）。
-- 运行时合并点见 packages/core/src/provider-custom-params.ts 的 resolveEffectiveCustomParams，
-- 由 packages/proxy/src/services/model-router.ts 的 routeRowToResult 调用。
ALTER TABLE providers ADD COLUMN custom_params TEXT;
