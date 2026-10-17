# Provider 导入模板（静态目录）

Admin 在 **Providers** 页面提供「从模板导入」：预填各协议的 Base URL 或能力端点，用户导入后打开 Provider 卡片并写入真实上游 API Key。列表以卡片展示密钥状态、路由数量与协议能力，并支持按状态和协议筛选。

## 数据位置

| 文件 | 说明 |
|------|------|
| [`packages/admin/lib/provider-import-presets.json`](../../../packages/admin/lib/provider-import-presets.json) | 模板列表（JSON 数组）；每条含 `name`、`vendor_key`、各协议 base URL、可选 `description`。 |
| [`packages/admin/lib/provider-import-preset.ts`](../../../packages/admin/lib/provider-import-preset.ts) | 合并 catalog、运行时 catalog 键（数组下标）、占位密钥常量 `PROVIDER_IMPORT_PENDING_API_KEY`、`isPendingProviderImportApiKey()`。 |

`vendor_key` 必须与 [`packages/admin/lib/model-vendors.json`](../../../packages/admin/lib/model-vendors.json) 中的 `key` 一致（展示名由 `model-vendor.ts` 归一化与 label）。

## API

- `GET /api/admin/providers/import/catalog`（内部 `/admin/providers/import/catalog`）：返回可导入摘要，**不含**密钥。每条 `id` 为 **catalog 行键**（JSON 数组下标字符串），**不是**入库后的 `providers.id`。
- `POST /api/admin/providers/import`（内部 `/admin/providers/import`）：请求体 `{ "ids": ["0", "1", ...] }`（catalog 键列表）。
  - **每次导入均新增** provider 行；`providers.id` 由服务端 `crypto.randomUUID()` 生成。
  - 新行的 `providers.kind` 写成该模板的英文 `name`。显示名 `providers.name` 和 `description` 按请求体 `locale` 取目录文案：以 `zh` 开头写入中文名称和摘要，其余语言写入英文。未传 `locale` 按英文。**同一 `kind` 下同名**（忽略大小写）才自动追加 `(2)`、`(3)` 等后缀。不同模板可以共用同一个账号别名。数据库唯一约束是 `(name, kind)`，比较区分大小写。
  - 新行不含 API Key，须在 UI 中打开对应卡片并手动添加后方可用于上游调用。

### 与官方模板同步

模板更新（描述、端点等）不会自动改已入库的 provider。Providers 页右上角的「检查官方更新」按钮由管理员手动触发检查（页面加载时不会自动比对），对比 `providers.kind` 对应的模板与当前行，有差异时给出提示，由管理员决定是否采用官方值。

- `GET /api/admin/providers/sync/diff?locale=zh`：按 `kind` 分组返回差异。比对范围只有 `description` 与 `endpoints`（以协议为单位，行级展示 `base` / `auth` / 各 capability）。`description` 的官方值是该 `locale` 的目录摘要（`zh` 开头为中文，其余为英文）；另一种语言的介绍会显示为差异，采用官方时写回这一语言。`name`、`api_key`、`status` 不参与比对；图标、链接、展示名由 `kind` 运行时解析，不会过期。模板要求导入后替换的部署位不算差异：`YOUR_PROJECT_ID`、`YOUR_RESOURCE_NAME`（`openai.azure.com` 与 Foundry 的 `services.ai.azure.com` 等价），以及 Vertex 模板里的 `locations/global`（改成具体区域同样视为已对齐）。这些位置之外的路径变化仍会列出；选择采用官方时，新 URL 会保留当前已经填写的项目、资源名、区域和 Azure 主机。
- `POST /api/admin/providers/sync/apply`：请求体 `{ "items": [{ "provider_id": "...", "fields": ["description", "endpoints.openai"] }] }`。服务端重新计算差异，只处理确实存在差异的所选字段，按官方值覆盖（协议整体替换；官方没有而本地有的协议被选中时会移除）。
- 默认选择：官方新增或变更默认「采用官方」，本地独有的项默认「保留当前」。「保留当前」不落库，下次检查仍会显示。
- `kind` 已不在模板中（模板改名或下线）的 provider 会单独列出，可在面板里迁移到新 `kind`（只改 `kind`）。这是下方「改名必须带数据迁移」的运行时补救路径。

认证与其它 Admin 路由相同：后台 Session，或具有 `providers.read` / `providers.write` 权限的 `Authorization: Bearer <ADMIN_API_KEY>`。

## 维护约定

1. **新增模板**：在 `provider-import-presets.json` 追加对象。英文 `name` 会写入 `providers.kind`，是稳定键：**改名必须带数据迁移**，不能只改 JSON。同一类型下与已有账号别名撞车时，导入会自动加后缀。
2. **核对 endpoint**：以各云厂商**当前官方文档**为准；OpenAI 可分别配置 `chat`、`responses`、Images、Audio 等能力端点，DashScope 使用独立协议配置；Gemini Vertex 兼容聚合商写完整 `{model}` 前缀并设 `gemini.auth: "bearer"`（如七牛、ZenMux）；正式 Vertex 用项目级占位 URL（`YOUR_PROJECT_ID`），OpenAI 只配 Chat Completions（`.../endpoints/openapi/chat/completions`），原生 Gemini 配 `auth: "bearer"`，密钥栏贴 **GCP 服务账号 JSON**（不是 Vertex API Key）；Azure OpenAI 的 Base 用 OpenAI v1 路径 `https://YOUR_RESOURCE_NAME.openai.azure.com/openai/v1`，Foundry 主机 `*.services.ai.azure.com` 同一路径也接受；`description` 中可提示「以控制台为准」。
3. **占位密钥**：勿改为真实密钥写入仓库；占位串为 `PROVIDER_IMPORT_PENDING_API_KEY`（见 `provider-import-preset.ts`）。
4. **Catalog 链接**：`catalog.links.platform` 为官网；`api_keys` 为密钥管理页（可省略）；`referral` 仅在有可确认的邀请/注册 URL 时填写，**不要**用邀请链接覆盖 `platform`。Admin 与 Website 的「点击前往」出站顺序为 `referral` → `api_keys` → `platform`。链接只存在静态预设中，不写入 `providers` 表。已保存 `kind` 时只取该模板的链接；`kind` 为 `__custom__` 时不附带链接；`kind` 仍为空时，才按模板名或 endpoint 签名推断。
5. **扩展**：按同样 JSON 结构追加供应商模板即可；**勿**在 JSON 中写 provider id（与 catalog 键无关）。

## 与模型导入的关系

- **Models**：`model-presets/*.json` + `/admin/models/import/*`（含定价分支；预设 `id` 即 gateway `models.id`）。
- **Providers**：本目录 + `/admin/providers/import/*`（仅 endpoint 与元数据，**不含**定价；入库 id 随机生成）。

二者独立；导入 Provider 后仍需配置 **model_routes** 指向对应 `provider_id`。
