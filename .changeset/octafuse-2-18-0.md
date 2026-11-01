---
"octafuse": minor
"@octafuse/core": minor
"@octafuse/tool-engines": minor
"@octafuse/proxy": minor
"@octafuse/admin": minor
---

OctaFuse Gateway v2.18.0 让第三方 MCP 客户端使用独立的 OAuth 访问令牌，并可以在后台查看和解绑路由粘性绑定。流式超时不再把上游的注释心跳当成有效输出。目录补上 GPT-6.1 Terra 和百度云模型服务 V2 的导入模板。

### Proxy

- **MCP OAuth**：新增 `GET /.well-known/oauth-protected-resource`，以及 `/mcp`、`/mcp/{slug}` 后缀形式。`/mcp*` 的 401 带 `WWW-Authenticate: Bearer resource_metadata="…"`。授权服务器地址来自 `system_config.MCP_OAUTH_AUTHORIZATION_SERVER`；未配置时不暴露元数据，401 行为不变。维护模式下元数据仍可读取。
- **OAuth 访问令牌**：第三方 MCP 凭证存入 `oauth_access_tokens`，前缀 `oat_`，只存哈希，默认 1 小时过期，只能访问 `/mcp` 与 `/mcp/*`。用于其它入口返回 403 `gateway.scope_denied`。过期或撤销后 `/mcp*` 返回 401，并带 `error="invalid_token"`。请求日志里 `api_key_id` 为空，`oauth_access_token_id` 指向令牌，按令牌所属用户扣费。`sk-` Key 在 `/mcp*` 的行为不变。
- **MCP 请求**：`/mcp*` 拒绝 JSON-RPC 批量数组，返回 400 `gateway.invalid_request`。`tools/call` 遇到空 202、缺少 `result`、响应 id 不符，或工具结果不符合 MCP 结构时，按上游失败处理且不扣费。`resources/templates/list` 返回空列表。
- **流式超时**：首包、空闲和首事件计时只认带内容的 SSE 事件，注释心跳和空行不再续命。`STREAM_FIRST_EVENT_TIMEOUT_MS` 未配置或为空时为 60 秒，配成 `0` 关闭。`STREAM_FIRST_EVENT_TIMEOUT_ROUTE_GROUPS` 为空时作用于全部路由组。后面还有未熔断候选时，首事件超时以 524 换路由；最后一个候选改由首包超时兜底。`STREAM_HEADERS_TIMEOUT_MS` 默认 60 秒：等不到上游响应头就换下一个候选；最后一个候选至少等满首包上限，全部失败返回 504。
- **Gemini 签名**：Gemini 原生入口收到 `Invalid thought signature` 的 400 时，清洗历史签名并对同一上游重试一次。没有可处理签名或其他 400 保持原有行为。
- **故障转移日志**：补充候选序号、Provider、上游目标、失败类别、熔断状态和错误摘要。`timing_metadata.attempts` 增加 `target_id`、`failure_kind` 和 HTTP 失败摘要。客户端错误响应不变。

### Admin

- **OAuth 访问令牌**：`/api/admin/oauth-access-tokens*` 支持签发、轮换、筛选、按应用统计、撤销和清理。入口在「MCP 服务」页的折叠区，以及用户详情 API Keys 页签下方。请求日志身份栏显示「OAuth 应用：名称」。权限沿用 `user_keys.read` / `user_keys.write`。
- **授权登录**：「MCP 服务」页可开关 OAuth，并保存 `MCP_OAUTH_AUTHORIZATION_SERVER`。空字符串表示关闭；其余必须是 https 源，本机开发允许 http localhost。接入指南可切换到 OAuth，给出免 Key 的登录步骤，并提示授权服务器是否已配置。
- **粘性绑定**：「Provider 粘性」分为配置、分布、明细、其他。有效期提供 1 小时（默认）、2 小时、6 小时和自定义。`GET /api/admin/routes/pools/:poolId/sticky/bindings` 列出有效绑定，可按 Provider、邮箱或用户 ID 筛选，并逐条解绑。点击粘性数字直接打开对应 Provider 的明细。批量失效只作用于本路由池，粘性开关和有效期不变。
- **路由列表**：按可用宽度使用上下或左右分区。宽屏保留名称、模型、配置摘要的层级，状态、权重、粘性和参数分开排列。
- **目录与模板**：新增 `gpt-6.1-terra`。Standard 短上下文为每百万 token 输入 $1、输出 $5，缓存读取 $0.05、30 分钟缓存写入 $1.25；输入超过 272K 时整单按长上下文计价（输入 $2、输出 $7.5，缓存读取 $0.10、30 分钟缓存写入 $2.50）。人民币价为美元刊例 ×7 的占位价。新增百度云模型服务 V2 的广州、新加坡、加利福尼亚、法兰克福模板。广州只含对话。其余三地另含图片和 Gemini 文本、生图。不含向量、音频和视频。与百度千帆分开，地域 Key 不能混用。已导入的模型和供应商不会被覆盖。

### 运维

- **生产依赖**：Next.js、OpenNext、Hono、Zod 与 MySQL 驱动等生产依赖已升级。Admin 镜像不再复制已不安装的 `denque`。

### 升级说明

- **数据库迁移**：必须应用 **0034** 和 **0035**。0034 为 `route_pool_sticky_bindings` 增加可空列 `affinity_key`。0035 新增表 `oauth_access_tokens`，并为 `api_key_request_logs` 增加可空列 `oauth_access_token_id`。D1、Postgres、MySQL 语义一致。详见 `docs/operators/migrations/0034-sticky-binding-affinity-key.md` 与 `docs/operators/migrations/0035-oauth-access-tokens.md`。
- **发布顺序**：先备份。执行 0034，再执行 0035，然后滚动更新同版本 Proxy 与 Admin。0034 未执行时，新版粘性写入会失败；请求仍会路由，但这次不记录绑定。0035 未执行时，新版请求日志写入会失败。旧版 Proxy / Admin 可以配合已迁移的库。
- **兼容性**：`MCP_OAUTH_AUTHORIZATION_SERVER` 默认未配置，OAuth 发现保持关闭。`sk-` 仍可访问 `/mcp*`。`/mcp*` 不再接受 JSON-RPC 批量数组。流式首事件超时在路由组配置为空时作用于全部路由组；只在 `default` 组灰度过的部署，升级后范围会扩大。配成 `0` 可关闭首事件超时。
- **旧绑定**：已有有效绑定继续使用。用户信息在后续成功调用续期时补全，补全前显示为「未记录用户」，不需要回填。
- **配置不自动改写**：已导入的模型价格和供应商不会被新目录覆盖。GPT-6.1 Terra 与百度云模板需要手工导入并配置路由。
- **建议操作**：升级后确认 0034、0035 已应用。需要第三方 MCP 登录时再填写授权服务器，并抽查一条粘性绑定明细。
