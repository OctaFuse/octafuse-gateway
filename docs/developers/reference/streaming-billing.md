# 流式 Chat 计费与取消（当前实现）

Proxy（`@octafuse/proxy`）在流式请求（`POST /v1/chat/completions`、`POST /v1/responses`、`POST /v1/messages`、Gemini `streamGenerateContent` 等；实现见 `packages/proxy/src/services/egress/*-driver.ts`）中解析上游 SSE 的 `usage`，写入 `api_key_request_logs` 并更新 `users.budget_spent`。客户端中途取消或断连时，仍尽量在有限时间内从上游 **drain** 读出末尾 usage，避免长期 `incomplete` / 0 token。Responses 的 usage 通常来自终态事件（`response.completed` / `response.incomplete`），并计入 reasoning / cached tokens。

本文描述 Chat / Messages / Gemini 的流式 token 计费。Images、Audio 与 Agent Tools 分别使用 image token / 按张、audio token / 按时长、固定按次计费，见 [用户 API](../api/user.md) 与 [文生图模型说明](./image-models.md)。

## 架构示意

```mermaid
flowchart LR
  subgraph client [客户端]
    Agent[downstream_AI_client]
  end
  subgraph gateway [Gateway]
    Chat[chat_route]
    Pump[pump_parse_usage]
    DB[(api_key_request_logs_users)]
  end
  subgraph upstream [上游]
    Provider[Provider_API]
  end
  Agent -->|"POST_stream"| Chat
  Chat --> Pump
  Pump -->|fetch_stream| Provider
  Provider -->|"SSE"| Pump
  Pump -->|"forward"| Agent
  Pump -->|"usage_落库"| DB
```

**旧问题（背景）**：若用 `TransformStream` + `flush()` 解析 usage，客户端 cancel 时 **`flush()` 不执行**，`usagePromise` 可能长期不 resolve。当前改为 **手动 pump**：断连后**只读上游、不写客户端**，在 `POST_DISCONNECT_DRAIN_MS` 内继续 read，再 `recordUsage`。

## 状态与扣费

```mermaid
flowchart LR
  subgraph status [api_key_request_logs.status]
    success[success]
    cancelled[cancelled]
    incomplete[incomplete]
    error[error]
  end
  subgraph billing [users.budget_spent]
    maybe[charged_cost_gt_0]
    no[no_charge]
  end
  success --> maybe
  cancelled --> maybe
  incomplete --> maybe
  error --> no
```

- `success`：流正常结束。
- `cancelled`：客户端断开，drain 后 resolve。
- `incomplete`：异常或安全超时，usage 不全。
- `error`：上游非 2xx；**不**按该次结果扣 `budget_spent`。
- 扣费：`status !== 'error'` 且 `charged_cost > 0`。金额公式：目录 `models.pricing_profile` 按 `input_tokens` 选档后，`charged_cost` / `metered_cost` = 目录价 × 有效倍率；`standard_cost` 仅为目录价。无 `schedule.mode`（存量）时有效倍率 = 基础倍率 × 命中窗 factor（未命中为 1）；`mode: "override"` 时命中窗用窗口 factor，未命中用基础倍率。每日时段在请求进入 Gateway 时锁定，长流式请求跨越边界不会切换倍率；该时刻写入 `pricing_audit.schedule.evaluated_at_utc`。嵌套 `price_override.metered` / `charged` tiers **忽略**。详见 `packages/proxy/src/services/usage-tracker.ts` 与 `packages/core/src/db/pricing-schedule.ts`。

## 常量

| 常量 | 典型值 | 含义 |
|------|--------|------|
| `POST_DISCONNECT_DRAIN_MS` | 各 driver 内定义（如 90s） | 断连后继续从上游读取的上限 |
| 安全超时 | 与路由 `USAGE_SAFETY_TIMEOUT_MS` 一致（如 5 min） | `usagePromise` 未 resolve 的兜底 |

**Workers**：`scheduleBackgroundWork` 内用 `ExecutionContext.waitUntil` 跑 `recordUsage`。**Node**：无 ExecutionContext 时退化为 detached Promise，语义仍是先响应、后台记账。

## Wrangler 配置

在 **`packages/proxy/wrangler.base.jsonc`**（生成后的 `wrangler.jsonc`）中启用请求取消信号（与断连检测配合）：

```jsonc
"compatibility_flags": ["nodejs_compat", "enable_request_signal"],
```

## 主要代码位置

| 文件 | 说明 |
|------|------|
| `packages/proxy/src/services/egress/openai-driver.ts` | OpenAI SSE：pump + drain |
| `packages/proxy/src/services/egress/anthropic-driver.ts` | Anthropic 流式 |
| `packages/proxy/src/services/egress/gemini-driver.ts` | Gemini 流式 |
| `packages/proxy/src/services/proxy.ts` | 组装路由与 `requestSignal` |
| `packages/proxy/src/routes/v1/chat.ts` 等 | 传入 signal、`cancelled` 状态 |
| `packages/proxy/src/services/usage-tracker.ts` | `recordUsage` |
| `packages/proxy/wrangler.base.jsonc` → 生成的 `wrangler.jsonc` | `enable_request_signal` |

## 限制与排查日志

- 上游在 drain 窗口内仍可能不发含 usage 的 chunk → 取消后 token 仍可能为 0。
- 部分请求仅出现 “Network connection lost” 而无 signal → 依赖写失败或安全超时。

日志关键词：`client disconnected, draining upstream`、`drain timeout`、`recordUsage`、`status=cancelled`。
