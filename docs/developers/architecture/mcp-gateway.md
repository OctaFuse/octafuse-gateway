# MCP 聚合入口

代理服务（Proxy）对外提供一个无会话的 MCP Streamable HTTP 入口。客户端只配置网关地址和用户 API Key，就能使用管理后台（Admin）已经审核过的远程 MCP 服务（MCP Servers）。

智能体工具（Agent Tools）的 REST 入口 `/v1/tools/*` 保持不变。MCP 入口只转发管理员接入的远程服务，不把现有 REST 工具改写成 MCP。

## 入口

| 路径 | 作用 |
|------|------|
| `POST /mcp` | 聚合所有已启用服务的工具、提示词和资源 |
| `POST /mcp/{slug}` | 只暴露这一个服务 |

认证接受 `Authorization: Bearer sk-...`；OAuth 客户端使用独立的 `oat_` 访问令牌，见下文授权发现。不签发 `Mcp-Session-Id`。`GET` 与其它非 `POST` 方法返回 `405`。协议版本至少支持 `2025-06-18` 和 `2025-03-26`。

`initialize` 和 `ping` 由网关直接应答。`tools/list`、`prompts/list`、`resources/list` 只读已发布快照，不访问上游。`tools/call`、`prompts/get`、`resources/read` 按名称或 URI 找到所属服务后再转发。

## 命名空间

协议中的 `tools`、`prompts`、`resources` 数组是平铺目录，通过名称前缀和资源 URI 标识来源服务。管理后台的 MCP 服务页提供“对外目录测试”：输入 Proxy 基础地址和用户 API Key，可请求全部服务或单个服务的 `tools/list`、`prompts/list`、`resources/list`、`initialize`。服务详情中的入口默认选中当前服务。

测试由浏览器直接请求 Proxy，展示实际 JSON-RPC 响应、HTTP 状态、耗时和可读响应头；按服务分组只是展示方式，不修改协议响应。Key 只在当前弹窗中保存，复制的 cURL 使用占位符。页面可选择已有用户 Key，且不会调用工具、同步上游或修改服务配置。

`slug` 是服务标识：1–40 个小写字母、数字和连字符，创建后不可改。`builtin` 为保留字。

- 工具名和提示词名对外是 `{slug}__{原名}`。超过 64 个字符时截断，并在末尾加短 hash。
- 资源 URI 对外改写为 `octafuse://{slug}/{encodeURIComponent(原 URI)}`，读取时再还原。
- 请求日志中的模型 ID 为 `mcp:{slug}/{原工具名}`，`provider_id` 为 `octafuse-mcp`。

## 会话

对客户端无会话。每个请求按当前快照新建服务实例，Cloudflare Workers 与 Node 使用同一套处理。

对上游：如果上游返回会话 ID，按服务缓存在当前进程内存里，并带上上游地址和鉴权头的指纹。地址或鉴权头变化、收到 `404`，都会重新 `initialize` 并重试一次。上游通知直接丢弃。上游发起的反向请求（sampling、elicitation、roots）不支持。进程之间不共享这份缓存。

## 快照与审核

同步由管理员手动触发。网关对上游执行 `initialize`，再按 `nextCursor` 拉全 `tools/list`、`prompts/list`、`resources/list`。上游返回方法不存在（JSON-RPC `-32601`）时，该项视为空目录。

- 新条目默认停用，管理员启用后才出现在客户端清单里。
- 已启用条目的说明或参数结构发生变化时，已发布定义保持不变，变更写入待审核字段。客户端在管理员接受变更之前仍看到旧说明。
- 上游删除的条目标记为已移除。
- 本次差异写在该服务的 `last_sync_summary`，并随同步接口返回。

## 计费

当前仅支持 `request` 按次计费：每次成功的 `tools/call` 固定计 1 单元，标准价作为基准，用户收费 = 标准价 × 用户倍率，供应成本 = 标准价 × 供应倍率。参数、结果条数、页数和上游返回的用量不参与计价。用户倍率为 0 表示用户免费，仍记录供应成本；标准价为 0 时三个金额均为 0。提示词和资源不计费，也不写请求日志。

