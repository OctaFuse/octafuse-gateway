# MCP 聚合入口

代理服务（Proxy）对外提供一个无会话的 MCP Streamable HTTP 入口。客户端只配置网关地址和用户 API Key，就能使用管理后台（Admin）已经审核过的远程 MCP 服务（MCP Servers）。

智能体工具（Agent Tools）的 REST 入口 `/v1/tools/*` 保持不变。MCP 入口只转发管理员接入的远程服务，不把现有 REST 工具改写成 MCP。

## 入口

| 路径 | 作用 |
|------|------|
| `POST /mcp` | 聚合所有已启用服务的工具、提示词和资源 |
| `POST /mcp/{slug}` | 只暴露这一个服务 |

认证与模型请求相同：`Authorization: Bearer sk-...`。不签发 `Mcp-Session-Id`。`GET` 与其它非 `POST` 方法返回 `405`。协议版本至少支持 `2025-06-18` 和 `2025-03-26`。

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

## 错误

协议错误（无法解析的 JSON、未知方法、未知名称或 URI）返回 JSON-RPC error。余额不足、条目已停用、上游失败或超时，作为 `tools/call` 的结果返回，`isError` 为 true，正文说明原因，`_meta.octafuse.code` 给出网关错误码。停用条目使用 `gateway.mcp_item_disabled`。计费规则无法解析时使用 `gateway.mcp_pricing_invalid`。

## 安全

上游地址和鉴权头按密钥存储。列表和详情默认脱敏，明文只通过 `mcp.secrets.read` 的 reveal 接口返回。日志不记录这些值，也不会把用户的 `sk-` 转发给上游。

上游地址只允许 `https`。开发环境放行 `localhost`、`127.0.0.1` 和 `::1`。不允许 URL 用户信息，也不跟随重定向，避免鉴权头被带到其它主机。每个服务单独设置超时和响应大小上限。

## 接入参考

在管理后台的 MCP 服务页填写地址，也可以粘贴远程地址或客户端 JSON，自动填入地址和静态请求头。需要鉴权时，逐行填写静态请求头，或把密钥放在 URL 查询参数里。这两种写法都会原样交给上游。编辑时把请求头的值留空会保留原值。查询参数在列表中会显示为 `***`。调用可以在调用记录里按 MCP 服务筛选。OAuth 登录和本地进程不能通过导入接入。

| 上游 | 地址 | 鉴权 |
|------|------|------|
| DeepWiki | `https://mcp.deepwiki.com/mcp` | 无 |
| Context7 | `https://mcp.context7.com/mcp` | 无 |
| 阿里云 IQS | 控制台给出的 Streamable HTTP 地址 | 请求头 `X-API-Key` |
| Tavily | 官方 MCP 地址 | 查询参数中的密钥 |
| 腾讯元宝搜索 | `https://api.wsa.cloud.tencent.com/Mcp` | 按官方要求的请求头 |

旧版 SSE 传输、stdio 进程和上游 OAuth 不在本期范围内。
