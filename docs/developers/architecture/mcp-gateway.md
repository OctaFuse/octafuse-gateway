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

只有 `tools/call` 计费，并写入请求日志。提示词和资源不计费，也不写请求日志。

单价取工具上的覆盖价；覆盖价为空时用服务默认价。三本账分别记录供应成本、标准价和用户计费。价格为 0 时仍然写一条成功日志，但不扣额度。余额不足时返回 `isError: true`，不请求上游，也不写扣费日志。

成功调用复用智能体工具的扣费：先扣周期额度，再扣永久额度。用户计费倍率不作用于 MCP 工具。上游传输失败、超时，或上游结果 `isError: true`，记 `status=error` 且金额为 0。

工具清单的 `_meta.octafuse` 带单价。成功结果的 `_meta.octafuse` 带本次实际扣费和请求日志 ID。

`/mcp` 跳过额度预检，余额为 0 时仍可列出清单。每分钟请求数只统计 `tools/call`。

## 错误

协议错误（无法解析的 JSON、未知方法、未知名称或 URI）返回 JSON-RPC error。余额不足、条目已停用、上游失败或超时，作为 `tools/call` 的结果返回，`isError` 为 true，正文说明原因，`_meta.octafuse.code` 给出网关错误码。停用条目使用 `gateway.mcp_item_disabled`。

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