服务保存默认价格，工具可以保存独立价格；工具价格整组替换服务默认价格。管理后台在“计费规则”集中维护标准价、用户倍率和供应倍率，服务与工具共用同一编辑器；免费选项将用户倍率设为 0，按次选项恢复用户倍率（默认 1），供应倍率默认 1。高级设置仅维护超时与响应大小。

计费配置继续存放在原有 `pricing` JSON 文本列中：

```json
{
  "v": 2,
  "unit": "request",
  "standard": 0.01,
  "chargedFactor": 1.2,
  "meteredFactor": 0.8,
  "config": {}
}
```

- `v` 是计费配置格式版本。
- `unit` 选择计费模式；当前只有 `request`。
- `standard` 是每单元的基准价格，保存时舍入到六位小数。
- `chargedFactor` 与 `meteredFactor` 是非负有限倍率，省略时为 1，可为 0 或大于 1，保留倍率精度。计算得到的收费与成本分别舍入到六位小数，只有用户收费扣额度。
- 新配置只保存基准价和倍率，三个账本金额由 `resolveMcpUnitPrices` 调用 REST 与 MCP 共用的 `resolveToolFactorPrices` 计算；上述示例用户收费 0.012，供应成本 0.008。
- `config` 保存模式自己的配置。`request` 无额外配置，必须为空对象。

调用前按单次价格检查余额；成功后结算 1 request，先扣周期额度，再扣永久额度。余额不足时不请求上游、不扣费。上游传输失败、超时或结果 `isError: true` 时记录错误日志，单元数和三个金额均为 0。免费成功调用也写日志。模型专用的 `users.charged_cost_factors` 不作用于 MCP 工具；MCP 的用户倍率来自当前服务或工具规则。

日志沿用 `fixed_tool_cost` 审计结构，`unit` 为 `request`，成功时 `billing_units` 为 1；`mcp_pricing` 记录规则来源（工具或服务）、规则版本、计费模式、预检单元数和成功结算单元数，v2 额外记录当次用户倍率与供应倍率。工具清单的 `_meta.octafuse` 返回计费模式及三个单价，成功结果返回本次单元数、实际扣费和请求日志 ID。

### 兼容已有配置

旧版 v1 三个独立单价的 JSON 继续直接读取、按原金额结算，API 读写也保留 v1，不自动改写已存数据。兼容早期按次 JSON（`unit=request`、`base=1`、空 `terms` / `guards`、空上下限及预估值）。管理界面在金额可无损转换时生成倍率草稿，保存为 v2；标准价为 0 但收费或成本非零等无法无损转换的情况，会提示重新定价并要求完整填写，保存前仍按原价格执行。无需修改数据库字段或迁移数据。旧复杂规则或未知模式会明确报不支持；不会静默转换成按次或免费。对应工具在重新保存有效价格前拒绝调用。

### 扩展新的计费模式

`packages/core/src/mcp/pricing.ts` 保留 `McpPricingMode` 接口和静态模式注册表，当前仅注册 `request`。后续增加一种模式时：

1. 实现 `parseConfig`、`preflight` 和 `settle`，验证该模式的配置并计算调用前及成功后的单元数。
2. 将模式注册到 `PRICING_MODES`，用新的 `unit` 标识选择它。
3. 将模式所需的参数放进 `config`，补充 API、界面和真实收费规则的测试。

模式内部配置留在已有 JSON 列里，增加模式无需新增数据库字段，也无需迁移已存的 request 配置。当前没有分档、数量、自报用量、参数护栏、上下限或试算实现。

`/mcp` 跳过额度预检，余额为 0 时仍可列出清单。每分钟请求数只统计 `tools/call`。

## OAuth 授权

Gateway 是 MCP 的资源服务器，同时可以内置 OAuth 授权服务器，让 ChatGPT、Claude、Codex 这类只支持 OAuth 的客户端无需复制 API Key 就能接入。OAuth 与 API Key 并存：客户端能在请求头带 `sk-` Key 时不需要 OAuth。

