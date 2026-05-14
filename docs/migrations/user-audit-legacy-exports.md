# User audit：已移除的兼容导出

以下符号已从 **`@octafuse/core`** 移除（本仓库内已无引用）。若外部项目仍使用，请按下表迁移。

| 已移除 | 请改用 |
|--------|--------|
| `mergeUserAuditMetadata` | `mergeUserAuditChangePayload`（[`packages/core/src/db/user-audit-metadata.ts`](../../packages/core/src/db/user-audit-metadata.ts)） |
| 子路径 `@octafuse/core/db/user-audit-legacy-mapper` 及其中 `insertParamsFromCreateKeyAudit`、`insertParamsFromBudgetTx`、`insertParamsFromUsageCharge`、`insertParamsFromFullLegacy` | [`user-budget-audit-mapper`](../../packages/core/src/db/user-budget-audit-mapper.ts)：`userBudgetAuditToInsertRowForCreateKey`、`userBudgetAuditToInsertRowForBudgetTx`、`userBudgetAuditToInsertRowForUsageCharge`、`userBudgetAuditToInsertRowFull` |
| `InsertApiKeyBudgetAuditLogParams`（原由 `api-key-budget-audit-logs-types` 再导出） | `InsertUserBudgetAuditLogParams`（[`packages/core/src/db/user-budget-audit-params.ts`](../../packages/core/src/db/user-budget-audit-params.ts)，主入口 `@octafuse/core` 已 `export *`） |
