---
"octafuse": minor
---

OctaFuse Gateway v2.6.0 重点完善项目级 Vertex AI 的服务账号鉴权与文生图计费，优化 Admin 路由、Playground 和 Simulator 的使用体验，同时新增多项供应商导入模板，并更新 Gemini 3.1 Flash-Lite 的模型 ID。

### Proxy

- **项目级 Vertex AI 鉴权**：在供应商凭证栏粘贴 GCP 服务账号 JSON，Gateway 会在请求发出前自动换取 OAuth 2.0 access token。Vertex AI 的 OpenAI 兼容端点（`.../endpoints/openapi`）与原生 Gemini 端点均通过 `Authorization: Bearer` 鉴权，不会将服务账号 JSON 拼接到 `?key=` 或原样发送给上游。
- **OpenAI 模型前缀**：通过 Vertex AI 的 OpenAI 兼容端点调用时，如果 `provider_model_name` 缺少 `google/`，Gateway 会自动补齐；原生 Gemini 端点保持原模型名。
- **文生图计费**：通过 `image_billing_mode` 明确区分按 Token（`token`）和按张（`per_image`）计费；客户端取消、Gateway 超时以及明确的上游错误均不扣费。仅包含旧版 `image` 块但未声明计费模式的配置不再计费。
- **每日时段计费**：新增 `schedule.mode: "override"`。命中每日时段后直接使用该时段的倍率，未命中时使用默认倍率；未设置 `mode` 的旧配置继续采用倍率叠乘规则。

### Admin

- **Vertex AI 导入模板**：新增项目级 Vertex AI 模板；导入后替换项目 ID，并在供应商凭证栏粘贴 GCP 服务账号 JSON。Playground 使用与 Proxy 相同的凭证解析和 access token 换取流程。
- **Gemini 鉴权**：供应商的 Gemini 端点可选择 `query-key` 或 `bearer`；使用服务账号时自动强制采用 Bearer 鉴权。
- **路由编辑**：优化每日时段和计费倍率的展示与编辑，明确区分默认倍率与时段覆盖倍率，并改进倍率格式和时段提示。
- **Playground / Simulator**：Playground 增加更多 LLM 请求样例、流式响应观察和 Gemini 工具调用联调能力；Simulator 可按客户端请求入口选择协议。
- **供应商导入模板**：新增 BytePlus、阿里云百炼国际站、Meta Model API、Cerebras、SambaNova、DeepInfra、Novita、Command Code、Hugging Face 和 Vercel 等模板，并补充相应图标与端点配置。
- **目录与导航**：优化模型目录、侧栏导航，以及供应商图标和端点信息的展示。
- **模型预设**：将 `gemini-3.1-flash-lite-preview` 调整为 Google 当前使用的模型 ID `gemini-3.1-flash-lite`。该模型目前仍处于预览阶段，已导入的旧模型记录不会被静态目录自动更新。

### Core

- **GCP JWT**：改进服务账号私钥的 PEM 解码和 JWT 签名，提升其在 Workers 与 Node.js 环境中的兼容性和稳定性。

### 文档

- **项目级 Vertex AI**：更新用户 API 和供应商导入文档，明确服务账号 JSON、OAuth access token 与 Bearer 鉴权流程；删除已废弃的双协议说明。
- **文生图**：补充两种计费模式、取消或超时不扣费，以及旧版配置的兼容规则。
- **界面与部署**：更新 README 截图、路由与协议配置说明，以及容器镜像发布文档。

### 升级说明

- **数据库迁移**：本版本没有数据库表结构变更。对于使用内置图片模型旧价目的 Postgres 部署，可先运行 `node scripts/db/migrate-image-billing-modes.mjs --dry-run`，确认后再运行 `--apply`。该脚本只处理已知的内置模型 ID；MySQL、D1 及自定义模型需要人工核对并补充 `image_billing_mode`。
- **发布顺序**：拉取同版本的 proxy、admin 和 migrate 镜像；按现有发布流程执行一次 migrate Job，然后滚动重启 proxy 和 admin。
- **配置变更**：项目级 Vertex AI 请在供应商凭证栏粘贴 GCP 服务账号 JSON，并替换导入模板中的 `YOUR_PROJECT_ID`；不要将 Vertex API Key 或服务账号 JSON 写入 `?key=`。
- **兼容性影响**：现有 Chat、Messages、Gemini、Images、Audio 和 Responses 接口保持不变。已导入的 `gemini-3.1-flash-lite-preview` 不会自动改名，可删除后重新导入或通过 PATCH 修改。仅包含旧版 `image` 块但未声明 `image_billing_mode` 的图片价目将不再扣费；包含有效 `image_*` Token 单价的旧配置仍按 Token 模式计费。
- **建议操作**：在 Admin 中核验 Vertex AI 服务账号的导入和鉴权，并通过 Playground 与 Simulator 验证请求；检查所有文生图模型的 `token` / `per_image` 配置，以及取消或超时不扣费的行为；如需使用新的 Flash-Lite 模型 ID，再导入 `gemini-3.1-flash-lite`。