### 三种模式

由 `system_config` 决定，Admin「MCP 服务」页顶部「OAuth 2.0 授权登录（可选）」卡片可切换，也可用 `PUT /api/admin/config`：

| 模式 | 配置 | 行为 |
|------|------|------|
| 内置 | `MCP_OAUTH_ISSUER` 非空（本 Gateway 的公开 https 源，localhost 可用 http） | Gateway 自己是授权服务器：动态注册、授权、换令牌、刷新、撤销。`MCP_OAUTH_AUTHORIZATION_SERVER` 被忽略 |
| 外部 | 仅 `MCP_OAUTH_AUTHORIZATION_SERVER` | Gateway 只公开资源元数据，把客户端指向外部授权服务器；令牌由外部服务器经 Admin API 签发 |
| 关闭 | 两者都为空 | 不公开 OAuth 发现 |

回滚到外部模式只需清空 `MCP_OAUTH_ISSUER`。内置模式下可选 `MCP_OAUTH_CONSENT_URL`：指向你自己的登录与同意页；留空则使用 Gateway 内置确认页（用户粘贴自己的 `sk-` Key 证明身份并点同意，Key 不存储不回显）。另一个可选项 `MCP_OAUTH_CIMD_ENABLED=true` 开启客户端元数据文档，见下文「客户端类型」。

### 对象模型

- **应用（`oauth_apps`）**：运营在 Admin 维护的目录条目，如 ChatGPT、Codex。字段含 `slug`、`name`、回调规则 `redirect_uris`、可选的客户端名称关键字 `client_name_patterns`、`enabled`。Admin 提供 ChatGPT、Claude、Claude Code、Codex、Cursor、VS Code、Gemini CLI、豆包、WorkBuddy 预设，以及兜底的「Local MCP clients」（任意本机回环回调）。
- **注册实例（`oauth_clients`）**：一个 `client_id`。来源 `registration_method` 有三种：`dcr`（动态注册，RFC 7591，前缀 `octa_`）、`manual`（运营在 Admin 手工签发）、`cimd`（`client_id` 本身是元数据文档的 https 地址）。一个应用下可以有很多实例，Admin 与用户界面按应用汇总。7 天未使用的 `dcr` / `cimd` 实例会被清理，手工签发的实例不清理，随应用删除。
- **授权（`oauth_access_tokens`）**：一行 = 一次授权（用户 × 应用实例），含访问令牌哈希（`oat_`，1 小时）、刷新令牌哈希（`ort_`，30 天，一次性）和 `app_id`。
- **授权请求（`oauth_authorization_requests`）**：`/oauth/authorize` 落库的待决请求（10 分钟有效），同意后写入一次性授权码（10 分钟，用后作废）。

### 回调规则与归属

应用的回调规则每行一条，可以是：

| 写法 | 含义 |
|------|------|
| `https://chatgpt.com/connector_platform_oauth_redirect` | 具体地址，精确匹配 |
| `http://127.0.0.1/callback`、`http://localhost/callback`、`http://[::1]/callback` | 本机回环，忽略端口（RFC 8252），路径仍须一致 |
| `cursor://anysphere.cursor-mcp/oauth/callback` | 自定义 scheme（原生应用），精确匹配 |
| `https://*.workbuddy.cn` | 任意子域、任意路径；只允许 https，`*.` 后至少两级域名，不匹配裸域名 |
| `http://127.0.0.1/*`、`cursor://anysphere.cursor-mcp/*` | 末尾 `*` 按路径前缀匹配 |

通配只能写在 Admin 的应用规则里。客户端注册时提交的回调必须是具体地址：https、本机回环 http 或自定义 scheme，不能含 `*`、片段或用户信息，`javascript:`、`data:`、`file:` 等危险 scheme 一律拒绝。

注册时把客户端的全部回调与启用的应用逐一比较，按以下顺序归属：

