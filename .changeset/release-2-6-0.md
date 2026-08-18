---
"octafuse": minor
---

OctaFuse Gateway v2.6.0 将项目级 Vertex 收口为 GCP 服务账号 JSON 统一换 OAuth，并整理文生图双模式计费、Admin 路由 / 调试台体验，以及 Gemini 3.1 Flash Lite 目录标识。

### Proxy

- **项目级 Vertex 服务账号**：凭证栏粘贴 GCP 服务账号 JSON；出站前换成 OAuth access token，官方 OpenAI（`.../endpoints/openapi`）与原生 Gemini 共用 Bearer。服务账号不会以 `?key=` 或原始 JSON 出站。
- **OpenAI 模型前缀**：Vertex OpenAI 的 `provider_model_name` 缺少 `google/` 时自动补齐（原生 Gemini 不加）。
- **文生图计费**：显式 `image_billing_mode`（`token` / `per_image`）；客户端取消与 Gateway 超时改为零费用；无显式 mode 的 legacy `image` 块不计费。

### Admin

- **Vertex 导入模板**：项目级 Vertex 导入要求粘贴服务账号 JSON；Playground 走同一套凭证解析。
- **Gemini 鉴权**：供应商 Gemini 端点可配置 `query-key` / `bearer`；服务账号强制 Bearer。
- **路由编辑**：每日时段与倍率展示 / 编辑体验整理（含 factor 格式化与时段提示）。
- **调试台 / 模拟器**：Playground 增强 LLM 样例、流式观察与 Gemini 工具联调；Simulator 按客户端请求入口选择协议。
- **目录与导航**：模型目录、侧栏与供应商模板的图标 / 端点展示整理。
- **模型预设**：`gemini-3.1-flash-lite-preview` 更名为正式 id `gemini-3.1-flash-lite`（已导入旧行不会被静态目录覆盖）。

### Core

- **GCP JWT**：服务账号 JSON 的 PEM 解码与 JWT 签名在 Workers / Node 上更稳健。

### 文档

- **项目级 Vertex**：用户接口与导入模板改为服务账号 JSON + Bearer；删除已废弃的 dual protocol 说明。
- **文生图**：计费双模式、取消 / 超时零费用与 legacy 不计费规则写入 image-models。
- **界面与部署**：README 截图、路由 / 协议配置与容器镜像发布说明同步。

### 升级说明

- **数据库迁移**：无 schema 版本变更。已部署库若仍使用文生图 legacy `image` 块，可先 `node scripts/db/migrate-image-billing-modes.mjs --dry-run`，确认后再 `--apply`。
- **发布顺序**：更新 proxy / admin / migrate 三镜像后滚动重启即可。
- **配置变更**：项目级 Vertex 请在供应商密钥栏粘贴 GCP 服务账号 JSON，并替换导入模板中的 `YOUR_PROJECT_ID`；不要继续把 Vertex API Key 或原始 JSON 写入 `?key=`。
- **兼容性影响**：既有 Chat / Messages / Gemini / Images / Audio / Responses 入口不变。已导入的 `gemini-3.1-flash-lite-preview` 行不会被自动改名，需删后 re-import 或手工 PATCH。无显式 `image_billing_mode` 的旧图片价目将停止扣费，直到补齐 mode 或跑上述脚本。
- **建议操作**：在 Admin 核验 Vertex 服务账号导入与 Playground / Simulator；对文生图模型确认 `token` / `per_image` 计费与取消 / 超时零费用；需要新 Flash Lite id 时再导入 `gemini-3.1-flash-lite`。
