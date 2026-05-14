# Provider 导入模板（静态目录）

Admin 在 **Gateway Providers** 页面提供「从模板导入」：预填各协议 **base URL**，用户只需在导入后 **编辑行并写入真实上游 API Key**。

## 数据位置

| 文件 | 说明 |
|------|------|
| [`packages/admin/lib/provider-import-presets.json`](../../packages/admin/lib/provider-import-presets.json) | 模板列表（JSON 数组）；每条含稳定 `id`、`name`、`vendor_key`、各协议 base URL、`description`。 |
| [`packages/admin/lib/provider-import-preset.ts`](../../packages/admin/lib/provider-import-preset.ts) | 合并 catalog、占位密钥常量 `PROVIDER_IMPORT_PENDING_API_KEY`、`isPendingProviderImportApiKey()`。 |

`vendor_key` 必须与 [`packages/admin/lib/model-vendors.json`](../../packages/admin/lib/model-vendors.json) 中的 `key` 一致（展示名由 `model-vendor.ts` 归一化与 label）。

## API

- `GET /api/admin/providers/import/catalog`（内部 `/admin/providers/import/catalog`）：返回可导入摘要，**不含**密钥。
- `POST /api/admin/providers/import`（内部 `/admin/providers/import`）：请求体 `{ "ids": ["template-id", ...] }`。
  - **同 `id` 已存在**：跳过，记入 `skipped_existing`（不覆盖）。
  - **同名**（忽略大小写）与已有 Provider 冲突：记入 `failed`（不插入）。
  - 新行写入占位 API Key，须在 UI 中 **PATCH** 为真实密钥后方可用于上游调用。

认证与其它 Admin 路由相同：`Authorization: Bearer <MASTER_KEY>`。

## 维护约定

1. **新增模板**：在 `provider-import-presets.json` 追加对象；`id` 稳定且全局唯一；`name` 在库中 `UNIQUE`，避免与常见手工命名撞车。
2. **核对 endpoint**：以各云厂商**当前官方文档**为准；`description` 中可提示「以控制台为准」。
3. **占位密钥**：勿改为真实密钥写入仓库；占位串为 `PROVIDER_IMPORT_PENDING_API_KEY`（见 `provider-import-preset.ts`）。
4. **扩展**：按同样 JSON 结构追加供应商模板即可。

## 与模型导入的关系

- **Models**：`model-presets/*.json` + `/admin/models/import/*`（含定价分支）。
- **Providers**：本目录 + `/admin/providers/import/*`（仅 endpoint 与元数据，**不含**定价）。

二者独立；导入 Provider 后仍需配置 **model_routes** 指向对应 `provider_id`。