1. 只有一个应用覆盖全部回调：归它。
2. 多个应用都覆盖：客户端名称命中某应用的 `client_name_patterns`（不区分大小写的子串）的优先。
3. 否则在没有名称关键字的应用里，取匹配最精确且唯一的一个（具体地址优先于通配）。仍无法区分则拒绝注册。

所以「Local MCP clients」这类通配应用只接住其它应用都没认领的本机客户端，不会抢走 Codex、Claude Code 的注册。`client_name` 由客户端自报，只用来在共用回调的应用之间分流和展示，不作为信任依据。被拒绝的注册会在 Proxy 日志里记一条 `[Gateway OAuth] registration rejected`（含客户端名称与回调），运营据此补充应用规则。

### 客户端类型

| 类型 | 怎么来 | 令牌端点认证 | PKCE |
|------|--------|--------------|------|
| 公开客户端 | 动态注册，`token_endpoint_auth_method=none`（默认） | 只带 `client_id` | 必须，仅 `S256` |
| 机密客户端 | 动态注册时声明 `client_secret_basic` 或 `client_secret_post`，响应里一次性返回 `client_secret`（前缀 `ocs_`，`client_secret_expires_at: 0`） | `client_secret_basic` 或 `client_secret_post` 都接受 | 可选；带了就按 `S256` 校验 |
| 手工客户端 | 运营在 Admin 某应用下「手工凭据」签发固定 `client_id` + `client_secret`，可重置、删除 | 同上 | 同上 |
| 元数据文档客户端（CIMD） | `client_id` 是一个 https 地址，Gateway 抓取该地址上的 JSON 元数据代替注册 | 只能是 `none` | 必须 |

- secret 只存 SHA-256 哈希，比较用常量时间。认证失败返回 401 `invalid_client`，用了 Basic 时带 `WWW-Authenticate: Basic`。
- 手工客户端适合服务端托管、不做动态注册的平台（例如要求填写「服务端认证」client_id / client_secret 的连接器）。它的回调规则为空时沿用所属应用的规则，否则只认自己的规则；同样支持通配。
- CIMD（MCP 2025-11-25）默认关闭，在「OAuth 2.0 授权登录」卡片里勾选或设 `MCP_OAUTH_CIMD_ENABLED=true` 开启，开启后元数据会声明 `client_id_metadata_document_supported: true`。抓取限制：只接受规范化的 https 地址（有路径、默认端口、域名而非 IP，排除 `localhost`、`.local`、`.internal` 等内网后缀），不跟随重定向，5 秒超时，最大 64 KB，必须 200；文档里的 `client_id` 必须等于地址，不能带 `client_secret`，回调必须命中某个启用应用。抓取结果缓存 1 小时，过期后重新抓取，抓取失败时沿用旧记录。限制：不做 DNS 解析层面的校验，指向内网地址的公网域名（DNS rebinding）无法挡住；部署在可访问敏感内网的环境时，应在出口网络层限制或保持关闭。

### 端点（Proxy）

- `GET /.well-known/oauth-authorization-server`：RFC 8414 元数据，声明 PKCE `S256`、`authorization_code` 与 `refresh_token`、令牌与撤销端点认证方式 `none` / `client_secret_basic` / `client_secret_post`、支持 `iss`（RFC 9207）。按 RFC 8414 路径后缀拼接的 `/.well-known/oauth-authorization-server/mcp[/{slug}]` 与 `/mcp/.well-known/oauth-authorization-server` 返回同一份文档。
- `POST /oauth/register`：动态注册，支持公开客户端与机密客户端。
- `GET /oauth/authorize`：校验参数后落授权请求，跳转到同意页（`MCP_OAUTH_CONSENT_URL` 或内置页），附 `request_id`。PKCE 只接受 `S256`，机密客户端可以不带；提供 `resource`（RFC 8707）时须是本 Gateway 的 `/mcp` 或 `/mcp/{slug}`。开启 CIMD 时，`client_id` 为 https 地址会在这里抓取元数据。
- `GET|POST /oauth/consent`：内置确认页（配置了外部同意页时返回 404）。
- `POST /oauth/token`：授权码换令牌、刷新令牌轮换，先认证客户端再消费授权码。已使用过的刷新令牌再次出现（重放）视为泄露，整个授权被撤销。
- `POST /oauth/revoke`：RFC 7009，接受访问令牌或刷新令牌，撤销的都是整个授权。
- `GET /.well-known/oauth-protected-resource[/mcp[/{slug}]]` 与 `/mcp/.well-known/oauth-protected-resource`：RFC 9728 资源元数据，`authorization_servers` 指向授权服务器，`scopes_supported: ["mcp"]`。

