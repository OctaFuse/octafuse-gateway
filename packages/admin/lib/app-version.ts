/**
 * Admin UI / internal API 展示的版本号，与 `packages/admin/package.json` 的 `version` 一致（随 Changesets 发版 bump）。
 */
import pkg from "../package.json";

export const adminAppVersion = pkg.version;
