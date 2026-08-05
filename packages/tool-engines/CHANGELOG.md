# @octafuse/tool-engines

## 2.1.2

### Patch Changes

- [#85](https://github.com/OctaFuse/octafuse-gateway/pull/85) [`9b7a9f6`](https://github.com/OctaFuse/octafuse-gateway/commit/9b7a9f6ddea090970d35f9b71976becd936c73f0) Thanks [@dyc87112](https://github.com/dyc87112)! - 优化 Admin 路由与 Provider 体验，请求日志补充外部系统字段，并修复干净仓库下 Admin 本地开发（Turbopack）无法解析 core 源码的问题。

  ### Admin

  - **路由列表 / 拓扑**：同优先级内按状态、权重与名称稳定排序；因子状态芯片与无障碍文案完善。
  - **路由详情**：自定义参数展示与 tooltip；布局响应式调整。
  - **Provider 卡片**：布局与按钮交互优化；移除未使用的 endpoint 复制入口。
  - **请求日志**：补充展示 `external_system`，便于区分外部系统来源。
  - **本地开发**：修复 Turbopack 下 `@octafuse/core` 源码解析，干净 checkout 可运行 `dev:admin`。

  ### Core

  - **请求日志**：读写路径补充 `external_system` 字段（D1 / Postgres / MySQL）。

  ### 升级说明

  - 数据库迁移：无
  - 配置变更：无
  - 兼容性影响：无（纯增量字段与 Admin UX）
  - 建议操作：更新 proxy / admin / migrate 三镜像后滚动重启

- Updated dependencies [[`9b7a9f6`](https://github.com/OctaFuse/octafuse-gateway/commit/9b7a9f6ddea090970d35f9b71976becd936c73f0)]:
  - @octafuse/core@2.1.2

## 2.1.1

### Patch Changes

- [`8e1f634`](https://github.com/OctaFuse/octafuse-gateway/commit/8e1f634d846cc97da4e1e47456e141103fc1d7e6) Thanks [@dyc87112](https://github.com/dyc87112)! - ### Proxy

  - **User+model 熔断**：敏感内容与普通上游 400 共用 `20s → 1m → 3m → 5m → 10m` 退避（不区分请求体）；短路用 code 区分类别（`circuit.sensitive_content` / `circuit.client_error`）。替换原独立 sensitive-content 熔断实现。
  - **Images / Audio**：退出普通 400（`client_error`）熔断，仅保留 sensitive_content 触发。
  - **Failover**：循环内复查已熔断 provider；401/403 provider 冷却由 10min 调整为 5min。
  - **错误码契约**：网关自造 / 熔断 / 上游分类错误增加固定 `code`（`gateway.*` / `circuit.*` / `upstream.*`）与响应头 `X-OctaFuse-Error-Code`；body 既有 `error` 形状纯增量。
  - **诊断**：`gateway.upstream_request_failed` 的 message 附带原始 fetch 错误摘要（与 `route_resolution_failed` 一致），便于客户端与 Langfuse 排查。

  ### Admin

  - **阿里云模型预设**：新增正式版 `qwen3.8-max` 与 `qwen3.7-flash`；同步修正 `qwen3.8-max-preview` 的缓存价 / 模态 / 输出上限；`qwen3.7-plus` / `qwen3.7-max` 的 `max_tokens` 对齐为 `128000`。

  ### 文档

  - 更新 API 与 `proxy-request-lifecycle` / `runtime-data` 说明，覆盖错误码头与 user+model 熔断行为。

- Updated dependencies [[`8e1f634`](https://github.com/OctaFuse/octafuse-gateway/commit/8e1f634d846cc97da4e1e47456e141103fc1d7e6)]:
  - @octafuse/core@2.1.1

## 2.1.0

### Minor Changes

- [`3a53d2f`](https://github.com/OctaFuse/octafuse-gateway/commit/3a53d2f1b3e11308e7d5497b895978d55c37f152) Thanks [@dyc87112](https://github.com/dyc87112)! - ### Proxy / Core

  - **Tools / AI Detection**：新增 `POST /v1/tools/ai-detection`（腾讯 TMS 引擎；按字符计费单元扣预算）。
  - **Tools / Pricing**：新增只读 `GET /v1/tools/pricing`（返回工具单价；不含引擎密钥）。
  - **工具三账本定价**：web-search / web-fetch / web-deep-search / ai-detection 统一 **metered / standard / charged**；`cost` 为 charged 兼容别名。
  - **`@octafuse/tool-engines`**：抽出共享引擎客户端包（web-search / web-fetch / web-deep-search / ai-detection）；Proxy 与 Admin Playground 共用，避免 Admin 直接依赖 Proxy 源码。

  ### Admin UI

  - **Tools**：配置页全局 secrets 显隐；调用记录展示 std / charged / metered / profit 与 engine provider。
  - **Request Logs**：区分 agent tools 与上游模型，展示引擎 provider。
  - **Playground / Simulator**：支持 AI Detection 联调。
  - **Providers**：删除时若仍被 `model_routes` 引用则拒绝，避免断路由。

  ### 文档 / 工程

  - 更新用户 / 开发者 / 运维文档与 API 说明（工具定价、AI Detection、route topology）。
  - Docker 构建纳入 `packages/tool-engines`；新增 docker-compose smoke workflow。

### Patch Changes

- Updated dependencies [[`3a53d2f`](https://github.com/OctaFuse/octafuse-gateway/commit/3a53d2f1b3e11308e7d5497b895978d55c37f152)]:
  - @octafuse/core@2.1.0