上述发现文档在维护模式下仍可读取。反向代理需要把 `/oauth/*`、`/.well-known/oauth-authorization-server*`、`/.well-known/oauth-protected-resource*` 与 `/mcp*` 转发到 Proxy；客户端报「OAuth 发现失败」时，先用 `curl` 逐个确认这些地址返回 200 的 JSON，且 `issuer` 与 `MCP_OAUTH_ISSUER` 一致。授权服务器接口有按 IP 的限流。

### 同意页（门户集成）

外部同意页只负责登录与让用户确认，不再保存 OAuth 状态：

1. Gateway 把用户带到 `MCP_OAUTH_CONSENT_URL?request_id=…`。
2. 同意页确认用户登录后，用集成密钥（权限 `oauth.consent`）调用 `GET /api/admin/oauth/authorization-requests/:id` 取客户端与应用名称展示。
3. 用户决定后调用 `POST …/accept`（body `{"user_id": "<路由 id>"}`，如 `ext:soloent:<uuid>`）或 `POST …/reject`，响应里的 `redirect_uri` 即要 303 跳回客户端的完整地址（含 `code`、`state`、`iss`）。

授权请求不存在、已过期或已处理时返回带稳定 `code` 的错误。

### 令牌与调用

- 访问令牌是 **OAuth 访问令牌**，不是用户的 `sk-` Key，存在独立表，前缀 `oat_`，只存 SHA-256 哈希，默认 1 小时过期，只能访问 `/mcp` 与 `/mcp/*`，用在其它入口返回 403 `gateway.scope_denied`。`sk-` Key 与访问令牌在 `/mcp*` 都能用，Proxy 按前缀区分，不读任何 metadata。
- `/mcp*` 的 401 带 `WWW-Authenticate: Bearer resource_metadata="<origin>/.well-known/oauth-protected-resource<path>", scope="mcp"`；令牌过期或已撤销时再带 `error="invalid_token"`，客户端据此刷新。其它入口的 401 不变。
- 访问令牌的调用写请求日志时 `api_key_id` 为空、`oauth_access_token_id` 指向令牌，Admin 请求日志显示「OAuth 应用：名称」。调用按令牌所属用户的预算与钱包扣费，每分钟请求数只受用户级限制。
- 外部模式下，令牌由授权服务器经 Admin API 签发与轮换（`POST /api/admin/users/:id/oauth-access-tokens`、`POST /api/admin/oauth-access-tokens/:id/rotate`），明文只在响应里出现一次；这类授权没有刷新令牌。
- 撤销是软删除，清空哈希并保留应用名，供日志显示。

### 运维

- Admin「MCP 服务」页：「OAuth 访问令牌」折叠区按应用汇总（用户数、实例数、有效授权、最近使用），可新增 / 编辑 / 停用 / 删除应用、从预设导入、为应用签发手工凭据（Manual credentials）、撤销某应用全部授权、清理过期记录；授权明细可按应用 / 用户 / 状态（有效、可续期、已过期、已撤销）筛选。旧地址 `/gateway/oauth-access-tokens` 会跳转到这里；用户详情的 API Keys 页签下方列出该用户的授权。
- 由外部授权服务器签发、没有归属应用的旧授权显示为「未归属」，按客户端名称成组，可单独撤销。
- 接口：`/api/admin/oauth/apps*`（含 `POST /api/admin/oauth/apps/:id/clients` 签发手工客户端）、`/api/admin/oauth/clients*`（列表支持 `registration_method` 筛选；手工客户端的 `PATCH`、`DELETE`、`POST …/secret` 重置）、`/api/admin/oauth/authorization-requests/*`、`/api/admin/oauth-access-tokens*`、`POST /api/admin/users/:id/oauth-access-tokens/revoke`。客户端列表不返回 secret 哈希，只返回 `has_client_secret`。权限：`oauth.read` / `oauth.write`（应用目录、注册实例与授权管理）、`oauth.consent`（仅同意页所需的三个授权请求接口）、`user_keys.read` / `user_keys.write`（按用户的授权）。
- 从外部模式切换到内置模式的步骤见 [0036 迁移说明](../../operators/migrations/0036-oauth-authorization-server.md)；机密 / 手工 / CIMD 客户端需要的表结构见 [0037 迁移说明](../../operators/migrations/0037-oauth-client-credentials.md)。

