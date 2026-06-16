# Provider 导入模板（静态目录）

Admin 在 **Gateway Providers** 页面提供「从模板导入」：预填各协议 **base URL**，用户只需在导入后 **编辑行并写入真实上游 API Key**。

## 数据位置

| 文件 | 说明 |
|------|------|
| [`packages/admin/lib/provider-import-presets.json`](../../packages/admin/lib/provider-import-presets.json) | 模板列表（JSON 数组）；每条含 `name`、`vendor_key`、各协议 base URL、可选 `description`。 |
| [`packages/admin/lib/provider-import-preset.ts`](../../packages/admin/lib/provider-import-preset.ts) | 合并 catalog、运行时 catalog 键（数组下标）、占位密钥常量 `PROVIDER_IMPORT_PENDING_API_KEY`、`isPendingProviderImportApiKey()`。 |

`vendor_key` 必须与 [`packages/admin/lib/model-vendors.json`](../../packages/admin/lib/model-vendors.json) 中的 `key` 一致（展示名由 `model-vendor.ts` 归一化与 label）。

## API

- `GET /api/admin/providers/import/catalog`（内部 `/admin/providers/import/catalog`）：返回可导入摘要，**不含**密钥。每条 `id` 为 **catalog 行键**（JSON 数组下标字符串），**不是**入库后的 `providers.id`。
- `POST /api/admin/providers/import`（内部 `/admin/providers/import`）：请求体 `{ "ids": ["0", "1", ...] }`（catalog 键列表）。
  - **每次导入均新增** provider 行；`providers.id` 由服务端 `crypto.randomUUID()` 生成。
  - **同名**（忽略大小写）与已有 Provider 冲突时，显示名自动追加 `(2)`、`(3)` 等后缀（`providers.name` 仍 UNIQUE）。
  - 新行不含 API Key，须在 UI 中手动添加后方可用于上游调用。

认证与其它 Admin 路由相同：`Authorization: Bearer <MASTER_KEY>`。

## 维护约定

1. **新增模板**：在 `provider-import-presets.json` 追加对象；保持 `name` 可读且尽量不与常见手工命名撞车（导入时会自动去重后缀）。
2. **核对 endpoint**：以各云厂商**当前官方文档**为准；`description` 中可提示「以控制台为准」。
3. **占位密钥**：勿改为真实密钥写入仓库；占位串为 `PROVIDER_IMPORT_PENDING_API_KEY`（见 `provider-import-preset.ts`）。
4. **扩展**：按同样 JSON 结构追加供应商模板即可；**勿**在 JSON 中写 provider id（与 catalog 键无关）。

## 与模型导入的关系

- **Models**：`model-presets/*.json` + `/admin/models/import/*`（含定价分支；预设 `id` 即 gateway `models.id`）。
- **Providers**：本目录 + `/admin/providers/import/*`（仅 endpoint 与元数据，**不含**定价；入库 id 随机生成）。

二者独立；导入 Provider 后仍需配置 **model_routes** 指向对应 `provider_id`。
