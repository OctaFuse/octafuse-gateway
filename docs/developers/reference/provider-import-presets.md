# 供应商导入模板

管理后台在供应商（Providers）页面提供「从模板导入」：预填各协议的 Base URL 或能力端点，用户导入后打开 Provider 卡片并写入真实上游 API Key。列表以卡片展示密钥状态、路由数量与协议能力，并支持按状态和协议筛选。

## 数据来源

Admin 通过 HTTPS 目录 API 导入、同步供应商和模型。默认读取[官网供应商目录](https://octafuse.dev/api/catalog/providers)和[官网模型目录](https://octafuse.dev/api/catalog/models)。按厂商查询时先请求 `/api/catalog/models-by-vendor/{vendor}`，失败时从同一服务的完整模型目录筛选。

官网模板分别在 [octafuse-website](https://github.com/OctaFuse/octafuse-website) 的 `catalog/providers.json` 和 `catalog/models/*.json` 维护，随官网发布。厂商展示名另由 Gateway 的[厂商字典](../../../packages/admin/lib/model-vendors.json)维护，官网生成目录时读取指定 Gateway 版本的字典。

供应商和模型的完整目录仅缓存在各 Admin 实例的内存中，默认有效期为 5 分钟，重启后清空。

- 缓存有效时，预览、导入和同步都可使用缓存。
- 缓存过期且刷新失败时，导入列表和同步差异预览仍可使用旧缓存。确认导入和应用同步会返回 `503`。
- 首次启动或重启后，如果目录 API 不可达，导入列表和同步差异预览也会返回 `503`。已保存的供应商仍可查看，目录相关字段会省略或显示为 `other`。已配置的模型和路由仍可正常处理请求。

内网部署可将 Admin 的 `CATALOG_BASE_URL` 设为镜像的 HTTPS 基础地址（例如 `https://catalog.example.com`）。镜像应提供 `/api/catalog/providers`、`/api/catalog/models` 和 `/api/catalog/models-by-vendor/{vendor}`。`CATALOG_TIMEOUT_MS` 和 `CATALOG_TTL_MS` 分别控制单次请求超时和完整目录缓存时长，默认值为 `3000` 和 `300000` 毫秒。以上变量均设置在 Admin 进程。使用 Compose 时见 [Docker 部署配置](../../operators/deployment/docker.md#gateway-admin-容器)。

## API

- `GET /api/admin/providers/import/catalog`（内部 `/admin/providers/import/catalog`）：返回可导入摘要，**不含**密钥。每条 `id` 使用模板英文名，写库时另行生成 `providers.id`。
- `POST /api/admin/providers/import`（内部 `/admin/providers/import`）：请求体 `{ "ids": ["DeepSeek", "Volcengine Ark"] }`。请使用目录响应提供的 `id`。旧版数组下标会返回 `409`，调用方需重新加载目录。
  - **每次导入均新增** provider 行；`providers.id` 由服务端 `crypto.randomUUID()` 生成。
  - 新行的 `providers.kind` 写成该模板的英文 `name`。显示名 `providers.name` 按请求体 `locale` 取目录名称：`zh` 写中文，`ja` 写日文，`ko` 写韩文，其余语言写英文。未传 `locale` 按英文。目录介绍不写入数据库，列表按 `kind` 附带 `kind_descriptions`。**同一 `kind` 下同名**（忽略大小写）才自动追加 `(2)`、`(3)` 等后缀。不同模板可以共用同一个账号别名。数据库唯一约束是 `(name, kind)`，比较区分大小写。
  - 新行不含 API Key，须在 UI 中打开对应卡片并手动添加后方可用于上游调用。

### 与官方模板同步

模板更新（描述、端点等）不会自动改已入库的 provider。Providers 页右上角的「检查官方更新」按钮由管理员手动触发检查（页面加载时不会自动比对），对比 `providers.kind` 对应的模板与当前行，有差异时给出提示，由管理员决定是否采用官方值。

- `GET /api/admin/providers/sync/diff`：按 `kind` 分组返回差异。比对范围是 `endpoints`（以协议为单位，行级展示 `base` / `auth` / 各 capability）。类型介绍由 `kind` 运行时解析，不入库、不比对。`note`、`name`、`api_key`、`status` 不参与比对；图标、链接、展示名由 `kind` 运行时解析，不会过期。模板要求导入后替换的部署位不算差异：`YOUR_PROJECT_ID`、`YOUR_RESOURCE_NAME`（`openai.azure.com` 与 Foundry 的 `services.ai.azure.com` 等价），以及 Vertex 模板里的 `locations/global`（改成具体区域同样视为已对齐）。这些位置之外的路径变化仍会列出；选择采用官方时，新 URL 会保留当前已经填写的项目、资源名、区域和 Azure 主机。
- `POST /api/admin/providers/sync/apply`：请求体 `{ "items": [{ "provider_id": "...", "fields": ["endpoints.openai"] }] }`。服务端重新计算差异，只处理确实存在差异的所选字段：端点按官方值覆盖（协议整体替换；官方没有而本地有的协议被选中时会移除）。不写 `note`。
- 默认选择：官方新增或变更默认「采用官方」，本地独有的项默认「保留当前」。「保留当前」不落库，下次检查仍会显示。
- `kind` 已不在模板中（模板改名或下线）的 provider 会单独列出，可在面板里迁移到新 `kind`（只改 `kind`）。这是下方「改名必须带数据迁移」的运行时补救路径。

认证与其它 Admin 路由相同：后台 Session，或具有 `providers.read` / `providers.write` 权限的 `Authorization: Bearer <ADMIN_API_KEY>`。

## 维护约定

1. **新增模板**：向官网仓库提交 PR，修改 `catalog/providers.json`，并按官网 README「供应商和模型模板」运行同步脚本，把生成的 `src/data/catalog/` 一并提交；官网发布后 Admin 在缓存刷新时读取。不要只改本仓库的 `provider-import-presets.json` 快照。英文 `name` 会写入 `providers.kind`，是稳定键：**改名必须带数据迁移**，不能只改模板。同一类型下与已有账号别名撞车时，导入会自动加后缀。
2. **核对 endpoint**：以各云厂商**当前官方文档**为准；OpenAI 可分别配置 `chat`、`responses`、Images、Audio 等能力端点，DashScope 使用独立协议配置；Gemini Vertex 兼容聚合商写完整 `{model}` 前缀并设 `gemini.auth: "bearer"`（如七牛、ZenMux）；正式 Vertex 用项目级占位 URL（`YOUR_PROJECT_ID`），OpenAI 只配 Chat Completions（`.../endpoints/openapi/chat/completions`），原生 Gemini 配 `auth: "bearer"`，密钥栏贴 **GCP 服务账号 JSON**（不是 Vertex API Key）；Azure OpenAI 的 Base 用 OpenAI v1 路径 `https://YOUR_RESOURCE_NAME.openai.azure.com/openai/v1`，Foundry 主机 `*.services.ai.azure.com` 同一路径也接受；网宿新版统一网关用 `https://api.edgecloudapp.com/v2/llm`：OpenAI 写 `.../openai` 这个 base，Anthropic Messages 写完整地址 `.../anthropic/messages`（路径里没有 `/v1`），Gemini 写 `.../gemini/v1beta/models` 并设 `auth: "bearer"`；`description` 中可提示「以控制台为准」。
3. **占位密钥**：勿改为真实密钥写入仓库；占位串为 `PROVIDER_IMPORT_PENDING_API_KEY`（定义在 `@octafuse/core/db/provider-key-utils`）。
4. **Catalog 链接**：`catalog.links.platform` 为官网；`api_keys` 为密钥管理页（可省略）；`referral` 仅在有可确认的邀请/注册 URL 时填写，**不要**用邀请链接覆盖 `platform`。Admin 与 Website 的「点击前往」出站顺序为 `referral` → `api_keys` → `platform`。管理后台从目录读取链接，`providers` 表只保存模板类型。已保存 `kind` 时只取该模板的链接；`kind` 为 `__custom__` 时不附带链接；`kind` 仍为空时，才按模板名或 endpoint 签名推断。
5. **生效**：官网发布新目录后，管理后台会在缓存刷新时读取，已入库的 provider 需要管理员手动执行「检查官方更新」。

## 与模型导入的关系

- **模型**：[OctaFuse 模型目录](https://octafuse.dev/api/catalog/models) 与 `/admin/models/import/*`（含定价分支；预设 `id` 即 gateway `models.id`）。
- **Providers**：本目录 + `/admin/providers/import/*`（仅 endpoint 与元数据，**不含**定价；入库 id 随机生成）。

二者独立；导入 Provider 后仍需配置 **model_routes** 指向对应 `provider_id`。