### 接入新的 Agent

1. 先看客户端支持什么：动态注册（大多数桌面与 CLI 客户端）、CIMD（较新的 MCP 客户端），还是只能填固定 client_id / client_secret（服务端托管的连接器）。
2. 动态注册或 CIMD：确认它的回调已被某个应用覆盖。本机回环回调默认落到「Local MCP clients」；需要单独统计或分开停用时，新建应用写具体回调，必要时加名称关键字。注册被拒时看 Proxy 日志里的 `registration rejected` 记录。
3. 固定凭据：在对应应用下签发手工凭据，把授权地址 `{issuer}/oauth/authorize`、令牌地址 `{issuer}/oauth/token`、scope `mcp`、`client_id`、`client_secret` 填到对方平台；对方平台给出的回调域名写进应用规则（如 `https://*.workbuddy.cn`）或手工客户端自己的规则。
4. 客户端里填的 MCP 地址是 `{issuer}/mcp`（或 `{issuer}/mcp/{slug}` 只接一个服务）。

## 错误

协议错误（无法解析的 JSON、未知方法、未知名称或 URI）返回 JSON-RPC error。余额不足、条目已停用、上游失败或超时，作为 `tools/call` 的结果返回，`isError` 为 true，正文说明原因，`_meta.octafuse.code` 给出网关错误码。停用条目使用 `gateway.mcp_item_disabled`。计费规则无法解析时使用 `gateway.mcp_pricing_invalid`。结算或错误日志持久化失败时，返回 `gateway.mcp_settlement_failed` 与 `retryable: false`，不再追加零费用错误日志；提交结果可能不确定，需要对账确认，客户端不应自动重试。

## 安全

上游地址和鉴权头按密钥存储。列表和详情默认脱敏，明文只通过 `mcp.secrets.read` 的 reveal 接口返回。日志不记录这些值，也不会把用户的 `sk-` 转发给上游。

上游地址只允许 `https`。开发环境放行 `localhost`、`127.0.0.1` 和 `::1`。不允许 URL 用户信息，也不跟随重定向，避免鉴权头被带到其它主机。每个服务单独设置超时和响应大小上限。

## 接入参考

在管理后台的 MCP 服务页填写地址，也可以粘贴远程地址或客户端 JSON，自动填入地址和静态请求头。需要鉴权时，逐行填写静态请求头，或把密钥放在 URL 查询参数里。这两种写法都会原样交给上游。编辑时把请求头的值留空会保留原值。查询参数在列表中会显示为 `***`。调用记在请求日志里，把类型选为 MCP 工具后可以按 MCP 服务筛选。OAuth 登录和本地进程不能通过导入接入。

| 上游 | 地址 | 鉴权 |
|------|------|------|
| DeepWiki | `https://mcp.deepwiki.com/mcp` | 无 |
| Context7 | `https://mcp.context7.com/mcp` | 无 |
| 阿里云 IQS | 控制台给出的 Streamable HTTP 地址 | 请求头 `X-API-Key` |
| Tavily | 官方 MCP 地址 | 查询参数中的密钥 |
| 腾讯元宝搜索 | `https://api.wsa.cloud.tencent.com/Mcp` | 按官方要求的请求头 |

旧版 SSE 传输、stdio 进程和上游 OAuth 不在本期范围内。
